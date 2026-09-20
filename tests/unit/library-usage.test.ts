/**
 * What the "Using the library" topic promises, done for real: a compiled
 * workflow called from code with a runtime from the package, a gated-or-not
 * workflow driven through the coordinator, and the entry points it names.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { compileWorkflow } from '../../src/api/compile';
import { createWorkflowRuntime } from '../../src/index';
import { createLocalCoordinator } from '../../src/coordinator/index';
import { listTopics, readTopic } from '../../src/docs/index';
import { guideOutline } from '../../src/docs/guide';
import { PRESETS } from '../../src/context/index';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let dir: string;
let file: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-library-'));
  file = path.join(dir, 'hello.ts');
  fs.copyFileSync(path.join(root, 'use-cases', 'hello-world.ts'), file);
  await compileWorkflow(file);
}, 60000);

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('calling a compiled workflow from code', () => {
  it('runs with a runtime built by createWorkflowRuntime, and not without one', async () => {
    const mod = await import(pathToFileURL(file).href) as { helloWorld: (execute: boolean, params: unknown, runtime?: unknown) => Promise<{ onSuccess: boolean; message: string }> };
    const runtime = createWorkflowRuntime({ runId: 'lib-1', workflowId: 'helloWorld' });
    const result = await mod.helloWorld(true, { firstName: 'Ada', lastName: 'Lovelace' }, runtime);
    expect(result.onSuccess).toBe(true);
    expect(result.message).toContain('Ada Lovelace');
    // The runtime is not optional; the topic says so because this is what happens.
    await expect(Reflect.apply(mod.helloWorld, undefined, [true, { firstName: 'Ada', lastName: 'Lovelace' }])).rejects.toThrow(/services/);
  });

  it('carries the services the topic lists', () => {
    const ac = new AbortController();
    const runtime = createWorkflowRuntime({
      runId: 'lib-2', workflowId: 'helloWorld', abortSignal: ac.signal,
      services: { mocks: { fast: true } },
    });
    expect(runtime.abortSignal).toBe(ac.signal);
    expect(runtime.services.mocks).toEqual({ fast: true });
  });

  it('types the compiled signature against the package runtime without a cast', () => {
    // The compiled file declares its own runtime types; its debug-controller
    // hook must not name the context class, or nothing from the package is
    // assignable to it.
    const compiled = fs.readFileSync(file, 'utf8');
    expect(compiled).toContain('__runtime__: WorkflowRuntime');
    expect(compiled).toMatch(/beforeNode\(nodeId: string, ctx: unknown\)/);
  });
});

describe('driving a run through the coordinator', () => {
  it('starts from the source file and reports the result', async () => {
    const runs = createLocalCoordinator({ rootDir: path.join(dir, 'runs') });
    const run = await runs.start({ filePath: path.join(root, 'use-cases', 'hello-world.ts'), params: { firstName: 'Grace', lastName: 'Hopper' } });
    expect(run.status).toBe('completed');
    expect((run.result as { message: string }).message).toContain('Grace Hopper');
    expect(runs.list().map((r) => r.runId)).toContain(run.runId);
  }, 60000);
});

describe('the topic and its entry points', () => {
  it('is a topic, placed under Running and in the ops and full presets', () => {
    expect(listTopics().map((t) => t.slug)).toContain('library');
    const running = guideOutline().find((g) => g.title === 'Running')!;
    expect(running.topics[0].slug).toBe('library');
    expect(PRESETS.ops).toContain('library');
    expect(PRESETS.full).toContain('library');
  });

  it('names only entry points the package publishes', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
    expect(pkg.exports['./coordinator']).toEqual({ types: './dist/coordinator/index.d.ts', default: './dist/coordinator/index.js' });
    const topic = readTopic('library')!.content;
    const named = [...topic.matchAll(/@synergenius\/flow-weaver(\/[a-z-]+)?/g)].map((m) => m[1] ? `.${m[1]}` : '.');
    for (const sub of new Set(named)) expect(pkg.exports, sub).toHaveProperty(sub);
    // The abbreviated rows of the entry-point table, too.
    const abbreviated = [...topic.matchAll(/`…(\/[a-z-]+)`/g)].map((m) => `.${m[1]}`);
    for (const sub of new Set(abbreviated)) expect(pkg.exports, sub).toHaveProperty(sub);
  });
});
