/**
 * TDD Test: Scope functions should be async when containing async child nodes
 *
 * When a forEach/scope contains async child nodes, the scope function MUST be async
 * so it can await the child node calls. Otherwise TypeScript throws:
 * TS2345: Type '(start, item) => {...}' is not assignable to type '(start, item) => Promise<...>'
 */

import { describe, it, expect } from 'vitest';
import { generateScopeFunctionClosure } from '../../src/generator/scope-function-generator';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstance } from '../../src/ast/types';

function makeForEachAsyncNodeType(): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: 'forEachAsync',
    functionName: 'forEachAsync',
    inputs: {
      execute: { dataType: 'STEP' },
      items: { dataType: 'ARRAY' },
      // Scoped input - return from scope function
      processed: { dataType: 'ANY', scope: 'processItem' },
      success: { dataType: 'BOOLEAN', scope: 'processItem' },
      failure: { dataType: 'BOOLEAN', scope: 'processItem' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      results: { dataType: 'ARRAY' },
      // Scoped outputs - parameters to scope function
      start: { dataType: 'BOOLEAN', scope: 'processItem' },
      item: { dataType: 'ANY', scope: 'processItem' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: true, // forEach is async and expects async callback
    executeWhen: 'CONJUNCTION',
    expression: false,
    inferred: true,
  };
}

function makeAsyncDoubleNodeType(): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: 'asyncDouble',
    functionName: 'asyncDouble',
    inputs: {
      execute: { dataType: 'STEP' },
      value: { dataType: 'NUMBER' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      result: { dataType: 'NUMBER' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: true, // Async child node
    executeWhen: 'CONJUNCTION',
    expression: false,
    inferred: true,
  };
}

function makeSyncDoubleNodeType(): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: 'syncDouble',
    functionName: 'syncDouble',
    inputs: {
      execute: { dataType: 'STEP' },
      value: { dataType: 'NUMBER' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      result: { dataType: 'NUMBER' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false, // Sync child node
    executeWhen: 'CONJUNCTION',
    expression: false,
    inferred: true,
  };
}

function createWorkflowWithAsyncChild(): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    sourceFile: 'test.ts',
    nodeTypes: [makeForEachAsyncNodeType(), makeAsyncDoubleNodeType()],
    instances: [
      { type: 'NodeInstance', id: 'forEach1', nodeType: 'forEachAsync' },
      {
        type: 'NodeInstance',
        id: 'doubler',
        nodeType: 'asyncDouble',
        parent: { id: 'forEach1', scope: 'processItem' },
      },
    ],
    connections: [
      // Scope: forEach passes item to child
      {
        type: 'Connection',
        from: { node: 'forEach1', port: 'item' },
        to: { node: 'doubler', port: 'value' },
      },
      // Scope: child returns processed value to forEach
      {
        type: 'Connection',
        from: { node: 'doubler', port: 'result' },
        to: { node: 'forEach1', port: 'processed' },
      },
    ],
    scopes: {
      processItem: ['doubler'],
    },
    startPorts: {
      execute: { dataType: 'STEP' },
      items: { dataType: 'ARRAY' },
    },
    exitPorts: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      results: { dataType: 'ARRAY' },
    },
    imports: [],
  };
}

function createWorkflowWithSyncChild(): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    sourceFile: 'test.ts',
    nodeTypes: [makeForEachAsyncNodeType(), makeSyncDoubleNodeType()],
    instances: [
      { type: 'NodeInstance', id: 'forEach1', nodeType: 'forEachAsync' },
      {
        type: 'NodeInstance',
        id: 'doubler',
        nodeType: 'syncDouble',
        parent: { id: 'forEach1', scope: 'processItem' },
      },
    ],
    connections: [
      {
        type: 'Connection',
        from: { node: 'forEach1', port: 'item' },
        to: { node: 'doubler', port: 'value' },
      },
      {
        type: 'Connection',
        from: { node: 'doubler', port: 'result' },
        to: { node: 'forEach1', port: 'processed' },
      },
    ],
    scopes: {
      processItem: ['doubler'],
    },
    startPorts: {
      execute: { dataType: 'STEP' },
      items: { dataType: 'ARRAY' },
    },
    exitPorts: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      results: { dataType: 'ARRAY' },
    },
    imports: [],
  };
}

describe('Scope function async detection', () => {
  it('should generate async scope function when isAsync=true is passed', () => {
    const parentNodeType = makeForEachAsyncNodeType();
    const workflow = createWorkflowWithAsyncChild();
    const childInstances = workflow.instances.filter(
      (i) => i.parent?.scope === 'processItem'
    ) as TNodeInstance[];

    // When isAsync=true, scope function should be async
    const code = generateScopeFunctionClosure(
      'processItem',
      'forEach1',
      parentNodeType,
      workflow,
      childInstances,
      true, // isAsync = true
      false // production
    );

    // Should generate async closure: return async (start, item) =>
    expect(code).toMatch(/return\s+async\s*\([^)]*\)\s*=>/);
  });

  it('should generate sync scope function when isAsync=false is passed', () => {
    const parentNodeType = makeForEachAsyncNodeType();
    const workflow = createWorkflowWithSyncChild();
    const childInstances = workflow.instances.filter(
      (i) => i.parent?.scope === 'processItem'
    ) as TNodeInstance[];

    // When isAsync=false, scope function should be sync
    const code = generateScopeFunctionClosure(
      'processItem',
      'forEach1',
      parentNodeType,
      workflow,
      childInstances,
      false, // isAsync = false
      false // production
    );

    // Should NOT have async keyword
    expect(code).not.toMatch(/return\s+async\s*\([^)]*\)\s*=>/);
    // But should still have the closure pattern
    expect(code).toMatch(/return\s*\([^)]*\)\s*=>/);
  });

  it('should await async child node calls when isAsync=true', () => {
    const parentNodeType = makeForEachAsyncNodeType();
    const workflow = createWorkflowWithAsyncChild();
    const childInstances = workflow.instances.filter(
      (i) => i.parent?.scope === 'processItem'
    ) as TNodeInstance[];

    const code = generateScopeFunctionClosure(
      'processItem',
      'forEach1',
      parentNodeType,
      workflow,
      childInstances,
      true, // isAsync = true
      false // production
    );

    // Should await the async child node call
    expect(code).toMatch(/await\s+asyncDouble/);
  });

  it('should NOT await sync child node calls when isAsync=false', () => {
    const parentNodeType = makeForEachAsyncNodeType();
    const workflow = createWorkflowWithSyncChild();
    const childInstances = workflow.instances.filter(
      (i) => i.parent?.scope === 'processItem'
    ) as TNodeInstance[];

    const code = generateScopeFunctionClosure(
      'processItem',
      'forEach1',
      parentNodeType,
      workflow,
      childInstances,
      false, // isAsync = false
      false // production
    );

    // Should NOT await the sync child node call
    expect(code).not.toMatch(/await\s+syncDouble/);
  });
});
