/**
 * WU2: S13 — Deduplicate cascading errors from UNKNOWN_NODE_TYPE
 *
 * Problem: 3 unknown types → 19 errors (3 root + 16 cascading).
 * The validator continues all checks after UNKNOWN_NODE_TYPE, producing
 * UNKNOWN_SOURCE_NODE, UNKNOWN_TARGET_NODE, UNDEFINED_NODE for the same IDs.
 *
 * Fix: After validation, filter out cascading errors that reference unknown node IDs.
 */

import { describe, it, expect } from 'vitest';
import { WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

describe('validator cascading error deduplication', () => {
  function createWorkflowWithUnknownTypes(): TWorkflowAST {
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
        // These 3 reference non-existent node types
        { type: 'NodeInstance', id: 'bad1', nodeType: 'nonExistentA' },
        { type: 'NodeInstance', id: 'bad2', nodeType: 'nonExistentB' },
        { type: 'NodeInstance', id: 'bad3', nodeType: 'nonExistentC' },
      ],
      connections: [
        // Valid connection
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'good1', port: 'execute' },
        },
        // Connections from/to unknown nodes (would cause cascading errors)
        {
          type: 'Connection',
          from: { node: 'good1', port: 'onSuccess' },
          to: { node: 'bad1', port: 'execute' },
        },
        {
          type: 'Connection',
          from: { node: 'bad1', port: 'output' },
          to: { node: 'bad2', port: 'input' },
        },
        {
          type: 'Connection',
          from: { node: 'bad2', port: 'output' },
          to: { node: 'bad3', port: 'input' },
        },
        {
          type: 'Connection',
          from: { node: 'bad3', port: 'output' },
          to: { node: 'Exit', port: 'result' },
        },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { result: { dataType: 'NUMBER' } },
      imports: [],
    };
  }

  it('should produce exactly 3 UNKNOWN_NODE_TYPE errors for 3 unknown types', () => {
    const workflow = createWorkflowWithUnknownTypes();
    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const unknownTypeErrors = result.errors.filter((e) => e.code === 'UNKNOWN_NODE_TYPE');
    expect(unknownTypeErrors).toHaveLength(3);
  });

  it('should NOT produce UNKNOWN_SOURCE_NODE errors for unknown type instances', () => {
    const workflow = createWorkflowWithUnknownTypes();
    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const sourceNodeErrors = result.errors.filter((e) => e.code === 'UNKNOWN_SOURCE_NODE');
    // None of these should reference bad1/bad2/bad3 since they're already reported as UNKNOWN_NODE_TYPE
    const cascadingErrors = sourceNodeErrors.filter(
      (e) => e.connection && ['bad1', 'bad2', 'bad3'].includes(e.connection.from.node)
    );
    expect(cascadingErrors).toHaveLength(0);
  });

  it('should NOT produce UNKNOWN_TARGET_NODE errors for unknown type instances', () => {
    const workflow = createWorkflowWithUnknownTypes();
    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const targetNodeErrors = result.errors.filter((e) => e.code === 'UNKNOWN_TARGET_NODE');
    const cascadingErrors = targetNodeErrors.filter(
      (e) => e.connection && ['bad1', 'bad2', 'bad3'].includes(e.connection.to.node)
    );
    expect(cascadingErrors).toHaveLength(0);
  });

  it('should NOT produce UNDEFINED_NODE errors for unknown type instances', () => {
    const workflow = createWorkflowWithUnknownTypes();
    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    const undefinedNodeErrors = result.errors.filter((e) => e.code === 'UNDEFINED_NODE');
    const cascadingErrors = undefinedNodeErrors.filter(
      (e) => e.node && ['bad1', 'bad2', 'bad3'].includes(e.node)
    );
    expect(cascadingErrors).toHaveLength(0);
  });

  it('should still report errors for genuinely unknown connection references', () => {
    // A workflow with a connection referencing a node that has no instance at all
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

    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'test',
      functionName: 'test',
      sourceFile: 'test.ts',
      nodeTypes: [knownType],
      instances: [{ type: 'NodeInstance', id: 'good1', nodeType: 'knownFunc' }],
      connections: [
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'good1', port: 'execute' },
        },
        // Connection to a node ID that was never declared as an instance
        {
          type: 'Connection',
          from: { node: 'good1', port: 'onSuccess' },
          to: { node: 'phantomNode', port: 'execute' },
        },
      ],
      scopes: {},
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: {},
      imports: [],
    };

    const validator = new WorkflowValidator();
    const result = validator.validate(workflow);

    // phantomNode has no instance at all, so UNKNOWN_TARGET_NODE should still appear
    const targetErrors = result.errors.filter(
      (e) => e.code === 'UNKNOWN_TARGET_NODE' && e.connection?.to.node === 'phantomNode'
    );
    expect(targetErrors.length).toBeGreaterThan(0);
  });
});
