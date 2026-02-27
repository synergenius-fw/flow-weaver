import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parser } from '../../src/parser';

const FIXTURES_DIR = path.join(os.tmpdir(), 'fw-test-chain-flatten');

function createFixtureFile(name: string, content: string): string {
  const filePath = path.join(FIXTURES_DIR, `${name}.ts`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function getMaxIndent(code: string): number {
  let max = 0;
  for (const line of code.split('\n')) {
    const match = line.match(/^(\s+)/);
    if (match) {
      max = Math.max(max, match[1].length);
    }
  }
  return max;
}

/**
 * Helper: creates a branching node type with onSuccess/onFailure ports
 */
function branchingNodeType(name: string): string {
  return `
/**
 * @flowWeaver nodeType
 * @input data - Input data
 * @output result - Output result
 */
function ${name}(execute: boolean, data: any): { onSuccess: boolean; onFailure: boolean; result: any } {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  return { onSuccess: true, onFailure: false, result: data };
}`;
}

/** Helper: creates a regular (non-branching) node type */
function regularNodeType(name: string): string {
  return `
/**
 * @flowWeaver nodeType
 * @input data - Input data
 * @output result - Output result
 */
function ${name}(execute: boolean, data: any): { onSuccess: boolean; result: any } {
  if (!execute) return { onSuccess: false, result: null };
  return { onSuccess: true, result: data };
}`;
}

// Fixture paths — created once in beforeAll
let chain5Path: string;
let chain10Path: string;
let chainFailPath: string;

describe('Branching chain flattening', () => {
  beforeAll(() => {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });

    chain5Path = createFixtureFile('chain5', `
${branchingNodeType('step1')}
${branchingNodeType('step2')}
${branchingNodeType('step3')}
${branchingNodeType('step4')}
${branchingNodeType('step5')}

/**
 * @flowWeaver workflow
 * @node s1 step1
 * @node s2 step2
 * @node s3 step3
 * @node s4 step4
 * @node s5 step5
 * @connect Start.input -> s1.data
 * @connect s1.onSuccess -> s2.execute
 * @connect s1.result -> s2.data
 * @connect s2.onSuccess -> s3.execute
 * @connect s2.result -> s3.data
 * @connect s3.onSuccess -> s4.execute
 * @connect s3.result -> s4.data
 * @connect s4.onSuccess -> s5.execute
 * @connect s4.result -> s5.data
 * @connect s5.result -> Exit.result
 */
export async function chain5Workflow(execute: boolean, params: { input: any }): Promise<{ onSuccess: boolean; onFailure: boolean; result?: any }> {
  throw new Error('Not implemented');
}
`);

    const nodeTypes = Array.from({ length: 10 }, (_, i) => branchingNodeType(`step${i}`)).join('\n');
    const nodes = Array.from({ length: 10 }, (_, i) => `@node s${i} step${i}`).join('\n * ');
    const connections = Array.from({ length: 10 }, (_, i) => {
      const lines: string[] = [];
      if (i === 0) {
        lines.push(`@connect Start.input -> s0.data`);
      }
      if (i < 9) {
        lines.push(`@connect s${i}.onSuccess -> s${i + 1}.execute`);
        lines.push(`@connect s${i}.result -> s${i + 1}.data`);
      } else {
        lines.push(`@connect s${i}.result -> Exit.result`);
      }
      return lines.join('\n * ');
    }).join('\n * ');

    chain10Path = createFixtureFile('chain10', `
${nodeTypes}

/**
 * @flowWeaver workflow
 * ${nodes}
 * ${connections}
 */
export async function chain10Workflow(execute: boolean, params: { input: any }): Promise<{ onSuccess: boolean; onFailure: boolean; result?: any }> {
  throw new Error('Not implemented');
}
`);

    chainFailPath = createFixtureFile('chain_fail', `
${branchingNodeType('validate')}
${branchingNodeType('processData')}
${regularNodeType('handleError')}

/**
 * @flowWeaver workflow
 * @node v validate
 * @node p processData
 * @node err handleError
 * @connect Start.input -> v.data
 * @connect v.onSuccess -> p.execute
 * @connect v.result -> p.data
 * @connect v.onFailure -> err.execute
 * @connect p.result -> Exit.successResult
 * @connect err.result -> Exit.errorResult
 * @returns successResult - Result from successful processing
 * @returns errorResult - Result from error handling
 */
export async function chainFailWorkflow(execute: boolean, params: { input: any }): Promise<{ onSuccess: boolean; onFailure: boolean; successResult?: any; errorResult?: any }> {
  throw new Error('Not implemented');
}
`);
  });

  afterAll(() => {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
    parser.clearCache();
  });

  it('should keep indentation bounded for linear chains of branching nodes', async () => {
    // 5-node chain
    const code5 = await global.testHelpers.generateFast(chain5Path, 'chain5Workflow');
    const fnStart5 = code5.indexOf('function chain5Workflow(');
    const bodyCode5 = fnStart5 >= 0 ? code5.substring(fnStart5) : code5;

    // With flattening, max indent should be bounded (not growing with chain length)
    // Without flattening, 5 nested levels would produce ~20+ spaces of indentation
    // With flattening, max indent is bounded by single-branch depth:
    //   debug_hook(2) + chain_guard(4) + if_success(6) + try(8) + catch_body(10) + error_object(12) + property(14)
    const maxIndent5 = getMaxIndent(bodyCode5);
    expect(maxIndent5).toBeLessThanOrEqual(14);

    // 10-node chain — same bound expected (proves flattening, not nesting)
    const code10 = await global.testHelpers.generateFast(chain10Path, 'chain10Workflow');
    const fnStart10 = code10.indexOf('function chain10Workflow(');
    const bodyCode10 = fnStart10 >= 0 ? code10.substring(fnStart10) : code10;

    const maxIndent10 = getMaxIndent(bodyCode10);
    expect(maxIndent10).toBeLessThanOrEqual(14);
  });

  it('should generate correct behavior for a chain with failure at mid-point', async () => {
    const code = await global.testHelpers.generateFast(chainFailPath, 'chainFailWorkflow');
    const outputFile = path.join(global.testHelpers.outputDir, 'chain_fail.generated.ts');
    fs.writeFileSync(outputFile, code, 'utf-8');

    try {
      const mod = await import(outputFile);
      // Test success path: validate succeeds, processData runs
      const successResult = await mod.chainFailWorkflow(true, { input: { value: 'test' } });
      expect(successResult.successResult).toBeDefined();
      expect(successResult.errorResult).toBeUndefined();
    } finally {
      global.testHelpers.cleanupOutput('chain_fail.generated.ts');
    }
  });
});
