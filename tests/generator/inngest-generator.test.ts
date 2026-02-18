/**
 * Tests for the Inngest deep code generator.
 *
 * Tests that generateInngestFunction() produces correct Inngest function code
 * with per-node step.run() wrapping, parallel detection, branching, etc.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, afterAll } from 'vitest';
import { generateInngestFunction, type InngestGenerationOptions } from '../../src/generator/inngest';
import { parser } from '../../src/parser';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-inngest-gen-'));

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

/**
 * Helper: parse a source file and generate Inngest code
 */
function parseAndGenerate(source: string, options?: InngestGenerationOptions): string {
  const tmpFile = path.join(tmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(tmpFile, source);
  const result = parser.parse(tmpFile);
  expect(result.errors).toHaveLength(0);
  expect(result.workflows.length).toBeGreaterThan(0);

  const workflow = result.workflows[0];
  const allNodeTypes = [...(workflow.nodeTypes || [])];
  return generateInngestFunction(workflow, allNodeTypes, options);
}

// ---------------------------------------------------------------------------
// Fixture workflows
// ---------------------------------------------------------------------------

const SIMPLE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input message - The message
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output result - The result
 */
function greet(execute: boolean, message: string): { onSuccess: boolean; onFailure: boolean; result: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: 'Hello ' + message };
}

/**
 * @flowWeaver workflow
 * @name simpleWorkflow
 * @node g greet
 * @connect Start.execute -> g.execute
 * @connect Start.message -> g.message
 * @connect g.onSuccess -> Exit.onSuccess
 * @connect g.result -> Exit.result
 */
export function simpleWorkflow(
  execute: boolean,
  params: { message: string }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

const TWO_NODE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input value - Input value
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output doubled - Doubled value
 */
function doubler(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; doubled: number } {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input value - Input value
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output incremented - Incremented value
 */
function incrementer(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; incremented: number } {
  if (!execute) return { onSuccess: false, onFailure: false, incremented: 0 };
  return { onSuccess: true, onFailure: false, incremented: value + 1 };
}

/**
 * @flowWeaver workflow
 * @name twoNodeWorkflow
 * @node d doubler
 * @node i incrementer
 * @connect Start.execute -> d.execute
 * @connect Start.value -> d.value
 * @connect d.onSuccess -> i.execute
 * @connect d.doubled -> i.value
 * @connect i.onSuccess -> Exit.onSuccess
 * @connect i.incremented -> Exit.result
 */
export function twoNodeWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

const BRANCHING_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input value - Input value
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output checked - Checked value
 */
function validator(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; checked: number } {
  if (!execute) return { onSuccess: false, onFailure: false, checked: 0 };
  if (value > 0) return { onSuccess: true, onFailure: false, checked: value };
  return { onSuccess: false, onFailure: true, checked: value };
}

/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input value - Input value
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output processed - Processed value
 */
function processor(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; processed: number } {
  if (!execute) return { onSuccess: false, onFailure: false, processed: 0 };
  return { onSuccess: true, onFailure: false, processed: value * 10 };
}

/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input value - Input value
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output logged - Logged message
 */
function errorLogger(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; logged: string } {
  if (!execute) return { onSuccess: false, onFailure: false, logged: '' };
  return { onSuccess: true, onFailure: false, logged: 'Error: ' + value };
}

/**
 * @flowWeaver workflow
 * @name branchingWorkflow
 * @node v validator
 * @node p processor
 * @node e errorLogger
 * @connect Start.execute -> v.execute
 * @connect Start.value -> v.value
 * @connect v.onSuccess -> p.execute
 * @connect v.checked -> p.value
 * @connect v.onFailure -> e.execute
 * @connect v.checked -> e.value
 * @connect p.onSuccess -> Exit.onSuccess
 * @connect p.processed -> Exit.result
 * @connect e.onSuccess -> Exit.onSuccess
 * @connect e.logged -> Exit.errorMessage
 */
export function branchingWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number; errorMessage: string }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

const PARALLEL_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input url - URL to fetch
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output data - Fetched data
 */
function fetchData(execute: boolean, url: string): { onSuccess: boolean; onFailure: boolean; data: string } {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  return { onSuccess: true, onFailure: false, data: 'data from ' + url };
}

/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input data - Data to process
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output result - Result
 */
function processA(execute: boolean, data: string): { onSuccess: boolean; onFailure: boolean; result: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: 'A:' + data };
}

/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input data - Data to process
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output result - Result
 */
function processB(execute: boolean, data: string): { onSuccess: boolean; onFailure: boolean; result: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: 'B:' + data };
}

/**
 * @flowWeaver workflow
 * @name parallelWorkflow
 * @node fetch fetchData
 * @node pA processA
 * @node pB processB
 * @connect Start.execute -> fetch.execute
 * @connect Start.url -> fetch.url
 * @connect fetch.onSuccess -> pA.execute
 * @connect fetch.data -> pA.data
 * @connect fetch.onSuccess -> pB.execute
 * @connect fetch.data -> pB.data
 * @connect pA.result -> Exit.resultA
 * @connect pB.result -> Exit.resultB
 */
export function parallelWorkflow(
  execute: boolean,
  params: { url: string }
): Promise<{ onSuccess: boolean; onFailure: boolean; resultA: string; resultB: string }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

const EXPRESSION_NODE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input a - First number
 * @input b - Second number
 * @output sum - Sum
 */
function add(a: number, b: number): { sum: number } {
  return { sum: a + b };
}

/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input value - Input value
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output result - Result
 */
function formatter(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: String(value) };
}

/**
 * @flowWeaver workflow
 * @name expressionWorkflow
 * @node a add
 * @node f formatter
 * @connect Start.x -> a.a
 * @connect Start.y -> a.b
 * @connect a.sum -> f.value
 * @connect Start.execute -> f.execute
 * @connect f.onSuccess -> Exit.onSuccess
 * @connect f.result -> Exit.result
 */
export function expressionWorkflow(
  execute: boolean,
  params: { x: number; y: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

// Parallel fan-out with branching node + expression merge (enrichment pattern)
const PARALLEL_BRANCHING_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input key - Lookup key
 * @output onSuccess - Success
 * @output onFailure - Failure
 * @output data - Enrichment data
 */
function enrichA(execute: boolean, key: string): { onSuccess: boolean; onFailure: boolean; data: string } {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  return { onSuccess: true, onFailure: false, data: 'a:' + key };
}

/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input key - Lookup key
 * @output onSuccess - Success
 * @output onFailure - Failure
 * @output data - Enrichment data
 */
function enrichB(execute: boolean, key: string): { onSuccess: boolean; onFailure: boolean; data: string } {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  return { onSuccess: true, onFailure: false, data: 'b:' + key };
}

/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input key - Lookup key
 * @output onSuccess - Success
 * @output onFailure - Failure
 * @output data - Enrichment data
 */
function enrichC(execute: boolean, key: string): { onSuccess: boolean; onFailure: boolean; data: string } {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  return { onSuccess: true, onFailure: false, data: 'c:' + key };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input a - First source
 * @input b - Second source
 * @input c - Third source
 * @output merged - Merged result
 */
function mergeResults(a: string, b: string, c: string): { merged: string } {
  return { merged: [a, b, c].join(',') };
}

/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input value - Input value
 * @output onSuccess - Success
 * @output onFailure - Failure
 * @output score - Score
 */
function scorer(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; score: number } {
  if (!execute) return { onSuccess: false, onFailure: false, score: 0 };
  return { onSuccess: true, onFailure: false, score: value.length };
}

/**
 * @flowWeaver workflow
 * @name parallelBranching
 * @node eA enrichA
 * @node eB enrichB
 * @node eC enrichC
 * @node m mergeResults
 * @node s scorer
 * @connect Start.execute -> eA.execute
 * @connect Start.execute -> eB.execute
 * @connect Start.execute -> eC.execute
 * @connect Start.key -> eA.key
 * @connect Start.key -> eB.key
 * @connect Start.key -> eC.key
 * @connect eA.data -> m.a
 * @connect eB.data -> m.b
 * @connect eC.data -> m.c
 * @connect m.merged -> s.value
 * @connect eC.onSuccess -> s.execute
 * @connect s.onSuccess -> Exit.onSuccess
 * @connect s.score -> Exit.score
 * @connect m.merged -> Exit.merged
 */
export function parallelBranching(
  execute: boolean,
  params: { key: string }
): Promise<{ onSuccess: boolean; onFailure: boolean; score: number; merged: string }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

// Branching with scoped variables (order-fulfillment pattern)
const BRANCHING_SCOPED_VARS_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input value - Value to check
 * @output onSuccess - Passed
 * @output onFailure - Failed
 * @output result - Check result
 */
function checker(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  if (value > 0) return { onSuccess: true, onFailure: false, result: 'ok' };
  return { onSuccess: false, onFailure: true, result: 'fail' };
}

/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input msg - Message
 * @output onSuccess - Done
 * @output onFailure - Failed
 * @output id - Confirmation ID
 */
function confirmAction(execute: boolean, msg: string): { onSuccess: boolean; onFailure: boolean; id: string } {
  if (!execute) return { onSuccess: false, onFailure: false, id: '' };
  return { onSuccess: true, onFailure: false, id: 'conf_' + msg };
}

/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input reason - Reason
 * @output onSuccess - Done
 * @output onFailure - Failed
 * @output id - Rollback ID
 */
function rollback(execute: boolean, reason: string): { onSuccess: boolean; onFailure: boolean; id: string } {
  if (!execute) return { onSuccess: false, onFailure: false, id: '' };
  return { onSuccess: true, onFailure: false, id: 'rb_' + reason };
}

/**
 * @flowWeaver workflow
 * @name branchingScopedVars
 * @node chk checker
 * @node conf confirmAction
 * @node rb rollback
 * @connect Start.execute -> chk.execute
 * @connect Start.value -> chk.value
 * @connect chk.onSuccess -> conf.execute
 * @connect chk.result -> conf.msg
 * @connect chk.onFailure -> rb.execute
 * @connect chk.result -> rb.reason
 * @connect conf.onSuccess -> Exit.onSuccess
 * @connect conf.id -> Exit.confirmId
 * @connect rb.onSuccess -> Exit.onFailure
 * @connect rb.id -> Exit.rollbackId
 */
export function branchingScopedVars(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; confirmId: string; rollbackId: string }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

const EMPTY_WORKFLOW = `
/**
 * @flowWeaver workflow
 * @name emptyWorkflow
 * @connect Start.execute -> Exit.onSuccess
 */
export function emptyWorkflow(
  execute: boolean,
  params: {}
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Inngest Generator', () => {
  describe('simple workflows', () => {
    it('generates inngest.createFunction() wrapper', () => {
      const code = parseAndGenerate(SIMPLE_WORKFLOW);
      expect(code).toContain('inngest.createFunction');
      expect(code).toContain("{ event: 'fw/simple-workflow.execute' }");
    });

    it('generates step.run() for each non-expression node', () => {
      const code = parseAndGenerate(TWO_NODE_WORKFLOW);
      expect(code).toContain("step.run('d'");
      expect(code).toContain("step.run('i'");
    });

    it('resolves inputs from event.data for Start ports', () => {
      const code = parseAndGenerate(SIMPLE_WORKFLOW);
      expect(code).toContain('event.data.');
    });

    it('returns correct exit port structure', () => {
      const code = parseAndGenerate(SIMPLE_WORKFLOW);
      expect(code).toContain('onSuccess:');
      expect(code).toContain('result:');
    });

    it('imports Inngest SDK', () => {
      const code = parseAndGenerate(SIMPLE_WORKFLOW);
      expect(code).toContain("import { Inngest } from 'inngest'");
    });

    it('creates Inngest client with service name', () => {
      const code = parseAndGenerate(SIMPLE_WORKFLOW);
      expect(code).toContain("new Inngest({ id: 'simple-workflow' })");
    });

    it('exports the function variable', () => {
      const code = parseAndGenerate(SIMPLE_WORKFLOW);
      expect(code).toContain('export const simpleWorkflowFn');
    });
  });

  describe('sequential workflows', () => {
    it('preserves sequential ordering for dependent nodes', () => {
      const code = parseAndGenerate(TWO_NODE_WORKFLOW);
      expect(code).not.toContain('Promise.all');
      // d step.run should appear before i step.run
      const dPos = code.indexOf("step.run('d'");
      const iPos = code.indexOf("step.run('i'");
      expect(dPos).toBeLessThan(iPos);
    });

    it('passes output from first node as input to second', () => {
      const code = parseAndGenerate(TWO_NODE_WORKFLOW);
      // The incrementer should receive d_result.doubled
      expect(code).toContain('d_result.');
    });
  });

  describe('branching', () => {
    it('generates if/else for onSuccess/onFailure', () => {
      const code = parseAndGenerate(BRANCHING_WORKFLOW);
      expect(code).toContain('v_result.onSuccess');
      expect(code).toMatch(/if\s*\(/);
    });

    it('generates step.run for nodes in branches', () => {
      const code = parseAndGenerate(BRANCHING_WORKFLOW);
      // Both processor and errorLogger should have step.run
      expect(code).toContain("step.run('p'");
      expect(code).toContain("step.run('e'");
    });

    it('places success and failure nodes in different branches', () => {
      const code = parseAndGenerate(BRANCHING_WORKFLOW);
      // processor is in success branch, errorLogger in failure
      expect(code).toContain('if (v_result.onSuccess)');
      expect(code).toContain('else');
    });
  });

  describe('parallel detection', () => {
    it('generates Promise.all for independent nodes', () => {
      const code = parseAndGenerate(PARALLEL_WORKFLOW);
      expect(code).toContain('Promise.all');
    });

    it('destructures Promise.all results', () => {
      const code = parseAndGenerate(PARALLEL_WORKFLOW);
      expect(code).toContain('pA_result');
      expect(code).toContain('pB_result');
    });
  });

  describe('expression nodes', () => {
    it('inlines expression nodes without step.run wrapper', () => {
      const code = parseAndGenerate(EXPRESSION_NODE_WORKFLOW);
      // Expression node 'add' should NOT be wrapped in step.run
      expect(code).not.toContain("step.run('a'");
      // But should still be called
      expect(code).toContain('add(');
    });

    it('wraps non-expression nodes in step.run', () => {
      const code = parseAndGenerate(EXPRESSION_NODE_WORKFLOW);
      expect(code).toContain("step.run('f'");
    });
  });

  describe('empty workflow', () => {
    it('handles workflow with no nodes (Start -> Exit)', () => {
      const code = parseAndGenerate(EMPTY_WORKFLOW);
      expect(code).toContain('inngest.createFunction');
      // No step.run calls needed
      expect(code).not.toContain('step.run');
    });

    it('still returns exit port values', () => {
      const code = parseAndGenerate(EMPTY_WORKFLOW);
      expect(code).toContain('return');
    });
  });

  describe('configuration', () => {
    it('uses custom service name', () => {
      const code = parseAndGenerate(SIMPLE_WORKFLOW, { serviceName: 'my-app' });
      expect(code).toContain("id: 'my-app'");
    });

    it('uses custom trigger event', () => {
      const code = parseAndGenerate(SIMPLE_WORKFLOW, {
        triggerEvent: 'custom/event',
      });
      expect(code).toContain("event: 'custom/event'");
    });

    it('uses custom retry count', () => {
      const code = parseAndGenerate(SIMPLE_WORKFLOW, { retries: 5 });
      expect(code).toContain('retries: 5');
    });

    it('merges extra function config', () => {
      const code = parseAndGenerate(SIMPLE_WORKFLOW, {
        functionConfig: { concurrency: { limit: 10 } },
      });
      expect(code).toContain('concurrency:');
    });
  });

  describe('parallel with branching nodes', () => {
    it('includes all parallel nodes in Promise.all even if some are branching', () => {
      const code = parseAndGenerate(PARALLEL_BRANCHING_WORKFLOW);
      expect(code).toContain('Promise.all');
      // All 3 enrichment nodes should be in the same Promise.all
      expect(code).toContain("step.run('eA'");
      expect(code).toContain("step.run('eB'");
      expect(code).toContain("step.run('eC'");
      const promiseAllPos = code.indexOf('Promise.all');
      const eAPos = code.indexOf("step.run('eA'");
      const eBPos = code.indexOf("step.run('eB'");
      const eCPos = code.indexOf("step.run('eC'");
      // All step.run calls should be after the Promise.all keyword
      expect(eAPos).toBeGreaterThan(promiseAllPos);
      expect(eBPos).toBeGreaterThan(promiseAllPos);
      expect(eCPos).toBeGreaterThan(promiseAllPos);
    });

    it('emits expression dependencies before their consumers in branch bodies', () => {
      const code = parseAndGenerate(PARALLEL_BRANCHING_WORKFLOW);
      // merge (expression) should appear before scorer which uses it
      const mergePos = code.indexOf('mergeResults(');
      const scorerPos = code.indexOf("step.run('s'");
      expect(mergePos).toBeLessThan(scorerPos);
      expect(mergePos).toBeGreaterThan(0);
    });
  });

  describe('scoped variable declarations', () => {
    it('pre-declares result variables with let', () => {
      const code = parseAndGenerate(BRANCHING_SCOPED_VARS_WORKFLOW);
      expect(code).toContain('let ');
      expect(code).toMatch(/let\s+\w+_result:\s*any/);
    });

    it('variables in branch bodies are accessible from return statement', () => {
      const code = parseAndGenerate(BRANCHING_SCOPED_VARS_WORKFLOW);
      // Both conf and rb results should be in the return
      expect(code).toContain('conf_result?.id');
      expect(code).toContain('rb_result?.id');
      // Return statement should come after the if/else block
      const returnPos = code.lastIndexOf('return {');
      const ifPos = code.indexOf('if (');
      expect(returnPos).toBeGreaterThan(ifPos);
    });

    it('uses assignment not const for node results', () => {
      const code = parseAndGenerate(BRANCHING_SCOPED_VARS_WORKFLOW);
      // Should NOT have const x_result patterns (except in let declaration)
      expect(code).not.toMatch(/const \w+_result\s*=/);
    });
  });

  describe('import generation', () => {
    it('imports node type functions', () => {
      const code = parseAndGenerate(SIMPLE_WORKFLOW);
      expect(code).toContain("import { greet }");
    });

    it('imports all unique node types', () => {
      const code = parseAndGenerate(TWO_NODE_WORKFLOW);
      expect(code).toContain("import { doubler }");
      expect(code).toContain("import { incrementer }");
    });
  });
});
