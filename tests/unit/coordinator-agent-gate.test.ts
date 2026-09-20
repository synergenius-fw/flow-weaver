/**
 * An agent gate answered through the coordinator: the profile is found, the
 * run says an answer is in progress, the transcript is kept beside the run,
 * and the run continues -- or stays waiting for a person when the profile
 * is missing, not ready, or the model gives nothing usable.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLocalCoordinator, answerAgentGate, autoAnswerAgentGates, transcriptName, type AgentTranscript } from '../../src/coordinator/index.js';
import { agentsFile } from '../../src/agent/profiles.js';
import { SUBMIT_TOOL, REJECT_TOOL } from '../../src/agent/gate.js';
import type { AgentProvider, StreamEvent } from '../../src/agent/types.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'continuation', 'fixtures');
const agentFile = path.join(fixtures, 'durable-agent-labeled.ts');

let rootDir: string;
let projectDir: string;
beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-runs-'));
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-proj-'));
});
afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
});

const profiles = (yaml = `default: reviewer\nagents:\n  reviewer:\n    provider: anthropic\n    model: m\n`) => {
  fs.mkdirSync(path.dirname(agentsFile(projectDir)), { recursive: true });
  fs.writeFileSync(agentsFile(projectDir), yaml);
};
const env = { ANTHROPIC_API_KEY: 'test' };

function playing(turns: StreamEvent[][]): () => AgentProvider {
  return () => {
    let i = 0;
    return { async *stream() { for (const ev of turns[i++] ?? [{ type: 'message_stop', finishReason: 'stop' }]) yield ev; } };
  };
}
const call = (name: string, args: Record<string, unknown>): StreamEvent[] => [
  { type: 'tool_use_start', id: 't', name }, { type: 'tool_use_end', id: 't', arguments: args },
  { type: 'usage', promptTokens: 10, completionTokens: 5 }, { type: 'message_stop', finishReason: 'tool_calls' },
];

describe('answerAgentGate', () => {
  it('answers the gate, keeps the transcript, and records the note without resuming', async () => {
    profiles();
    const c = createLocalCoordinator({ rootDir });
    const paused = await c.start({ filePath: agentFile, params: { path: 'notes.md', text: 'TODO: ship it.' } });
    expect(paused.status).toBe('waiting');
    expect(paused.gate?.kind).toBe('agent');

    const events: string[] = [];
    const step = await answerAgentGate(c, paused.runId, {
      projectDir, env, provider: playing([call(SUBMIT_TOOL, { summary: 'No tests.', risk: 'high' })]), onEvent: (e) => events.push(e.phase),
    });
    expect(step.kind).toBe('answer');
    if (step.kind !== 'answer') return;
    expect(step.answer).toEqual({ summary: 'No tests.', risk: 'high' });
    expect(step.note).toMatchObject({ status: 'answered', profile: 'reviewer', provider: 'anthropic', model: 'm', node: 'agent', usage: { promptTokens: 10, completionTokens: 5 }, toolCalls: 1 });
    expect(events[0]).toBe('start');
    expect(events.at(-1)).toBe('done');

    // Still waiting: answering and resuming are separate.
    const rec = (await c.record(paused.runId))!;
    expect(rec.status).toBe('waiting');
    expect(rec.agent?.status).toBe('answered');
    const kept = (await c.kept<AgentTranscript>(paused.runId, transcriptName(rec.gate!.id)))!;
    expect(kept.outcome).toEqual({ kind: 'answer', answer: { summary: 'No tests.', risk: 'high' } });
    expect(kept.messages.length).toBeGreaterThan(0);
  });

  it('leaves a gate alone when no profile matches, when the run is manual, and when the gate is not an agent gate', async () => {
    const c = createLocalCoordinator({ rootDir });
    const noProfile = await c.start({ filePath: agentFile, params: { path: 'a', text: 'b' } });
    expect(await answerAgentGate(c, noProfile.runId, { projectDir, env })).toEqual({ kind: 'skip', why: 'no-profile' });

    profiles();
    const manual = await c.start({ filePath: agentFile, params: { path: 'a', text: 'b' }, agents: 'manual' });
    expect(await answerAgentGate(c, manual.runId, { projectDir, env })).toEqual({ kind: 'skip', why: 'manual' });
    expect((await c.record(manual.runId))?.agents).toBe('manual');

    const approval = await c.start({ filePath: path.join(fixtures, 'durable-approval.ts'), params: { value: 4 } });
    expect(await answerAgentGate(c, approval.runId, { projectDir, env })).toEqual({ kind: 'skip', why: 'not-agent' });
  });

  it('records why a profile cannot run, so the person sees it on the gate', async () => {
    profiles();
    const c = createLocalCoordinator({ rootDir });
    const paused = await c.start({ filePath: agentFile, params: { path: 'a', text: 'b' } });
    const step = await answerAgentGate(c, paused.runId, { projectDir, env: {} });
    expect(step.kind).toBe('not-ready');
    expect((await c.record(paused.runId))?.agent).toMatchObject({ status: 'failed', error: 'ANTHROPIC_API_KEY is not set in the environment' });
    expect((await c.get(paused.runId))?.status).toBe('waiting');
  });

  it('records a model that never submits as failed and keeps the gate waiting', async () => {
    profiles();
    const c = createLocalCoordinator({ rootDir });
    const paused = await c.start({ filePath: agentFile, params: { path: 'a', text: 'b' } });
    const step = await answerAgentGate(c, paused.runId, { projectDir, env, provider: playing([[{ type: 'text_delta', text: 'no' }, { type: 'message_stop', finishReason: 'stop' }]]) });
    expect(step.kind).toBe('failed');
    expect((await c.record(paused.runId))?.agent?.status).toBe('failed');
    expect((await c.get(paused.runId))?.status).toBe('waiting');
  });
});

describe('autoAnswerAgentGates', () => {
  it('answers and resumes to completion', async () => {
    profiles();
    const c = createLocalCoordinator({ rootDir });
    const paused = await c.start({ filePath: agentFile, params: { path: 'notes.md', text: 'TODO' } });
    const out = await autoAnswerAgentGates(c, paused.runId, { projectDir, env, provider: playing([call(SUBMIT_TOOL, { summary: 'No tests.', risk: 'high' })]) });
    expect(out.stop).toBe('completed');
    expect(out.run.status).toBe('completed');
    expect((out.run.result as { report: string }).report).toContain('risk: high');
    expect((await c.record(paused.runId))?.agent?.status).toBe('answered');
  });

  it('rejects along the failure path when the model gives up', async () => {
    profiles();
    const c = createLocalCoordinator({ rootDir });
    const paused = await c.start({ filePath: agentFile, params: { path: 'notes.md', text: '' } });
    const out = await autoAnswerAgentGates(c, paused.runId, { projectDir, env, provider: playing([call(REJECT_TOOL, { reason: 'nothing to review' })]) });
    expect(out.stop).toBe('completed');
    expect((out.run.result as { onFailure: boolean }).onFailure).toBe(true);
    expect((await c.record(paused.runId))?.agent).toMatchObject({ status: 'rejected', error: 'nothing to review' });
  });

  it('stops for a person when there is no profile', async () => {
    const c = createLocalCoordinator({ rootDir });
    const paused = await c.start({ filePath: agentFile, params: { path: 'a', text: 'b' } });
    const out = await autoAnswerAgentGates(c, paused.runId, { projectDir, env });
    expect(out.stop).toBe('no-profile');
    expect(out.run.status).toBe('waiting');
  });
});
