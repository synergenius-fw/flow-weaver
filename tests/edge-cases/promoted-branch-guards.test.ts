/**
 * Tests for promoted node STEP guards and multi-exit connection coalescing.
 *
 * Bug 1: Promoted expression nodes get `sourceIdx !== undefined` guards instead
 *         of `source_success` / `source_success === false`, causing them to
 *         execute on both branches.
 *
 * Bug 2: Multiple connections to the same Exit port are deduplicated by a Map,
 *         silently dropping all but the last connection.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generator } from '../../src/generator';

const TEST_DIR = path.join(os.tmpdir(), `fw-promoted-guards-${process.pid}`);

function writeFixture(name: string, code: string): string {
  const filePath = path.join(TEST_DIR, `${name}.ts`);
  fs.writeFileSync(filePath, code, 'utf-8');
  return filePath;
}

beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Shared workflow source used by Tests A and B
// ---------------------------------------------------------------------------
// A branching router with two expression handlers that each have an external
// data dependency (validator.data), forcing them to be promoted out of the
// branch region. Each handler connects its result to a separate Exit port.
const PROMOTED_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input value - Input value
 * @output data - Validated data
 */
function validate(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; data: string } {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  return { onSuccess: true, onFailure: false, data: value };
}

/**
 * @flowWeaver nodeType
 * @input flag - Routing flag
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 */
function router(execute: boolean, flag: string): { onSuccess: boolean; onFailure: boolean } {
  if (!execute) return { onSuccess: false, onFailure: false };
  if (flag === 'yes') return { onSuccess: true, onFailure: false };
  return { onSuccess: false, onFailure: true };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input data - External dep (forces promotion)
 * @output result - Result
 */
function onSuccessHandler(data: string): { result: string } {
  return { result: 'SUCCESS:' + data };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input data - External dep (forces promotion)
 * @output result - Result
 */
function onFailureHandler(data: string): { result: string } {
  return { result: 'FAILURE:' + data };
}

/**
 * @flowWeaver workflow
 * @node v validate
 * @node r router
 * @node s onSuccessHandler
 * @node f onFailureHandler
 * @connect Start.execute -> v.execute
 * @connect Start.value -> v.value
 * @connect v.onSuccess -> r.execute
 * @connect v.data -> r.flag
 * @connect r.onSuccess -> s.execute
 * @connect r.onFailure -> f.execute
 * @connect v.data -> s.data
 * @connect v.data -> f.data
 * @connect s.result -> Exit.successResult
 * @connect f.result -> Exit.failureResult
 * @param execute [order:0] - Execute
 * @param value [order:1] - Input value
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns successResult [order:2] - Success handler result
 * @returns failureResult [order:3] - Failure handler result
 */
export function promotedGuardWorkflow(
  execute: boolean,
  params: { value: string }, __abortSignal__?: AbortSignal
): { onSuccess: boolean; onFailure: boolean; successResult?: string; failureResult?: string } {
  throw new Error('Generated');
}
`;

describe('Promoted branch guards', () => {
  let outputFile: string;

  beforeAll(async () => {
    const srcFile = writeFixture('promoted-guards', PROMOTED_WORKFLOW);
    const code = await generator.generate(srcFile, 'promotedGuardWorkflow');
    outputFile = path.join(TEST_DIR, 'promoted-guards.generated.ts');
    fs.writeFileSync(outputFile, code, 'utf-8');
  });

  it('promoted expression node only executes on the correct branch (success path)', async () => {
    const mod = await import(outputFile);
    // router flag='yes' → onSuccess, so only s (onSuccessHandler) should run
    const result = mod.promotedGuardWorkflow(true, { value: 'yes' });
    expect(result.successResult).toBe('SUCCESS:yes');
    expect(result.failureResult).toBeUndefined();
  });

  it('promoted expression node only executes on the correct branch (failure path)', async () => {
    const mod = await import(outputFile);
    // router flag='no' → onFailure, so only f (onFailureHandler) should run
    const result = mod.promotedGuardWorkflow(true, { value: 'no' });
    expect(result.failureResult).toBe('FAILURE:no');
    expect(result.successResult).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Shared workflow source for multi-exit coalescing tests
// ---------------------------------------------------------------------------
// A branching router where two handlers connect to the SAME Exit.result port.
const MULTI_EXIT_COALESCE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input flag - Routing flag
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 */
function splitter(execute: boolean, flag: string): { onSuccess: boolean; onFailure: boolean } {
  if (!execute) return { onSuccess: false, onFailure: false };
  if (flag === 'A') return { onSuccess: true, onFailure: false };
  return { onSuccess: false, onFailure: true };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input value - Input
 * @output result - Result
 */
function handlerA(value: string): { result: string } {
  return { result: 'A:' + value };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input value - Input
 * @output result - Result
 */
function handlerB(value: string): { result: string } {
  return { result: 'B:' + value };
}

/**
 * @flowWeaver workflow
 * @node sp splitter
 * @node hA handlerA
 * @node hB handlerB
 * @connect Start.execute -> sp.execute
 * @connect Start.input -> sp.flag
 * @connect sp.onSuccess -> hA.execute
 * @connect Start.input -> hA.value
 * @connect sp.onFailure -> hB.execute
 * @connect Start.input -> hB.value
 * @connect hA.result -> Exit.result
 * @connect hB.result -> Exit.result
 * @param execute [order:0] - Execute
 * @param input [order:1] - Input value
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns result [order:2] - Combined result
 */
export function multiExitCoalesce(
  execute: boolean,
  params: { input: string }, __abortSignal__?: AbortSignal
): { onSuccess: boolean; onFailure: boolean; result?: string } {
  throw new Error('Generated');
}
`;

describe('Multiple exit connection coalescing', () => {
  let outputFile: string;

  beforeAll(async () => {
    const srcFile = writeFixture('multi-exit-coalesce', MULTI_EXIT_COALESCE_WORKFLOW);
    const code = await generator.generate(srcFile, 'multiExitCoalesce');
    outputFile = path.join(TEST_DIR, 'multi-exit-coalesce.generated.ts');
    fs.writeFileSync(outputFile, code, 'utf-8');
  });

  it('data port coalesces: success path returns handlerA result', async () => {
    const mod = await import(outputFile);
    const result = mod.multiExitCoalesce(true, { input: 'A' });
    expect(result.result).toBe('A:A');
  });

  it('data port coalesces: failure path returns handlerB result', async () => {
    const mod = await import(outputFile);
    const result = mod.multiExitCoalesce(true, { input: 'B' });
    expect(result.result).toBe('B:B');
  });
});

// ---------------------------------------------------------------------------
// Test C: Multiple connections to Exit.onSuccess coalesce with OR
// ---------------------------------------------------------------------------
const MULTI_EXIT_ONSUCCESS_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input flag - Routing flag
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 */
function route(execute: boolean, flag: string): { onSuccess: boolean; onFailure: boolean } {
  if (!execute) return { onSuccess: false, onFailure: false };
  if (flag === 'left') return { onSuccess: true, onFailure: false };
  return { onSuccess: false, onFailure: true };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input value - Input
 * @output result - Result
 */
function leftHandler(value: string): { result: string } {
  return { result: 'LEFT:' + value };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input value - Input
 * @output result - Result
 */
function rightHandler(value: string): { result: string } {
  return { result: 'RIGHT:' + value };
}

/**
 * @flowWeaver workflow
 * @node rt route
 * @node lh leftHandler
 * @node rh rightHandler
 * @connect Start.execute -> rt.execute
 * @connect Start.input -> rt.flag
 * @connect rt.onSuccess -> lh.execute
 * @connect Start.input -> lh.value
 * @connect rt.onFailure -> rh.execute
 * @connect Start.input -> rh.value
 * @connect lh.onSuccess -> Exit.onSuccess
 * @connect rh.onSuccess -> Exit.onSuccess
 * @param execute [order:0] - Execute
 * @param input [order:1] - Input value
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 */
export function multiOnSuccess(
  execute: boolean,
  params: { input: string }, __abortSignal__?: AbortSignal
): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('Generated');
}
`;

describe('Multiple connections to Exit.onSuccess', () => {
  let outputFile: string;

  beforeAll(async () => {
    const srcFile = writeFixture('multi-onsuccess', MULTI_EXIT_ONSUCCESS_WORKFLOW);
    const code = await generator.generate(srcFile, 'multiOnSuccess');
    outputFile = path.join(TEST_DIR, 'multi-onsuccess.generated.ts');
    fs.writeFileSync(outputFile, code, 'utf-8');
  });

  it('left path returns onSuccess: true', async () => {
    const mod = await import(outputFile);
    const result = mod.multiOnSuccess(true, { input: 'left' });
    expect(result.onSuccess).toBe(true);
  });

  it('right path returns onSuccess: true', async () => {
    const mod = await import(outputFile);
    const result = mod.multiOnSuccess(true, { input: 'right' });
    expect(result.onSuccess).toBe(true);
  });
});
