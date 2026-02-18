import { describe, it, expect } from 'vitest';
import { WorkflowValidator } from '../../src/validator';
import type {
  TWorkflowAST,
  TNodeTypeAST,
  TNodeInstanceAST,
  TPortDefinition,
} from '../../src/ast/types';

describe('Type Normalization', () => {
  function makeNodeType(
    name: string,
    inputs: Record<string, { dataType: string; optional?: boolean; tsType?: string }>,
    outputs: Record<string, { dataType: string; tsType?: string }>,
    functionText?: string
  ): TNodeTypeAST {
    return {
      type: 'NodeType',
      name,
      functionName: name,
      inputs,
      outputs,
      functionText,
    } as unknown as TNodeTypeAST;
  }

  function makeInstance(id: string, nodeType: string): TNodeInstanceAST {
    return {
      type: 'NodeInstance',
      id,
      nodeType,
      config: {},
    } as unknown as TNodeInstanceAST;
  }

  function makeWorkflow(
    nodeTypes: TNodeTypeAST[],
    instances: TNodeInstanceAST[],
    connections: TWorkflowAST['connections'] = []
  ): TWorkflowAST {
    return {
      type: 'Workflow',
      sourceFile: 'test.ts',
      name: 'test',
      functionName: 'test',
      nodeTypes,
      instances,
      connections,
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' } },
      imports: [],
    } as unknown as TWorkflowAST;
  }

  describe('ANNOTATION_SIGNATURE_TYPE_MISMATCH normalization', () => {
    it('should not warn for Array<T> vs T[] differences', () => {
      const nt = makeNodeType(
        'process',
        {
          execute: { dataType: 'STEP' },
          items: { dataType: 'ARRAY', tsType: 'Array<string>' },
        },
        { onSuccess: { dataType: 'STEP' } },
        'function process(execute: boolean, items: string[]) { return { onSuccess: true }; }'
      );
      const inst = makeInstance('proc', 'process');
      const wf = makeWorkflow(
        [nt],
        [inst],
        [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'proc', port: 'execute' } } as TWorkflowAST['connections'][0],
          { from: { node: 'Start', port: 'items' }, to: { node: 'proc', port: 'items' } } as TWorkflowAST['connections'][0],
          { from: { node: 'proc', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } } as TWorkflowAST['connections'][0],
        ]
      );
      wf.startPorts = {
        execute: { dataType: 'STEP' } as TPortDefinition,
        items: { dataType: 'ARRAY' } as TPortDefinition,
      };

      const validator = new WorkflowValidator();
      const result = validator.validate(wf);
      const mismatch = result.warnings.find((w) => w.code === 'ANNOTATION_SIGNATURE_TYPE_MISMATCH');
      expect(mismatch).toBeUndefined();
    });

    it('should not warn for trailing semicolons in object types', () => {
      const nt = makeNodeType(
        'process',
        {
          execute: { dataType: 'STEP' },
          data: { dataType: 'OBJECT', tsType: '{x: number;}' },
        },
        { onSuccess: { dataType: 'STEP' } },
        'function process(execute: boolean, data: {x: number}) { return { onSuccess: true }; }'
      );
      const inst = makeInstance('proc', 'process');
      const wf = makeWorkflow(
        [nt],
        [inst],
        [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'proc', port: 'execute' } } as TWorkflowAST['connections'][0],
          { from: { node: 'Start', port: 'data' }, to: { node: 'proc', port: 'data' } } as TWorkflowAST['connections'][0],
          { from: { node: 'proc', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } } as TWorkflowAST['connections'][0],
        ]
      );
      wf.startPorts = {
        execute: { dataType: 'STEP' } as TPortDefinition,
        data: { dataType: 'OBJECT' } as TPortDefinition,
      };

      const validator = new WorkflowValidator();
      const result = validator.validate(wf);
      const mismatch = result.warnings.find((w) => w.code === 'ANNOTATION_SIGNATURE_TYPE_MISMATCH');
      expect(mismatch).toBeUndefined();
    });

    it('should not warn for whitespace differences in types', () => {
      const nt = makeNodeType(
        'process',
        {
          execute: { dataType: 'STEP' },
          data: { dataType: 'OBJECT', tsType: '{ x: number }' },
        },
        { onSuccess: { dataType: 'STEP' } },
        'function process(execute: boolean, data: {x:number}) { return { onSuccess: true }; }'
      );
      const inst = makeInstance('proc', 'process');
      const wf = makeWorkflow(
        [nt],
        [inst],
        [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'proc', port: 'execute' } } as TWorkflowAST['connections'][0],
          { from: { node: 'Start', port: 'data' }, to: { node: 'proc', port: 'data' } } as TWorkflowAST['connections'][0],
          { from: { node: 'proc', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } } as TWorkflowAST['connections'][0],
        ]
      );
      wf.startPorts = {
        execute: { dataType: 'STEP' } as TPortDefinition,
        data: { dataType: 'OBJECT' } as TPortDefinition,
      };

      const validator = new WorkflowValidator();
      const result = validator.validate(wf);
      const mismatch = result.warnings.find((w) => w.code === 'ANNOTATION_SIGNATURE_TYPE_MISMATCH');
      expect(mismatch).toBeUndefined();
    });

    it('should still warn for genuinely different types', () => {
      const nt = makeNodeType(
        'process',
        {
          execute: { dataType: 'STEP' },
          x: { dataType: 'NUMBER', tsType: 'number' },
        },
        { onSuccess: { dataType: 'STEP' } },
        'function process(execute: boolean, x: string) { return { onSuccess: true }; }'
      );
      const inst = makeInstance('proc', 'process');
      const wf = makeWorkflow(
        [nt],
        [inst],
        [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'proc', port: 'execute' } } as TWorkflowAST['connections'][0],
          { from: { node: 'Start', port: 'x' }, to: { node: 'proc', port: 'x' } } as TWorkflowAST['connections'][0],
          { from: { node: 'proc', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } } as TWorkflowAST['connections'][0],
        ]
      );
      wf.startPorts = {
        execute: { dataType: 'STEP' } as TPortDefinition,
        x: { dataType: 'NUMBER' } as TPortDefinition,
      };

      const validator = new WorkflowValidator();
      const result = validator.validate(wf);
      const mismatch = result.warnings.find((w) => w.code === 'ANNOTATION_SIGNATURE_TYPE_MISMATCH');
      expect(mismatch).toBeDefined();
    });
  });

  describe('OBJECT_TYPE_MISMATCH normalization', () => {
    it('should not warn for cosmetic differences in connection object types', () => {
      const sourceNode = makeNodeType(
        'producer',
        { execute: { dataType: 'STEP' } },
        {
          onSuccess: { dataType: 'STEP' },
          data: { dataType: 'OBJECT', tsType: '{ promptTokens: number; completionTokens: number; }' },
        }
      );
      const targetNode = makeNodeType(
        'consumer',
        {
          execute: { dataType: 'STEP' },
          data: { dataType: 'OBJECT', tsType: '{ promptTokens: number; completionTokens: number }' },
        },
        { onSuccess: { dataType: 'STEP' } }
      );
      const wf = makeWorkflow(
        [sourceNode, targetNode],
        [makeInstance('prod', 'producer'), makeInstance('cons', 'consumer')],
        [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'prod', port: 'execute' } } as TWorkflowAST['connections'][0],
          { from: { node: 'prod', port: 'onSuccess' }, to: { node: 'cons', port: 'execute' } } as TWorkflowAST['connections'][0],
          { from: { node: 'prod', port: 'data' }, to: { node: 'cons', port: 'data' } } as TWorkflowAST['connections'][0],
          { from: { node: 'cons', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } } as TWorkflowAST['connections'][0],
        ]
      );

      const validator = new WorkflowValidator();
      const result = validator.validate(wf);
      const mismatch = result.warnings.find((w) => w.code === 'OBJECT_TYPE_MISMATCH');
      expect(mismatch).toBeUndefined();
    });

    it('should still warn for genuinely different object types in connections', () => {
      const sourceNode = makeNodeType(
        'producer',
        { execute: { dataType: 'STEP' } },
        {
          onSuccess: { dataType: 'STEP' },
          data: { dataType: 'OBJECT', tsType: '{ name: string }' },
        }
      );
      const targetNode = makeNodeType(
        'consumer',
        {
          execute: { dataType: 'STEP' },
          data: { dataType: 'OBJECT', tsType: '{ age: number }' },
        },
        { onSuccess: { dataType: 'STEP' } }
      );
      const wf = makeWorkflow(
        [sourceNode, targetNode],
        [makeInstance('prod', 'producer'), makeInstance('cons', 'consumer')],
        [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'prod', port: 'execute' } } as TWorkflowAST['connections'][0],
          { from: { node: 'prod', port: 'onSuccess' }, to: { node: 'cons', port: 'execute' } } as TWorkflowAST['connections'][0],
          { from: { node: 'prod', port: 'data' }, to: { node: 'cons', port: 'data' } } as TWorkflowAST['connections'][0],
          { from: { node: 'cons', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } } as TWorkflowAST['connections'][0],
        ]
      );

      const validator = new WorkflowValidator();
      const result = validator.validate(wf);
      const mismatch = result.warnings.find((w) => w.code === 'OBJECT_TYPE_MISMATCH');
      expect(mismatch).toBeDefined();
    });
  });
});
