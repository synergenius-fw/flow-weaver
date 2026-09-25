/**
 * Tests for code generation utilities
 * Tests buildNodeArgumentsWithContext
 */

import { buildNodeArgumentsWithContext } from '../../src/generator/node-arguments';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

describe('Code Generation Utilities', () => {
  // Helper to create a minimal node type
  function createNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
    return {
      type: 'NodeType',
      name: 'testNode',
      functionName: 'testNode',
      variant: 'FUNCTION',
      inputs: {
        execute: { dataType: 'STEP', label: 'Execute' },
        input1: { dataType: 'STRING', tsType: 'string' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
        output1: { dataType: 'STRING', tsType: 'string' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
      ...overrides,
    };
  }

  // Helper to create a minimal workflow
  function createWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
    return {
      type: 'Workflow',
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      sourceFile: 'test.ts',
      nodeTypes: [createNodeType()],
      instances: [{ type: 'NodeInstance', id: 'node1', nodeType: 'testNode' }],
      connections: [
        {
          type: 'Connection',
          from: { node: 'Start', port: 'input' },
          to: { node: 'node1', port: 'input1' },
        },
      ],
      scopes: {},
      startPorts: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'STRING' },
      },
      exitPorts: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        result: { dataType: 'STRING' },
      },
      imports: [],
      ...overrides,
    };
  }

  describe('buildNodeArgumentsWithContext', () => {
    it('should build arguments for node with single input connection', () => {
      const node = createNodeType();
      const workflow = createWorkflow();
      const lines: string[] = [];

      const args = buildNodeArgumentsWithContext({
        node,
        workflow,
        id: 'node1',
        lines,
        indent: '  ',
      });

      // Should have execute and input1 arguments
      expect(args).toHaveLength(2);
      expect(args[0]).toBe('true'); // execute defaults to true when no connection
      expect(args[1]).toBe('node1_input1');

      // Should generate variable declaration for input1
      const linesJoined = lines.join('\n');
      expect(linesJoined).toContain('const node1_input1 = ');
      expect(linesJoined).toContain('getVariable');
      expect(linesJoined).toContain("'Start'");
      expect(linesJoined).toContain("'input'");
    });

    it('should handle execute port connection', () => {
      const node = createNodeType();
      const workflow = createWorkflow({
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'node1', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'Start', port: 'input' },
            to: { node: 'node1', port: 'input1' },
          },
        ],
      });
      const lines: string[] = [];

      const args = buildNodeArgumentsWithContext({
        node,
        workflow,
        id: 'node1',
        lines,
        indent: '  ',
      });

      // Execute should be from connection, not default true
      expect(args[0]).toBe('node1_execute');

      const linesJoined = lines.join('\n');
      expect(linesJoined).toContain('const node1_execute = ');
    });

    it('should use default value for ports with default', () => {
      const node = createNodeType({
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
          input1: {
            dataType: 'STRING',
            tsType: 'string',
            default: 'default_value',
          },
        },
      });
      const workflow = createWorkflow({
        connections: [], // No connections
      });
      const lines: string[] = [];

      buildNodeArgumentsWithContext({
        node,
        workflow,
        id: 'node1',
        lines,
        indent: '  ',
      });

      const linesJoined = lines.join('\n');
      expect(linesJoined).toContain('"default_value"');
    });

    it('should handle optional ports without connection', () => {
      const node = createNodeType({
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
          input1: { dataType: 'STRING', tsType: 'string', optional: true },
        },
      });
      const workflow = createWorkflow({
        connections: [],
      });
      const lines: string[] = [];

      buildNodeArgumentsWithContext({
        node,
        workflow,
        id: 'node1',
        lines,
        indent: '  ',
      });

      const linesJoined = lines.join('\n');
      expect(linesJoined).toContain('const node1_input1 = undefined');
    });

    it('should type-annotate required ports without connection using definite assignment', () => {
      const node = createNodeType({
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
          input1: { dataType: 'NUMBER', tsType: 'number' },
        },
      });
      const workflow = createWorkflow({
        connections: [], // No connections — required port is unconnected
      });
      const lines: string[] = [];

      buildNodeArgumentsWithContext({
        node,
        workflow,
        id: 'node1',
        lines,
        indent: '  ',
      });

      const linesJoined = lines.join('\n');
      // Should use typed undefined cast for required unconnected ports
      expect(linesJoined).toContain('let node1_input1: number = undefined as unknown as number;');
    });

    it('should keep bare undefined for optional ports without connection', () => {
      const node = createNodeType({
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
          input1: { dataType: 'NUMBER', tsType: 'number', optional: true },
        },
      });
      const workflow = createWorkflow({
        connections: [],
      });
      const lines: string[] = [];

      buildNodeArgumentsWithContext({
        node,
        workflow,
        id: 'node1',
        lines,
        indent: '  ',
      });

      const linesJoined = lines.join('\n');
      expect(linesJoined).toContain('const node1_input1 = undefined');
    });

    it('should handle missing source nodes gracefully', () => {
      const node = createNodeType();
      const workflow = createWorkflow({
        connections: [
          // Connection from non-existent node
          {
            type: 'Connection',
            from: { node: 'missingNode', port: 'output' },
            to: { node: 'node1', port: 'input1' },
          },
        ],
      });
      const lines: string[] = [];

      buildNodeArgumentsWithContext({
        node,
        workflow,
        id: 'node1',
        lines,
        indent: '  ',
      });

      const linesJoined = lines.join('\n');
      expect(linesJoined).toContain('undefined');
      expect(linesJoined).toContain('not found');
    });
  });
});
