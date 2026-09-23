/**
 * A compiled file carries the durable engine and needs nothing from the
 * package to run: a gate-free workflow runs to the end, and a gated one
 * pauses, hands its host a continuation, and resumes from it, with the same
 * refusals the coordinator makes. Nothing here imports the package into the
 * compiled module. It is transpiled and loaded the way a host would load it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { getWorkflowTemplate } from '../../../src/cli/templates/index.js';
import { compileWorkflow } from '../../../src/api/compile.js';
import { executeWorkflow } from '../../../src/mcp/workflow-executor.js';
import { INLINE_ENGINE_SOURCE } from '../../../src/api/inline-engine.generated.js';
import { generateInlineRuntime, INLINE_ENGINE_EXPORTS } from '../../../src/api/inline-runtime.js';
import { VERSION } from '../../../src/generated-version.js';

type Gate = { id: string; kind: string; address: { nodeId: string } };
type Yield = Error & { gate: Gate; continuation?: Record<string, unknown> };
/** The compiled module as a host sees it: the workflow plus the engine's exports. */
interface CompiledModule {
  approveSpend?: (execute: boolean, params: unknown, runtime: unknown) => Promise<Record<string, unknown>>;
  zetaFlow?: (execute: boolean, params: unknown, runtime: unknown) => Record<string, unknown> | Promise<Record<string, unknown>>;
  createWorkflowRuntime: (options: Record<string, unknown>) => { durable: { assertResumeResolutionConsumed(): void } };
  acceptContinuation: (input: unknown, identity: Record<string, unknown>) => { accepted: true; envelope: Record<string, unknown> } | { accepted: false; reason: string; message: string };
  isDurableGateYield: (error: unknown) => error is Yield;
  ENGINE_VERSION: string;
}

let dir: string;
const GATE_FREE = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input name - Name
 * @output greeting - Greeting
 */
function greet(name: string): string { return \`hi \${name}\`; }

/**
 * @flowWeaver workflow
 * @param name - Name
 * @returns greeting - Greeting
 * @node g greet
 * @path Start -> g -> Exit
 */
export function zetaFlow(execute: boolean, params: { name: string }): { onSuccess: boolean; onFailure: boolean; greeting: string } {
  throw new Error('generated body was not installed');
}
`;

/** Compile in place, then load the result as plain JavaScript, as a host would. */
async function compileAndLoad(name: string, source: string): Promise<{ file: string; code: string; mod: CompiledModule }> {
  const file = path.join(dir, `${name}.ts`);
  fs.writeFileSync(file, source);
  await compileWorkflow(file, { write: true, inPlace: true });
  const code = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  const out = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(out, js);
  const mod = (await import(pathToFileURL(out).href)) as CompiledModule;
  return { file, code, mod };
}

const approvalSource = (input = 'request') =>
  getWorkflowTemplate('approval')!.generate({ workflowName: 'approveSpend', config: { input } });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-inline-engine-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the engine text', () => {
  it('is the package engine with its module syntax removed, and no doc comments left for a JSDoc scan', () => {
    const lines = INLINE_ENGINE_SOURCE.split('\n');
    expect(lines.filter((line) => /^(import|export)\b/.test(line))).toEqual([]);
    expect(INLINE_ENGINE_SOURCE).not.toContain('/**');
    expect(INLINE_ENGINE_SOURCE).not.toMatch(/from ["']node:|createHash|Buffer\.|TextEncoder|Object\.hasOwn\(|\.at\(/);
    for (const name of ['class DurableExecution', 'function createWorkflowRuntime', 'function acceptContinuation', 'function sha256Hex', 'class DurableGateYield']) {
      expect(INLINE_ENGINE_SOURCE).toContain(name);
    }
  });

  it('is exported from every ESM runtime section, and left to module.exports for CJS', () => {
    const esm = generateInlineRuntime(true);
    expect(esm).toContain(`export { ${INLINE_ENGINE_EXPORTS.join(', ')} };`);
    expect(esm).toContain(`const VERSION = ${JSON.stringify(VERSION)};`);
    const cjs = generateInlineRuntime(true, false, 'typescript', 'cjs');
    expect(cjs).not.toContain('export {');
    expect(cjs).toContain('class DurableExecution');
  });
});

describe('a compiled file, loaded without the package', () => {
  it('runs a gate-free workflow with the runtime it exports itself', async () => {
    const { code, mod } = await compileAndLoad('zeta', GATE_FREE);
    expect(code).not.toContain('@synergenius/flow-weaver');
    expect(code).not.toContain('ctx.bindWorkflow(');      // nothing to protect: no gate, no continuation
    expect(mod.ENGINE_VERSION).toBe(VERSION);
    const result = await mod.zetaFlow!(true, { name: 'Ada' }, mod.createWorkflowRuntime({ runId: 'r1', workflowId: 'zetaFlow' }));
    expect(result).toMatchObject({ onSuccess: true, greeting: 'hi Ada' });
  });

  it('pauses a gated workflow, hands over a continuation, and resumes from its JSON in a fresh runtime', async () => {
    const { code, mod } = await compileAndLoad('approve', approvalSource());
    expect(code).toMatch(/ctx\.bindWorkflow\('approveSpend', '[0-9a-f]{64}'\)/);
    const runId = 'host-1';
    const params = { request: { amount: 120, for: 'a keyboard' } };

    let kept = '';
    let gateId = '';
    await expect(mod.approveSpend!(true, params, mod.createWorkflowRuntime({ runId, workflowId: 'approveSpend' }))).rejects.toSatisfy((error: unknown) => {
      if (!mod.isDurableGateYield(error)) return false;
      expect(error.gate).toMatchObject({ kind: 'approval', address: { nodeId: 'approval' } });
      expect(error.continuation).toMatchObject({ runId, workflowId: 'approveSpend', gateId: error.gate.id, engineVersion: VERSION });
      expect(error.continuation!.bundleDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      kept = JSON.stringify(error.continuation);
      gateId = error.gate.id;
      return true;
    });

    // Later, elsewhere: only the JSON and the gate id survived.
    const decoded = mod.acceptContinuation(kept, { runId, workflowId: 'approveSpend', gateId });
    if (!decoded.accepted) throw new Error(decoded.message);
    const runtime = mod.createWorkflowRuntime({
      runId, workflowId: 'approveSpend', continuation: decoded.envelope,
      resolution: { gateId, value: { onSuccess: true, onFailure: false, note: 'fine by me' } },
    });
    await expect(mod.approveSpend!(true, params, runtime)).resolves.toMatchObject({
      onSuccess: true, onFailure: false, outcome: 'applied {"amount":120,"for":"a keyboard"} -- fine by me',
    });
    expect(() => runtime.durable.assertResumeResolutionConsumed()).not.toThrow();

    // The refusal arm.
    const other = 'host-2';
    const paused = await mod.approveSpend!(true, { request: 'a boat' }, mod.createWorkflowRuntime({ runId: other, workflowId: 'approveSpend' })).catch((e: unknown) => e as Yield);
    const again = mod.acceptContinuation(paused.continuation, { runId: other, workflowId: 'approveSpend' });
    if (!again.accepted) throw new Error(again.message);
    await expect(mod.approveSpend!(true, { request: 'a boat' }, mod.createWorkflowRuntime({
      runId: other, workflowId: 'approveSpend', continuation: again.envelope,
      resolution: { gateId: paused.gate.id, value: { onSuccess: false, onFailure: true, note: null } },
    }))).resolves.toMatchObject({ onSuccess: false, onFailure: true });
  });

  it('refuses what a host must not resume: altered, misaddressed, or a graph that changed', async () => {
    const a = await compileAndLoad('approve-a', approvalSource());
    const b = await compileAndLoad('approve-b', approvalSource('order'));   // same name, other graph
    const runId = 'host-3';
    const paused = await a.mod.approveSpend!(true, { request: 'x' }, a.mod.createWorkflowRuntime({ runId, workflowId: 'approveSpend' })).catch((e: unknown) => e as Yield);
    const kept = paused.continuation!;

    const tampered = JSON.parse(JSON.stringify(kept)) as { state: { completed: unknown[] } };
    tampered.state.completed = [];
    expect(a.mod.acceptContinuation(tampered, { runId, workflowId: 'approveSpend' })).toMatchObject({ accepted: false, reason: 'checksum-mismatch' });
    expect(a.mod.acceptContinuation(kept, { runId: 'someone-else', workflowId: 'approveSpend' })).toMatchObject({ accepted: false, reason: 'wrong-run' });
    expect(a.mod.acceptContinuation(kept, { runId, workflowId: 'approveSpend', gateId: '0'.repeat(64) })).toMatchObject({ accepted: false, reason: 'stale-gate' });
    expect(() => a.mod.createWorkflowRuntime({ runId, workflowId: 'approveSpend', continuation: kept })).toThrow(/acceptContinuation/);

    // The other compiled graph takes the envelope in (it cannot know the graph
    // from the JSON alone) and refuses it the moment the body names itself.
    const inB = b.mod.acceptContinuation(kept, { runId, workflowId: 'approveSpend' });
    if (!inB.accepted) throw new Error(inB.message);
    await expect(b.mod.approveSpend!(true, { order: 'x' }, b.mod.createWorkflowRuntime({
      runId, workflowId: 'approveSpend', continuation: inB.envelope,
      resolution: { gateId: paused.gate.id, value: { onSuccess: true, onFailure: false, note: 'ok' } },
    }))).rejects.toThrow(/another workflow graph/);
  });

  it('carries the bundle digest a host gives, and refuses a resume under another', async () => {
    const { mod } = await compileAndLoad('approve-c', approvalSource());
    const runId = 'host-4';
    const digestA = `sha256:${'a'.repeat(64)}`;
    const digestB = `sha256:${'b'.repeat(64)}`;
    expect(() => mod.createWorkflowRuntime({ runId, workflowId: 'approveSpend', bundleDigest: 'build-42' })).toThrow(/sha256/);

    const paused = await mod.approveSpend!(true, { request: 'x' }, mod.createWorkflowRuntime({ runId, workflowId: 'approveSpend', bundleDigest: digestA })).catch((e: unknown) => e as Yield);
    expect(paused.continuation!.bundleDigest).toBe(digestA);
    const decoded = mod.acceptContinuation(paused.continuation, { runId, workflowId: 'approveSpend' });
    if (!decoded.accepted) throw new Error(decoded.message);
    const resolution = { gateId: paused.gate.id, value: { onSuccess: true, onFailure: false, note: 'ok' } };
    await expect(mod.approveSpend!(true, { request: 'x' }, mod.createWorkflowRuntime({ runId, workflowId: 'approveSpend', continuation: decoded.envelope, resolution, bundleDigest: digestB }))).rejects.toThrow(/another bundle/);
    await expect(mod.approveSpend!(true, { request: 'x' }, mod.createWorkflowRuntime({ runId, workflowId: 'approveSpend', continuation: decoded.envelope, resolution, bundleDigest: digestA }))).resolves.toMatchObject({ onSuccess: true });
  });
});

describe('the executor beside the exported helpers', () => {
  it('runs the workflow, not the first exported function, when no name is given', async () => {
    const file = path.join(dir, 'zeta-exec.ts');
    fs.writeFileSync(file, GATE_FREE);
    // 'acceptContinuation' and 'createWorkflowRuntime' sort before 'zetaFlow'.
    const outcome = await executeWorkflow({ runId: 'exec-1', filePath: file, params: { name: 'Bo' } });
    expect(outcome).toMatchObject({ kind: 'completed', functionName: 'zetaFlow', result: { greeting: 'hi Bo' } });
  });
});
