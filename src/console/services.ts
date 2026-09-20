/**
 * The project's long-lived services, run by the console.
 *
 * `fw serve` and `fw watch` run until stopped, which is why the CLI pane
 * refuses them. Here they are children the console owns: started with the
 * settings from the Server card, their output kept and streamed, stopped
 * and restarted from the page, and stopped with the console. A server
 * someone started from a terminal for the same project is shown beside
 * them from the service registry, and can be stopped -- it is our process
 * on our machine -- but not restarted or read, since it is not ours.
 *
 * Settings live per project under the user's home, never in the project
 * tree. A token is generated per start and handed to the child through
 * the environment; the page shows it because anyone who reaches the
 * console can already run every workflow.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listServices, isAlive, type ServiceRecord } from '../service-registry.js';
import { resolveCliEntry } from './cli-run.js';

export type ManagedKind = 'serve' | 'watch';

export interface ServeSettings {
  port: number;
  host: string;
  /** Guard the server with a token generated at start. */
  auth: 'token' | 'open';
  agents: boolean;
  trace: boolean;
  dev: boolean;
  swagger: boolean;
  /** Start it when the console opens. */
  autoStart: boolean;
}
export interface WatchSettings { autoStart: boolean }
export interface ServiceSettings { serve: ServeSettings; watch: WatchSettings }

export const DEFAULT_SETTINGS: ServiceSettings = {
  serve: { port: 3000, host: '127.0.0.1', auth: 'token', agents: true, trace: true, dev: false, swagger: false, autoStart: false },
  watch: { autoStart: false },
};

export interface LogLine { t: number; stream: 'out' | 'err'; text: string }

export type ServiceState = 'stopped' | 'starting' | 'running' | 'exited';

export interface ServiceView {
  kind: ManagedKind;
  state: ServiceState;
  /** Started by this console, so it can be restarted and read. */
  owned: boolean;
  pid?: number;
  url?: string;
  startedAt?: string;
  /** For an exited child: how it ended, and the last thing it said. */
  exitCode?: number | null;
  error?: string;
  /** Kept log lines, for the drawer to know there is something to open. */
  lines: number;
  /** The token the running server wants; only for a server this console started. */
  token?: string;
  /** What the registry knows: requests answered, the last one, the install. */
  activity?: { count: number; last?: string; at: string; version: string; install: string };
  /** Other processes of this kind for the project, not ours. */
  others: Array<{ pid: number; url?: string; startedAt: string; version: string; install: string }>;
}

export interface SupervisorOptions {
  projectDir: string;
  /** Where settings are kept. Default `~/.fw/console`, or `FW_CONSOLE_DIR`. */
  settingsDir?: string;
  /** Start a child; a test hands in a fake. */
  spawn?: (args: string[], cwd: string, env: NodeJS.ProcessEnv) => ChildProcess;
  /** Called whenever a service changes state or says something. */
  onChange?: (event: { kind: ManagedKind; state: ServiceState; line?: LogLine; url?: string; exitCode?: number | null; error?: string }) => void;
  /** Where the registry is read from; a test points it elsewhere. */
  registryDir?: string;
}

const MAX_LINES = 500;
const STOP_GRACE_MS = 5000;

interface Child {
  kind: ManagedKind;
  proc: ChildProcess;
  state: ServiceState;
  startedAt: string;
  url?: string;
  token?: string;
  exitCode?: number | null;
  error?: string;
  lines: LogLine[];
  stopping?: boolean;
}

export function consoleSettingsDir(): string {
  return process.env.FW_CONSOLE_DIR ?? path.join(os.homedir(), '.fw', 'console');
}

/** Start this install's `fw <args>` with the environment given. */
function spawnFwWith(args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const { exec, prefix } = resolveCliEntry();
  return spawn(exec, [...prefix, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

export class Supervisor {
  private readonly children = new Map<ManagedKind, Child>();
  private readonly listeners = new Map<ManagedKind, Set<(line: LogLine) => void>>();
  private readonly file: string;
  private cache?: ServiceSettings;
  readonly projectDir: string;

  constructor(private readonly opts: SupervisorOptions) {
    this.projectDir = path.resolve(opts.projectDir);
    const dir = opts.settingsDir ?? consoleSettingsDir();
    this.file = path.join(dir, `${createHash('sha256').update(real(this.projectDir)).digest('hex').slice(0, 16)}.json`);
  }

  // ---------------------------------------------------------- settings

  settings(): ServiceSettings {
    if (this.cache) return this.cache;
    let stored: Partial<ServiceSettings> = {};
    try { stored = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<ServiceSettings>; } catch { stored = {}; }
    this.cache = {
      serve: { ...DEFAULT_SETTINGS.serve, ...(stored.serve ?? {}) },
      watch: { ...DEFAULT_SETTINGS.watch, ...(stored.watch ?? {}) },
    };
    return this.cache;
  }

  saveSettings<K extends ManagedKind>(kind: K, patch: Partial<ServiceSettings[K]>): ServiceSettings {
    const current = this.settings();
    const next: ServiceSettings = { ...current, [kind]: { ...current[kind], ...patch } };
    if (kind === 'serve') {
      const s = next.serve;
      if (!Number.isInteger(s.port) || s.port < 0 || s.port > 65535) throw new Error('port must be a whole number between 0 and 65535');
      if (!/^[A-Za-z0-9.:[\]-]+$/.test(s.host)) throw new Error('host must be a host name or an address');
      if (s.auth !== 'token' && s.auth !== 'open') throw new Error('auth is token or open');
      if (s.auth === 'open' && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(s.host)) throw new Error('a server beyond loopback needs a token: set auth to token, or host to 127.0.0.1');
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, this.file);
    this.cache = next;
    return next;
  }

  // ------------------------------------------------------------ control

  /** Start a service with the saved settings. A running one is left alone. */
  start(kind: ManagedKind): ServiceView {
    const existing = this.children.get(kind);
    if (existing && (existing.state === 'running' || existing.state === 'starting')) return this.view(kind);
    const others = this.registryFor(kind);
    if (kind === 'serve' && others.length) throw new Error(`fw serve is already running for this project (pid ${others[0].pid}${others[0].url ? `, ${others[0].url}` : ''}); stop it first`);

    const settings = this.settings();
    const { NODE_OPTIONS: _flags, VITEST: _test, ...base } = process.env;
    const env: NodeJS.ProcessEnv = { ...base, FORCE_COLOR: '0', NO_COLOR: '1' };
    let args: string[];
    let token: string | undefined;
    if (kind === 'serve') {
      const s = settings.serve;
      args = ['serve', this.projectDir, '--port', String(s.port), '--host', s.host];
      if (s.auth === 'token') { token = randomBytes(24).toString('hex'); env.FW_SERVE_TOKEN = token; } else { delete env.FW_SERVE_TOKEN; if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(s.host)) args.push('--insecure'); }
      if (!s.agents) args.push('--no-agents');
      if (s.trace) args.push('--trace');
      if (s.dev) args.push('--dev');
      if (s.swagger) args.push('--swagger');
    } else {
      args = ['watch', this.projectDir];
    }

    const proc = (this.opts.spawn ?? spawnFwWith)(args, this.projectDir, env);
    const child: Child = { kind, proc, state: 'starting', startedAt: new Date().toISOString(), token, lines: [] };
    this.children.set(kind, child);
    // Watch is running as soon as it is up; a server is running once it says where it listens.
    if (kind === 'watch') child.state = 'running';

    const onData = (stream: 'out' | 'err') => (chunk: Buffer) => {
      for (const raw of chunk.toString().split(/\r?\n/)) {
        if (!raw.trim()) continue;
        const line: LogLine = { t: Date.now(), stream, text: raw };
        child.lines.push(line);
        if (child.lines.length > MAX_LINES) child.lines.splice(0, child.lines.length - MAX_LINES);
        const listening = /Listening:\s*(https?:\/\/\S+)/.exec(raw);
        if (listening && child.state === 'starting') {
          child.state = 'running';
          child.url = listening[1];
          this.opts.onChange?.({ kind, state: 'running', url: child.url });
        }
        for (const fn of this.listeners.get(kind) ?? []) fn(line);
        this.opts.onChange?.({ kind, state: child.state, line });
      }
    };
    proc.stdout?.on('data', onData('out'));
    proc.stderr?.on('data', onData('err'));
    proc.on('error', (err) => {
      child.state = 'exited';
      child.error = err.message;
      this.opts.onChange?.({ kind, state: 'exited', error: err.message });
    });
    proc.on('close', (code) => {
      if (child.state === 'exited') return;
      child.state = 'exited';
      child.exitCode = code;
      const lastErr = [...child.lines].reverse().find((l) => l.stream === 'err')?.text;
      if (code && code !== 0 && !child.stopping) child.error = lastErr ?? `exited with code ${code}`;
      this.opts.onChange?.({ kind, state: 'exited', exitCode: code, error: child.error });
    });
    this.opts.onChange?.({ kind, state: child.state });
    return this.view(kind);
  }

  /** Stop our child of this kind, or another process of this kind for the project by pid. */
  async stop(kind: ManagedKind, pid?: number): Promise<ServiceView> {
    const child = this.children.get(kind);
    if (child && (pid === undefined || child.proc.pid === pid) && child.state !== 'exited') {
      child.stopping = true;
      await terminate(child.proc);
      return this.view(kind);
    }
    if (pid !== undefined) {
      const other = this.registryFor(kind).find((r) => r.pid === pid);
      if (!other) throw new Error(`no ${kind} with pid ${pid} for this project`);
      try { process.kill(pid, 'SIGTERM'); } catch (e) { throw new Error(`could not stop pid ${pid}: ${(e as Error).message}`); }
      const end = Date.now() + STOP_GRACE_MS;
      while (Date.now() < end && isAlive(pid)) await sleep(100);
      if (isAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    }
    return this.view(kind);
  }

  async restart(kind: ManagedKind): Promise<ServiceView> {
    await this.stop(kind);
    return this.start(kind);
  }

  /** Stop every child; called when the console closes. */
  async close(): Promise<void> {
    await Promise.all([...this.children.values()].filter((c) => c.state !== 'exited').map((c) => { c.stopping = true; return terminate(c.proc); }));
  }

  // -------------------------------------------------------------- reading

  logs(kind: ManagedKind): LogLine[] {
    return [...(this.children.get(kind)?.lines ?? [])];
  }

  /** Every new line as it arrives. Returns the unsubscribe. */
  onLog(kind: ManagedKind, fn: (line: LogLine) => void): () => void {
    const set = this.listeners.get(kind) ?? this.listeners.set(kind, new Set()).get(kind)!;
    set.add(fn);
    return () => { set.delete(fn); };
  }

  view(kind: ManagedKind): ServiceView {
    const child = this.children.get(kind);
    const records = this.registryFor(kind);
    const mine = child && child.state !== 'exited' ? records.find((r) => r.pid === child.proc.pid) : undefined;
    const others = records.filter((r) => r.pid !== child?.proc.pid).map((r) => ({ pid: r.pid, url: r.url, startedAt: r.startedAt, version: r.version, install: r.install }));
    const activity = (r: ServiceRecord | undefined) => (r ? { count: r.activityCount, last: r.activity, at: r.lastActivityAt, version: r.version, install: r.install } : undefined);
    if (child) {
      return {
        kind, state: child.state, owned: true, pid: child.proc.pid, url: child.url ?? mine?.url, startedAt: child.startedAt,
        exitCode: child.exitCode, error: child.error, lines: child.lines.length, token: child.token, activity: activity(mine), others,
      };
    }
    // Nothing of ours: a process from elsewhere stands in as the running one.
    const first = records[0];
    return first
      ? { kind, state: 'running', owned: false, pid: first.pid, url: first.url, startedAt: first.startedAt, lines: 0, activity: activity(first), others: others.filter((o) => o.pid !== first.pid) }
      : { kind, state: 'stopped', owned: false, lines: 0, others: [] };
  }

  list(): ServiceView[] {
    return (['serve', 'watch'] as const).map((k) => this.view(k));
  }

  private registryFor(kind: ManagedKind): ServiceRecord[] {
    const here = real(this.projectDir);
    return listServices(this.opts.registryDir).filter((s) => s.kind === kind && real(s.project ?? s.cwd) === here);
  }
}

const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SIGTERM, a grace period, then SIGKILL. Resolves when the process is gone. */
function terminate(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) { resolve(); return; }
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, STOP_GRACE_MS);
    proc.once('close', () => { clearTimeout(timer); resolve(); });
    try { proc.kill('SIGTERM'); } catch { clearTimeout(timer); resolve(); }
  });
}
