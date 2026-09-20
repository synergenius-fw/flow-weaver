/**
 * The supervisor behind the console's Server card: it starts `fw serve` and
 * `fw watch` with the saved settings and a generated token, reads what they
 * say, knows when a server is listening, stops and restarts them, keeps
 * settings per project outside the project, and shows a server started
 * elsewhere from the registry. A fake child stands in for the CLI.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { Supervisor, DEFAULT_SETTINGS } from '../../src/console/services.js';

/** Enough of a ChildProcess for the supervisor: pipes, pid, kill, close. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  constructor(readonly pid: number, readonly args: string[], readonly env: NodeJS.ProcessEnv) { super(); }
  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.killed = true;
    this.signalCode = signal;
    setTimeout(() => this.emit('close', null, signal), 5);
    return true;
  }
  say(text: string) { this.stdout.write(`${text}\n`); }
  complain(text: string) { this.stderr.write(`${text}\n`); }
  exit(code: number) { this.exitCode = code; this.emit('close', code, null); }
}

let dir: string;
let settingsDir: string;
let registryDir: string;
let spawned: FakeChild[];
let nextPid: number;
const events: string[] = [];

const make = () => new Supervisor({
  projectDir: dir, settingsDir, registryDir,
  spawn: (args, _cwd, env) => { const c = new FakeChild(nextPid++, args, env); spawned.push(c); return c as unknown as ChildProcess; },
  onChange: (e) => { if (!e.line) events.push(`${e.kind}:${e.state}`); },
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-svc-project-'));
  settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-svc-settings-'));
  registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-svc-registry-'));
  spawned = []; nextPid = 50_000; events.length = 0;
});
afterEach(() => { for (const d of [dir, settingsDir, registryDir]) fs.rmSync(d, { recursive: true, force: true }); });

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('the supervisor', () => {
  it('starts fw serve with the settings and a token, and knows when it listens', async () => {
    const s = make();
    expect(s.settings()).toEqual(DEFAULT_SETTINGS);
    s.saveSettings('serve', { port: 4000, trace: false, swagger: true });
    const starting = s.start('serve');
    expect(starting.state).toBe('starting');
    expect(starting.owned).toBe(true);
    const child = spawned[0];
    expect(child.args).toEqual(['serve', dir, '--port', '4000', '--host', '127.0.0.1', '--swagger']);
    expect(child.env.FW_SERVE_TOKEN).toMatch(/^[0-9a-f]{48}$/);
    expect(child.env.NO_COLOR).toBe('1');
    expect(starting.token).toBe(child.env.FW_SERVE_TOKEN);

    child.say('Flow Weaver Server');
    child.say('Listening: http://127.0.0.1:4000  (3 workflow endpoints)');
    await settle();
    const running = s.view('serve');
    expect(running.state).toBe('running');
    expect(running.url).toBe('http://127.0.0.1:4000');
    expect(running.lines).toBe(2);
    expect(s.logs('serve').map((l) => l.text)).toEqual(['Flow Weaver Server', 'Listening: http://127.0.0.1:4000  (3 workflow endpoints)']);
    expect(events).toEqual(['serve:starting', 'serve:running']);
    // Starting again while it runs is a no-op.
    expect(s.start('serve').pid).toBe(child.pid);
    expect(spawned).toHaveLength(1);
  });

  it('runs open on loopback without a token, and refuses open beyond loopback', () => {
    const s = make();
    s.saveSettings('serve', { auth: 'open' });
    s.start('serve');
    expect(spawned[0].env.FW_SERVE_TOKEN).toBeUndefined();
    expect(spawned[0].args).not.toContain('--insecure');
    expect(() => s.saveSettings('serve', { host: '0.0.0.0' })).toThrow(/needs a token/);
    expect(() => s.saveSettings('serve', { port: 70000 })).toThrow(/port/);
  });

  it('stops, restarts, and records how a child ended', async () => {
    const s = make();
    s.start('serve');
    spawned[0].say('Listening: http://127.0.0.1:3000');
    await settle();
    const stopped = await s.stop('serve');
    expect(spawned[0].killed).toBe(true);
    expect(stopped.state).toBe('exited');
    expect(stopped.error).toBeUndefined();               // asked to stop: not an error

    const again = await s.restart('serve');
    expect(again.state).toBe('starting');
    expect(spawned).toHaveLength(2);
    spawned[1].complain('Error: Port 3000 is already in use');
    spawned[1].exit(1);
    await settle();
    const crashed = s.view('serve');
    expect(crashed.state).toBe('exited');
    expect(crashed.exitCode).toBe(1);
    expect(crashed.error).toBe('Error: Port 3000 is already in use');
    expect(events.at(-1)).toBe('serve:exited');
  });

  it('streams lines to a listener until it unsubscribes, and keeps at most five hundred', async () => {
    const s = make();
    s.start('watch');
    expect(s.view('watch').state).toBe('running');   // no port to wait for
    const seen: string[] = [];
    const off = s.onLog('watch', (l) => seen.push(l.text));
    spawned[0].say('compiled a.ts');
    await settle();
    off();
    spawned[0].say('compiled b.ts');
    await settle();
    expect(seen).toEqual(['compiled a.ts']);
    for (let i = 0; i < 600; i++) spawned[0].say(`line ${i}`);
    await settle();
    expect(s.logs('watch')).toHaveLength(500);
    expect(s.logs('watch')[0].text).toBe('line 100');   // two compiled lines, then 600: the oldest 102 are gone
  });

  it('keeps settings per project outside the project, and reads them back fresh', () => {
    const s = make();
    s.saveSettings('serve', { port: 4100, autoStart: true });
    s.saveSettings('watch', { autoStart: true });
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(fs.readdirSync(settingsDir)).toHaveLength(1);
    const later = make();
    expect(later.settings().serve).toMatchObject({ port: 4100, autoStart: true, host: '127.0.0.1' });
    expect(later.settings().watch.autoStart).toBe(true);
  });

  it('shows a server started elsewhere, refuses to start a second, and can stop it', async () => {
    fs.writeFileSync(path.join(registryDir, 'serve-1.json'), JSON.stringify({
      kind: 'serve', pid: process.pid, version: '0.0.0', install: '/elsewhere', cwd: dir, project: dir, url: 'http://127.0.0.1:3999',
      startedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), activityCount: 7, activity: 'POST /reviews',
    }));
    const s = make();
    const v = s.view('serve');
    expect(v).toMatchObject({ state: 'running', owned: false, pid: process.pid, url: 'http://127.0.0.1:3999', activity: { count: 7, last: 'POST /reviews' } });
    expect(v.token).toBeUndefined();
    expect(() => s.start('serve')).toThrow(/already running/);
    await expect(s.stop('serve', 424242)).rejects.toThrow(/no serve with pid/);
  });

  it('stops every child when closed', async () => {
    const s = make();
    s.start('serve');
    s.start('watch');
    await s.close();
    expect(spawned.every((c) => c.killed)).toBe(true);
    expect(s.list().map((v) => v.state)).toEqual(['exited', 'exited']);
  });
});
