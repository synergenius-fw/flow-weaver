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

// =============================================================================
// Connection-level coercion validation (conn.coerce field)
// =============================================================================

describe('connection-level coercion validation', () => {
  function createStrToNumWorkflow(coerce?: 'string' | 'number' | 'boolean' | 'json' | 'object'): TWorkflowAST {
    const strProducer: TNodeTypeAST = {
      type: 'NodeType',
      name: 'strProducer',
      functionName: 'strProducer',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        text: { dataType: 'STRING' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const numConsumer: TNodeTypeAST = {
      type: 'NodeType',
      name: 'numConsumer',
      functionName: 'numConsumer',
      inputs: {
        execute: { dataType: 'STEP' },
        value: { dataType: 'NUMBER', optional: true },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        result: { dataType: 'NUMBER' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    return {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [strProducer, numConsumer],
      instances: [
        { type: 'NodeInstance', id: 'str1', nodeType: 'strProducer' },
        { type: 'NodeInstance', id: 'num1', nodeType: 'numConsumer' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'str1', port: 'execute' } },
        { type: 'Connection', from: { node: 'str1', port: 'onSuccess' }, to: { node: 'num1', port: 'execute' } },
        {
          type: 'Connection',
          from: { node: 'str1', port: 'text' },
          to: { node: 'num1', port: 'value' },
          ...(coerce ? { coerce } : {}),
        },
        { type: 'Connection', from: { node: 'num1', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { result: { dataType: 'NUMBER' } },
      imports: [],
    };
  }

  it('should emit COERCE_TYPE_MISMATCH when coerce output does not match target', () => {
    // `as json` produces STRING, but target is NUMBER
    const workflow = createStrToNumWorkflow('json');
    const v = new WorkflowValidator();
    const result = v.validate(workflow);

    const mismatchWarnings = result.warnings.filter(
      (w) => w.code === 'COERCE_TYPE_MISMATCH'
    );
    expect(mismatchWarnings.length).toBe(1);
    expect(mismatchWarnings[0].message).toContain('as json');
    expect(mismatchWarnings[0].message).toContain('STRING');
    expect(mismatchWarnings[0].message).toContain('NUMBER');
    expect(mismatchWarnings[0].message).toContain('as number');
  });

  it('should not warn when coerce correctly resolves the mismatch (as number on STRING->NUMBER)', () => {
    const workflow = createStrToNumWorkflow('number');
    const v = new WorkflowValidator();
    const result = v.validate(workflow);

    const coerceWarnings = result.warnings.filter(
      (w) => w.code === 'COERCE_TYPE_MISMATCH' || w.code === 'LOSSY_TYPE_COERCION' || w.code === 'TYPE_MISMATCH'
    );
    expect(coerceWarnings).toHaveLength(0);
  });

  it('should emit REDUNDANT_COERCE when source and target are the same type', () => {
    const numProducer: TNodeTypeAST = {
      type: 'NodeType',
      name: 'numProducer',
      functionName: 'numProducer',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        count: { dataType: 'NUMBER' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const numConsumer2: TNodeTypeAST = {
      type: 'NodeType',
      name: 'numConsumer2',
      functionName: 'numConsumer2',
      inputs: {
        execute: { dataType: 'STEP' },
        value: { dataType: 'NUMBER', optional: true },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        result: { dataType: 'NUMBER' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'redundant',
      functionName: 'redundant',
      sourceFile: 'test.ts',
      nodeTypes: [numProducer, numConsumer2],
      instances: [
        { type: 'NodeInstance', id: 'np', nodeType: 'numProducer' },
        { type: 'NodeInstance', id: 'nc', nodeType: 'numConsumer2' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'np', port: 'execute' } },
        { type: 'Connection', from: { node: 'np', port: 'onSuccess' }, to: { node: 'nc', port: 'execute' } },
        { type: 'Connection', from: { node: 'np', port: 'count' }, to: { node: 'nc', port: 'value' }, coerce: 'number' },
        { type: 'Connection', from: { node: 'nc', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { result: { dataType: 'NUMBER' } },
      imports: [],
    };

    const v = new WorkflowValidator();
    const result = v.validate(workflow);

    const redundantWarnings = result.warnings.filter(
      (w) => w.code === 'REDUNDANT_COERCE'
    );
    expect(redundantWarnings.length).toBe(1);
    expect(redundantWarnings[0].message).toContain('redundant');
    expect(redundantWarnings[0].message).toContain('NUMBER');
  });

  it('should emit COERCE_ON_FUNCTION_PORT error when coerce is used on FUNCTION port', () => {
    const fnProducer: TNodeTypeAST = {
      type: 'NodeType',
      name: 'fnProducer',
      functionName: 'fnProducer',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        callback: { dataType: 'FUNCTION' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const fnConsumer: TNodeTypeAST = {
      type: 'NodeType',
      name: 'fnConsumer',
      functionName: 'fnConsumer',
      inputs: {
        execute: { dataType: 'STEP' },
        handler: { dataType: 'FUNCTION', optional: true },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        result: { dataType: 'STRING' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'fnCoerce',
      functionName: 'fnCoerce',
      sourceFile: 'test.ts',
      nodeTypes: [fnProducer, fnConsumer],
      instances: [
        { type: 'NodeInstance', id: 'fp', nodeType: 'fnProducer' },
        { type: 'NodeInstance', id: 'fc', nodeType: 'fnConsumer' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'fp', port: 'execute' } },
        { type: 'Connection', from: { node: 'fp', port: 'onSuccess' }, to: { node: 'fc', port: 'execute' } },
        { type: 'Connection', from: { node: 'fp', port: 'callback' }, to: { node: 'fc', port: 'handler' }, coerce: 'string' },
        { type: 'Connection', from: { node: 'fc', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { result: { dataType: 'STRING' } },
      imports: [],
    };

    const v = new WorkflowValidator();
    const result = v.validate(workflow);

    const fnErrors = result.errors.filter(
      (e) => e.code === 'COERCE_ON_FUNCTION_PORT'
    );
    expect(fnErrors.length).toBe(1);
    expect(fnErrors[0].message).toContain('FUNCTION');
    expect(fnErrors[0].message).toContain('as string');
  });
});
