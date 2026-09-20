/**
 * The console's step-through debugger: the same controller the CLI and MCP
 * drive, seen as a session that pauses, is inspected, changed, and moved.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { DebugSessions, latestValues } from '../../../src/console/debug';

const useCases = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'use-cases');
const hello = path.join(useCases, 'hello-world.ts');
const triage = path.join(useCases, 'resume-yield-demo', 'incident-triage.ts');
const params = { firstName: 'Jane', lastName: 'Doe' };

describe('latestValues', () => {
  it('keeps the latest execution of each node.port', () => {
    expect(latestValues({ 'a:out:0': 1, 'a:out:2': 3, 'a:out:1': 2, 'b:x:0': 'k' })).toEqual({ 'a.out': 3, 'b.x': 'k' });
  });

  it('ignores keys that are not node:port:index', () => {
    expect(latestValues({ odd: 1, 'a:b': 2 })).toEqual({});
  });
});

describe('DebugSessions', () => {
  it('pauses before the first node, steps through, and completes', async () => {
    const seen: string[] = [];
    const changes: string[] = [];
    const sessions = new DebugSessions();
    let v = await sessions.start({ file: hello, name: 'helloWorld', params, onEvent: (e) => { seen.push(e.type); }, onChange: (x) => { changes.push(x.status); } });
    expect(v).toMatchObject({ status: 'paused', node: 'fmt', phase: 'before', position: 0, order: ['fmt', 'greet'] });

    v = await sessions.step(v.id);
    expect(v).toMatchObject({ status: 'paused', node: 'fmt', phase: 'after', position: 1 });
    expect(v.values['fmt.fullName']).toBe('Jane Doe');

    v = await sessions.continue(v.id);
    expect(v.status).toBe('completed');
    expect(v.result).toMatchObject({ message: 'Hello, Jane Doe! Welcome aboard.' });
    expect(seen).toContain('STATUS_CHANGED');
    // Every transition was announced: running while a step runs, paused at each stop.
    expect(changes).toEqual(['paused', 'running', 'paused', 'running', 'completed']);
  }, 60000);

  it('lets a produced value be changed before the next node reads it', async () => {
    const sessions = new DebugSessions();
    let v = await sessions.start({ file: hello, name: 'helloWorld', params });
    v = await sessions.step(v.id); // after fmt
    v = sessions.setVariable(v.id, 'fmt', 'fullName', 'Someone Else');
    expect(v.values['fmt.fullName']).toBe('Someone Else');
    v = await sessions.continue(v.id);
    expect(v.status).toBe('completed');
    expect((v.result as { message: string }).message).toBe('Hello, Someone Else! Welcome aboard.');
  }, 60000);

  it('refuses to set a value a node has not produced yet', async () => {
    const sessions = new DebugSessions();
    const v = await sessions.start({ file: hello, name: 'helloWorld', params });
    expect(() => sessions.setVariable(v.id, 'greet', 'message', 'x')).toThrow(/has no value yet/);
    await sessions.abort(v.id);
  }, 60000);

  it('runs to a breakpoint, and breakpoints can be changed while paused', async () => {
    const sessions = new DebugSessions();
    let v = await sessions.start({ file: hello, name: 'helloWorld', params, breakpoints: ['greet'] });
    expect(v.breakpoints).toEqual(['greet']);
    v = await sessions.continue(v.id, true);
    expect(v).toMatchObject({ status: 'paused', node: 'greet', phase: 'before' });
    v = sessions.breakpoint(v.id, 'remove', 'greet');
    expect(v.breakpoints).toEqual([]);
    v = await sessions.continue(v.id);
    expect(v.status).toBe('completed');
  }, 60000);

  it('aborts a paused session without calling it a failure', async () => {
    const sessions = new DebugSessions();
    let v = await sessions.start({ file: hello, name: 'helloWorld', params });
    v = await sessions.abort(v.id);
    expect(v.status).toBe('aborted');
    expect(v.error).toBeUndefined();
    await expect(sessions.step(v.id)).rejects.toThrow(/not paused/);
  }, 60000);

  it('uses the id it is given and lists the session from the start', async () => {
    const sessions = new DebugSessions();
    const v = await sessions.start({ id: 'dbg-1', file: hello, name: 'helloWorld', params });
    expect(v.id).toBe('dbg-1');
    expect(sessions.list().map((x) => x.id)).toEqual(['dbg-1']);
    await sessions.abort('dbg-1');
  }, 60000);

  it('reports a file that does not parse as a failed session', async () => {
    const sessions = new DebugSessions();
    const v = await sessions.start({ file: hello, name: 'noSuchWorkflow', params });
    expect(v.status).toBe('failed');
    expect(v.error).toBeTruthy();
  }, 60000);

  it('steps a gated workflow as far as its first gate, then says why it stops', async () => {
    const sessions = new DebugSessions();
    let v = await sessions.start({
      file: triage, name: 'incidentTriage',
      params: { incident: { incidentId: 'INC-1', service: 'api', severity: 'high', symptom: 'slow' } },
    });
    expect(v.status).toBe('paused');
    v = await sessions.continue(v.id);
    expect(v.status).toBe('yielded');
    expect(v.node).toBe('plan');
    expect(v.error).toMatch(/gate at plan/);
  }, 60000);
});
