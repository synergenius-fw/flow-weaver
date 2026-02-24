/**
 * Tests that @coerce macros bridge type mismatches without validation warnings,
 * and that @strictTypes passes when explicit coercion is used.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parser } from '../../src/parser';
import { validator, WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

function writeAndValidate(filename: string, source: string) {
  const testFile = path.join(global.testHelpers.outputDir, filename);
  fs.writeFileSync(testFile, source.trim());
  try {
    const parsed = parser.parse(testFile);
    const workflow = parsed.workflows[0];
    return validator.validate(workflow);
  } finally {
    try { fs.unlinkSync(testFile); } catch { /* ignore */ }
  }
}

const STRING_NODE = `
/**
 * @flowWeaver nodeType
 * @output text [type:STRING] - A string value
 */
export async function producer(execute: boolean) {
  return { onSuccess: true, onFailure: false, text: 'hello' };
}
`;

const NUMBER_NODE = `
/**
 * @flowWeaver nodeType
 * @input amount [type:NUMBER] - A number value
 * @output doubled [type:NUMBER] - Doubled
 */
export async function consumer(execute: boolean, amount: number) {
  return { onSuccess: true, onFailure: false, doubled: amount * 2 };
}
`;

describe('@coerce validator integration', () => {
  it('should produce type mismatch warning without @coerce (AST-level)', () => {
    // Construct AST directly to ensure types are exactly STRING and NUMBER,
    // since the parser's type inference may resolve output types differently.
    const stringProducer: TNodeTypeAST = {
      type: 'NodeType',
      name: 'producer',
      functionName: 'producer',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        text: { dataType: 'STRING' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: true,
      executeWhen: 'CONJUNCTION',
    };

    const numberConsumer: TNodeTypeAST = {
      type: 'NodeType',
      name: 'consumer',
      functionName: 'consumer',
      inputs: {
        execute: { dataType: 'STEP' },
        amount: { dataType: 'NUMBER' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        doubled: { dataType: 'NUMBER' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: true,
      executeWhen: 'CONJUNCTION',
    };

    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      sourceFile: 'test.ts',
      nodeTypes: [stringProducer, numberConsumer],
      instances: [
        { type: 'NodeInstance', id: 'p', nodeType: 'producer' },
        { type: 'NodeInstance', id: 'c', nodeType: 'consumer' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'p', port: 'execute' } },
        { type: 'Connection', from: { node: 'p', port: 'onSuccess' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'p', port: 'text' }, to: { node: 'c', port: 'amount' } },
        { type: 'Connection', from: { node: 'c', port: 'doubled' }, to: { node: 'Exit', port: 'result' } },
        { type: 'Connection', from: { node: 'c', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' }, input: { dataType: 'STRING' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
      imports: [],
    };

    const v = new WorkflowValidator();
    const result = v.validate(workflow);
    const typeWarnings = result.warnings.filter(
      w => w.code === 'TYPE_MISMATCH' || w.code === 'LOSSY_TYPE_COERCION' || w.code === 'UNUSUAL_TYPE_COERCION'
    );
    expect(typeWarnings.length).toBeGreaterThan(0);
  });

  it('should produce no type warnings when @coerce bridges STRING -> NUMBER', () => {
    const source = `
${STRING_NODE}
${NUMBER_NODE}

/**
 * @flowWeaver workflow
 * @param input - string
 * @returns {number} result
 * @node p producer
 * @node c consumer
 * @coerce toNum p.text -> c.amount as number
 * @connect Start.execute -> p.execute
 * @connect p.onSuccess -> c.execute
 * @connect c.doubled -> Exit.result
 * @connect c.onSuccess -> Exit.onSuccess
 */
export async function testWorkflow(execute: boolean, params: { input: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  throw new Error('Not implemented');
}
    `;

    const result = writeAndValidate('coerce-val-with-coerce.ts', source);
    // The coercion node's input is ANY (accepts STRING) and output is NUMBER (matches consumer)
    const typeWarnings = result.warnings.filter(
      w =>
        (w.code === 'TYPE_MISMATCH' || w.code === 'LOSSY_TYPE_COERCION' || w.code === 'UNUSUAL_TYPE_COERCION') &&
        w.message.includes('text') && w.message.includes('amount')
    );
    expect(typeWarnings).toHaveLength(0);
  });

  it('should pass @strictTypes when explicit @coerce is used', () => {
    const source = `
${STRING_NODE}
${NUMBER_NODE}

/**
 * @flowWeaver workflow
 * @strictTypes
 * @param input - string
 * @returns {number} result
 * @node p producer
 * @node c consumer
 * @coerce toNum p.text -> c.amount as number
 * @connect Start.execute -> p.execute
 * @connect p.onSuccess -> c.execute
 * @connect c.doubled -> Exit.result
 * @connect c.onSuccess -> Exit.onSuccess
 */
export async function strictWorkflow(execute: boolean, params: { input: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  throw new Error('Not implemented');
}
    `;

    const result = writeAndValidate('coerce-val-strict.ts', source);
    const incompatibleErrors = result.errors.filter(
      e => e.code === 'TYPE_INCOMPATIBLE' && e.message.includes('text') && e.message.includes('amount')
    );
    expect(incompatibleErrors).toHaveLength(0);
  });

  it('should validate coercion node as a valid instance', () => {
    const source = `
${STRING_NODE}
${NUMBER_NODE}

/**
 * @flowWeaver workflow
 * @param input - string
 * @returns {number} result
 * @node p producer
 * @node c consumer
 * @coerce toNum p.text -> c.amount as number
 * @connect Start.execute -> p.execute
 * @connect p.onSuccess -> c.execute
 * @connect c.doubled -> Exit.result
 * @connect c.onSuccess -> Exit.onSuccess
 */
export async function testWorkflow(execute: boolean, params: { input: string }): Promise<{
  onSuccess: boolean; onFailure: boolean; result: number;
}> {
  throw new Error('Not implemented');
}
    `;

    const result = writeAndValidate('coerce-val-valid-instance.ts', source);
    const unknownTypeErrors = result.errors.filter(
      e => e.code === 'UNKNOWN_NODE_TYPE' && e.message.includes('__fw_')
    );
    expect(unknownTypeErrors).toHaveLength(0);
  });
});
