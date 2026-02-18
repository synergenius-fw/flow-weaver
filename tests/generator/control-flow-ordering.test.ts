/**
 * Tests for control flow graph execution ordering.
 *
 * Verifies that data-flow dependencies are respected in the topological sort,
 * not just STEP (control-flow) connections.
 */

import {
  buildControlFlowGraph,
  performKahnsTopologicalSort,
} from '../../src/generator/control-flow';
import { parser } from '../../src/parser';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Workflow where a data chain (plan → proc → agg) feeds a branching node (eval).
// Without data-flow edges in the CFG, eval can be sorted before agg.
const DATA_CHAIN_THEN_BRANCH = `
/**
 * @flowWeaver nodeType
 * @input question - Question
 * @output queries - Queries
 */
function planQueries(execute: boolean, question: string): { onSuccess: boolean; onFailure: boolean; queries: string[] } {
  if (!execute) return { onSuccess: false, onFailure: false, queries: [] };
  return { onSuccess: true, onFailure: false, queries: [question] };
}

/**
 * @flowWeaver nodeType
 * @input items - Items
 * @output results - Results
 */
function processItems(execute: boolean, items: string[]): { onSuccess: boolean; onFailure: boolean; results: string[] } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  return { onSuccess: true, onFailure: false, results: items };
}

/**
 * @flowWeaver nodeType
 * @input data - Data
 * @output merged - Merged
 */
function aggregate(execute: boolean, data: string[]): { onSuccess: boolean; onFailure: boolean; merged: string[] } {
  if (!execute) return { onSuccess: false, onFailure: false, merged: [] };
  return { onSuccess: true, onFailure: false, merged: data };
}

/**
 * @flowWeaver nodeType
 * @input sources - Sources
 * @output result - Result
 * @output score - Score
 */
function evaluate(execute: boolean, sources: string[]): { onSuccess: boolean; onFailure: boolean; result: string; score: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: '', score: 0 };
  const pass = sources.length > 0;
  return { onSuccess: pass, onFailure: !pass, result: sources.join(','), score: pass ? 0.9 : 0.1 };
}

/**
 * @flowWeaver nodeType
 * @input text - Text
 * @output output - Output
 */
function goodPath(execute: boolean, text: string): { onSuccess: boolean; onFailure: boolean; output: string } {
  if (!execute) return { onSuccess: false, onFailure: false, output: '' };
  return { onSuccess: true, onFailure: false, output: 'GOOD:' + text };
}

/**
 * @flowWeaver nodeType
 * @input score - Score
 * @output output - Output
 */
function badPath(execute: boolean, score: number): { onSuccess: boolean; onFailure: boolean; output: string } {
  if (!execute) return { onSuccess: false, onFailure: false, output: '' };
  return { onSuccess: true, onFailure: false, output: 'BAD:' + score };
}

/**
 * @flowWeaver workflow
 * @node plan planQueries
 * @node proc processItems
 * @node agg aggregate
 * @node eval evaluate
 * @node good goodPath
 * @node bad badPath
 *
 * @connect Start.question -> plan.question
 * @connect plan.queries -> proc.items
 * @connect proc.results -> agg.data
 * @connect agg.merged -> eval.sources
 * @connect eval.onSuccess -> good.execute
 * @connect eval.result -> good.text
 * @connect eval.onFailure -> bad.execute
 * @connect eval.score -> bad.score
 * @connect good.output -> Exit.successResult
 * @connect bad.output -> Exit.failureResult
 *
 * @param question - Question
 * @returns successResult - Success output
 * @returns failureResult - Failure output
 */
export function testWorkflow(
  execute: boolean,
  params: { question: string }
): { onSuccess: boolean; onFailure: boolean; successResult: string; failureResult: string } {
  return { onSuccess: true, onFailure: false, successResult: '', failureResult: '' };
}
`;

describe('buildControlFlowGraph — data-flow ordering', () => {
  it('should order data-dependent nodes before branching nodes that consume their output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-cfg-'));
    const tmpFile = path.join(tmpDir, 'ordering-test.ts');
    fs.writeFileSync(tmpFile, DATA_CHAIN_THEN_BRANCH);

    try {
      const parseResult = parser.parse(tmpFile);
      expect(parseResult.errors).toHaveLength(0);

      const workflow = parseResult.workflows[0];
      const nodeTypes = parseResult.nodeTypes;
      const cfg = buildControlFlowGraph(workflow, nodeTypes);

      // Verify the CFG has edges for data-flow connections (not just STEP)
      // plan.queries -> proc.items should create edge plan → proc
      const planSuccessors = cfg.graph.get('plan') || [];
      expect(planSuccessors).toContain('proc');

      // proc.results -> agg.data should create edge proc → agg
      const procSuccessors = cfg.graph.get('proc') || [];
      expect(procSuccessors).toContain('agg');

      // agg.merged -> eval.sources should create edge agg → eval
      const aggSuccessors = cfg.graph.get('agg') || [];
      expect(aggSuccessors).toContain('eval');

      // With data edges, topological sort must respect the chain
      const order = performKahnsTopologicalSort(cfg);
      const mainNodes = order.filter((id) => ['plan', 'proc', 'agg', 'eval'].includes(id));
      expect(mainNodes).toEqual(['plan', 'proc', 'agg', 'eval']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should compile and execute data-chain-then-branch without reference errors', async () => {
    const { compileWorkflow } = await import('../../src/api/compile');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-exec-'));
    const tmpFile = path.join(tmpDir, 'data-chain-branch.ts');
    fs.writeFileSync(tmpFile, DATA_CHAIN_THEN_BRANCH);

    try {
      const result = await compileWorkflow(tmpFile, { write: true });
      expect(result.code).toBeDefined();

      // Import and execute — must not throw "Cannot access aggIdx before initialization"
      const compiled = await import(tmpFile);
      const execResult = compiled.testWorkflow(true, { question: 'hello' });

      // plan returns ['hello'], proc passes through, agg passes through,
      // eval sees sources=['hello'] → onSuccess → goodPath → "GOOD:hello"
      expect(execResult.onSuccess).toBe(true);
      expect(execResult.successResult).toBe('GOOD:hello');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
