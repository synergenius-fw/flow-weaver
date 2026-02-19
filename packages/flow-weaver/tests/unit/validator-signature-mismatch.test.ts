import { describe, it, expect } from 'vitest';
import { WorkflowValidator } from '../../src/validator';
import type {
  TWorkflowAST,
  TNodeTypeAST,
  TNodeInstanceAST,
  TPortDefinition,
} from '../../src/ast/types';

describe('Annotation-to-Signature Type Checking', () => {
  function makeNodeType(
    name: string,
    inputs: Record<string, { dataType: string; optional?: boolean; tsType?: string }>,
    outputs: Record<string, { dataType: string }>,
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

  it('warns when @input marks port as required but signature has it optional', () => {
    // @input x (required in annotation) but x?: number in signature
    const nt = makeNodeType(
      'process',
      {
        execute: { dataType: 'STEP' },
        x: { dataType: 'NUMBER', optional: false, tsType: 'number' },
      },
      { onSuccess: { dataType: 'STEP' } },
      'function process(execute: boolean, x?: number) { return { onSuccess: true }; }'
    );
    const inst = makeInstance('proc', 'process');
    const wf = makeWorkflow(
      [nt],
      [inst],
      [
        {
          from: { node: 'Start', port: 'execute' },
          to: { node: 'proc', port: 'execute' },
        } as TWorkflowAST['connections'][0],
        {
          from: { node: 'Start', port: 'x' },
          to: { node: 'proc', port: 'x' },
        } as TWorkflowAST['connections'][0],
        {
          from: { node: 'proc', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        } as TWorkflowAST['connections'][0],
      ]
    );
    wf.startPorts = {
      execute: { dataType: 'STEP' } as TPortDefinition,
      x: { dataType: 'NUMBER' } as TPortDefinition,
    };

    const validator = new WorkflowValidator();
    const result = validator.validate(wf);
    const warning = result.warnings.find((w) => w.code === 'ANNOTATION_SIGNATURE_MISMATCH');
    expect(warning).toBeDefined();
    expect(warning!.message).toContain('optional in signature but required in annotation');
  });

  it('does not warn when @input [x] (optional) and x: number (required) in signature', () => {
    // Stricter is fine - optional annotation, required signature
    const nt = makeNodeType(
      'process',
      {
        execute: { dataType: 'STEP' },
        x: { dataType: 'NUMBER', optional: true, tsType: 'number' },
      },
      { onSuccess: { dataType: 'STEP' } },
      'function process(execute: boolean, x: number) { return { onSuccess: true }; }'
    );
    const inst = makeInstance('proc', 'process');
    const wf = makeWorkflow(
      [nt],
      [inst],
      [
        {
          from: { node: 'Start', port: 'execute' },
          to: { node: 'proc', port: 'execute' },
        } as TWorkflowAST['connections'][0],
        {
          from: { node: 'proc', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        } as TWorkflowAST['connections'][0],
      ]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(wf);
    const warning = result.warnings.find((w) => w.code === 'ANNOTATION_SIGNATURE_MISMATCH');
    expect(warning).toBeUndefined();
  });

  it('warns when @input x {number} but signature has x: string', () => {
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
        {
          from: { node: 'Start', port: 'execute' },
          to: { node: 'proc', port: 'execute' },
        } as TWorkflowAST['connections'][0],
        {
          from: { node: 'Start', port: 'x' },
          to: { node: 'proc', port: 'x' },
        } as TWorkflowAST['connections'][0],
        {
          from: { node: 'proc', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        } as TWorkflowAST['connections'][0],
      ]
    );
    wf.startPorts = {
      execute: { dataType: 'STEP' } as TPortDefinition,
      x: { dataType: 'NUMBER' } as TPortDefinition,
    };

    const validator = new WorkflowValidator();
    const result = validator.validate(wf);
    const warning = result.warnings.find((w) => w.code === 'ANNOTATION_SIGNATURE_TYPE_MISMATCH');
    expect(warning).toBeDefined();
    expect(warning!.message).toContain('number');
    expect(warning!.message).toContain('string');
  });

  it('does not warn when types match', () => {
    const nt = makeNodeType(
      'process',
      {
        execute: { dataType: 'STEP' },
        x: { dataType: 'NUMBER', tsType: 'number' },
      },
      { onSuccess: { dataType: 'STEP' } },
      'function process(execute: boolean, x: number) { return { onSuccess: true }; }'
    );
    const inst = makeInstance('proc', 'process');
    const wf = makeWorkflow(
      [nt],
      [inst],
      [
        {
          from: { node: 'Start', port: 'execute' },
          to: { node: 'proc', port: 'execute' },
        } as TWorkflowAST['connections'][0],
        {
          from: { node: 'Start', port: 'x' },
          to: { node: 'proc', port: 'x' },
        } as TWorkflowAST['connections'][0],
        {
          from: { node: 'proc', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        } as TWorkflowAST['connections'][0],
      ]
    );
    wf.startPorts = {
      execute: { dataType: 'STEP' } as TPortDefinition,
      x: { dataType: 'NUMBER' } as TPortDefinition,
    };

    const validator = new WorkflowValidator();
    const result = validator.validate(wf);
    const mismatch = result.warnings.find((w) => w.code === 'ANNOTATION_SIGNATURE_TYPE_MISMATCH');
    expect(mismatch).toBeUndefined();
  });

  it('does not warn when signature has no type annotations (untyped JS)', () => {
    const nt = makeNodeType(
      'process',
      {
        execute: { dataType: 'STEP' },
        x: { dataType: 'NUMBER', tsType: 'number' },
      },
      { onSuccess: { dataType: 'STEP' } },
      'function process(execute, x) { return { onSuccess: true }; }'
    );
    const inst = makeInstance('proc', 'process');
    const wf = makeWorkflow(
      [nt],
      [inst],
      [
        {
          from: { node: 'Start', port: 'execute' },
          to: { node: 'proc', port: 'execute' },
        } as TWorkflowAST['connections'][0],
        {
          from: { node: 'Start', port: 'x' },
          to: { node: 'proc', port: 'x' },
        } as TWorkflowAST['connections'][0],
        {
          from: { node: 'proc', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        } as TWorkflowAST['connections'][0],
      ]
    );
    wf.startPorts = {
      execute: { dataType: 'STEP' } as TPortDefinition,
      x: { dataType: 'NUMBER' } as TPortDefinition,
    };

    const validator = new WorkflowValidator();
    const result = validator.validate(wf);
    const mismatch = result.warnings.find(
      (w) =>
        w.code === 'ANNOTATION_SIGNATURE_TYPE_MISMATCH' ||
        w.code === 'ANNOTATION_SIGNATURE_MISMATCH'
    );
    expect(mismatch).toBeUndefined();
  });

  it('does not warn when no functionText is available', () => {
    const nt = makeNodeType(
      'process',
      {
        execute: { dataType: 'STEP' },
        x: { dataType: 'NUMBER', optional: false, tsType: 'number' },
      },
      { onSuccess: { dataType: 'STEP' } }
      // no functionText
    );
    const inst = makeInstance('proc', 'process');
    const wf = makeWorkflow(
      [nt],
      [inst],
      [
        {
          from: { node: 'Start', port: 'execute' },
          to: { node: 'proc', port: 'execute' },
        } as TWorkflowAST['connections'][0],
        {
          from: { node: 'Start', port: 'x' },
          to: { node: 'proc', port: 'x' },
        } as TWorkflowAST['connections'][0],
        {
          from: { node: 'proc', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        } as TWorkflowAST['connections'][0],
      ]
    );
    wf.startPorts = {
      execute: { dataType: 'STEP' } as TPortDefinition,
      x: { dataType: 'NUMBER' } as TPortDefinition,
    };

    const validator = new WorkflowValidator();
    const result = validator.validate(wf);
    const mismatch = result.warnings.find(
      (w) =>
        w.code === 'ANNOTATION_SIGNATURE_TYPE_MISMATCH' ||
        w.code === 'ANNOTATION_SIGNATURE_MISMATCH'
    );
    expect(mismatch).toBeUndefined();
  });
});
