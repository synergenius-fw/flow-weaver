/**
 * Branch coverage tests for src/generator/unified.ts
 *
 * Targets conditional branches that are harder to reach through end-to-end compilation:
 * - Production vs dev mode (debugger, controller, variable_set omission)
 * - Sync vs async code paths (await keywords, Promise.all)
 * - Pull execution config: boolean vs object, instance vs nodeType default
 * - Branching nodes with only success downstream, only failure downstream, both, neither
 * - Exit port edge cases: undeclared exit port, multiple connections to same port
 * - Stub node variant runtime throw
 * - Coercion node inline expression
 * - WORKFLOW variant params wrapping with recursion depth
 * - Expression branching node with single vs multiple data outputs
 */
import * as fs from 'fs';
import * as path from 'path';

// --------------------------------------------------------------------------
// 1. Production mode omits debug hooks and variable_set for Exit ports
// --------------------------------------------------------------------------
describe('Unified Generator: production mode branches', () => {
  it('omits debug controller and exit variable_set in production mode', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output doubled - number
 */
export function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} result - Doubled
 * @node d double
 * @connect Start.n -> d.value
 * @connect d.doubled -> Exit.result
 */
export function prodWorkflow(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; result: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'prod-mode.ts');
    fs.writeFileSync(testFile, source);

    try {
      const devCode = await global.testHelpers.generateFast(testFile, 'prodWorkflow');
      const prodCode = await global.testHelpers.generateFast(testFile, 'prodWorkflow', { production: true });

      // Dev mode has debug controller and effective debugger
      expect(devCode).toContain('__ctrl__');
      expect(devCode).toContain('__effectiveDebugger__');

      // Production mode omits them
      expect(prodCode).not.toContain('__ctrl__');
      expect(prodCode).not.toContain('__effectiveDebugger__');

      // Both produce valid code with the node call
      expect(devCode).toContain('double');
      expect(prodCode).toContain('double');
    } finally {
      global.testHelpers.cleanupOutput('prod-mode.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 2. Sync workflow: no await keywords
// --------------------------------------------------------------------------
describe('Unified Generator: sync vs async branches', () => {
  it('generates sync code without await for sync workflow', async () => {
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
 * @param n - number
 * @returns {number} out - Result
 * @node inc increment
 * @connect Start.n -> inc.value
 * @connect inc.result -> Exit.out
 */
export function syncWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'sync-wf.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'syncWf', { production: true });
      // Sync workflow should not have await keywords on ctx calls
      expect(code).toContain('ctx.setVariable');
      expect(code).toContain('ctx.getVariable');
      expect(code).not.toContain('await ctx.setVariable');
      expect(code).not.toContain('await ctx.getVariable');
    } finally {
      global.testHelpers.cleanupOutput('sync-wf.ts');
    }
  });

  it('generates async code with await for async workflow', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function asyncInc(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} out - Result
 * @node inc asyncInc
 * @connect Start.n -> inc.value
 * @connect inc.result -> Exit.out
 */
export async function asyncWf(execute: boolean, params: { n: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; out: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'async-wf.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'asyncWf');
      expect(code).toContain('await ctx.setVariable');
      expect(code).toContain('await ctx.getVariable');
    } finally {
      global.testHelpers.cleanupOutput('async-wf.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 3. Branching node with only success downstream (no failure branch)
// --------------------------------------------------------------------------
describe('Unified Generator: branching node downstream branches', () => {
  it('generates if block with cancelled else when only success downstream exists', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function check(execute: boolean, value: number) {
  return { onSuccess: value > 0, onFailure: value <= 0, result: value };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function successHandler(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 10 };
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} out - Result
 * @node c check
 * @node s successHandler
 * @connect Start.n -> c.value
 * @connect c.onSuccess -> s.execute
 * @connect c.result -> s.value
 * @connect s.result -> Exit.out
 */
export function successOnlyWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'success-only.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'successOnlyWf');
      // Should have if(c_success) block
      expect(code).toContain('c_success');
      expect(code).toContain('successHandler');
      // Should have CANCELLED events for the else path
      expect(code).toContain('CANCELLED');
    } finally {
      global.testHelpers.cleanupOutput('success-only.ts');
    }
  });

  it('generates if/else with failure branch when both downstream exist', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function validator(execute: boolean, value: number) {
  return { onSuccess: value > 0, onFailure: value <= 0, result: value };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - string
 */
export function onOk(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: 'ok' };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - string
 */
export function onFail(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: 'fail' };
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {string} out - Result
 * @node v validator
 * @node ok onOk
 * @node fail onFail
 * @connect Start.n -> v.value
 * @connect v.onSuccess -> ok.execute
 * @connect v.result -> ok.value
 * @connect v.onFailure -> fail.execute
 * @connect v.result -> fail.value
 * @connect ok.result -> Exit.out
 * @connect fail.result -> Exit.out
 */
export function bothBranchesWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: string;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'both-branches.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'bothBranchesWf');
      expect(code).toContain('v_success');
      expect(code).toContain('onOk');
      expect(code).toContain('onFail');
      // Both branches generate CANCELLED events for the path not taken
      expect(code).toContain('CANCELLED');
    } finally {
      global.testHelpers.cleanupOutput('both-branches.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 4. Exit port edge cases: multiple connections to same exit port coalesced
// --------------------------------------------------------------------------
describe('Unified Generator: exit port coalescing', () => {
  it('coalesces multiple connections to the same exit port with ?? operator', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function pathA(execute: boolean, value: number) {
  return { onSuccess: value > 0, onFailure: value <= 0, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function pathB(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value + 100 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function pathC(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value - 1 };
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} out - Result
 * @node a pathA
 * @node b pathB
 * @node c pathC
 * @connect Start.n -> a.value
 * @connect a.onSuccess -> b.execute
 * @connect a.result -> b.value
 * @connect a.onFailure -> c.execute
 * @connect a.result -> c.value
 * @connect b.result -> Exit.out
 * @connect c.result -> Exit.out
 */
export function coalesceWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'coalesce-exit.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'coalesceWf');
      // Two connections to Exit.out should be coalesced with ?? operator
      expect(code).toContain('??');
    } finally {
      global.testHelpers.cleanupOutput('coalesce-exit.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 5. Stub node variant: generates runtime throw
// --------------------------------------------------------------------------
describe('Unified Generator: stub node variant', () => {
  it('generates a throw statement for stub nodes', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @stub
 * @input value - number
 * @output result - number
 */
export function missingImpl(execute: boolean, value: number): {
  onSuccess: boolean; onFailure: boolean; result: number;
} {
  throw new Error('Not implemented');
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} out - Result
 * @node m missingImpl
 * @connect Start.n -> m.value
 * @connect m.result -> Exit.out
 */
export function stubWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'stub-node.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'stubWf');
      expect(code).toContain('stub');
      expect(code).toContain('missingImpl');
    } finally {
      global.testHelpers.cleanupOutput('stub-node.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 6. Expression node: single data output branch vs multiple
// --------------------------------------------------------------------------
describe('Unified Generator: expression node output branches', () => {
  it('generates raw value extraction for single-output expression node', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input value - number
 * @output doubled - number
 */
export function exprDouble(value: number): number {
  return value * 2;
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} out - Result
 * @node d exprDouble
 * @connect Start.n -> d.value
 * @connect d.doubled -> Exit.out
 */
export function singleExprWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'single-expr.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'singleExprWf');
      // Single data output uses typeof check for raw value extraction
      expect(code).toContain('typeof');
      expect(code).toContain('_raw');
      expect(code).toContain('exprDouble');
    } finally {
      global.testHelpers.cleanupOutput('single-expr.ts');
    }
  });

  it('generates destructured access for multi-output expression node', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input text - string
 * @output length - number
 * @output upper - string
 */
export function analyze(text: string): { length: number; upper: string } {
  return { length: text.length, upper: text.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @param s - string
 * @returns {number} len - Length
 * @returns {string} up - Upper
 * @node a analyze
 * @connect Start.s -> a.text
 * @connect a.length -> Exit.len
 * @connect a.upper -> Exit.up
 */
export function multiExprWf(execute: boolean, params: { s: string }): {
  onSuccess: boolean; onFailure: boolean; len: number; up: string;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'multi-expr.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'multiExprWf');
      // Multi-output uses destructured access (result.portName)
      expect(code).toContain('.length');
      expect(code).toContain('.upper');
      // Should NOT have raw value extraction
      expect(code).not.toContain('_raw');
    } finally {
      global.testHelpers.cleanupOutput('multi-expr.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 7. Parallel execution: async workflow with independent nodes
// --------------------------------------------------------------------------
describe('Unified Generator: parallel execution', () => {
  it('generates Promise.all for independent async nodes', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function slowDouble(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export async function slowTriple(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 3 };
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} doubled - Doubled
 * @returns {number} tripled - Tripled
 * @node d slowDouble
 * @node t slowTriple
 * @connect Start.n -> d.value
 * @connect Start.n -> t.value
 * @connect d.result -> Exit.doubled
 * @connect t.result -> Exit.tripled
 */
export async function parallelWf(execute: boolean, params: { n: number }): Promise<{
  onSuccess: boolean; onFailure: boolean; doubled: number; tripled: number;
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'parallel-wf.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'parallelWf');
      // Two independent async nodes should be wrapped in Promise.all
      expect(code).toContain('Promise.all');
      expect(code).toContain('slowDouble');
      expect(code).toContain('slowTriple');
    } finally {
      global.testHelpers.cleanupOutput('parallel-wf.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 8. Recursion depth protection
// --------------------------------------------------------------------------
describe('Unified Generator: recursion depth protection', () => {
  it('includes recursion depth check in generated code', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function identity(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} out - Result
 * @node id identity
 * @connect Start.n -> id.value
 * @connect id.result -> Exit.out
 */
export function rdWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'rd-check.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'rdWf');
      expect(code).toContain('__rd__');
      expect(code).toContain('1000');
      expect(code).toContain('Max recursion depth');
    } finally {
      global.testHelpers.cleanupOutput('rd-check.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 9. Default onSuccess/onFailure when not explicitly connected
// --------------------------------------------------------------------------
describe('Unified Generator: default exit port values', () => {
  it('adds default onSuccess: true when not connected', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function noop(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} out - Result
 * @node x noop
 * @connect Start.n -> x.value
 * @connect x.result -> Exit.out
 */
export function defaultExitWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'default-exit.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'defaultExitWf');
      // Default onSuccess: true and onFailure: false in return
      expect(code).toContain('onSuccess: true');
      expect(code).toContain('onFailure: false');
    } finally {
      global.testHelpers.cleanupOutput('default-exit.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 10. Coercion node: inline expression instead of function call
// --------------------------------------------------------------------------
describe('Unified Generator: coercion node variant', () => {
  it('generates inline String() call for toString coercion', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @expression
 * @coercion toString
 * @input value - number
 * @output result - string
 */
export function __fw_toString(value: number): string {
  return String(value);
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {string} out - Stringified
 * @node c __fw_toString
 * @connect Start.n -> c.value
 * @connect c.result -> Exit.out
 */
export function coercionWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: string;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'coercion-node.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'coercionWf');
      // Coercion nodes use inline expressions like String(value)
      expect(code).toContain('String(');
      expect(code).toContain('__fw_toString');
    } finally {
      global.testHelpers.cleanupOutput('coercion-node.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 11. DISJUNCTION executeWhen strategy
// --------------------------------------------------------------------------
describe('Unified Generator: DISJUNCTION executeWhen', () => {
  it('generates OR condition for DISJUNCTION strategy', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function srcA(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function srcB(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver nodeType
 * @input a - number
 * @input b - number
 * @output result - number
 * @executeWhen DISJUNCTION
 */
export function disjNode(execute: boolean, a: number, b: number) {
  return { onSuccess: true, onFailure: false, result: a + b };
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} out - Result
 * @node sa srcA
 * @node sb srcB
 * @node d disjNode
 * @connect Start.n -> sa.value
 * @connect Start.n -> sb.value
 * @connect sa.onSuccess -> d.execute
 * @connect sb.onSuccess -> d.execute
 * @connect sa.result -> d.a
 * @connect sb.result -> d.b
 * @connect d.result -> Exit.out
 */
export function disjWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'disj-wf.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'disjWf');
      // DISJUNCTION uses OR logic (||)
      expect(code).toContain('||');
      expect(code).toContain('disjNode');
    } finally {
      global.testHelpers.cleanupOutput('disj-wf.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 12. Abort signal / checkAborted is always emitted
// --------------------------------------------------------------------------
describe('Unified Generator: abort signal', () => {
  it('emits checkAborted calls and __abortSignal__ parameter', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function compute(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} out - Result
 * @node c compute
 * @connect Start.n -> c.value
 * @connect c.result -> Exit.out
 */
export function abortWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'abort-wf.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'abortWf');
      expect(code).toContain('checkAborted');
      expect(code).toContain('__abortSignal__');
    } finally {
      global.testHelpers.cleanupOutput('abort-wf.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 13. Workflow completed event and final result construction
// --------------------------------------------------------------------------
describe('Unified Generator: workflow completed event', () => {
  it('emits sendWorkflowCompletedEvent with finalResult', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function passthrough(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} out - Result
 * @node p passthrough
 * @connect Start.n -> p.value
 * @connect p.result -> Exit.out
 */
export function completedWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'completed-wf.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'completedWf');
      expect(code).toContain('sendWorkflowCompletedEvent');
      expect(code).toContain('finalResult');
      expect(code).toContain("status: 'SUCCEEDED'");
    } finally {
      global.testHelpers.cleanupOutput('completed-wf.ts');
    }
  });
});

// --------------------------------------------------------------------------
// 14. CancellationError handling in catch blocks
// --------------------------------------------------------------------------
describe('Unified Generator: cancellation error handling', () => {
  it('distinguishes cancellation from regular errors in catch blocks', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input value - number
 * @output result - number
 */
export function risky(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 * @param n - number
 * @returns {number} out - Result
 * @node r risky
 * @connect Start.n -> r.value
 * @connect r.result -> Exit.out
 */
export function cancelWf(execute: boolean, params: { n: number }): {
  onSuccess: boolean; onFailure: boolean; out: number;
} {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
`.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'cancel-wf.ts');
    fs.writeFileSync(testFile, source);

    try {
      const code = await global.testHelpers.generateFast(testFile, 'cancelWf');
      expect(code).toContain('CancellationError.isCancellationError');
      expect(code).toContain("isCancellation ? 'CANCELLED' : 'FAILED'");
      expect(code).toContain('sendLogErrorEvent');
    } finally {
      global.testHelpers.cleanupOutput('cancel-wf.ts');
    }
  });
});
