/**
 * Integration test for adding npm package node types and instances.
 * Tests the full flow: addNodeType -> addNode -> setNodePosition
 * Also tests code generation and parsing roundtrip.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { addNodeType, addNode, setNodePosition } from '../../src/api/manipulation';
import { generateInPlace } from '../../src/api/generate-in-place';
import { parser } from '../../src/parser';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST } from '../../src/ast/types';

describe('Add NPM Node Integration', () => {
  let baseWorkflow: TWorkflowAST;

  beforeEach(() => {
    // Create a minimal valid workflow
    baseWorkflow = {
      type: 'Workflow',
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      sourceFile: '/test/workflow.ts',
      nodeTypes: [],
      instances: [],
      connections: [],
      startPorts: {},
      exitPorts: {},
    };
  });

  describe('addNodeType idempotency', () => {
    it('should add a new node type successfully', () => {
      const npmNodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'npm/lodash/map',
        functionName: 'map',
        importSource: 'lodash',
        variant: 'FUNCTION',
        inputs: { array: { type: 'ARRAY' } },
        outputs: { result: { type: 'ARRAY' } },
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: 'CONJUNCTION',
      };

      const result = addNodeType(baseWorkflow, npmNodeType);

      expect(result.nodeTypes).toHaveLength(1);
      expect(result.nodeTypes[0].name).toBe('npm/lodash/map');
      expect(result.nodeTypes[0].importSource).toBe('lodash');
    });

    it('should return unchanged AST when node type already exists (idempotent)', () => {
      const npmNodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'npm/lodash/map',
        functionName: 'map',
        importSource: 'lodash',
        variant: 'FUNCTION',
        inputs: {},
        outputs: {},
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: 'CONJUNCTION',
      };

      // Add it once
      const firstResult = addNodeType(baseWorkflow, npmNodeType);
      expect(firstResult.nodeTypes).toHaveLength(1);

      // Add it again - should be idempotent (return same, no error)
      const secondResult = addNodeType(firstResult, npmNodeType);
      expect(secondResult.nodeTypes).toHaveLength(1);
      // Should return the same AST object (reference equality)
      expect(secondResult).toBe(firstResult);
    });
  });

  describe('addNode after addNodeType', () => {
    it('should add node instance after registering node type', () => {
      const npmNodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'npm/autoprefixer/autoprefixer',
        functionName: 'autoprefixer',
        importSource: 'autoprefixer',
        variant: 'FUNCTION',
        inputs: { css: { type: 'STRING' } },
        outputs: { result: { type: 'STRING' } },
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: 'CONJUNCTION',
      };

      // Step 1: Add node type
      const workflowWithType = addNodeType(baseWorkflow, npmNodeType);
      expect(workflowWithType.nodeTypes).toHaveLength(1);

      // Step 2: Add node instance
      const nodeInstance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'npm/autoprefixer/autoprefixerc234b6abd08c',
        nodeType: 'npm/autoprefixer/autoprefixer',
        config: { x: 100, y: 200 },
        metadata: {},
      };

      const workflowWithNode = addNode(workflowWithType, nodeInstance);
      expect(workflowWithNode.instances).toHaveLength(1);
      expect(workflowWithNode.instances[0].id).toBe('npm/autoprefixer/autoprefixerc234b6abd08c');
      expect(workflowWithNode.instances[0].nodeType).toBe('npm/autoprefixer/autoprefixer');
    });

    it('should throw when adding duplicate node instance', () => {
      const nodeInstance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'testNode1',
        nodeType: 'someType',
        config: { x: 0, y: 0 },
        metadata: {},
      };

      const workflowWithNode = addNode(baseWorkflow, nodeInstance);

      // Adding same node again should throw
      expect(() => addNode(workflowWithNode, nodeInstance)).toThrow(
        'Node "testNode1" already exists'
      );
    });
  });

  describe('setNodePosition after addNode', () => {
    it('should set position on newly added node', () => {
      const npmNodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'npm/autoprefixer/autoprefixer',
        functionName: 'autoprefixer',
        importSource: 'autoprefixer',
        variant: 'FUNCTION',
        inputs: {},
        outputs: {},
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: 'CONJUNCTION',
      };

      const nodeInstance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'npm/autoprefixer/autoprefixerABC123',
        nodeType: 'npm/autoprefixer/autoprefixer',
        config: { x: 100, y: 200 },
        metadata: {},
      };

      // Add type, then node
      let workflow = addNodeType(baseWorkflow, npmNodeType);
      workflow = addNode(workflow, nodeInstance);

      // Set position should work
      const result = setNodePosition(workflow, 'npm/autoprefixer/autoprefixerABC123', 300, 400);

      expect(result.instances[0].config?.x).toBe(300);
      expect(result.instances[0].config?.y).toBe(400);
    });

    it('should throw when setting position on non-existent node', () => {
      expect(() => setNodePosition(baseWorkflow, 'nonExistentNode', 100, 200)).toThrow(
        'Node "nonExistentNode" not found'
      );
    });
  });

  describe('full npm node workflow', () => {
    it('should support complete npm node lifecycle', () => {
      const npmNodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'npm/date-fns/format',
        functionName: 'format',
        importSource: 'date-fns',
        variant: 'FUNCTION',
        inputs: {
          date: { type: 'DATE' },
          formatStr: { type: 'STRING' },
        },
        outputs: {
          result: { type: 'STRING' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: 'CONJUNCTION',
      };

      const nodeInstance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'formatDate123',
        nodeType: 'npm/date-fns/format',
        config: { x: 50, y: 100, label: 'Format Date' },
        metadata: {},
      };

      // Full lifecycle
      let workflow = baseWorkflow;

      // 1. Add node type (idempotent - can be called multiple times)
      workflow = addNodeType(workflow, npmNodeType);
      workflow = addNodeType(workflow, npmNodeType); // Should not throw
      expect(workflow.nodeTypes).toHaveLength(1);

      // 2. Add node instance
      workflow = addNode(workflow, nodeInstance);
      expect(workflow.instances).toHaveLength(1);

      // 3. Move node (setPosition)
      workflow = setNodePosition(workflow, 'formatDate123', 200, 300);
      expect(workflow.instances[0].config?.x).toBe(200);
      expect(workflow.instances[0].config?.y).toBe(300);

      // Verify node type is still intact
      expect(workflow.nodeTypes[0].name).toBe('npm/date-fns/format');
      expect(workflow.nodeTypes[0].importSource).toBe('date-fns');
    });
  });

  describe('autoprefixer specific test', () => {
    it('should handle autoprefixer node type exactly as used in UI', () => {
      // This matches the exact pattern from the user's error:
      // nodeId: "npm/autoprefixer/autoprefixerc234b6abd08c"
      const autoprefixerNodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'npm/autoprefixer/autoprefixer',
        functionName: 'autoprefixer',
        importSource: 'autoprefixer',
        variant: 'FUNCTION',
        inputs: {},
        outputs: {},
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: 'CONJUNCTION',
      };

      // UUID suffix matches the error: c234b6abd08c
      const autoprefixerInstance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'npm/autoprefixer/autoprefixerc234b6abd08c',
        nodeType: 'npm/autoprefixer/autoprefixer',
        config: { x: 100, y: 200, label: 'autoprefixer' },
        metadata: {},
      };

      let workflow = baseWorkflow;

      // Step 1: Add node type
      workflow = addNodeType(workflow, autoprefixerNodeType);
      expect(workflow.nodeTypes).toHaveLength(1);
      expect(workflow.nodeTypes[0].name).toBe('npm/autoprefixer/autoprefixer');
      expect(workflow.nodeTypes[0].importSource).toBe('autoprefixer');

      // Step 2: Add node instance
      workflow = addNode(workflow, autoprefixerInstance);
      expect(workflow.instances).toHaveLength(1);
      expect(workflow.instances[0].id).toBe('npm/autoprefixer/autoprefixerc234b6abd08c');

      // Step 3: Set position (this was failing with "Node not found")
      workflow = setNodePosition(workflow, 'npm/autoprefixer/autoprefixerc234b6abd08c', 300, 400);
      expect(workflow.instances[0].config?.x).toBe(300);
      expect(workflow.instances[0].config?.y).toBe(400);

      // Verify everything is intact
      expect(workflow.nodeTypes).toHaveLength(1);
      expect(workflow.instances).toHaveLength(1);
    });

    it('should handle idempotent addNodeType then addNode', () => {
      const autoprefixerNodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'npm/autoprefixer/autoprefixer',
        functionName: 'autoprefixer',
        importSource: 'autoprefixer',
        variant: 'FUNCTION',
        inputs: {},
        outputs: {},
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: 'CONJUNCTION',
      };

      let workflow = baseWorkflow;

      // Call addNodeType multiple times (simulating race conditions or retries)
      workflow = addNodeType(workflow, autoprefixerNodeType);
      const afterFirst = workflow;
      workflow = addNodeType(workflow, autoprefixerNodeType);
      const afterSecond = workflow;

      // Should be the same object (idempotent)
      expect(afterSecond).toBe(afterFirst);
      expect(workflow.nodeTypes).toHaveLength(1);

      // Now add two different instances
      const instance1: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'npm/autoprefixer/autoprefixerAAA111',
        nodeType: 'npm/autoprefixer/autoprefixer',
        config: { x: 100, y: 100 },
        metadata: {},
      };

      const instance2: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'npm/autoprefixer/autoprefixerBBB222',
        nodeType: 'npm/autoprefixer/autoprefixer',
        config: { x: 200, y: 200 },
        metadata: {},
      };

      workflow = addNode(workflow, instance1);
      workflow = addNode(workflow, instance2);

      expect(workflow.instances).toHaveLength(2);
      expect(workflow.nodeTypes).toHaveLength(1); // Still just one node type
    });
  });

  describe('generateInPlace code generation', () => {
    it('should generate code for npm node types correctly', () => {
      // Start with source code that has a workflow (STEP signature format)
      const sourceCode = `
/**
 * @flowWeaver workflow
 * @name testWorkflow
 */
export async function testWorkflow(execute: boolean, params: {}) {
  // @flow-weaver-body-start
  return { onSuccess: true, onFailure: false };
  // @flow-weaver-body-end
}
`;

      // Create the npm node type
      const autoprefixerNodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'npm/autoprefixer/autoprefixer',
        functionName: 'autoprefixer',
        importSource: 'autoprefixer',
        variant: 'FUNCTION',
        inputs: {},
        outputs: { result: { type: 'ANY' } },
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: 'CONJUNCTION',
      };

      const autoprefixerInstance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'npm/autoprefixer/autoprefixerc234b6abd08c',
        nodeType: 'npm/autoprefixer/autoprefixer',
        config: { x: 100, y: 200, label: 'Autoprefixer' },
        metadata: {},
      };

      // Parse initial workflow
      const parsed = parser.parseFromString(sourceCode, '/test/workflow.ts');
      expect(parsed.errors).toHaveLength(0);
      expect(parsed.workflows).toHaveLength(1);

      let workflow = parsed.workflows[0];

      // Add node type and instance
      const nodeTypesBeforeAdd = workflow.nodeTypes.length;
      workflow = addNodeType(workflow, autoprefixerNodeType);
      workflow = addNode(workflow, autoprefixerInstance);

      // Should have one more node type than before
      expect(workflow.nodeTypes).toHaveLength(nodeTypesBeforeAdd + 1);
      expect(workflow.instances).toHaveLength(1);

      // Verify the npm node type exists
      const npmNodeType = workflow.nodeTypes.find(nt => nt.name === 'npm/autoprefixer/autoprefixer');
      expect(npmNodeType).toBeDefined();
      expect(npmNodeType?.importSource).toBe('autoprefixer');

      // Generate new code
      const generated = generateInPlace(sourceCode, workflow);
      expect(generated.hasChanges).toBe(true);

      // Verify the generated code contains the npm node call
      // This proves the code generator can now find npm node types (the main bug fix)
      expect(generated.code).toContain('autoprefixer(');
      expect(generated.code).toContain('npm_autoprefixer_autoprefixerc234b6abd08cResult');

      // Verify no "type not found" skip comment
      expect(generated.code).not.toContain("type 'npm/autoprefixer/autoprefixer' not found");
    });
  });
});
