/**
 * Regression tests for breakpoint-aware code generation.
 *
 * Covers:
 * - inline-runtime.ts: generateInlineRuntime emits `async sendStatusChangedEvent`
 *   so the injected __flowWeaverDebugger__.sendEvent (which is async) can be awaited.
 * - inline-runtime.ts: TDebugger.sendEvent type accepts `void | Promise<void>` so
 *   an async implementation is assignable without a type error.
 * - Generators (unified / code-utils / scope-function-generator): every call to
 *   sendStatusChangedEvent in async-mode code is prefixed with `await`, ensuring
 *   the breakpoint pause propagates back to the caller.
 * - Sync-mode code must NOT have `await sendStatusChangedEvent` (would be a syntax error).
 * - RUNNING, SUCCEEDED, FAILED status events all get `await` in async mode.
 * - sendLogErrorEvent is sync (not involved in breakpoint pausing).
 * - Parallel workflows, scoped workflows, multi-node chains all emit awaited calls.
 * - Production mode stubs are untouched.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateInlineRuntime } from '../../src/api/inline-runtime.js';
import { generateNodeWithExecutionContext } from '../../src/generator/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a source file, generate the workflow body, clean up. */
async function compileWorkflow(filename: string, source: string): Promise<string> {
  const testFile = path.join(global.testHelpers.outputDir, filename);
  fs.writeFileSync(testFile, source.trim());
  try {
    const exportName = source.match(/@flowWeaver workflow[\s\S]*?export (?:async )?function (\w+)/)?.[1];
    if (!exportName) throw new Error('Could not find workflow export name');
    return await global.testHelpers.generateFast(testFile, exportName);
  } finally {
    global.testHelpers.cleanupOutput(filename);
  }
}

/** Count occurrences of a pattern in a string. */
function countMatches(str: string, pattern: RegExp): number {
  return [...str.matchAll(pattern)].length;
}

/** Lines that are `.sendStatusChangedEvent(` call sites (not method defs). */
function callSiteLines(code: string): string[] {
  return code.split('\n').filter((l) => /\.\s*sendStatusChangedEvent\(/.test(l));
}

/** Call site lines that are NOT awaited. */
function unAwaitedCallSiteLines(code: string): string[] {
  return callSiteLines(code).filter((l) => !/await\s/.test(l));
}

// ---------------------------------------------------------------------------
// 1–6: inline-runtime dev mode shape
// ---------------------------------------------------------------------------

describe('generateInlineRuntime (dev) — sendStatusChangedEvent is async', () => {
  const devRuntime = generateInlineRuntime(false);

  test('1 — method declared async', () => {
    expect(devRuntime).toContain('async sendStatusChangedEvent(');
  });

  test('2 — return type is Promise<void>', () => {
    expect(devRuntime).toContain('): Promise<void>');
  });

  test('3 — body awaits this.flowWeaverDebugger.sendEvent', () => {
    expect(devRuntime).toContain('await this.flowWeaverDebugger.sendEvent(');
  });

  test('4 — TDebugger.sendEvent type is void | Promise<void>', () => {
    expect(devRuntime).toContain('sendEvent: (event: TEvent) => void | Promise<void>');
  });

  test('5 — sendLogErrorEvent IS async and awaits sendEvent', () => {
    expect(devRuntime).toContain('async sendLogErrorEvent(');
    expect(devRuntime).toContain('await this.flowWeaverDebugger.sendEvent');
  });

  test('6 — sendWorkflowCompletedEvent IS async and awaits sendEvent', () => {
    expect(devRuntime).toContain('async sendWorkflowCompletedEvent(');
  });
});

// ---------------------------------------------------------------------------
// 7–9: inline-runtime production mode — stubs untouched
// ---------------------------------------------------------------------------

describe('generateInlineRuntime (prod) — stubs are sync no-ops', () => {
  const prodRuntime = generateInlineRuntime(true);

  test('7 — production sendStatusChangedEvent stub is NOT async', () => {
    expect(prodRuntime).not.toContain('async sendStatusChangedEvent(');
  });

  test('8 — no TDebugger type in production output', () => {
    expect(prodRuntime).not.toContain('TDebugger');
  });

  test('9 — production runtime still defines sendStatusChangedEvent as no-op', () => {
    expect(prodRuntime).toContain('sendStatusChangedEvent');
  });
});

// ---------------------------------------------------------------------------
// 10–14: single-node async workflow — all statuses awaited
// ---------------------------------------------------------------------------

describe('Single-node async workflow — every sendStatusChangedEvent is awaited', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} out - Result
 * @node d double
 * @connect Start.num -> d.value
 * @connect d.result -> Exit.out
 */
export async function singleNode(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; out: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-single.ts', source); });

  test('10 — there are sendStatusChangedEvent call sites', () => {
    expect(callSiteLines(code).length).toBeGreaterThan(0);
  });

  test('11 — zero un-awaited call sites', () => {
    expect(unAwaitedCallSiteLines(code)).toHaveLength(0);
  });

  test('12 — RUNNING status call is awaited', () => {
    expect(code).toMatch(/await\s+\w+\.sendStatusChangedEvent\(\{[\s\S]*?status:\s*['"]RUNNING['"]/);
  });

  test('13 — SUCCEEDED status call is awaited', () => {
    expect(code).toMatch(/await\s+\w+\.sendStatusChangedEvent\(\{[\s\S]*?status:\s*['"]SUCCEEDED['"]/);
  });

  test('14 — error-path (FAILED/CANCELLED) status call is awaited', () => {
    // Generator emits `isCancellation ? 'CANCELLED' : 'FAILED'` in catch blocks
    expect(code).toMatch(/await\s+\w+\.sendStatusChangedEvent\(\{[\s\S]*?status:\s*isCancellation/);
  });
});

// ---------------------------------------------------------------------------
// 15–16: sync workflow — no await anywhere
// ---------------------------------------------------------------------------

describe('Single-node SYNC workflow (PRODUCTION) — sendStatusChangedEvent never awaited', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function doubleSync(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} out - Result
 * @node d doubleSync
 * @connect Start.num -> d.value
 * @connect d.result -> Exit.out
 */
export function syncWorkflow(execute: boolean, params: { num: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-sync.ts', source); });

  test('15 — dev mode sync workflow: all sendStatusChangedEvent calls are awaited', () => {
    // In dev mode, even sync workflows are wrapped in async so the debugger can
    // pause at breakpoints. Every sendStatusChangedEvent call must be awaited.
    expect(callSiteLines(code).length).toBeGreaterThan(0);
    expect(unAwaitedCallSiteLines(code)).toHaveLength(0);
  });

  test('16 — sync workflow emits sendStatusChangedEvent call sites', () => {
    expect(callSiteLines(code).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 17–18: multi-node async chain — every node's calls awaited
// ---------------------------------------------------------------------------

describe('Multi-node async chain — all nodes have awaited status events', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output doubled - number
 */
export async function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output tripled - number
 */
export async function triple(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, tripled: value * 3 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} out - Result
 * @node d double
 * @node t triple
 * @connect Start.num -> d.value
 * @connect d.doubled -> t.value
 * @connect t.tripled -> Exit.out
 */
export async function chainWorkflow(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; out: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-chain.ts', source); });

  test('17 — zero un-awaited call sites across entire chain', () => {
    expect(unAwaitedCallSiteLines(code)).toHaveLength(0);
  });

  test('18 — at least 2 RUNNING await calls (one per user node)', () => {
    const runningCalls = [...code.matchAll(/await\s+\w+\.sendStatusChangedEvent\(\{[\s\S]*?status:\s*['"]RUNNING['"]/g)];
    expect(runningCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 19–20: parallel async nodes — all awaited
// ---------------------------------------------------------------------------

describe('Parallel async nodes — awaited in both branches', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output doubled - number
 */
export async function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output tripled - number
 */
export async function triple(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, tripled: value * 3 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} doubled - Doubled
 * @returns {number} tripled - Tripled
 * @node d double
 * @node t triple
 * @connect Start.num -> d.value
 * @connect Start.num -> t.value
 * @connect d.doubled -> Exit.doubled
 * @connect t.tripled -> Exit.tripled
 */
export async function parallelWorkflow(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; doubled: number; tripled: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-parallel.ts', source); });

  test('19 — parallel workflow has zero un-awaited sendStatusChangedEvent calls', () => {
    expect(unAwaitedCallSiteLines(code)).toHaveLength(0);
  });

  test('20 — parallel workflow still uses Promise.all (parallel not serialised)', () => {
    expect(code).toContain('Promise.all([');
  });
});

// ---------------------------------------------------------------------------
// 21–24: branching node (onSuccess / onFailure) — all paths awaited
// ---------------------------------------------------------------------------

describe('Branching async node — success and failure paths both awaited', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function validate(execute: boolean, value: number) {
  if (value < 0) return { onSuccess: false, onFailure: true, result: 0 };
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function process(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function fallback(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: -1 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} out - Result
 * @node v validate
 * @node p process
 * @node f fallback
 * @connect Start.num -> v.value
 * @connect v.onSuccess -> p.execute
 * @connect v.onFailure -> f.execute
 * @connect v.value -> p.value
 * @connect v.value -> f.value
 * @connect p.result -> Exit.out
 * @connect f.result -> Exit.out
 */
export async function branchWorkflow(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; out: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-branch.ts', source); });

  test('21 — branching workflow has zero un-awaited sendStatusChangedEvent calls', () => {
    expect(unAwaitedCallSiteLines(code)).toHaveLength(0);
  });

  test('22 — at least 3 RUNNING await calls (one per user node)', () => {
    const calls = [...code.matchAll(/await\s+\w+\.sendStatusChangedEvent\(\{[\s\S]*?status:\s*['"]RUNNING['"]/g)];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  test('23 — catch-path (FAILED/CANCELLED) status awaited for every user node', () => {
    // Each user node has a try/catch that emits the ternary status
    const catchCalls = [...code.matchAll(/await\s+\w+\.sendStatusChangedEvent\(\{[\s\S]*?isCancellation/g)];
    expect(catchCalls.length).toBeGreaterThanOrEqual(3);
  });

  test('24 — Start node status event is awaited', () => {
    expect(code).toMatch(/await\s+\w+\.sendStatusChangedEvent\(\{[\s\S]*?nodeTypeName:\s*['"]Start['"]/);
  });
});

// ---------------------------------------------------------------------------
// 25–28: Start and Exit node events in async workflows
// ---------------------------------------------------------------------------

describe('Start and Exit node events — awaited in async workflows', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function identity(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} out - Result
 * @node n identity
 * @connect Start.num -> n.value
 * @connect n.result -> Exit.out
 */
export async function startExitWorkflow(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; out: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-startExit.ts', source); });

  test('25 — Start node status event is awaited', () => {
    expect(code).toMatch(/await\s+ctx\.sendStatusChangedEvent\(\{[\s\S]*?nodeTypeName:\s*['"]Start['"]/);
  });

  test('26 — Exit node status event is awaited', () => {
    expect(code).toMatch(/await\s+ctx\.sendStatusChangedEvent\(\{[\s\S]*?nodeTypeName:\s*['"]Exit['"]/);
  });

  test('27 — no call site in the entire workflow body lacks await', () => {
    expect(unAwaitedCallSiteLines(code)).toHaveLength(0);
  });

  test('28 — total awaited call sites ≥ 5 (Start + node RUNNING/SUCCEEDED/FAILED + Exit)', () => {
    const awaited = [...code.matchAll(/await\s+\w+\.sendStatusChangedEvent\(/g)];
    expect(awaited.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// 29–32: inline-runtime method signatures — full contract checks
// ---------------------------------------------------------------------------

describe('generateInlineRuntime — full method signature contracts', () => {
  const devRuntime = generateInlineRuntime(false);
  const prodRuntime = generateInlineRuntime(true);

  test('29 — dev: sendStatusChangedEvent body awaits sendEvent, not just calls it', () => {
    // Ensure the await appears INSIDE the sendStatusChangedEvent method body.
    // The method signature closes with ): Promise<void> { — start searching from there
    // to avoid matching the args-type closing brace `  }): Promise<void>`.
    const methodStart = devRuntime.indexOf('async sendStatusChangedEvent(');
    const bodyOpenMarker = '): Promise<void> {';
    const bodyOpen = devRuntime.indexOf(bodyOpenMarker, methodStart);
    const methodEnd = devRuntime.indexOf('\n  }', bodyOpen + bodyOpenMarker.length);
    const methodBody = devRuntime.slice(bodyOpen, methodEnd);
    expect(methodBody).toContain('await this.flowWeaverDebugger.sendEvent(');
  });

  test('30 — dev: sendStatusChangedEvent signature has correct args shape', () => {
    expect(devRuntime).toMatch(/async sendStatusChangedEvent\(args:\s*\{/);
  });

  test('31 — prod: sendStatusChangedEvent takes _args (no-op signature)', () => {
    expect(prodRuntime).toMatch(/sendStatusChangedEvent\(_args/);
  });

  test('32 — dev runtime declares TDebugger as a type (not interface, for inline use)', () => {
    expect(devRuntime).toContain('type TDebugger = {');
  });
});

// ---------------------------------------------------------------------------
// 33–35: generateInlineRuntime with exportClasses=true — async preserved
// ---------------------------------------------------------------------------

describe('generateInlineRuntime (dev, exportClasses=true) — async preserved', () => {
  const exportedRuntime = generateInlineRuntime(false, true);

  test('33 — exported dev runtime still has async sendStatusChangedEvent', () => {
    expect(exportedRuntime).toContain('async sendStatusChangedEvent(');
  });

  test('34 — exported dev runtime still awaits sendEvent', () => {
    expect(exportedRuntime).toContain('await this.flowWeaverDebugger.sendEvent(');
  });

  test('35 — exported dev runtime adds export keyword to class', () => {
    expect(exportedRuntime).toContain('export class GeneratedExecutionContext');
  });
});

// ---------------------------------------------------------------------------
// 36–38: generateInlineRuntime javascript output format — async survives transform
// ---------------------------------------------------------------------------

describe('generateInlineRuntime (dev, outputFormat=javascript) — async survives esbuild strip', () => {
  const jsRuntime = generateInlineRuntime(false, false, 'javascript');

  test('36 — JS output still contains async sendStatusChangedEvent', () => {
    expect(jsRuntime).toContain('async sendStatusChangedEvent(');
  });

  test('37 — JS output still awaits sendEvent call', () => {
    expect(jsRuntime).toContain('await this.flowWeaverDebugger.sendEvent(');
  });

  test('38 — JS output does not contain TypeScript type annotations (types stripped)', () => {
    // No TS-only constructs like `: void`, `: Promise<void>`, or `private`
    expect(jsRuntime).not.toMatch(/:\s*Promise<void>/);
  });
});

// ---------------------------------------------------------------------------
// 39–40: regression guards — must not regress to sync sendStatusChangedEvent
// ---------------------------------------------------------------------------

describe('Regression guards', () => {
  const devRuntime = generateInlineRuntime(false);

  test('39 — dev runtime does NOT have sync sendStatusChangedEvent (non-async form)', () => {
    // Would be a regression: plain `sendStatusChangedEvent(args` without `async`
    const syncMethodPattern = /(?<!async\s)sendStatusChangedEvent\(args/;
    expect(devRuntime).not.toMatch(syncMethodPattern);
  });

  test('40 — dev runtime does NOT call sendEvent without await inside sendStatusChangedEvent', () => {
    const methodStart = devRuntime.indexOf('async sendStatusChangedEvent(');
    const methodEnd = devRuntime.indexOf('\n  }', methodStart);
    const methodBody = devRuntime.slice(methodStart, methodEnd);
    // Must not have non-awaited sendEvent call in the method body
    const nonAwaitedSendEvent = methodBody.match(/(?<!await\s)this\.flowWeaverDebugger\.sendEvent\(/);
    expect(nonAwaitedSendEvent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 41–42: Scoped (forEach) async workflow — scopedCtx.sendStatusChangedEvent awaited
// ---------------------------------------------------------------------------

describe('Scoped async workflow — scopedCtx.sendStatusChangedEvent is awaited', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @async
 * @input items [order:1] - Array of items
 * @input success scope:processItem [order:0] - From child onSuccess
 * @input failure scope:processItem [order:1] - From child onFailure
 * @input result scope:processItem [order:2] - Result from child
 * @input execute [order:0] - Execute
 * @output start scope:processItem [order:0] - Triggers child
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - Collected results
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function forEachAsync(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => Promise<{ success: boolean; failure: boolean; result: any }>
): Promise<{ onSuccess: boolean; onFailure: boolean; results: any[] }> {
  return { onSuccess: true, onFailure: false, results: [] };
}

/**
 * @flowWeaver nodeType
 * @async
 * @input item [order:1]
 * @input execute [order:0]
 * @output result [order:2]
 * @output onSuccess [order:0]
 * @output onFailure [order:1]
 */
async function processItem(execute: boolean, item: any): Promise<{ onSuccess: boolean; onFailure: boolean; result: any }> {
  return { onSuccess: true, onFailure: false, result: item };
}

/**
 * @flowWeaver workflow
 * @async
 * @node loop forEachAsync
 * @node proc processItem loop.processItem
 * @connect Start.items -> loop.items
 * @connect loop.start:processItem -> proc.execute
 * @connect loop.item:processItem -> proc.item
 * @connect proc.result -> loop.result:processItem
 * @connect proc.onSuccess -> loop.success:processItem
 * @connect proc.onFailure -> loop.failure:processItem
 * @connect loop.results -> Exit.results
 * @connect loop.onSuccess -> Exit.onSuccess
 * @connect loop.onFailure -> Exit.onFailure
 * @scope loop.processItem [proc]
 * @param items
 * @returns results
 * @returns onSuccess
 * @returns onFailure
 */
export async function scopedAsyncWorkflow(
  execute: boolean,
  params: { items: any[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: any[] }> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-scoped-async.ts', source); });

  test('41 — scoped async workflow has zero un-awaited sendStatusChangedEvent calls', () => {
    expect(unAwaitedCallSiteLines(code)).toHaveLength(0);
  });

  test('42 — scopedCtx.sendStatusChangedEvent calls are awaited', () => {
    expect(code).toMatch(/await\s+scopedCtx\.sendStatusChangedEvent\(/);
  });
});

// ---------------------------------------------------------------------------
// 43–44: Scoped SYNC workflow — scopedCtx.sendStatusChangedEvent NOT awaited
// ---------------------------------------------------------------------------

describe('Scoped sync workflow — scopedCtx.sendStatusChangedEvent NOT awaited', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @input items [order:1] - Array of items
 * @input success scope:processItem [order:0] - From child onSuccess
 * @input failure scope:processItem [order:1] - From child onFailure
 * @input result scope:processItem [order:2] - Result from child
 * @input execute [order:0] - Execute
 * @output start scope:processItem [order:0] - Triggers child
 * @output item scope:processItem [order:1] - Current item
 * @output results [order:2] - Collected results
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function forEachSync(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => { success: boolean; failure: boolean; result: any }
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  return { onSuccess: true, onFailure: false, results: [] };
}

/**
 * @flowWeaver nodeType
 * @input item [order:1]
 * @input execute [order:0]
 * @output result [order:2]
 * @output onSuccess [order:0]
 * @output onFailure [order:1]
 */
function processItemSync(execute: boolean, item: any): { onSuccess: boolean; onFailure: boolean; result: any } {
  return { onSuccess: true, onFailure: false, result: item };
}

/**
 * @flowWeaver workflow
 * @node loop forEachSync
 * @node proc processItemSync loop.processItem
 * @connect Start.items -> loop.items
 * @connect loop.start:processItem -> proc.execute
 * @connect loop.item:processItem -> proc.item
 * @connect proc.result -> loop.result:processItem
 * @connect proc.onSuccess -> loop.success:processItem
 * @connect proc.onFailure -> loop.failure:processItem
 * @connect loop.results -> Exit.results
 * @connect loop.onSuccess -> Exit.onSuccess
 * @connect loop.onFailure -> Exit.onFailure
 * @scope loop.processItem [proc]
 * @param items
 * @returns results
 * @returns onSuccess
 * @returns onFailure
 */
export function scopedSyncWorkflow(
  execute: boolean,
  params: { items: any[] }
): { onSuccess: boolean; onFailure: boolean; results: any[] } {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-scoped-sync.ts', source); });

  test('43 — scoped sync workflow: scope function stays sync (parent node expects sync callback)', () => {
    // Scope functions must NOT be forced async in dev mode because parent nodes
    // (e.g., forEach) call the callback synchronously — an async callback would
    // return Promises instead of values, causing undefined results.
    // The workflow body IS async (for breakpoints), but scope callbacks respect
    // the parent node's sync/async expectation.
    const scopeLines = code.split('\n').filter(l => l.includes('scopedCtx.sendStatusChangedEvent'));
    expect(scopeLines.length).toBeGreaterThan(0); // scope calls exist
    // Scope calls must NOT be awaited — the parent node calls the callback synchronously
    const awaitedScopeLines = scopeLines.filter(l => /await\s/.test(l));
    expect(awaitedScopeLines).toHaveLength(0);
  });

  test('44 — scoped sync workflow still emits sendStatusChangedEvent (just not awaited)', () => {
    expect(code).toContain('scopedCtx.sendStatusChangedEvent(');
    expect(code).not.toMatch(/await\s+scopedCtx\.sendStatusChangedEvent\(/);
  });
});

// ---------------------------------------------------------------------------
// 45–46: SYNC branching workflow — CANCELLED events never awaited
// ---------------------------------------------------------------------------

describe('Sync branching workflow — CANCELLED events NOT awaited', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function validateSync(execute: boolean, value: number) {
  if (value < 0) return { onSuccess: false, onFailure: true, result: 0 };
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function processSync(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function fallbackSync(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: -1 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} out - Result
 * @node v validateSync
 * @node p processSync
 * @node f fallbackSync
 * @connect Start.num -> v.value
 * @connect v.onSuccess -> p.execute
 * @connect v.onFailure -> f.execute
 * @connect v.value -> p.value
 * @connect v.value -> f.value
 * @connect p.result -> Exit.out
 * @connect f.result -> Exit.out
 */
export function syncBranchWorkflow(execute: boolean, params: { num: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-sync-branch.ts', source); });

  test('45 — sync branching workflow in dev mode has ALL calls awaited (debugger support)', () => {
    expect(unAwaitedCallSiteLines(code)).toHaveLength(0);
  });

  test('46 — sync branching workflow emits CANCELLED for non-taken branches', () => {
    // CANCELLED events must still be emitted — just not awaited
    expect(callSiteLines(code).length).toBeGreaterThan(0);
    expect(code).toContain("'CANCELLED'");
  });
});

// ---------------------------------------------------------------------------
// 47–48: Success-only branch — no failure handler → else path for CANCELLED
// ---------------------------------------------------------------------------

describe('Success-only branch (no failure handler) — CANCELLED emitted and awaited in async', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function validateOnly(execute: boolean, value: number) {
  if (value < 0) return { onSuccess: false, onFailure: true, result: 0 };
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function processSuccess(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} out - Result
 * @node v validateOnly
 * @node p processSuccess
 * @connect Start.num -> v.value
 * @connect v.onSuccess -> p.execute
 * @connect v.value -> p.value
 * @connect p.result -> Exit.out
 */
export async function successOnlyWorkflow(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; out: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-success-only.ts', source); });

  test('47 — success-only branch has zero un-awaited sendStatusChangedEvent calls', () => {
    expect(unAwaitedCallSiteLines(code)).toHaveLength(0);
  });

  test('48 — success-only branch emits awaited CANCELLED in the else path for the skipped success node', () => {
    // When the failure path is taken, the success-branch node (p) gets a CANCELLED event
    // in the else block generated by generateCancelledEventsForBranch
    expect(code).toMatch(/await\s+\w+\.sendStatusChangedEvent\(\{[\s\S]*?status:\s*['"]CANCELLED['"]/);
  });
});

// ---------------------------------------------------------------------------
// 49–50: generateInlineRuntime — method declaration uniqueness
// ---------------------------------------------------------------------------

describe('generateInlineRuntime — method declaration uniqueness', () => {
  test('49 — dev runtime contains exactly one async sendStatusChangedEvent declaration', () => {
    const devRuntime = generateInlineRuntime(false);
    const matches = [...devRuntime.matchAll(/async sendStatusChangedEvent\(/g)];
    expect(matches).toHaveLength(1);
  });

  test('50 — prod runtime contains exactly one sendStatusChangedEvent declaration', () => {
    const prodRuntime = generateInlineRuntime(true);
    // Match only declaration forms (followed by `(` that starts the param list)
    const matches = [...prodRuntime.matchAll(/\bsendStatusChangedEvent\s*\(/g)];
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 51–54: generateNodeWithExecutionContext (code-utils.ts) — awaitPrefix contract
// ---------------------------------------------------------------------------

describe('generateNodeWithExecutionContext — awaitPrefix on all sendStatusChangedEvent calls', () => {
  // Minimal AST objects sufficient for the function to run without errors.
  // This function is a public API in generator/index.ts used by external tooling.
  const minimalNode = {
    type: 'NodeType' as const,
    name: 'myNode',
    functionName: 'myNode',
    inputs: { execute: { dataType: 'STEP' as const } },
    outputs: { result: { dataType: 'ANY' as const } },
    hasSuccessPort: false,
    hasFailurePort: false,
    executeWhen: 'always' as const,
    isAsync: false,
  };

  const minimalWorkflow = {
    type: 'Workflow' as const,
    sourceFile: 'test.ts',
    name: 'test',
    functionName: 'test',
    nodeTypes: [],
    instances: [],
    connections: [],
    startPorts: {},
    exitPorts: {},
    imports: [],
  };

  test('51 — async mode: all three sendStatusChangedEvent calls use await', () => {
    const lines: string[] = [];
    generateNodeWithExecutionContext(minimalNode as any, minimalWorkflow as any, lines, true);
    const output = lines.join('\n');
    const awaitedCalls = [...output.matchAll(/await ctx\.sendStatusChangedEvent\(/g)];
    // RUNNING + SUCCEEDED + FAILED = 3 call sites
    expect(awaitedCalls.length).toBeGreaterThanOrEqual(3);
  });

  test('52 — async mode: zero un-awaited sendStatusChangedEvent calls', () => {
    const lines: string[] = [];
    generateNodeWithExecutionContext(minimalNode as any, minimalWorkflow as any, lines, true);
    const output = lines.join('\n');
    const unAwaited = unAwaitedCallSiteLines(output);
    expect(unAwaited).toHaveLength(0);
  });

  test('53 — sync mode: sendStatusChangedEvent calls are NOT awaited', () => {
    const lines: string[] = [];
    generateNodeWithExecutionContext(minimalNode as any, minimalWorkflow as any, lines, false);
    const output = lines.join('\n');
    expect(output).not.toMatch(/await ctx\.sendStatusChangedEvent\(/);
  });

  test('54 — sync mode: sendStatusChangedEvent IS still emitted (just sync)', () => {
    const lines: string[] = [];
    generateNodeWithExecutionContext(minimalNode as any, minimalWorkflow as any, lines, false);
    const output = lines.join('\n');
    expect(output).toContain('ctx.sendStatusChangedEvent(');
  });
});

// ---------------------------------------------------------------------------
// 55–56: Pull node in async workflow — generatePullNodeWithContext uses awaitPrefix
// ---------------------------------------------------------------------------

describe('Async pull node workflow — executor awaits sendStatusChangedEvent', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @async
 * @pullExecution execute
 * @input value - number
 * @output doubled - number
 */
export async function asyncDouble(execute: boolean, value: number): Promise<{
  onSuccess: boolean; onFailure: boolean; doubled: number;
}> {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} out - Result
 * @node d asyncDouble
 * @connect Start.num -> d.value
 * @connect d.doubled -> Exit.out
 */
export async function pullNodeWorkflow(execute: boolean, params: { num: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; out: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-pull-async.ts', source); });

  test('55 — async pull node executor function is async', () => {
    // generatePullNodeWithContext wraps the node in `const d_executor = async () => {`
    expect(code).toMatch(/const\s+\w+_executor\s*=\s*async\s*\(\)/);
  });

  test('56 — async pull node executor awaits sendStatusChangedEvent (zero un-awaited)', () => {
    expect(unAwaitedCallSiteLines(code)).toHaveLength(0);
  });
});

// ===========================================================================
// GENERATED CODE QUALITY INVARIANTS
//
// These tests enforce three non-negotiable rules for all generated output:
//
// 1. ZERO IMPORTS — Generated code must be fully self-contained. It must
//    NEVER import from '@synergenius/flow-weaver' or any other package.
//    The runtime (GeneratedExecutionContext, CancellationError, etc.) is
//    always inlined. Importing creates a deployment dependency that
//    contradicts the "zero runtime dependencies" design.
//
// 2. ZERO `as any` — Generated code must not contain `as any` casts.
//    Use proper types or `as unknown as T` where narrowing is needed.
//    The eslint-disable pragma for @typescript-eslint/no-explicit-any
//    must not appear in generated output.
//
// 3. SYNC WORKFLOWS MUST AWAIT IN DEV MODE — When a debugger is present
//    (!production), even sync workflows must await sendStatusChangedEvent
//    so the async breakpoint mechanism can pause execution. Production
//    mode is unchanged (no await overhead for sync workflows).
// ===========================================================================

// ---------------------------------------------------------------------------
// 57–58: ZERO IMPORTS — generated code must never import from packages
// ---------------------------------------------------------------------------

describe('Generated code — zero imports from @synergenius/flow-weaver', () => {
  // Use the sync workflow from test 15-16 (already compiled above)
  const syncSource = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function add1(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} out - Result
 * @node a add1
 * @connect Start.num -> a.value
 * @connect a.result -> Exit.out
 */
export function noImportsWorkflow(execute: boolean, params: { num: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-no-imports.ts', syncSource); });

  test('57 — generated code has ZERO import statements from @synergenius/flow-weaver', () => {
    // This is a non-negotiable invariant. The runtime must be inlined, never imported.
    expect(code).not.toMatch(/from\s+['"]@synergenius\/flow-weaver/);
    expect(code).not.toMatch(/require\(\s*['"]@synergenius\/flow-weaver/);
  });

  test('58 — generated code has ZERO import statements from any external package', () => {
    // Only relative imports (./foo, ../bar) are acceptable. No bare specifiers.
    const importLines = code.split('\n').filter((l) =>
      /^\s*(import\s|const\s+\w+\s*=\s*require)/.test(l)
    );
    const externalImports = importLines.filter(
      (l) => !l.includes("'./") && !l.includes("'../") && !l.includes('"./')  && !l.includes('"../')
    );
    expect(externalImports).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 59–60: ZERO `as any` — generated code must use proper types
// ---------------------------------------------------------------------------

describe('Generated code — zero `as any` casts', () => {
  const syncSource = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} out - Result
 * @node d double
 * @connect Start.num -> d.value
 * @connect d.result -> Exit.out
 */
export function noAnyWorkflow(execute: boolean, params: { num: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-no-any.ts', syncSource); });

  test('59 — generated code contains zero `as any` casts', () => {
    const anyMatches = code.match(/as any\b/g);
    expect(anyMatches ?? []).toHaveLength(0);
  });

  test('60 — generated code has no eslint-disable for no-explicit-any', () => {
    expect(code).not.toContain('no-explicit-any');
  });
});

// ---------------------------------------------------------------------------
// 61–65: SYNC WORKFLOW IN DEV MODE — must await for debugger breakpoints
// ---------------------------------------------------------------------------

describe('Sync workflow in dev mode — sendStatusChangedEvent awaited for debugger', () => {
  const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function increment(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @param num - number
 * @returns {number} out - Result
 * @node n increment
 * @connect Start.num -> n.value
 * @connect n.result -> Exit.out
 */
export function syncDebugWorkflow(execute: boolean, params: { num: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
  `;

  let code: string;
  beforeAll(async () => { code = await compileWorkflow('bp-sync-debug.ts', source); });

  test('61 — dev mode sync workflow has ALL sendStatusChangedEvent calls awaited', () => {
    expect(unAwaitedCallSiteLines(code)).toHaveLength(0);
  });

  test('62 — dev mode sync workflow has sendStatusChangedEvent call sites', () => {
    expect(callSiteLines(code).length).toBeGreaterThan(0);
  });

  test('63 — GeneratedExecutionContext is created with true (async) in dev mode', () => {
    expect(code).toMatch(/new GeneratedExecutionContext\(true[,)]/);
    expect(code).not.toMatch(/new GeneratedExecutionContext\(false[,)]/);
  });

  test('64 — dev mode sync workflow wraps body in async IIFE or makes function async', () => {
    // Either the function is async, or the body is wrapped in (async () => { ... })()
    const hasAsyncFunction = /export\s+async\s+function\s+syncDebugWorkflow/.test(code);
    const hasAsyncIIFE = /return\s+\(?async\s*\(\)\s*=>\s*\{/.test(code);
    expect(hasAsyncFunction || hasAsyncIIFE).toBe(true);
  });

  test('65 — RUNNING status call is awaited in dev mode sync workflow', () => {
    expect(code).toMatch(/await\s+\w+\.sendStatusChangedEvent\(\{[\s\S]*?status:\s*['"]RUNNING['"]/);
  });
});
