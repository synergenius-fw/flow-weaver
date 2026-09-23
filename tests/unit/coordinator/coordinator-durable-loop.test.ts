import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createLocalCoordinator } from '../../../src/coordinator/index.js';

/**
 * A bounded, sequential durable loop driven through the local coordinator with
 * a persisted run store — the path the console and `fw_run`/`fw_resume` use.
 *
 * This is the regression that the in-memory continuation test missed: across
 * iterations the completed set accumulates prior iterations, and the resume-
 * compatibility check must still accept iteration N+1's boundary as a valid
 * prefix. A late node in the loop body (higher topological order) committed in
 * iteration N must not compare as "after" the gate early in iteration N+1 — the
 * progress ordering has to treat loop iteration as dominant. Each resume uses a
 * FRESH coordinator on the same directory, so nothing is carried in memory.
 */
const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..',
  'continuation',
  'fixtures',
);
const boundedLoop = path.join(fixturesDir, 'durable-bounded-loop.ts');
const agentLoop = path.join(fixturesDir, 'durable-agent-loop.ts');

let rootDir: string;
beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-loop-runs-'));
});
afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('durable loop through the persisted coordinator', () => {
  it('walks every iteration to completion across fresh coordinators', async () => {
    const items = ['a', 'b', 'c'];
    const start = createLocalCoordinator({ rootDir });
    let view = await start.start({ filePath: boundedLoop, params: { items, maxItems: 5 } });

    const prompts: string[] = [];
    let guard = 0;
    while (view.status === 'waiting') {
      if (guard++ > 10) throw new Error('loop did not terminate — resume compatibility likely rejected an iteration');
      expect(view.gate?.kind).toBe('approval');
      // The gate prompt is the current item, recovered from committed state.
      prompts.push(String((view.gate?.inputs as { prompt?: unknown })?.prompt));

      // A brand-new coordinator on the same directory: the run survives only
      // through the store, exactly as it does between console requests.
      const fresh = createLocalCoordinator({ rootDir });
      view = await fresh.resume({ runId: view.runId, input: { answer: { approved: true } } });
    }

    // Each iteration saw its own item, in order, recovered from committed state.
    expect(prompts).toEqual(['a', 'b', 'c']);
    expect(view.status).toBe('completed');
    // The loop ran every iteration and collected one result per item.
    const results = (view.result as { results: unknown[] }).results;
    expect(results).toHaveLength(3);
    // The continuation is cleared once the run completes.
    expect(fs.existsSync(path.join(rootDir, view.runId, 'continuation.json'))).toBe(false);
  });

  it('walks an agent loop with a two-node scope body across fresh coordinators', async () => {
    // Reproduces the console scenario exactly: the scope holds an agent gate
    // AND a following record node, so each iteration commits a node whose
    // topological order is higher than the gate's. Resuming into the next
    // iteration must still see the completed set as a valid prefix. This is the
    // case the single-node-scope loop did not catch.
    const subtopics = ['transformers', 'tokenization', 'fine-tuning'];
    const start = createLocalCoordinator({ rootDir });
    let view = await start.start({
      filePath: agentLoop,
      params: { subtopics, maxTopics: 5 },
      agents: 'manual',
    });

    const seen: string[] = [];
    let guard = 0;
    while (view.status === 'waiting') {
      if (guard++ > 10) throw new Error('agent loop did not terminate — resume compatibility rejected an iteration');
      expect(view.gate?.kind).toBe('agent');
      seen.push(String((view.gate?.inputs as { agentId?: unknown })?.agentId));

      const fresh = createLocalCoordinator({ rootDir });
      view = await fresh.resume({
        runId: view.runId,
        input: { answer: { agentResult: { summary: 'ok' } } },
      });
    }

    // Every subtopic was investigated, in order, each surviving a fresh process.
    expect(seen).toEqual(subtopics);
    expect(view.status).toBe('completed');
    expect((view.result as { report: unknown[] }).report).toHaveLength(3);
  });

  it('honours the attempt limit through the store', async () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const coordinator = createLocalCoordinator({ rootDir });
    let view = await coordinator.start({ filePath: boundedLoop, params: { items, maxItems: 2 } });

    let iterations = 0;
    let guard = 0;
    while (view.status === 'waiting') {
      if (guard++ > 10) throw new Error('capped loop did not terminate');
      iterations++;
      view = await coordinator.resume({ runId: view.runId, input: { answer: { approved: true } } });
    }

    expect(iterations).toBe(2);
    expect(view.status).toBe('completed');
    // maxItems: 2 caps the loop at two iterations even with five items.
    expect((view.result as { results: unknown[] }).results).toHaveLength(2);
  });
});
