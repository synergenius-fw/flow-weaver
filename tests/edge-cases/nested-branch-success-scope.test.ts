/**
 * Tests for nested branching node _success variable scoping.
 *
 * Bug: When a branching node (gate) sits downstream of another branching
 * node (router) that has its own fail path, the gate's _success flag is
 * declared inside the router's success guard block but referenced at a
 * higher scope by downstream nodes, causing a ReferenceError.
 *
 * Reproduces the weaver-bot topology:
 *   Start -> router -> context -> gate -> process -> merge -> report -> Exit
 *   router:fail -> fallback -> report (separate fail path)
 *   gate:fail -> merge (skip path)
 *
 * The router:fail path causes context and gate to be generated inside
 * router's success branch, scoping their variables incorrectly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generator } from '../../src/generator/workflow-generator';

const TEST_DIR = path.join(os.tmpdir(), `fw-nested-branch-scope-${process.pid}`);

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
// Workflow that reproduces the scoping bug.
// Key: router has a :fail path, which causes everything downstream
// (context, gate, process) to be generated inside router's success guard.
// The gate's _success flag ends up declared in that nested scope but
// referenced at the outer scope when guarding process.
// ---------------------------------------------------------------------------

const NESTED_BRANCH_SCOPE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @label Router
 * @input mode - Routing mode
 * @output ctx - Routed context
 */
function routeMode(execute: boolean, mode: string): { onSuccess: boolean; onFailure: boolean; ctx: string } {
  if (!execute) return { onSuccess: false, onFailure: false, ctx: '' };
  if (mode === 'fail') return { onSuccess: false, onFailure: true, ctx: '' };
  return { onSuccess: true, onFailure: false, ctx: mode };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Fallback
 * @input ctx - Fallback context
 * @output result - Fallback result
 */
function fallback(ctx: string): { result: string } {
  return { result: 'fallback' };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Context
 * @input ctx - Input
 * @output ctx - Built context
 */
function buildCtx(ctx: string): { ctx: string } {
  return { ctx: 'built:' + ctx };
}

/**
 * @flowWeaver nodeType
 * @label Gate
 * @input flag - Enable/disable flag
 * @output onSuccess - Enabled
 * @output onFailure - Disabled (skip)
 */
function gate(execute: boolean, flag: string): { onSuccess: boolean; onFailure: boolean } {
  if (!execute) return { onSuccess: false, onFailure: false };
  if (flag === 'yes') return { onSuccess: true, onFailure: false };
  return { onSuccess: false, onFailure: true };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Process
 * @input ctx - Input context
 * @output ctx - Processed context
 */
function processCtx(ctx: string): { ctx: string } {
  return { ctx: 'processed:' + ctx };
}

/**
 * @flowWeaver nodeType
 * @executeWhen DISJUNCTION
 * @label Merge
 * @input [ctxA] - From process path
 * @input [ctxB] - From skip path
 * @output ctx - Merged result
 */
function mergeCtx(execute: boolean, ctxA?: string, ctxB?: string): { onSuccess: boolean; onFailure: boolean; ctx: string } {
  if (!execute) return { onSuccess: false, onFailure: false, ctx: '' };
  const ctx = ctxA ?? ctxB ?? '';
  return { onSuccess: true, onFailure: false, ctx };
}

/**
 * @flowWeaver nodeType
 * @executeWhen DISJUNCTION
 * @label Report
 * @input [mainCtx] - Context from main path
 * @input [fallbackResult] - Result from fallback path
 * @output result - Final result
 */
function report(execute: boolean, mainCtx?: string, fallbackResult?: string): { onSuccess: boolean; onFailure: boolean; result: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: mainCtx ?? fallbackResult ?? 'empty' };
}

/**
 * @flowWeaver workflow
 * @node r routeMode
 * @node fb fallback
 * @node bctx buildCtx
 * @node g gate
 * @node proc processCtx
 * @node m mergeCtx
 * @node rep report
 *
 * @path Start -> r -> bctx -> g -> proc
 * @path r:fail -> fb
 * @path m -> rep -> Exit
 *
 * @connect bctx.ctx -> proc.ctx
 * @connect proc.onSuccess -> m.execute
 * @connect proc.ctx -> m.ctxA
 *
 * @connect g.onFailure -> m.execute
 * @connect bctx.ctx -> m.ctxB
 *
 * @connect m.ctx -> rep.mainCtx
 * @connect fb.result -> rep.fallbackResult
 * @connect fb.onSuccess -> rep.execute
 *
 * @connect rep.result -> Exit.result
 *
 * @param execute [order:0] - Execute
 * @param mode [order:1] - Router mode
 * @param flag [order:2] - Gate flag (yes/no)
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns result [order:2] - Result
 */
export function nestedBranchScopeWorkflow(
  execute: boolean,
  params: { mode: string; flag: string }
): { onSuccess: boolean; onFailure: boolean; result?: string } {
  throw new Error('Generated');
}
`;

describe('Nested branching node _success variable scope', () => {
  let generatedCode: string;
  let outputFile: string;

  beforeAll(async () => {
    const srcFile = writeFixture('nested-branch-scope', NESTED_BRANCH_SCOPE_WORKFLOW);
    generatedCode = await generator.generate(srcFile, 'nestedBranchScopeWorkflow');
    outputFile = path.join(TEST_DIR, 'nested-branch-scope.generated.ts');
    fs.writeFileSync(outputFile, generatedCode, 'utf-8');
  });

  it('generated code should declare gate _success at accessible scope', () => {
    // The bug: g_success is used as a guard but declared inside a nested block
    // Check that g_success is declared at a scope accessible to downstream code
    const usageIndex = generatedCode.indexOf('if (g_success)');
    if (usageIndex === -1) {
      // If the compiler doesn't use g_success as a guard, that's also fine
      return;
    }

    // Find the declaration of g_success
    const declIndex = generatedCode.indexOf('let g_success');
    expect(declIndex).toBeGreaterThan(-1); // Must be declared

    // The declaration must come BEFORE the usage
    expect(declIndex).toBeLessThan(usageIndex);

    // The declaration must NOT be inside a deeper block than the usage.
    // Count the nesting depth (opening { minus closing }) at both points.
    const beforeDecl = generatedCode.substring(0, declIndex);
    const beforeUsage = generatedCode.substring(0, usageIndex);
    const depthAtDecl = (beforeDecl.match(/\{/g) || []).length - (beforeDecl.match(/\}/g) || []).length;
    const depthAtUsage = (beforeUsage.match(/\{/g) || []).length - (beforeUsage.match(/\}/g) || []).length;

    // Declaration must be at same or shallower nesting depth than usage
    expect(depthAtDecl).toBeLessThanOrEqual(depthAtUsage);
  });

  it('should be importable as valid TypeScript', async () => {
    // If g_success is declared in a nested scope but referenced at a higher
    // scope, the import will fail with a ReferenceError
    const mod = await import(outputFile);
    expect(mod.nestedBranchScopeWorkflow).toBeDefined();
  });

  it('should not throw ReferenceError when gate is enabled (mode=ok, flag=yes)', async () => {
    const mod = await import(outputFile);
    // The key assertion: calling the function should NOT throw ReferenceError
    // about g_success being undefined. The result values depend on the
    // workflow's fan-in merge logic which is tested separately.
    const result = await mod.nestedBranchScopeWorkflow(
      true,
      { mode: 'ok', flag: 'yes' },
      testHelpers.createRuntime('nestedBranchScopeWorkflow'),
    );
    expect(result).toBeDefined();
  });

  it('should not throw ReferenceError when gate is disabled (mode=ok, flag=no)', async () => {
    const mod = await import(outputFile);
    const result = await mod.nestedBranchScopeWorkflow(
      true,
      { mode: 'ok', flag: 'no' },
      testHelpers.createRuntime('nestedBranchScopeWorkflow'),
    );
    expect(result).toBeDefined();
  });

  it('should not throw ReferenceError on fallback path (mode=fail)', async () => {
    const mod = await import(outputFile);
    const result = await mod.nestedBranchScopeWorkflow(
      true,
      { mode: 'fail', flag: 'yes' },
      testHelpers.createRuntime('nestedBranchScopeWorkflow'),
    );
    expect(result).toBeDefined();
  });

  it('g_success should not be declared with let more than once', () => {
    // Ensure no duplicate declarations which would cause a SyntaxError
    const matches = generatedCode.match(/let g_success/g);
    if (matches) {
      expect(matches.length).toBe(1);
    }
  });

  it('all _success flags referenced in guards should be declared', () => {
    // Find all `if (xxx_success)` references
    const guardPattern = /if \((\w+_success)/g;
    let match: RegExpExecArray | null;
    const referencedFlags = new Set<string>();
    while ((match = guardPattern.exec(generatedCode)) !== null) {
      referencedFlags.add(match[1]);
    }

    // Each referenced flag must have a `let` declaration
    for (const flag of referencedFlags) {
      const declPattern = new RegExp(`let ${flag}\\b`);
      expect(generatedCode).toMatch(declPattern);
    }
  });

  it('all _success flags used as guards must be assigned from success state', () => {
    // Bug: flag is declared `let g_success = false` and used in `if (g_success)`
    // but never assigned `= true` after the node succeeds → downstream is dead code
    const guardPattern = /if \((\w+_success)\)/g;
    let match: RegExpExecArray | null;
    const guardedFlags = new Set<string>();
    while ((match = guardPattern.exec(generatedCode)) !== null) {
      guardedFlags.add(match[1]);
    }

    for (const flag of guardedFlags) {
      const assignPattern = new RegExp(`${flag}\\s*=\\s*(?:true|\\w+Result\\.onSuccess)`);
      expect(generatedCode, `${flag} is used as guard but never set to true, so downstream nodes are dead code`).toMatch(
        assignPattern,
      );
    }
  });

  it('gate success path actually executes process node (runtime)', async () => {
    const mod = await import(outputFile);
    const result = await mod.nestedBranchScopeWorkflow(
      true,
      { mode: 'ok', flag: 'yes' },
      testHelpers.createRuntime('nestedBranchScopeWorkflow'),
    );
    // When gate is enabled, process should run and its output should reach report
    // via merge. The result should contain 'processed:' prefix from processCtx.
    expect(result.result).toContain('processed:');
  });

  it('gate skip path uses skip context via merge (runtime)', async () => {
    const mod = await import(outputFile);
    const result = await mod.nestedBranchScopeWorkflow(
      true,
      { mode: 'ok', flag: 'no' },
      testHelpers.createRuntime('nestedBranchScopeWorkflow'),
    );
    // When gate is disabled, process is skipped. Merge should use ctxB (built context).
    expect(result.result).toContain('built:');
    expect(result.result).not.toContain('processed:');
  });
});

// ---------------------------------------------------------------------------
// Edge case: Double-nested branching (A -> B -> C where all branch)
// ---------------------------------------------------------------------------

const DOUBLE_NESTED_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input mode
 * @output data
 */
function outerRouter(execute: boolean, mode: string): { onSuccess: boolean; onFailure: boolean; data: string } {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  if (mode === 'skip') return { onSuccess: false, onFailure: true, data: '' };
  return { onSuccess: true, onFailure: false, data: mode };
}

/**
 * @flowWeaver nodeType
 * @input flag
 */
function middleGate(execute: boolean, flag: string): { onSuccess: boolean; onFailure: boolean } {
  if (!execute) return { onSuccess: false, onFailure: false };
  return flag === 'yes' ? { onSuccess: true, onFailure: false } : { onSuccess: false, onFailure: true };
}

/**
 * @flowWeaver nodeType
 * @input level
 */
function innerGate(execute: boolean, level: string): { onSuccess: boolean; onFailure: boolean } {
  if (!execute) return { onSuccess: false, onFailure: false };
  return level === 'high' ? { onSuccess: true, onFailure: false } : { onSuccess: false, onFailure: true };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input data
 * @output result
 */
function transform(data: string): { result: string } {
  return { result: 'transformed:' + data };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input data
 * @output result
 */
function fallbackOuter(data: string): { result: string } {
  return { result: 'outer-fallback' };
}

/**
 * @flowWeaver workflow
 * @node outer outerRouter
 * @node mid middleGate
 * @node inner innerGate
 * @node t transform
 * @node fb fallbackOuter
 *
 * @path Start -> outer -> mid -> inner -> t -> Exit
 * @path outer:fail -> fb -> Exit
 *
 * @connect outer.data -> t.data
 * @connect t.result -> Exit.result
 * @connect fb.result -> Exit.result
 *
 * @param execute [order:0]
 * @param mode [order:1]
 * @param flag [order:2]
 * @param level [order:3]
 * @returns onSuccess [order:0]
 * @returns onFailure [order:1]
 * @returns result [order:2]
 */
export function doubleNestedWorkflow(
  execute: boolean,
  params: { mode: string; flag: string; level: string }
): { onSuccess: boolean; onFailure: boolean; result?: string } {
  throw new Error('Generated');
}
`;

describe('Double-nested branching scoping', () => {
  let generatedCode: string;
  let outputFile: string;

  beforeAll(async () => {
    const srcFile = writeFixture('double-nested', DOUBLE_NESTED_WORKFLOW);
    generatedCode = await generator.generate(srcFile, 'doubleNestedWorkflow');
    outputFile = path.join(TEST_DIR, 'double-nested.generated.ts');
    fs.writeFileSync(outputFile, generatedCode, 'utf-8');
  });

  it('all _success flags should be declared at accessible scope', () => {
    const guardPattern = /if \((\w+_success)/g;
    let match: RegExpExecArray | null;
    while ((match = guardPattern.exec(generatedCode)) !== null) {
      const flag = match[1];
      const declPattern = new RegExp(`let ${flag}\\b`);
      expect(generatedCode).toMatch(declPattern);
    }
  });

  it('should be importable without ReferenceError', async () => {
    const mod = await import(outputFile);
    expect(mod.doubleNestedWorkflow).toBeDefined();
  });

  it('should execute all gates when all enabled', async () => {
    const mod = await import(outputFile);
    const result = await mod.doubleNestedWorkflow(
      true,
      { mode: 'ok', flag: 'yes', level: 'high' },
      testHelpers.createRuntime('doubleNestedWorkflow'),
    );
    expect(result).toBeDefined();
    // Should not throw
  });

  it('should handle middle gate disabled', async () => {
    const mod = await import(outputFile);
    const result = await mod.doubleNestedWorkflow(
      true,
      { mode: 'ok', flag: 'no', level: 'high' },
      testHelpers.createRuntime('doubleNestedWorkflow'),
    );
    expect(result).toBeDefined();
  });

  it('should handle outer router fail path', async () => {
    const mod = await import(outputFile);
    const result = await mod.doubleNestedWorkflow(
      true,
      { mode: 'skip', flag: 'yes', level: 'high' },
      testHelpers.createRuntime('doubleNestedWorkflow'),
    );
    expect(result).toBeDefined();
  });

  it('no _success flag should be declared more than once', () => {
    const declPattern = /let (\w+_success)/g;
    const declarations = new Map<string, number>();
    let match: RegExpExecArray | null;
    while ((match = declPattern.exec(generatedCode)) !== null) {
      const flag = match[1];
      declarations.set(flag, (declarations.get(flag) ?? 0) + 1);
    }
    for (const [flag, count] of declarations) {
      expect(count, `${flag} declared ${count} times`).toBe(1);
    }
  });
});
