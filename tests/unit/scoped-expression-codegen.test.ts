/**
 * WU1: B2 — Scoped expression nodes missing onSuccess/onFailure
 *
 * Bug: scope-function-generator.ts extracts result.onSuccess from expression
 * node return (undefined). Non-scoped code correctly hardcodes true/false.
 *
 * Fix: When child is an expression node, hardcode onSuccess=true/onFailure=false
 * instead of reading from procResult.onSuccess/procResult.onFailure.
 */

import { describe, it, expect } from 'vitest';
import { generateScopeFunctionClosure } from '../../src/generator/scope-function-generator';
import type { TNodeTypeAST, TWorkflowAST } from '../../src/ast/types';

describe('scoped expression codegen', () => {
  function createForEachWithExpressionChild() {
    const parentNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'forEach',
      functionName: 'forEach',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'ARRAY', optional: true },
        success: { dataType: 'STEP', scope: 'iteration' },
        result: { dataType: 'NUMBER', scope: 'iteration' },
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

    const expressionChildType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'doubler',
      functionName: 'doubler',
      expression: true,
      inputs: {
        execute: { dataType: 'STEP' },
        value: { dataType: 'NUMBER', optional: true },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        doubled: { dataType: 'NUMBER' },
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
      nodeTypes: [parentNodeType, expressionChildType],
      instances: [
        { type: 'NodeInstance', id: 'forEach1', nodeType: 'forEach' },
        {
          type: 'NodeInstance',
          id: 'child1',
          nodeType: 'doubler',
          parent: { id: 'forEach1', scope: 'iteration' },
        },
      ],
      connections: [
        // Scoped: parent outputs to child
        {
          type: 'Connection',
          from: { node: 'forEach1', port: 'start', scope: 'iteration' },
          to: { node: 'child1', port: 'execute' },
        },
        {
          type: 'Connection',
          from: { node: 'forEach1', port: 'item', scope: 'iteration' },
          to: { node: 'child1', port: 'value' },
        },
        // Scoped: child outputs to parent scoped inputs
        {
          type: 'Connection',
          from: { node: 'child1', port: 'onSuccess' },
          to: { node: 'forEach1', port: 'success', scope: 'iteration' },
        },
        {
          type: 'Connection',
          from: { node: 'child1', port: 'doubled' },
          to: { node: 'forEach1', port: 'result', scope: 'iteration' },
        },
      ],
      scopes: { 'forEach1.iteration': ['child1'] },
      startPorts: { execute: { dataType: 'STEP' }, items: { dataType: 'ARRAY' } },
      exitPorts: { results: { dataType: 'ARRAY' } },
      imports: [],
    };

    const childInstances = workflow.instances.filter(
      (inst) => inst.parent?.id === 'forEach1' && inst.parent?.scope === 'iteration'
    );

    return { parentNodeType, workflow, childInstances };
  }

  it('should hardcode onSuccess=true for expression child nodes', () => {
    const { parentNodeType, workflow, childInstances } = createForEachWithExpressionChild();

    const code = generateScopeFunctionClosure(
      'iteration',
      'forEach1',
      parentNodeType,
      workflow,
      childInstances,
      true, // isAsync
      false // production
    );

    // Expression nodes should have hardcoded true for onSuccess
    // The generated code should set onSuccess to true, not read it from result
    expect(code).toContain("'onSuccess'");
    expect(code).toContain(', true)');
    // Should NOT contain result.onSuccess (which would be undefined for expression nodes)
    expect(code).not.toMatch(/child1Result\.onSuccess/);
  });

  it('should hardcode onFailure=false for expression child nodes', () => {
    const { parentNodeType, workflow, childInstances } = createForEachWithExpressionChild();

    const code = generateScopeFunctionClosure(
      'iteration',
      'forEach1',
      parentNodeType,
      workflow,
      childInstances,
      true,
      false
    );

    // Expression nodes should have hardcoded false for onFailure
    // The code stores onFailure with hardcoded false instead of reading from result
    // Check the code does NOT read child1Result.onFailure
    expect(code).not.toMatch(/child1Result\.onFailure/);
    // And check it does contain a setVariable for onFailure with value false
    expect(code).toMatch(/onFailure[\s\S]*?false/);
    // Also verify it contains ', false);' literally (the hardcoded value)
    expect(code).toContain('false);');
  });

  it('should still read data outputs from expression node result', () => {
    const { parentNodeType, workflow, childInstances } = createForEachWithExpressionChild();

    const code = generateScopeFunctionClosure(
      'iteration',
      'forEach1',
      parentNodeType,
      workflow,
      childInstances,
      true,
      false
    );

    // Data outputs should still be read from the result
    expect(code).toContain('child1Result.doubled');
  });

  it('should still read onSuccess from result for non-expression child nodes', () => {
    const { parentNodeType, workflow, childInstances } = createForEachWithExpressionChild();

    // Make the child non-expression
    const nonExpressionType = workflow.nodeTypes.find((nt) => nt.functionName === 'doubler')!;
    delete nonExpressionType.expression;

    const code = generateScopeFunctionClosure(
      'iteration',
      'forEach1',
      parentNodeType,
      workflow,
      childInstances,
      true,
      false
    );

    // Non-expression nodes should read from result
    expect(code).toContain('child1Result.onSuccess');
    expect(code).toContain('child1Result.onFailure');
  });
});
