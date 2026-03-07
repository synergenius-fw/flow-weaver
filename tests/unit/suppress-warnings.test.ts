import { describe, it, expect } from 'vitest';
import { parseNodeLine } from '../../src/chevrotain-parser/node-parser';
import { generateNodeInstanceTag } from '../../src/annotation-generator';
import { WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST } from '../../src/ast/types';

// -- Parsing tests --

describe('suppress annotation parsing', () => {
  it('parses a single suppress code', () => {
    const warnings: string[] = [];
    const result = parseNodeLine('@node myNode SomeType [suppress: "UNUSED_OUTPUT_PORT"]', warnings);
    expect(warnings).toHaveLength(0);
    expect(result).not.toBeNull();
    expect(result!.suppress).toEqual(['UNUSED_OUTPUT_PORT']);
  });

  it('parses multiple suppress codes', () => {
    const warnings: string[] = [];
    const result = parseNodeLine(
      '@node myNode SomeType [suppress: "UNUSED_OUTPUT_PORT", "SOME_OTHER"]',
      warnings
    );
    expect(warnings).toHaveLength(0);
    expect(result!.suppress).toEqual(['UNUSED_OUTPUT_PORT', 'SOME_OTHER']);
  });

  it('works alongside other attributes', () => {
    const warnings: string[] = [];
    const result = parseNodeLine(
      '@node myNode SomeType [label: "My Node"] [suppress: "UNUSED_OUTPUT_PORT"]',
      warnings
    );
    expect(warnings).toHaveLength(0);
    expect(result!.label).toBe('My Node');
    expect(result!.suppress).toEqual(['UNUSED_OUTPUT_PORT']);
  });

  it('works in separate brackets alongside other attributes', () => {
    const warnings: string[] = [];
    const result = parseNodeLine(
      '@node myNode SomeType [suppress: "CODE1"] [minimized]',
      warnings
    );
    expect(warnings).toHaveLength(0);
    expect(result!.suppress).toEqual(['CODE1']);
    expect(result!.minimized).toBe(true);
  });
});

// -- Round-trip test --

describe('suppress annotation round-trip', () => {
  it('generates and re-parses suppress attribute', () => {
    const instance: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: 'myNode',
      nodeType: 'SomeType',
      config: { suppressWarnings: ['UNUSED_OUTPUT_PORT', 'SOME_OTHER'] },
    };

    const generated = generateNodeInstanceTag(instance);
    expect(generated).toContain('[suppress: "UNUSED_OUTPUT_PORT", "SOME_OTHER"]');

    // Strip the leading " * " prefix the generator adds
    const nodeLine = generated.replace(/^\s*\*\s*/, '');
    const warnings: string[] = [];
    const parsed = parseNodeLine(nodeLine, warnings);
    expect(warnings).toHaveLength(0);
    expect(parsed!.suppress).toEqual(['UNUSED_OUTPUT_PORT', 'SOME_OTHER']);
  });
});

// -- Validator tests --

function makeNodeType(name: string, outputs: Record<string, { dataType: string }>): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      ...outputs,
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
  };
}

describe('suppress annotation in validator', () => {
  it('suppresses UNUSED_OUTPUT_PORT warning on annotated node', () => {
    const nodeType = makeNodeType('Producer', {
      data: { dataType: 'STRING' },
    });

    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [nodeType],
      instances: [
        {
          type: 'NodeInstance',
          id: 'producer1',
          nodeType: 'Producer',
          config: { suppressWarnings: ['UNUSED_OUTPUT_PORT'] },
        },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'producer1', port: 'execute' } },
        { type: 'Connection', from: { node: 'producer1', port: 'onSuccess' }, to: { node: 'Exit', port: 'execute' } },
        // data port intentionally unconnected
      ],
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { execute: { dataType: 'STEP' } },
    };

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const unusedWarnings = result.warnings.filter(w => w.code === 'UNUSED_OUTPUT_PORT' && w.node === 'producer1');
    expect(unusedWarnings).toHaveLength(0);
  });

  it('still warns without suppress annotation', () => {
    const nodeType = makeNodeType('Producer', {
      data: { dataType: 'STRING' },
    });

    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [nodeType],
      instances: [
        {
          type: 'NodeInstance',
          id: 'producer1',
          nodeType: 'Producer',
        },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'producer1', port: 'execute' } },
        { type: 'Connection', from: { node: 'producer1', port: 'onSuccess' }, to: { node: 'Exit', port: 'execute' } },
      ],
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { execute: { dataType: 'STEP' } },
    };

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const unusedWarnings = result.warnings.filter(w => w.code === 'UNUSED_OUTPUT_PORT' && w.node === 'producer1');
    expect(unusedWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it('does not suppress warnings with a non-matching code', () => {
    const nodeType = makeNodeType('Producer', {
      data: { dataType: 'STRING' },
    });

    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [nodeType],
      instances: [
        {
          type: 'NodeInstance',
          id: 'producer1',
          nodeType: 'Producer',
          config: { suppressWarnings: ['SOME_UNRELATED_CODE'] },
        },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'producer1', port: 'execute' } },
        { type: 'Connection', from: { node: 'producer1', port: 'onSuccess' }, to: { node: 'Exit', port: 'execute' } },
      ],
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { execute: { dataType: 'STEP' } },
    };

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const unusedWarnings = result.warnings.filter(w => w.code === 'UNUSED_OUTPUT_PORT' && w.node === 'producer1');
    expect(unusedWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it('suppress on node A does not affect warnings on node B', () => {
    const nodeType = makeNodeType('Producer', {
      data: { dataType: 'STRING' },
    });

    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [nodeType],
      instances: [
        {
          type: 'NodeInstance',
          id: 'suppressed',
          nodeType: 'Producer',
          config: { suppressWarnings: ['UNUSED_OUTPUT_PORT'] },
        },
        {
          type: 'NodeInstance',
          id: 'unsuppressed',
          nodeType: 'Producer',
        },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'suppressed', port: 'execute' } },
        { type: 'Connection', from: { node: 'suppressed', port: 'onSuccess' }, to: { node: 'unsuppressed', port: 'execute' } },
        { type: 'Connection', from: { node: 'unsuppressed', port: 'onSuccess' }, to: { node: 'Exit', port: 'execute' } },
        // Both have unconnected data ports
      ],
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { execute: { dataType: 'STEP' } },
    };

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const suppressedWarnings = result.warnings.filter(w => w.code === 'UNUSED_OUTPUT_PORT' && w.node === 'suppressed');
    const unsuppressedWarnings = result.warnings.filter(w => w.code === 'UNUSED_OUTPUT_PORT' && w.node === 'unsuppressed');

    expect(suppressedWarnings).toHaveLength(0);
    expect(unsuppressedWarnings.length).toBeGreaterThanOrEqual(1);
  });
});
