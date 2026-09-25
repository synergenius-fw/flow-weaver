/**
 * Refusing a resume before anything runs. The console and `fw serve` drive
 * resumes in the background, so they ask the coordinator first whether a
 * resume would be refused and answer the person with the reason. The
 * checks are the ones `resume` itself makes before taking the run, and
 * asking changes nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createLocalCoordinator, createMemoryRunStore, noteAnswerMisfit,
  RunNotFoundError, RunNotWaitingError, BundleChangedError, InvalidAnswerError, MissingOutputsError,
  type LocalCoordinator,
} from '../../../src/coordinator/index.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'continuation', 'fixtures');

let dir: string;
let file: string;
let coordinator: LocalCoordinator;
let runId: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-check-resume-'));
  file = path.join(dir, 'approval.ts');
  fs.copyFileSync(path.join(fixtures, 'durable-approval.ts'), file);
  coordinator = createLocalCoordinator({ store: createMemoryRunStore() });
  runId = (await coordinator.start({ filePath: file, params: { value: 4 } })).runId;
}, 60000);
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('checkResume', () => {
  it('passes a resume that would be accepted, and changes nothing', async () => {
    const before = await coordinator.record(runId);
    expect(before?.status).toBe('waiting');
    await expect(coordinator.checkResume({ runId, input: { answer: 8 } })).resolves.toBeUndefined();
    await expect(coordinator.checkResume({ runId, input: { reject: 'no' } })).resolves.toBeUndefined();
    expect(await coordinator.record(runId)).toEqual(before);
  });

  it('refuses a run that does not exist', async () => {
    await expect(coordinator.checkResume({ runId: 'nope', input: { answer: 1 } })).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it('refuses a run that is no longer waiting', async () => {
    await coordinator.resume({ runId, input: { answer: 8 } });
    const err = await coordinator.checkResume({ runId, input: { answer: 8 } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunNotWaitingError);
    expect((err as Error).message).toContain('completed');
  });

  it('refuses when the workflow changed since the run paused', async () => {
    fs.appendFileSync(file, '\n// changed\n');
    await expect(coordinator.checkResume({ runId, input: { answer: 8 } })).rejects.toBeInstanceOf(BundleChangedError);
  });

  it('refuses an answer the gate cannot take', async () => {
    await expect(coordinator.checkResume({ runId, input: { answer: () => 1 } })).rejects.toBeInstanceOf(InvalidAnswerError);
  });
});

describe('noteAnswerMisfit', () => {
  const note = { gateId: 'g', node: 'n', profile: 'reviewer', provider: 'anthropic' as const, status: 'answered' as const, startedAt: new Date().toISOString() };

  it('marks the agent failed when its answer did not fit the gate', async () => {
    await coordinator.setAgent(runId, note);
    expect(await noteAnswerMisfit(coordinator, runId, new MissingOutputsError(['value']))).toBe(true);
    const agent = (await coordinator.record(runId))?.agent;
    expect(agent).toMatchObject({ status: 'failed', profile: 'reviewer' });
    expect(agent?.error).toBe('the answer did not fit the gate: answer is missing gate outputs: value');
  });

  it('leaves the agent alone for any other failure, such as the workflow having changed', async () => {
    await coordinator.setAgent(runId, note);
    expect(await noteAnswerMisfit(coordinator, runId, new BundleChangedError())).toBe(false);
    expect(await noteAnswerMisfit(coordinator, runId, new Error('boom'))).toBe(false);
    expect((await coordinator.record(runId))?.agent?.status).toBe('answered');
  });

  it('does nothing for a run no agent answered, or one that is gone', async () => {
    expect(await noteAnswerMisfit(coordinator, runId, new InvalidAnswerError('bad'))).toBe(false);
    expect((await coordinator.record(runId))?.agent).toBeUndefined();
    expect(await noteAnswerMisfit(coordinator, 'nope', new InvalidAnswerError('bad'))).toBe(false);
  });
});
