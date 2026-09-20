/**
 * Long-lived `fw` processes announce themselves.
 *
 * An MCP server speaks stdio to the editor that started it, and nothing else
 * can connect to it to ask how it is. `fw serve` and `fw console` have
 * ports, but nobody knows which. So each writes a small record under
 * `~/.fw/services/` when it starts -- what it is, which install it runs
 * from, where, since when -- and touches it as it works. Anyone can read
 * the directory, and a record whose process is gone is dropped on reading.
 * The same idea as the run store: a directory on disk is the shared truth.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from './generated-version.js';

export type ServiceKind = 'mcp-server' | 'serve' | 'console';

export interface ServiceRecord {
  kind: ServiceKind;
  pid: number;
  /** Flow Weaver's version, and the install it runs from. */
  version: string;
  install: string;
  /** Where it was started. */
  cwd: string;
  /** The project it serves, when that is not the working directory. */
  project?: string;
  url?: string;
  transport?: 'stdio' | 'http';
  /** What is on the other end, when known: the MCP client's name and version. */
  client?: string;
  startedAt: string;
  lastActivityAt: string;
  /** The last thing it did: a tool name, a request. */
  activity?: string;
  activityCount: number;
}

export function servicesDir(): string {
  return process.env.FW_SERVICES_DIR ?? path.join(os.homedir(), '.fw', 'services');
}

/** The package this module runs from: `dist/` or `src/` sits one level below it. */
export function installRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/** Whether a process exists. `EPERM` means it exists but is not ours. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface Announcement {
  readonly file: string;
  /** Note activity, at most one write a second. */
  touch(activity?: string): void;
  /** Change what is known about the service (its client, its project). */
  update(patch: Partial<Pick<ServiceRecord, 'client' | 'project' | 'url'>>): void;
  /** Withdraw the record. Also done on exit. */
  retire(): void;
}

function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/**
 * Announce this process. Best effort throughout: a service must never fail
 * to start because its status directory could not be written.
 */
export function announceService(init: { kind: ServiceKind; cwd?: string; project?: string; url?: string; transport?: 'stdio' | 'http'; dir?: string }): Announcement {
  const dir = init.dir ?? servicesDir();
  const file = path.join(dir, `${init.kind}-${process.pid}.json`);
  const now = new Date().toISOString();
  let record: ServiceRecord = {
    kind: init.kind, pid: process.pid, version: VERSION, install: installRoot(),
    cwd: init.cwd ?? process.cwd(), project: init.project, url: init.url, transport: init.transport,
    startedAt: now, lastActivityAt: now, activityCount: 0,
  };
  const write = () => {
    try { fs.mkdirSync(dir, { recursive: true }); writeAtomic(file, JSON.stringify(record)); } catch { /* status is a courtesy */ }
  };
  write();
  let lastWrite = Date.now();
  let pending: NodeJS.Timeout | undefined;
  const retire = () => {
    if (pending) clearTimeout(pending);
    try { fs.rmSync(file, { force: true }); } catch { /* gone already */ }
  };
  process.once('exit', retire);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => { retire(); });
  }
  return {
    file,
    touch(activity) {
      record = { ...record, lastActivityAt: new Date().toISOString(), activity: activity ?? record.activity, activityCount: record.activityCount + 1 };
      const due = 1000 - (Date.now() - lastWrite);
      if (due <= 0) { lastWrite = Date.now(); write(); }
      else if (!pending) pending = setTimeout(() => { pending = undefined; lastWrite = Date.now(); write(); }, due).unref?.() as unknown as NodeJS.Timeout | undefined;
    },
    update(patch) {
      record = { ...record, ...patch };
      write();
    },
    retire,
  };
}

/** Every service alive now, newest first. Records of dead processes are removed as they are found. */
export function listServices(dir: string = servicesDir()): ServiceRecord[] {
  let names: string[];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out: ServiceRecord[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let record: ServiceRecord;
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')) as ServiceRecord; } catch { continue; }
    if (!record || typeof record.pid !== 'number' || !isAlive(record.pid)) {
      try { fs.rmSync(file, { force: true }); } catch { /* someone else did */ }
      continue;
    }
    out.push(record);
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
