/**
 * Shared test fixtures and factories for API tests
 * Provides reusable workflow structures and node type definitions
 */

import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST } from '../../src/ast/types';

/**
 * Create a processor node type with optional inputs
 * Default: single input/output NUMBER ports
 */
export function createProcessorNodeType(
  name: string = 'processor',
  functionName: string = 'process'
): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName,
    inputs: { input: { dataType: 'NUMBER', optional: true } },
    outputs: { output: { dataType: 'NUMBER' } },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
  };
}

/**
 * Create a transformer node type
 * Default: data input → result output
 */
export function createTransformerNodeType(
  name: string = 'transformer',
  functionName: string = 'transform'
): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName,
    inputs: { data: { dataType: 'NUMBER', optional: true } },
    outputs: { result: { dataType: 'NUMBER' } },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
  };
}

/**
 * Create a multi-input node type
 * Useful for testing parallel connections
 */
export function createMultiInputNodeType(
  name: string = 'adder',
  functionName: string = 'add'
): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName,
    inputs: {
      a: { dataType: 'NUMBER', optional: true },
      b: { dataType: 'NUMBER', optional: true },
    },
    outputs: { result: { dataType: 'NUMBER' } },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
  };
}

/**
 * Create a node instance
 */
export function createNodeInstance(
  id: string,
  nodeType: string = 'process',
  config?: TNodeInstanceAST['config']
): TNodeInstanceAST {
  const node: TNodeInstanceAST = {
    type: 'NodeInstance',
    id,
    nodeType,
  };

  if (config) {
    node.config = config;
  }

  return node;
}

/**
 * Create a simple workflow with 1 node
 * Structure: Start → node1 → Exit
 */
export function createSimpleWorkflow(): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    sourceFile: 'test.ts',
    nodeTypes: [createProcessorNodeType()],
    instances: [createNodeInstance('node1', 'process')],
    connections: [
      {
        type: 'Connection',
        from: { node: 'Start', port: 'x' },
        to: { node: 'node1', port: 'input' },
      },
      {
        type: 'Connection',
        from: { node: 'node1', port: 'output' },
        to: { node: 'Exit', port: 'result' },
      },
    ],
    scopes: {},
    startPorts: { x: { dataType: 'NUMBER' } },
    exitPorts: { result: { dataType: 'NUMBER' } },
    imports: [],
  };
}

/**
 * Create a chain workflow with 3 nodes in sequence
 * Structure: Start → node1 → node2 → node3 → Exit
 * Useful for testing dependency analysis
 */
export function createChainWorkflow(): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    sourceFile: 'test.ts',
    nodeTypes: [createProcessorNodeType(), createTransformerNodeType()],
    instances: [
      createNodeInstance('node1', 'process'),
      createNodeInstance('node2', 'process'),
      createNodeInstance('node3', 'transform'),
    ],
    connections: [
      {
        type: 'Connection',
        from: { node: 'Start', port: 'x' },
        to: { node: 'node1', port: 'input' },
      },
      {
        type: 'Connection',
        from: { node: 'node1', port: 'output' },
        to: { node: 'node2', port: 'input' },
      },
      {
        type: 'Connection',
        from: { node: 'node2', port: 'output' },
        to: { node: 'node3', port: 'data' },
      },
      {
        type: 'Connection',
        from: { node: 'node3', port: 'result' },
        to: { node: 'Exit', port: 'output' },
      },
    ],
    scopes: {},
    startPorts: { x: { dataType: 'NUMBER' } },
    exitPorts: { output: { dataType: 'NUMBER' } },
    imports: [],
  };
}

/**
 * Create a workflow with parallel nodes
 * Structure: Start → node1 & node2 → node3 → Exit
 * Useful for testing execution groups
 */
export function createParallelWorkflow(): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'parallelWorkflow',
    functionName: 'parallelWorkflow',
    sourceFile: 'parallel.ts',
    nodeTypes: [createProcessorNodeType(), createMultiInputNodeType()],
    instances: [
      createNodeInstance('node1', 'process'),
      createNodeInstance('node2', 'process'),
      createNodeInstance('node3', 'add'),
    ],
    connections: [
      {
        type: 'Connection',
        from: { node: 'Start', port: 'x' },
        to: { node: 'node1', port: 'input' },
      },
      {
        type: 'Connection',
        from: { node: 'Start', port: 'x' },
        to: { node: 'node2', port: 'input' },
      },
      {
        type: 'Connection',
        from: { node: 'node1', port: 'output' },
        to: { node: 'node3', port: 'a' },
      },
      {
        type: 'Connection',
        from: { node: 'node2', port: 'output' },
        to: { node: 'node3', port: 'b' },
      },
      {
        type: 'Connection',
        from: { node: 'node3', port: 'result' },
        to: { node: 'Exit', port: 'output' },
      },
    ],
    scopes: {},
    startPorts: { x: { dataType: 'NUMBER' } },
    exitPorts: { output: { dataType: 'NUMBER' } },
    imports: [],
  };
}

/**
 * Create a workflow with a direct Start→Exit bypass connection
 * Useful for testing node removal without breaking workflow validity
 */
export function createWorkflowWithBypass(): TWorkflowAST {
  const workflow = createSimpleWorkflow();
  workflow.connections.push({
    type: 'Connection',
    from: { node: 'Start', port: 'x' },
    to: { node: 'Exit', port: 'result' },
  });
  return workflow;
}

/**
 * Create a minimal workflow for basic validation tests
 * Single node with non-optional input for testing required connections
 */
export function createMinimalWorkflow(): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'test',
    functionName: 'test',
    sourceFile: 'test.ts',
    nodeTypes: [
      {
        type: 'NodeType',
        name: 'testType',
        functionName: 'testFunc',
        inputs: { input: { dataType: 'NUMBER' } },
        outputs: { output: { dataType: 'NUMBER' } },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      },
    ],
    instances: [createNodeInstance('testNode', 'testFunc')],
    connections: [
      {
        type: 'Connection',
        from: { node: 'Start', port: 'input' },
        to: { node: 'testNode', port: 'input' },
      },
      {
        type: 'Connection',
        from: { node: 'testNode', port: 'output' },
        to: { node: 'Exit', port: 'output' },
      },
    ],
    scopes: {},
    startPorts: { input: { dataType: 'NUMBER' } },
    exitPorts: { output: { dataType: 'NUMBER' } },
    imports: [],
  };
}

/**
 * Create a workflow with a scoped (forEach-like) parent node and per-port scoped children.
 * Structure:
 *   Main flow: Start → forEach1 → Exit
 *   Scoped:    forEach1.start:iteration → child1.execute (inside scope closure)
 *              child1.processed → forEach1.processed:iteration (scoped return)
 *
 * This triggers the scoped-query bug: scoped connections create apparent cycles
 * in naive topological sort because they cross scope boundaries.
 */
export function createScopedWorkflow(): TWorkflowAST {
  const forEachNodeType: TNodeTypeAST = {
    type: 'NodeType',
    name: 'forEach',
    functionName: 'forEach',
    inputs: {
      execute: { dataType: 'STEP' },
      items: { dataType: 'ARRAY', optional: true },
      success: { dataType: 'STEP', scope: 'iteration' },
      failure: { dataType: 'STEP', scope: 'iteration' },
      processed: { dataType: 'NUMBER', scope: 'iteration' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      start: { dataType: 'STEP', scope: 'iteration' },
      item: { dataType: 'NUMBER', scope: 'iteration' },
      results: { dataType: 'ARRAY' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    scopes: ['iteration'],
  };

  const childNodeType: TNodeTypeAST = {
    type: 'NodeType',
    name: 'processor',
    functionName: 'process',
    inputs: {
      execute: { dataType: 'STEP' },
      input: { dataType: 'NUMBER', optional: true },
    },
    outputs: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      processed: { dataType: 'NUMBER' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
  };

  return {
    type: 'Workflow',
    name: 'scopedWorkflow',
    functionName: 'scopedWorkflow',
    sourceFile: 'scoped.ts',
    nodeTypes: [forEachNodeType, childNodeType],
    instances: [
      { type: 'NodeInstance', id: 'forEach1', nodeType: 'forEach' },
      {
        type: 'NodeInstance',
        id: 'child1',
        nodeType: 'process',
        parent: { id: 'forEach1', scope: 'iteration' },
      },
    ],
    connections: [
      // Main flow: Start → forEach1
      {
        type: 'Connection',
        from: { node: 'Start', port: 'execute' },
        to: { node: 'forEach1', port: 'execute' },
      },
      {
        type: 'Connection',
        from: { node: 'Start', port: 'items' },
        to: { node: 'forEach1', port: 'items' },
      },
      // Main flow: forEach1 → Exit
      {
        type: 'Connection',
        from: { node: 'forEach1', port: 'results' },
        to: { node: 'Exit', port: 'results' },
      },
      {
        type: 'Connection',
        from: { node: 'forEach1', port: 'onSuccess' },
        to: { node: 'Exit', port: 'onSuccess' },
      },
      // Scoped connections (these create apparent cycles if not filtered)
      {
        type: 'Connection',
        from: { node: 'forEach1', port: 'start', scope: 'iteration' },
        to: { node: 'child1', port: 'execute' },
      },
      {
        type: 'Connection',
        from: { node: 'forEach1', port: 'item', scope: 'iteration' },
        to: { node: 'child1', port: 'input' },
      },
      {
        type: 'Connection',
        from: { node: 'child1', port: 'processed' },
        to: { node: 'forEach1', port: 'processed', scope: 'iteration' },
      },
      {
        type: 'Connection',
        from: { node: 'child1', port: 'onSuccess' },
        to: { node: 'forEach1', port: 'success', scope: 'iteration' },
      },
      {
        type: 'Connection',
        from: { node: 'child1', port: 'onFailure' },
        to: { node: 'forEach1', port: 'failure', scope: 'iteration' },
      },
    ],
    scopes: { 'forEach1.iteration': ['child1'] },
    startPorts: { execute: { dataType: 'STEP' }, items: { dataType: 'ARRAY' } },
    exitPorts: { results: { dataType: 'ARRAY' }, onSuccess: { dataType: 'STEP' } },
    imports: [],
  };
}

/**
 * Create a workflow with explicit @position annotations on all nodes.
 * Structure: Start(-600, 0) → node1(0, 0) → Exit(600, 0)
 * Used to test that the diagram generator respects explicit positions.
 */
export function createPositionedWorkflow(): TWorkflowAST {
  const workflow = createSimpleWorkflow();
  workflow.ui = {
    startNode: { x: -600, y: 0 },
    exitNode: { x: 600, y: 0 },
  };
  workflow.instances[0].config = {
    ...workflow.instances[0].config,
    x: 0,
    y: 0,
  };
  return workflow;
}

/**
 * Standard processor node type constant
 * For tests that just need a basic node type
 */
export const STANDARD_PROCESSOR_NODE_TYPE = createProcessorNodeType();
