/**
 * TDD Test: Generated code should not have duplicate properties
 *
 * Tests for TS2783 errors where onSuccess/onFailure are specified more than once
 * in the generated return statements.
 */

import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { generateCode } from '../../src/api/generate';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

const MOCK_FILE = path.join(os.tmpdir(), 'test-workflow.ts');

function makeNodeType(overrides: Partial<TNodeTypeAST>): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: overrides.name || 'testFn',
    functionName: overrides.functionName || overrides.name || 'testFn',
    inputs: overrides.inputs || { execute: { dataType: 'STEP' } },
    outputs: overrides.outputs || {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      result: { dataType: 'STRING' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    expression: true,
    inferred: true,
    ...overrides,
  };
}

function makeWorkflow(nodeTypes: TNodeTypeAST[], overrides?: Partial<TWorkflowAST>): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: MOCK_FILE,
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    nodeTypes,
    instances: [{ type: 'NodeInstance', id: 'n1', nodeType: nodeTypes[0]?.name || 'testFn' }],
    connections: [
      {
        type: 'Connection',
        from: { node: 'Start', port: 'execute' },
        to: { node: 'n1', port: 'execute' },
      },
      {
        type: 'Connection',
        from: { node: 'n1', port: 'onSuccess' },
        to: { node: 'Exit', port: 'onSuccess' },
      },
    ],
    startPorts: {
      execute: { dataType: 'STEP' },
      input: { dataType: 'STRING' },
    },
    exitPorts: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      output: { dataType: 'STRING' },
    },
    imports: [],
    ...overrides,
  };
}

/**
 * Helper to check for duplicate property assignments in object literals
 * Returns array of property names that appear more than once in any single object literal
 */
function findDuplicateObjectProperties(code: string): string[] {
  const duplicates: string[] = [];

  // Match object literals: { prop1: val1, prop2: val2, ... }
  // This regex matches the content inside { }
  const objectLiteralRegex = /\{([^{}]+)\}/g;
  let match;

  while ((match = objectLiteralRegex.exec(code)) !== null) {
    const content = match[1];
    // Skip empty objects
    if (!content.trim()) continue;

    // Extract property names (before the colon)
    // Handle spread operator: ...result
    const propMatches = content.matchAll(/(?:\.\.\.(\w+)|(\w+)\s*:)/g);
    const props: string[] = [];
    for (const propMatch of propMatches) {
      if (propMatch[2]) {
        // Regular property
        props.push(propMatch[2]);
      }
      // Ignore spread operators for this check - they're handled separately
    }

    // Find duplicates within this object literal
    const seen = new Set<string>();
    for (const prop of props) {
      if (seen.has(prop)) {
        if (!duplicates.includes(prop)) {
          duplicates.push(prop);
        }
      }
      seen.add(prop);
    }
  }

  return duplicates;
}

describe('Generated code duplicate properties', () => {
  it('should not duplicate onSuccess/onFailure in Exit node return', () => {
    const nodeType = makeNodeType({
      name: 'process',
      functionName: 'process',
      sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
      // Regular node that returns control flow ports
      functionText: `function process(execute: boolean, input: string) {
        if (!execute) return { onSuccess: false, onFailure: false, result: '' };
        return { onSuccess: true, onFailure: false, result: input.toUpperCase() };
      }`,
    });

    const ast = makeWorkflow([nodeType]);
    const code = generateCode(ast, { production: true }) as string;

    const duplicates = findDuplicateObjectProperties(code);
    expect(duplicates).not.toContain('onSuccess');
    expect(duplicates).not.toContain('onFailure');
  });

  it('should not duplicate properties when spreading result with control flow', () => {
    // Node type where the result being spread contains onSuccess/onFailure
    const nodeType = makeNodeType({
      name: 'transform',
      functionName: 'transform',
      expression: false,
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        data: { dataType: 'STRING' },
      },
      sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
      functionText: `function transform(execute: boolean, input: string) {
        return { onSuccess: true, onFailure: false, data: input };
      }`,
    });

    const ast = makeWorkflow([nodeType], {
      exitPorts: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        data: { dataType: 'STRING' },
      },
      connections: [
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'n1', port: 'execute' },
        },
        {
          type: 'Connection',
          from: { node: 'n1', port: 'data' },
          to: { node: 'Exit', port: 'data' },
        },
        {
          type: 'Connection',
          from: { node: 'n1', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        },
        {
          type: 'Connection',
          from: { node: 'n1', port: 'onFailure' },
          to: { node: 'Exit', port: 'onFailure' },
        },
      ],
    });

    const code = generateCode(ast, { production: true }) as string;

    const duplicates = findDuplicateObjectProperties(code);
    expect(duplicates).not.toContain('onSuccess');
    expect(duplicates).not.toContain('onFailure');
    expect(duplicates).not.toContain('data');
  });

  it('should handle finalResult object without duplicates', () => {
    const nodeType = makeNodeType({
      name: 'echo',
      functionName: 'echo',
      sourceLocation: { file: MOCK_FILE, line: 1, column: 0 },
      functionText: `function echo(execute: boolean, value: string) {
        return { onSuccess: true, onFailure: false, result: value };
      }`,
    });

    const ast = makeWorkflow([nodeType]);
    const code = generateCode(ast, { production: true }) as string;

    // Check that finalResult construction doesn't have duplicates
    // Use word boundary to match only property names, not variable names like exit_onSuccess
    const finalResultMatch = code.match(/const finalResult = \{[^}]+\}/);
    if (finalResultMatch) {
      const finalResult = finalResultMatch[0];
      // Match only property names (word at start of assignment)
      const onSuccessCount = (finalResult.match(/\bonSuccess:/g) || []).length;
      const onFailureCount = (finalResult.match(/\bonFailure:/g) || []).length;

      expect(onSuccessCount).toBeLessThanOrEqual(1);
      expect(onFailureCount).toBeLessThanOrEqual(1);
    }
  });
});
