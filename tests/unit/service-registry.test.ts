/**
 * Long-lived fw processes announce themselves in a directory; readers see
 * the ones alive and drop the rest.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { announceService, listServices, isAlive, installRoot } from '../../src/service-registry';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-services-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('announceService', () => {
  it('writes a record for this process and withdraws it on retire', () => {
    const a = announceService({ kind: 'console', url: 'http://127.0.0.1:4311', project: '/p', dir });
    const rec = JSON.parse(fs.readFileSync(a.file, 'utf8'));
    expect(rec).toMatchObject({ kind: 'console', pid: process.pid, url: 'http://127.0.0.1:4311', project: '/p', activityCount: 0 });
    expect(typeof rec.version).toBe('string');
    expect(rec.install).toBe(installRoot());
    expect(path.basename(a.file)).toBe(`console-${process.pid}.json`);
    a.retire();
    expect(fs.existsSync(a.file)).toBe(false);
  });

  it('records activity and updates what is known', () => {
    const a = announceService({ kind: 'mcp-server', transport: 'stdio', dir });
    a.touch('fw_validate');
    a.update({ client: 'claude-code 2.1' });
    const rec = JSON.parse(fs.readFileSync(a.file, 'utf8'));
    expect(rec.activity).toBe('fw_validate');
    expect(rec.activityCount).toBe(1);
    expect(rec.client).toBe('claude-code 2.1');
    a.retire();
  });

  it('never throws when the directory cannot be written', () => {
    const a = announceService({ kind: 'serve', dir: path.join(dir, 'nope', 'deeper') });
    expect(() => { a.touch(); a.update({ url: 'x' }); a.retire(); }).not.toThrow();
  });
});

describe('listServices', () => {
  it('lists the services alive and removes the records of dead ones', () => {
    const live = announceService({ kind: 'console', dir });
    // A process id nothing could be using: written as a record, gone on read.
    fs.writeFileSync(path.join(dir, 'mcp-server-999999.json'), JSON.stringify({ kind: 'mcp-server', pid: 999999, version: '0', install: '/x', cwd: '/x', startedAt: '2026-01-01T00:00:00Z', lastActivityAt: '2026-01-01T00:00:00Z', activityCount: 0 }));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');
    const list = listServices(dir);
    expect(list.map((s) => s.pid)).toEqual([process.pid]);
    expect(fs.existsSync(path.join(dir, 'mcp-server-999999.json'))).toBe(false);
    live.retire();
  });

  it('is empty for a directory that does not exist', () => {
    expect(listServices(path.join(dir, 'missing'))).toEqual([]);
  });
});

describe('isAlive', () => {
  it('knows this process and not an impossible one', () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(999999)).toBe(false);
  });
});
