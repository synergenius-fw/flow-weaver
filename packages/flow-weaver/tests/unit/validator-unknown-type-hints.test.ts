/**
 * WU3: S14 — Distinguish "unannotated function" from "function not found"
 *
 * Problem: UNKNOWN_NODE_TYPE says "unknown type X" but doesn't say if
 * function X exists without annotation.
 *
 * Fix: When a function exists but has no @flowWeaver nodeType annotation,
 * the error message should hint that the function needs annotation.
 */

import { describe, it, expect } from 'vitest';
import { WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

describe('validator unknown type hints', () => {
  function createWorkflowWithAvailableFunctionNames(
    availableFunctionNames: string[]
  ): TWorkflowAST {
    const knownType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'knownFunc',
      functionName: 'knownFunc',
      inputs: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'NUMBER', optional: true },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        output: { dataType: 'NUMBER' },
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
      nodeTypes: [knownType],
      instances: [
        { type: 'NodeInstance', id: 'good1', nodeType: 'knownFunc' },
        // References a function name that exists but isn't annotated
        { type: 'NodeInstance', id: 'bad1', nodeType: 'myProcessor' },
      ],
      connections: [
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'good1', port: 'execute' },
        },
        {
          type: 'Connection',
          from: { node: 'good1', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
      imports: [],
      availableFunctionNames,
    };
  }

  it('should hint about missing annotation when function exists', () => {
    const workflow = createWorkflowWithAvailableFunctionNames(['myProcessor', 'helper', 'utils']);
    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const unknownTypeErrors = result.errors.filter((e) => e.code === 'UNKNOWN_NODE_TYPE');
    expect(unknownTypeErrors).toHaveLength(1);
    expect(unknownTypeErrors[0].message).toContain('myProcessor');
    expect(unknownTypeErrors[0].message).toContain(
      'exists but has no @flowWeaver nodeType annotation'
    );
  });

  it('should show "Did you mean?" when function does NOT exist', () => {
    // No function named "myProcessor" in available names
    const workflow = createWorkflowWithAvailableFunctionNames(['helper', 'utils']);
    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const unknownTypeErrors = result.errors.filter((e) => e.code === 'UNKNOWN_NODE_TYPE');
    expect(unknownTypeErrors).toHaveLength(1);
    // Should NOT contain the annotation hint
    expect(unknownTypeErrors[0].message).not.toContain(
      'exists but has no @flowWeaver nodeType annotation'
    );
  });

  it('should work when availableFunctionNames is undefined', () => {
    const workflow = createWorkflowWithAvailableFunctionNames([]);
    delete (workflow as Record<string, unknown>).availableFunctionNames;
    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const unknownTypeErrors = result.errors.filter((e) => e.code === 'UNKNOWN_NODE_TYPE');
    expect(unknownTypeErrors).toHaveLength(1);
    // Should not crash, just use default behavior
    expect(unknownTypeErrors[0].message).toContain('myProcessor');
  });
});
