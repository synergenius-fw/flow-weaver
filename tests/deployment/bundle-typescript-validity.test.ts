/**
 * TDD Test: Generated Code TypeScript Validity
 *
 * Tests that generated workflow code compiles without TypeScript errors.
 * This catches issues like:
 * - Wrong property names (nodeName vs id)
 * - Type mismatches in scope functions
 * - Missing or incorrect type annotations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { parseWorkflow } from '../../src/api/parse';
import { generateCode } from '../../src/api/generate';

// Resolve tsc via Node module resolution — works in worktrees where
// node_modules may live in a parent directory rather than __dirname/../../
const TSC_PATH = (() => {
  try {
    const tsPath = require.resolve('typescript/bin/tsc');
    return tsPath;
  } catch {
    return path.resolve(__dirname, '../../node_modules/.bin/tsc');
  }
})();

const tempDir = path.join(os.tmpdir(), `fw-code-validity-${process.pid}`);

// Test case definitions
const testCases = [
  {
    name: 'simple',
    workflowName: 'simpleWorkflow',
    source: `
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node doubler double
 * @connect Start.input -> doubler.value
 * @connect doubler.doubled -> Exit.result
 */
export function simpleWorkflow(
  execute: boolean,
  params: { input: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}
`,
  },
  {
    name: 'expression',
    workflowName: 'expressionWorkflow',
    source: `
/**
 * @flowWeaver nodeType
 * @input value
 * @input multiplier - Expression: (ctx) => ctx.getVariable({ id: "Start", portName: "factor", executionIndex: 0 })
 * @output result
 */
function multiply(execute: boolean, value: number, multiplier: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * multiplier };
}

/**
 * @flowWeaver workflow
 * @node mult multiply
 * @connect Start.input -> mult.value
 * @connect mult.result -> Exit.result
 */
export function expressionWorkflow(
  execute: boolean,
  params: { input: number; factor: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}
`,
  },
  {
    name: 'foreach',
    workflowName: 'forEachWorkflow',
    source: `
/**
 * @flowWeaver nodeType
 * @scope processItem
 * @input items
 * @output item scope:processItem
 * @input success scope:processItem
 * @input failure scope:processItem
 * @input processed scope:processItem
 * @output results
 */
function forEach(
  execute: boolean,
  items: number[],
  processItem: (item: number) => { success: boolean; failure: boolean; processed: number }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map(item => {
    const result = processItem(item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node loop forEach
 * @node proc double loop.processItem
 * @connect Start.numbers -> loop.items
 * @connect loop.item:processItem -> proc.value
 * @connect proc.onSuccess -> loop.success:processItem
 * @connect proc.onFailure -> loop.failure:processItem
 * @connect proc.doubled -> loop.processed:processItem
 * @connect loop.results -> Exit.results
 */
export function forEachWorkflow(
  execute: boolean,
  params: { numbers: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}
`,
  },
  {
    name: 'complex-scope',
    workflowName: 'searchWorkflow',
    source: `
interface SearchResult {
  title: string;
  url: string;
}

/**
 * @flowWeaver nodeType
 * @scope processItem
 * @input items
 * @output item scope:processItem - tsType: string
 * @input success scope:processItem
 * @input failure scope:processItem
 * @input processed scope:processItem - tsType: SearchResult[]
 * @output results - tsType: SearchResult[][]
 */
function forEachQuery(
  execute: boolean,
  items: string[],
  processItem: (item: string) => { success: boolean; failure: boolean; processed: SearchResult[] }
): { onSuccess: boolean; onFailure: boolean; results: SearchResult[][] } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map(item => {
    const result = processItem(item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}

/**
 * @flowWeaver nodeType
 * @input query
 * @output results - tsType: SearchResult[]
 */
function search(execute: boolean, query: string): { onSuccess: boolean; onFailure: boolean; results: SearchResult[] } {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  return { onSuccess: true, onFailure: false, results: [{ title: 'Result', url: 'http://example.com' }] };
}

/**
 * @flowWeaver workflow
 * @node loop forEachQuery
 * @node searcher search loop.processItem
 * @connect Start.queries -> loop.items
 * @connect loop.item:processItem -> searcher.query
 * @connect searcher.onSuccess -> loop.success:processItem
 * @connect searcher.onFailure -> loop.failure:processItem
 * @connect searcher.results -> loop.processed:processItem
 * @connect loop.results -> Exit.results
 */
export function searchWorkflow(
  execute: boolean,
  params: { queries: string[] }
): { onSuccess: boolean; onFailure: boolean; results: SearchResult[][] } {
  throw new Error('Not implemented');
}
`,
  },
] as const;

// Shared tsc result — computed once in beforeAll
let tscExitCode = 0;
let tscOutput = '';
const generatedCode: Record<string, string> = {};

beforeAll(async () => {
  fs.mkdirSync(tempDir, { recursive: true });

  // Generate all 4 workflow code files
  for (const tc of testCases) {
    const sourceFile = path.join(tempDir, `${tc.name}-source.ts`);
    fs.writeFileSync(sourceFile, tc.source);

    const parseResult = await parseWorkflow(sourceFile, { workflowName: tc.workflowName });
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors for ${tc.name}: ${parseResult.errors.join(', ')}`);
    }

    const code = generateCode(parseResult.ast, {
      production: true,
      allWorkflows: parseResult.allWorkflows,
    });
    generatedCode[tc.name] = code;
    fs.writeFileSync(path.join(tempDir, `${tc.name}.generated.ts`), code);
  }

  // Single tsconfig that includes ALL generated files
  const tsconfig = {
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      lib: ["ES2020", "DOM"],
      types: [],
    },
    include: testCases.map(tc => `${tc.name}.generated.ts`),
  };
  fs.writeFileSync(
    path.join(tempDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2)
  );

  // Single tsc invocation for all files
  try {
    tscOutput = execSync(`${TSC_PATH} --noEmit`, {
      cwd: tempDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    tscExitCode = 0;
  } catch (error: any) {
    tscExitCode = error.status ?? 1;
    tscOutput = (error.stdout || '') + (error.stderr || '');
  }
});

afterAll(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe('Generated Code TypeScript Validity', () => {
  it('should generate valid TypeScript for simple workflow', () => {
    expect(tscExitCode, `TypeScript errors:\n${tscOutput}\n\nGenerated code:\n${generatedCode['simple']}`).toBe(0);
  });

  it('should generate valid TypeScript for expression workflow', () => {
    expect(tscExitCode, `TypeScript errors:\n${tscOutput}\n\nGenerated code:\n${generatedCode['expression']}`).toBe(0);
  });

  it('should generate valid TypeScript for forEach scope', () => {
    expect(tscExitCode, `TypeScript errors:\n${tscOutput}\n\nGenerated code:\n${generatedCode['foreach']}`).toBe(0);
  });

  it('should generate valid TypeScript for forEach scope with complex types', () => {
    expect(tscExitCode, `TypeScript errors:\n${tscOutput}\n\nGenerated code:\n${generatedCode['complex-scope']}`).toBe(0);
  });
});
