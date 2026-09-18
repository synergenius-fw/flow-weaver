/**
 * Regression: an [expr: port="node.port"] reference to another node's output
 * must compile to a context fetch and run, not leave the node id as a bare
 * identifier in the generated code.
 *
 * Found by dogfooding: `factor="cfg.factor"` compiled to `const ap_factor =
 * cfg.factor;`, and `cfg` is a node id, not a variable, so the run threw
 * "cfg is not defined". Every prior test referenced Start.*, whose identifier
 * happens not to collide, so this shape was uncovered.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseWorkflow, validateWorkflow } from '../../src/api/index';
import { executeWorkflow } from '../../src/mcp/workflow-executor';
import { findExpressionReferences } from '../../src/parser/expression-references';

const SOURCE = `
/** @flowWeaver nodeType @expression */
function makeConfig(base: number) {
  return { factor: base * 2 };
}

/** @flowWeaver nodeType @expression */
function apply(value: number, factor: number) {
  return { result: value * factor };
}

/**
 * @flowWeaver workflow
 * @param base - Base number
 * @param value - Value to scale
 * @returns result - Scaled value
 * @node cfg makeConfig
 * @node ap apply [expr: factor="cfg.factor"]
 * @path Start -> cfg -> ap -> Exit
 */
export function scale(execute: boolean, params: { base: number; value: number }): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('generated body was not installed');
}
`;

async function inTemp<T>(code: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-node-ref-'));
  const file = path.join(dir, 'flow.ts');
  fs.writeFileSync(file, code);
  try {
    return await fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SOURCE_EXPLICIT_OUTPUT = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input base
 * @output factor
 */
function makeConfig(base: number) {
  return { factor: base * 2 };
}

/** @flowWeaver nodeType @expression */
function apply(value: number, factor: number) {
  return { result: value * factor };
}

/**
 * @flowWeaver workflow
 * @param base - Base number
 * @param value - Value to scale
 * @returns result - Scaled value
 * @node cfg makeConfig
 * @node ap apply [expr: factor="cfg.factor"]
 * @path Start -> cfg -> ap -> Exit
 */
export function scale(execute: boolean, params: { base: number; value: number }): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('generated body was not installed');
}
`;

describe('a bare node-to-node reference', () => {
  it('the finder sees the whole-value reference', () => {
    expect(findExpressionReferences('cfg.factor', new Set(['cfg'])).map((r) => `${r.root}.${r.port}`)).toEqual(['cfg.factor']);
  });

  it('runs when the referenced port has the SAME name as the target port', async () => {
    // @path also wires cfg.factor -> ap.factor by name, so that connection is
    // a plain edge, not flagged derived. The generator must still fetch cfg,
    // not emit the bare identifier. This is the shape that regressed.
    await inTemp(SOURCE, async (file) => {
      const parsed = await parseWorkflow(file);
      expect(parsed.errors).toEqual([]);
      expect(validateWorkflow(parsed.ast).errors).toEqual([]);
      const outcome = await executeWorkflow({
        runId: 'node-ref-same-name',
        bundleDigest: `sha256:${'1'.repeat(64)}`,
        filePath: file,
        workflowName: 'scale',
        params: { base: 3, value: 5 },
        production: false,
      });
      expect(outcome.kind).toBe('completed');
      if (outcome.kind !== 'completed') return;
      // factor = base*2 = 6; result = value*factor = 30
      expect(outcome.result).toMatchObject({ onSuccess: true, result: 30 });
    });
  });

  it('runs for a cross-named reference (recorded as a derived edge)', async () => {
    const src = `
/** @flowWeaver nodeType @expression */
function makeConfig(base: number) { return { scale: base * 2 }; }

/** @flowWeaver nodeType @expression */
function apply(value: number, factor: number) { return { result: value * factor }; }

/**
 * @flowWeaver workflow
 * @param base - Base
 * @param value - Value
 * @returns result - Scaled
 * @node cfg makeConfig
 * @node ap apply [expr: factor="cfg.scale"]
 * @path Start -> cfg -> ap -> Exit
 */
export function scale(execute: boolean, params: { base: number; value: number }): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('stub');
}
`;
    await inTemp(src, async (file) => {
      const parsed = await parseWorkflow(file);
      const derived = parsed.ast.connections.filter((c) => c.derived).map((c) => `${c.from.node}.${c.from.port}->${c.to.node}.${c.to.port}`);
      expect(derived).toEqual(['cfg.scale->ap.factor']);
      const outcome = await executeWorkflow({
        runId: 'node-ref-cross-named',
        bundleDigest: `sha256:${'2'.repeat(64)}`,
        filePath: file,
        workflowName: 'scale',
        params: { base: 3, value: 5 },
        production: false,
      });
      expect(outcome.kind).toBe('completed');
      if (outcome.kind !== 'completed') return;
      expect(outcome.result).toMatchObject({ onSuccess: true, result: 30 });
    });
  });

  it('substitutes a reference used inside a larger expression', async () => {
    const src = `
/** @flowWeaver nodeType @expression */
function makeConfig(base: number) { return { factor: base * 2 }; }

/** @flowWeaver nodeType @expression */
function apply(value: number, factor: number) { return { result: value * factor }; }

/**
 * @flowWeaver workflow
 * @param base - Base
 * @param value - Value
 * @returns result - Scaled
 * @node cfg makeConfig
 * @node ap apply [expr: factor="cfg.factor + Start.base"]
 * @path Start -> cfg -> ap -> Exit
 */
export function scale(execute: boolean, params: { base: number; value: number }): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('stub');
}
`;
    await inTemp(src, async (file) => {
      const outcome = await executeWorkflow({
        runId: 'node-ref-larger-expr',
        bundleDigest: `sha256:${'3'.repeat(64)}`,
        filePath: file,
        workflowName: 'scale',
        params: { base: 3, value: 5 },
        production: false,
      });
      expect(outcome.kind).toBe('completed');
      if (outcome.kind !== 'completed') return;
      // factor = (base*2) + base = 6 + 3 = 9; result = 5 * 9 = 45
      expect(outcome.result).toMatchObject({ onSuccess: true, result: 45 });
    });
  });
});
