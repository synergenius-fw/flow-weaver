/**
 * WU8, S15: LOSSY_TYPE_COERCION should hint about @strictTypes
 */

import { describe, it, expect } from 'vitest';
import { WorkflowValidator } from '../../../src/validation/validator';
import { AnnotationParser } from '../../../src/parser/annotation-parser';
import type { TWorkflowAST, TNodeTypeAST } from '../../../src/ast/types';

describe('type coercion hints', () => {
  function createWorkflowWithTypeCoercion(): TWorkflowAST {
    const stringProducer: TNodeTypeAST = {
      type: 'NodeType',
      name: 'strProducer',
      functionName: 'strProducer',
      inputs: {
        execute: { dataType: 'STEP' },
      },
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

    const numberConsumer: TNodeTypeAST = {
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
      nodeTypes: [stringProducer, numberConsumer],
      instances: [
        { type: 'NodeInstance', id: 'str1', nodeType: 'strProducer' },
        { type: 'NodeInstance', id: 'num1', nodeType: 'numConsumer' },
      ],
      connections: [
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'str1', port: 'execute' },
        },
        {
          type: 'Connection',
          from: { node: 'str1', port: 'onSuccess' },
          to: { node: 'num1', port: 'execute' },
        },
        // STRING → NUMBER = lossy coercion
        {
          type: 'Connection',
          from: { node: 'str1', port: 'text' },
          to: { node: 'num1', port: 'value' },
        },
        {
          type: 'Connection',
          from: { node: 'num1', port: 'result' },
          to: { node: 'Exit', port: 'result' },
        },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { result: { dataType: 'NUMBER' } },
      imports: [],
    };
  }

  it('should include @strictTypes hint in LOSSY_TYPE_COERCION warning', () => {
    const workflow = createWorkflowWithTypeCoercion();
    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const coercionWarnings = result.warnings.filter((w) => w.code === 'LOSSY_TYPE_COERCION');
    expect(coercionWarnings.length).toBeGreaterThan(0);
    expect(coercionWarnings[0].message).toContain('@strictTypes');
  });

  describe('`@connect ... as <type>` written in source', () => {
    function parseWith(asClause: string) {
      const source = `
/**
 * @flowWeaver nodeType
 * @output text
 */
function strProducer(execute: boolean): { text: string; onSuccess: boolean } {
  return { text: '1', onSuccess: true };
}

/**
 * @flowWeaver nodeType
 * @input [value]
 */
function numConsumer(execute: boolean, value?: number): { onSuccess: boolean } {
  return { onSuccess: true };
}

/**
 * @flowWeaver workflow
 * @node str1 strProducer
 * @node num1 numConsumer
 * @connect Start.execute -> str1.execute
 * @connect str1.onSuccess -> num1.execute
 * @connect str1.text -> num1.value${asClause}
 * @connect num1.onSuccess -> Exit.onSuccess
 */
export function wf(execute: boolean, params: {}): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`;
      const parsed = new AnnotationParser().parseFromString(source, `coerce-${asClause.length}.ts`);
      expect(parsed.errors).toEqual([]);
      return new WorkflowValidator().validate(parsed.workflows[0]);
    }

    it('resolves the lossy STRING to NUMBER warning when the coercion matches the target', () => {
      const without = parseWith('');
      expect(without.warnings.map((w) => w.code)).toContain('LOSSY_TYPE_COERCION');

      const withCoerce = parseWith(' as number');
      expect(withCoerce.warnings.map((w) => w.code)).not.toContain('LOSSY_TYPE_COERCION');
      expect(withCoerce.errors).toEqual([]);
    });

    it('reports COERCE_TYPE_MISMATCH when the coercion produces the wrong type', () => {
      const result = parseWith(' as boolean');
      const mismatch = result.warnings.find((w) => w.code === 'COERCE_TYPE_MISMATCH');
      expect(mismatch).toBeDefined();
      expect(mismatch!.message).toContain('as number');
    });
  });
});
