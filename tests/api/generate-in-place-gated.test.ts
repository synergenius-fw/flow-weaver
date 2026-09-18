/**
 * In-place generation on a gated workflow.
 *
 * Covers two regressions found while driving a workflow from an assistant:
 * - a structural edit (`fw_modify`) compiled the whole file in place, and
 * - the compiled file could not be run again, because the regenerated JSDoc
 *   dropped every durable classification (the inlined built-in `waitForAgent`
 *   came back as an ordinary node type and its fallback body threw).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseWorkflow } from '../../src/api/index';
import { generateInPlace, hasInPlaceMarkers, MARKERS } from '../../src/api/generate-in-place';
import { applyModifyOperation } from '../../src/api/modify-operation';
import { executeWorkflow } from '../../src/mcp/workflow-executor';

const GATED_SOURCE = `
/**
 * @flowWeaver nodeType
 * @durablePure
 * @input value - Value to prepare
 * @output agentId - Task id
 * @output context - Context for the agent
 */
function prepare(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; agentId: string; context: object } {
  return { onSuccess: execute, onFailure: false, agentId: 'review', context: { value } };
}

/**
 * @flowWeaver nodeType
 * @durablePure
 * @input result - Whatever the agent answered
 * @output verdict - Final verdict
 */
function finish(execute: boolean, result: Record<string, unknown>): { onSuccess: boolean; onFailure: boolean; verdict: string } {
  return { onSuccess: execute, onFailure: false, verdict: String(result?.verdict ?? 'none') };
}

/**
 * @flowWeaver workflow
 * @param value - Input value
 * @returns verdict - Final verdict
 * @node prep prepare
 * @node agent waitForAgent
 * @node done finish
 * @connect Start.execute -> prep.execute
 * @connect Start.value -> prep.value
 * @connect prep.onSuccess -> agent.execute
 * @connect prep.agentId -> agent.agentId
 * @connect prep.context -> agent.context
 * @connect agent.onSuccess -> done.execute
 * @connect agent.agentResult -> done.result
 * @connect done.onSuccess -> Exit.onSuccess
 * @connect done.verdict -> Exit.verdict
 */
export async function gatedFlow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; verdict: string }> {
  throw new Error('generated body was not installed');
}
`;

const bundleDigest = `sha256:${'a'.repeat(64)}`;

describe('generateInPlace on a gated workflow', () => {
  let tmpDir: string;
  let file: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-inplace-gated-'));
    file = path.join(tmpDir, 'gated.ts');
    fs.writeFileSync(file, GATED_SOURCE);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('annotationsOnly rewrites the JSDoc and nothing else', async () => {
    const parsed = await parseWorkflow(file);
    expect(parsed.errors).toEqual([]);

    const { ast } = applyModifyOperation(parsed.ast, 'addConnection', {
      from: 'agent.onFailure',
      to: 'Exit.onFailure',
    });
    const result = generateInPlace(GATED_SOURCE, ast, { annotationsOnly: true });

    expect(result.hasChanges).toBe(true);
    // The new edge is written either as @connect or folded into a @path macro
    expect(result.code).toMatch(/@connect agent\.onFailure -> Exit\.onFailure|@path Start -> prep -> agent:fail -> Exit/);
    // No generated code of any kind
    expect(hasInPlaceMarkers(result.code)).toBe(false);
    expect(result.code).not.toContain(MARKERS.RUNTIME_START);
    expect(result.code).not.toContain(MARKERS.BODY_START);
    expect(result.code).not.toContain('__runtime__');
    expect(result.code).not.toContain('async function waitForAgent(');
    // The authored body of the workflow stub is untouched
    expect(result.code).toContain("throw new Error('generated body was not installed')");
    // Durable tags survive the JSDoc rewrite
    expect(result.code.match(/@durablePure/g)).toHaveLength(2);
    // It is still a valid, gated workflow after the rewrite
    fs.writeFileSync(file, result.code);
    const reparsed = await parseWorkflow(file);
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.ast.nodeTypes.find((nt) => nt.name === 'waitForAgent')?.durableGate).toBe('agent');
    expect(
      reparsed.ast.connections.some(
        (c) => c.from.node === 'agent' && c.from.port === 'onFailure' && c.to.node === 'Exit' && c.to.port === 'onFailure'
      )
    ).toBe(true);
  });

  it('annotationsOnly reports no change when the annotations are already current', async () => {
    const parsed = await parseWorkflow(file);
    const first = generateInPlace(GATED_SOURCE, parsed.ast, { annotationsOnly: true });
    fs.writeFileSync(file, first.code);
    const reparsed = await parseWorkflow(file);
    const second = generateInPlace(first.code, reparsed.ast, { annotationsOnly: true });
    expect(second.hasChanges).toBe(false);
    expect(second.code).toBe(first.code);
  });

  it('a full in-place compile keeps every durable classification', async () => {
    const parsed = await parseWorkflow(file);
    const result = generateInPlace(GATED_SOURCE, parsed.ast, { sourceFile: file });

    expect(hasInPlaceMarkers(result.code)).toBe(true);
    // User node types keep their tag
    expect(result.code.match(/@durablePure/g)).toHaveLength(2);
    // The inlined built-in carries its gate kind
    const inlined = result.code.indexOf('async function waitForAgent(');
    expect(inlined).toBeGreaterThan(-1);
    const jsdocBefore = result.code.slice(0, inlined);
    expect(jsdocBefore.slice(jsdocBefore.lastIndexOf('/**'))).toContain('@durableGate agent');

    // Re-parsing the compiled file sees the same classifications
    fs.writeFileSync(file, result.code);
    const reparsed = await parseWorkflow(file);
    expect(reparsed.errors).toEqual([]);
    const byName = new Map(reparsed.ast.nodeTypes.map((nt) => [nt.name, nt]));
    expect(byName.get('prepare')?.durablePure).toBe(true);
    expect(byName.get('finish')?.durablePure).toBe(true);
    expect(byName.get('waitForAgent')?.durableGate).toBe('agent');
  });

  it('a file compiled in place still yields at its gate when run', async () => {
    const parsed = await parseWorkflow(file);
    const compiled = generateInPlace(GATED_SOURCE, parsed.ast, { sourceFile: file });
    fs.writeFileSync(file, compiled.code);

    const outcome = await executeWorkflow({
      runId: 'in-place-recompile-run',
      bundleDigest,
      filePath: file,
      workflowName: 'gatedFlow',
      params: { value: 3 },
      production: false,
    });

    expect(outcome.kind).toBe('yielded');
    if (outcome.kind !== 'yielded') return;
    expect(outcome.gate.kind).toBe('agent');
    expect(outcome.gate.address.nodeId).toBe('agent');
  });
});
