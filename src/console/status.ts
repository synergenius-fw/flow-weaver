/**
 * The state of everything around a project: which fw services are alive,
 * which editors have the MCP server registered and from which install,
 * whether the environment passes `fw doctor`, whether the registries
 * answer.
 *
 * Nothing here can talk to a running MCP server -- it speaks stdio to the
 * editor that owns it -- so what is known about one is what it announced
 * about itself (see `service-registry.ts`).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listServices, installRoot, type ServiceRecord } from '../service-registry.js';
import { runDoctorChecks, type DoctorReport } from '../cli/commands/doctor.js';
import { resolveRegistries, type Registry } from '../marketplace/npmrc.js';
import { VERSION } from '../generated-version.js';

export interface McpRegistration {
  /** The editor, as `fw mcp-setup` names it. */
  tool: string;
  file: string;
  command: string;
  args: string[];
  /** What the registration runs: this install, another one on disk, or whatever npm serves as latest. */
  runs: 'this install' | 'other install' | 'npm latest' | 'unknown';
  install?: string;
}

const realpath = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/**
 * What a registration's command line would start: `npx @synergenius/flow-weaver@latest`
 * means whatever npm serves; a path to a `flow-weaver.mjs` or a checkout
 * names an install, compared with the one answering here.
 */
export function installVerdict(command: string, args: string[], here: string = installRoot()): { runs: McpRegistration['runs']; install?: string } {
  const all = [command, ...args];
  if (all.some((a) => /@synergenius\/flow-weaver(@|$)/.test(a)) && /npx|pnpm|yarn|bunx/.test(command)) return { runs: 'npm latest' };
  const pathArg = all.find((a) => /flow-weaver\.mjs$|[\\/]flow-weaver([\\/]|$)/.test(a) && /[\\/]/.test(a));
  if (!pathArg) return { runs: 'unknown' };
  // The install root is the package directory the entry file sits in.
  let install = realpath(pathArg);
  for (let i = 0; i < 6 && !fs.existsSync(path.join(install, 'package.json')); i++) install = path.dirname(install);
  return { runs: realpath(install) === realpath(here) ? 'this install' : 'other install', install };
}

interface McpEntry { command?: string; args?: string[] }

function readJson(file: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return null; }
}

/** The editors with a `flow-weaver` MCP server registered, read from the files `fw mcp-setup` writes. */
export function mcpRegistrations(projectDir: string, home: string = os.homedir(), here: string = installRoot()): McpRegistration[] {
  const out: McpRegistration[] = [];
  const add = (tool: string, file: string, entry: McpEntry | undefined) => {
    if (!entry || typeof entry.command !== 'string') return;
    const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
    out.push({ tool, file, command: entry.command, args, ...installVerdict(entry.command, args, here) });
  };
  const servers = (file: string, key: string): McpEntry | undefined => {
    const cfg = readJson(file);
    const map = cfg?.[key] as Record<string, McpEntry> | undefined;
    return map?.['flow-weaver'];
  };
  // Claude Code: project scope in .mcp.json; user scope, and per-project entries, in ~/.claude.json.
  add('Claude Code (project)', path.join(projectDir, '.mcp.json'), servers(path.join(projectDir, '.mcp.json'), 'mcpServers'));
  const claude = readJson(path.join(home, '.claude.json'));
  if (claude) {
    add('Claude Code (user)', path.join(home, '.claude.json'), (claude.mcpServers as Record<string, McpEntry> | undefined)?.['flow-weaver']);
    const projects = claude.projects as Record<string, { mcpServers?: Record<string, McpEntry> }> | undefined;
    const mine = projects?.[projectDir] ?? projects?.[realpath(projectDir)];
    add('Claude Code (this project)', path.join(home, '.claude.json'), mine?.mcpServers?.['flow-weaver']);
  }
  add('Cursor', path.join(projectDir, '.cursor', 'mcp.json'), servers(path.join(projectDir, '.cursor', 'mcp.json'), 'mcpServers'));
  add('VS Code', path.join(projectDir, '.vscode', 'mcp.json'), servers(path.join(projectDir, '.vscode', 'mcp.json'), 'servers'));
  add('Windsurf', path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), servers(path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers'));
  add('OpenClaw', path.join(projectDir, 'openclaw.json'), servers(path.join(projectDir, 'openclaw.json'), 'mcpServers'));
  return out;
}

export interface Probe { url: string; ok: boolean; status?: number; ms?: number; error?: string }

/** Ask a URL once, briefly. */
export async function probe(url: string, init?: RequestInit, timeoutMs = 2500): Promise<Probe> {
  const started = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    return { url, ok: res.ok, status: res.status, ms: Date.now() - started };
  } catch (err) {
    return { url, ok: false, ms: Date.now() - started, error: err instanceof Error ? (err.name === 'AbortError' ? 'timed out' : err.message) : String(err) };
  } finally {
    clearTimeout(t);
  }
}

export interface RegistryStatus extends Probe { scopes: string[]; authenticated: boolean; user?: string }

/** Each configured registry, asked who we are -- which says both that it answers and that the token works. */
export async function registryStatuses(projectDir: string, registries: Registry[] = resolveRegistries(projectDir)): Promise<RegistryStatus[]> {
  return Promise.all(registries.map(async (r) => {
    const url = `${r.url}-/whoami`;
    const started = Date.now();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    try {
      const res = await fetch(url, { headers: r.authorization ? { Authorization: r.authorization } : {}, signal: ctl.signal });
      let user: string | undefined;
      if (res.ok) { try { user = ((await res.json()) as { username?: string }).username; } catch { /* not json */ } }
      // Without credentials the public registry answers 401 to whoami while being perfectly reachable.
      const reachable = res.ok || (!r.authorization && (res.status === 401 || res.status === 403));
      return { url: r.url, scopes: r.scopes, authenticated: !!r.authorization, ok: reachable, status: res.status, ms: Date.now() - started, user };
    } catch (err) {
      return { url: r.url, scopes: r.scopes, authenticated: !!r.authorization, ok: false, ms: Date.now() - started, error: err instanceof Error ? (err.name === 'AbortError' ? 'timed out' : err.message) : String(err) };
    } finally {
      clearTimeout(t);
    }
  }));
}

export interface StatusReport {
  console: { version: string; install: string; project: string; url: string; watching: boolean; runsDir: string };
  services: Array<ServiceRecord & { alive: true }>;
  mcp: { registrations: McpRegistration[]; running: ServiceRecord[] };
  doctor: DoctorReport;
  http: Array<{ service: ServiceRecord; probe: Probe }>;
  registries: RegistryStatus[];
  at: string;
}

export async function describeStatus(projectDir: string, info: { url: string; watching: boolean; runsDir: string }): Promise<StatusReport> {
  const services = listServices().map((s) => ({ ...s, alive: true as const }));
  const serve = services.filter((s) => s.kind === 'serve' && s.url);
  const [http, registries] = await Promise.all([
    Promise.all(serve.map(async (service) => ({ service, probe: await probe(`${service.url!.replace(/\/$/, '')}/health`) }))),
    registryStatuses(projectDir),
  ]);
  return {
    console: { version: VERSION, install: installRoot(), project: projectDir, url: info.url, watching: info.watching, runsDir: info.runsDir },
    services,
    mcp: { registrations: mcpRegistrations(projectDir), running: services.filter((s) => s.kind === 'mcp-server') },
    doctor: runDoctorChecks(projectDir),
    http,
    registries,
    at: new Date().toISOString(),
  };
}
