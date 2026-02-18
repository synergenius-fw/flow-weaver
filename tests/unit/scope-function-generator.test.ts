/**
 * Tests for scope function generator
 * Tests generateScopeFunctionClosure
 */

import { generateScopeFunctionClosure } from '../../src/generator/scope-function-generator';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

describe('Scope Function Generator', () => {
  // Helper to create a node type with scoped ports
  function createScopedNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
    return {
      type: 'NodeType',
      name: 'forEachNode',
      functionName: 'forEachNode',
      variant: 'FUNCTION',
      inputs: {
        execute: { dataType: 'STEP', label: 'Execute' },
        items: { dataType: 'ARRAY', tsType: 'any[]' },
        // Scoped input - return value from scope function
        result: { dataType: 'ANY', scope: 'forEach' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
        // Scoped output - parameter to scope function
        item: { dataType: 'ANY', scope: 'forEach' },
        index: { dataType: 'NUMBER', scope: 'forEach' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
      ...overrides,
    };
  }

  // Helper to create a workflow with child nodes in scope
  function createWorkflowWithScope(): TWorkflowAST {
    return {
      type: 'Workflow',
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      sourceFile: 'test.ts',
      nodeTypes: [
        createScopedNodeType(),
        {
          type: 'NodeType',
          name: 'processItem',
          functionName: 'processItem',
          variant: 'FUNCTION',
          inputs: {
            execute: { dataType: 'STEP' },
            data: { dataType: 'ANY' },
          },
          outputs: {
            onSuccess: { dataType: 'STEP', isControlFlow: true },
            onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
            processed: { dataType: 'ANY' },
          },
          hasSuccessPort: true,
          hasFailurePort: true,
          isAsync: false,
          executeWhen: 'CONJUNCTION',
        },
      ],
      instances: [
        { type: 'NodeInstance', id: 'parent', nodeType: 'forEachNode' },
        {
          type: 'NodeInstance',
          id: 'child1',
          nodeType: 'processItem',
          parent: { id: 'parent', scope: 'forEach' },
        },
      ],
      connections: [
        // Parent's scoped output to child's input
        {
          type: 'Connection',
          from: { node: 'parent', port: 'item' },
          to: { node: 'child1', port: 'data' },
        },
      ],
      scopes: {
        forEach: ['child1'],
      },
      startPorts: {
        execute: { dataType: 'STEP' },
      },
      exitPorts: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
      },
      imports: [],
    };
  }

  describe('generateScopeFunctionClosure', () => {
    it('should generate closure with scope parameters', () => {
      const parentNodeType = createScopedNodeType();
      const workflow = createWorkflowWithScope();
      const childInstances = workflow.instances.filter((i) => i.parent?.scope === 'forEach');

      const code = generateScopeFunctionClosure(
        'forEach',
        'parent',
        parentNodeType,
        workflow,
        childInstances,
        true,
        false
      );

      // Should generate closure pattern
      expect(code).toContain('((ctx) => {');
      expect(code).toContain('})(ctx)');
      // Should have scoped output ports as parameters with correct types
      // item has dataType: 'ANY' -> 'unknown', index has dataType: 'NUMBER' -> 'number'
      expect(code).toContain('item: unknown');
      expect(code).toContain('index: number');
    });

    it('should create scoped context with createScope()', () => {
      const parentNodeType = createScopedNodeType();
      const workflow = createWorkflowWithScope();
      const childInstances = workflow.instances.filter((i) => i.parent?.scope === 'forEach');

      const code = generateScopeFunctionClosure(
        'forEach',
        'parent',
        parentNodeType,
        workflow,
        childInstances,
        true,
        false
      );

      expect(code).toContain('ctx.createScope');
      expect(code).toContain("'parent'");
      expect(code).toContain("'forEach'");
    });

    it('should generate async function when isAsync is true', () => {
      const parentNodeType = createScopedNodeType();
      const workflow = createWorkflowWithScope();
      const childInstances = workflow.instances.filter((i) => i.parent?.scope === 'forEach');

      const code = generateScopeFunctionClosure(
        'forEach',
        'parent',
        parentNodeType,
        workflow,
        childInstances,
        true, // async
        false
      );

      expect(code).toContain('async (');
      expect(code).toContain('await scopedCtx.setVariable');
    });

    it('should generate sync function when isAsync is false', () => {
      const parentNodeType = createScopedNodeType();
      const workflow = createWorkflowWithScope();
      const childInstances = workflow.instances.filter((i) => i.parent?.scope === 'forEach');

      const code = generateScopeFunctionClosure(
        'forEach',
        'parent',
        parentNodeType,
        workflow,
        childInstances,
        false, // sync
        false
      );

      // Should not have async keyword
      expect(code).not.toMatch(/return async \(/);
      expect(code).toMatch(/return \(/);
      // setVariable without await
      expect(code).toContain('scopedCtx.setVariable');
      expect(code).not.toMatch(/await scopedCtx\.setVariable/);
    });

    it('should execute child nodes in topological order', () => {
      const parentNodeType = createScopedNodeType();
      const workflow = createWorkflowWithScope();
      const childInstances = workflow.instances.filter((i) => i.parent?.scope === 'forEach');

      const code = generateScopeFunctionClosure(
        'forEach',
        'parent',
        parentNodeType,
        workflow,
        childInstances,
        true,
        false
      );

      // Should execute child nodes
      expect(code).toContain('child1Idx');
      expect(code).toContain('processItem');
    });

    it('should return scope outputs', () => {
      const parentNodeType = createScopedNodeType();
      const workflow = createWorkflowWithScope();
      const childInstances = workflow.instances.filter((i) => i.parent?.scope === 'forEach');

      const code = generateScopeFunctionClosure(
        'forEach',
        'parent',
        parentNodeType,
        workflow,
        childInstances,
        true,
        false
      );

      // Should return an object with scope results
      expect(code).toContain('return {');
    });

    it('should merge scope back to parent context', () => {
      const parentNodeType = createScopedNodeType();
      const workflow = createWorkflowWithScope();
      const childInstances = workflow.instances.filter((i) => i.parent?.scope === 'forEach');

      const code = generateScopeFunctionClosure(
        'forEach',
        'parent',
        parentNodeType,
        workflow,
        childInstances,
        true,
        false
      );

      // Should merge scoped context back
      expect(code).toContain('mergeScope');
    });

    it('should read success/failure from connected child nodes, not hardcode them (#41)', () => {
      // Node type with success/failure scoped INPUT ports (like retryLoop)
      const retryNodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'retryLoop',
        functionName: 'retryLoop',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
          data: { dataType: 'ANY' },
          maxRetries: { dataType: 'NUMBER' },
          // Scoped INPUT ports (return values from scope function)
          success: { dataType: 'STEP', scope: 'attempt' },
          failure: { dataType: 'STEP', scope: 'attempt' },
          result: { dataType: 'ANY', scope: 'attempt' },
          error: { dataType: 'STRING', scope: 'attempt' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          // Scoped OUTPUT ports (parameters to scope function)
          start: { dataType: 'STEP', scope: 'attempt' },
          attemptData: { dataType: 'ANY', scope: 'attempt' },
          attemptNum: { dataType: 'NUMBER', scope: 'attempt' },
          finalResult: { dataType: 'ANY' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const tryOpNodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'tryOperation',
        functionName: 'tryOperation',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP' },
          data: { dataType: 'ANY' },
          attempt: { dataType: 'NUMBER' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          result: { dataType: 'ANY' },
          error: { dataType: 'STRING' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const workflow: TWorkflowAST = {
        type: 'Workflow',
        name: 'retryPipeline',
        functionName: 'retryPipeline',
        sourceFile: 'test.ts',
        nodeTypes: [retryNodeType, tryOpNodeType],
        instances: [
          { type: 'NodeInstance', id: 'loop', nodeType: 'retryLoop' },
          {
            type: 'NodeInstance',
            id: 'op',
            nodeType: 'tryOperation',
            parent: { id: 'loop', scope: 'attempt' },
          },
        ],
        connections: [
          // Parent scoped OUTPUT -> child INPUT
          {
            type: 'Connection',
            from: { node: 'loop', port: 'start' },
            to: { node: 'op', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'loop', port: 'attemptData' },
            to: { node: 'op', port: 'data' },
          },
          {
            type: 'Connection',
            from: { node: 'loop', port: 'attemptNum' },
            to: { node: 'op', port: 'attempt' },
          },
          // Child OUTPUT -> parent scoped INPUT (the critical connections)
          {
            type: 'Connection',
            from: { node: 'op', port: 'onSuccess' },
            to: { node: 'loop', port: 'success' },
          },
          {
            type: 'Connection',
            from: { node: 'op', port: 'onFailure' },
            to: { node: 'loop', port: 'failure' },
          },
          {
            type: 'Connection',
            from: { node: 'op', port: 'result' },
            to: { node: 'loop', port: 'result' },
          },
          {
            type: 'Connection',
            from: { node: 'op', port: 'error' },
            to: { node: 'loop', port: 'error' },
          },
        ],
        scopes: { attempt: ['op'] },
        startPorts: { execute: { dataType: 'STEP' } },
        exitPorts: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
        imports: [],
      };

      const childInstances = workflow.instances.filter((i) => i.parent?.scope === 'attempt');

      const code = generateScopeFunctionClosure(
        'attempt',
        'loop',
        retryNodeType,
        workflow,
        childInstances,
        false,
        false
      );

      // success/failure should be read from child node's onSuccess/onFailure — NOT hardcoded
      expect(code).toContain('scopeReturn_success');
      expect(code).toContain('scopeReturn_failure');
      // Should use hasVariable check (safe for expression nodes that don't set onSuccess/onFailure)
      expect(code).toContain('hasVariable(');
      expect(code).toContain("portName: 'onSuccess'");
      expect(code).toContain("portName: 'onFailure'");

      // Return object should use the resolved variables
      expect(code).toContain('success: scopeReturn_success');
      expect(code).toContain('failure: scopeReturn_failure');

      // Should NOT have hardcoded success: true in the return object
      expect(code).not.toMatch(/return \{[^}]*success: true/);
    });

    it('should handle empty scope (no child nodes)', () => {
      const parentNodeType = createScopedNodeType();
      const workflow = createWorkflowWithScope();

      // Empty child instances
      const code = generateScopeFunctionClosure(
        'forEach',
        'parent',
        parentNodeType,
        workflow,
        [], // no children
        true,
        false
      );

      // Should still generate valid closure
      expect(code).toContain('((ctx) => {');
      expect(code).toContain('return {');
    });

    it('should generate async scope function when workflow isAsync=true, even if node.isAsync=false', () => {
      // This tests the fix for scope async mismatch errors:
      // "Type '(start, item) => Promise<...>' is not assignable to type '(start, item) => {...}'"
      //
      // The scope function must match the workflow's async context, NOT the parent node's isAsync flag.
      // When the workflow is async (isAsync=true parameter), the scope function must be async
      // so that it can use await for context operations like setVariable and getVariable.

      // Parent node type with isAsync=false (sync callback signature expected by the node)
      const syncParentNodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'syncForEach',
        functionName: 'syncForEach',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
          items: { dataType: 'ARRAY', tsType: 'number[]' },
          // Scoped input - return value from scope function
          processed: { dataType: 'NUMBER', scope: 'forEach' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          // Scoped output - parameter to scope function
          start: { dataType: 'STEP', scope: 'forEach' },
          item: { dataType: 'NUMBER', scope: 'forEach' },
          results: { dataType: 'ARRAY', tsType: 'number[]' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false, // <-- Parent node is SYNC
        executeWhen: 'CONJUNCTION',
      };

      const childNodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'doubleItem',
        functionName: 'doubleItem',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP' },
          value: { dataType: 'NUMBER' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          result: { dataType: 'NUMBER' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const workflow: TWorkflowAST = {
        type: 'Workflow',
        name: 'asyncWorkflowWithSyncNode',
        functionName: 'asyncWorkflowWithSyncNode',
        sourceFile: 'test.ts',
        nodeTypes: [syncParentNodeType, childNodeType],
        instances: [
          { type: 'NodeInstance', id: 'loop', nodeType: 'syncForEach' },
          {
            type: 'NodeInstance',
            id: 'proc',
            nodeType: 'doubleItem',
            parent: { id: 'loop', scope: 'forEach' },
          },
        ],
        connections: [
          {
            type: 'Connection',
            from: { node: 'loop', port: 'start' },
            to: { node: 'proc', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'loop', port: 'item' },
            to: { node: 'proc', port: 'value' },
          },
          {
            type: 'Connection',
            from: { node: 'proc', port: 'result' },
            to: { node: 'loop', port: 'processed' },
          },
        ],
        scopes: { forEach: ['proc'] },
        startPorts: { execute: { dataType: 'STEP' } },
        exitPorts: { onSuccess: { dataType: 'STEP', isControlFlow: true } },
        imports: [],
      };

      const childInstances = workflow.instances.filter((i) => i.parent?.scope === 'forEach');

      // Generate scope function with isAsync=TRUE (workflow context is async)
      // but parent node type has isAsync=false
      const code = generateScopeFunctionClosure(
        'forEach',
        'loop',
        syncParentNodeType, // node.isAsync = false
        workflow,
        childInstances,
        true, // isAsync = true (workflow context is async)
        false
      );

      // The scope function MUST be async because the workflow context is async.
      // This is required for ctx.setVariable/getVariable to work with await.
      expect(code).toContain('async (');
      expect(code).toContain('await scopedCtx.setVariable');
      expect(code).toContain('await scopedCtx.getVariable');
    });
  });
});
