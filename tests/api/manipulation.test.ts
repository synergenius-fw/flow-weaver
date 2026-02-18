/**
 * Comprehensive tests for Manipulation API
 * Tests all 27 manipulation functions with various scenarios
 */

import {
  // Workflow operations
  cloneWorkflow,
  setWorkflowDescription,
  // Node type operations
  addNodeType,
  removeNodeType,
  updateNodeType,
  getNodeType,
  hasNodeType,
  listNodeTypes,
  // Node instance operations
  addNode,
  removeNode,
  renameNode,
  updateNode,
  addNodes,
  removeNodes,
  setNodeConfig,
  setNodePosition,
  setNodeMinimized,
  setNodeSize,
  setNodeLabel,
  // Workflow metadata operations
  setWorkflowMetadata,
  setOutputFileType,
  // Connection operations
  addConnection,
  removeConnection,
  removeAllConnections,
  reconnect,
  addConnections,
  replaceConnections,
  // Scope operations
  createScope,
  removeScope,
  addToScope,
  removeFromScope,
  moveToScope,
  // Port operations
  swapPortOrder,
  swapNodeInstancePortOrder,
  setStartExitPorts,
  setInstancePortConfigs,
} from '../../src/api/manipulation';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST } from '../../src/ast/types';
import {
  createSimpleWorkflow as createTestWorkflow,
  createWorkflowWithBypass as createTestWorkflowWithBypass,
  createMultiInputNodeType as createSampleNodeType,
  createNodeInstance as createSampleNode,
  createNodeInstance,
} from '../helpers/test-fixtures';

// ============================================================================
// WORKFLOW-LEVEL OPERATIONS
// ============================================================================

describe('Manipulation API - Workflow Operations', () => {
  describe('cloneWorkflow', () => {
    it('should create deep copy of workflow', () => {
      const original = createTestWorkflow();
      const clone = cloneWorkflow(original);

      expect(clone).not.toBe(original); // Different object
      expect(clone).toEqual(original); // Same content
      expect(clone.instances).not.toBe(original.instances); // Deep copy
    });

    it('should preserve all workflow properties', () => {
      const original = createTestWorkflow();
      original.description = 'Test description';
      original.ui = { disablePan: true };

      const clone = cloneWorkflow(original);

      expect(clone.description).toBe('Test description');
      expect(clone.ui?.disablePan).toBe(true);
    });
  });

  describe('setWorkflowDescription', () => {
    it('should set workflow description', () => {
      const workflow = createTestWorkflow();
      const result = setWorkflowDescription(workflow, 'New description');

      expect(result.description).toBe('New description');
      expect(workflow.description).toBeUndefined(); // Original unchanged
    });

    it('should preserve other workflow properties', () => {
      const workflow = createTestWorkflow();
      workflow.ui = { disablePan: true };

      const result = setWorkflowDescription(workflow, 'Test');

      expect(result.ui?.disablePan).toBe(true);
      expect(result.instances).toHaveLength(1);
    });
  });
});

// ============================================================================
// NODE TYPE OPERATIONS
// ============================================================================

describe('Manipulation API - Node Type Operations', () => {
  describe('addNodeType', () => {
    it('should add node type to workflow', () => {
      const workflow = createTestWorkflow();
      const newType = createSampleNodeType('newProcessor');

      const result = addNodeType(workflow, newType);

      expect(result.nodeTypes).toHaveLength(2);
      expect(result.nodeTypes[1]).toEqual(newType);
      expect(workflow.nodeTypes).toHaveLength(1); // Original unchanged
    });

    it('should return unchanged AST on duplicate node type name (idempotent)', () => {
      const workflow = createTestWorkflow();
      const duplicate = createSampleNodeType('processor'); // Already exists

      // Idempotent: returns the same AST object when duplicate is detected
      const result = addNodeType(workflow, duplicate);
      expect(result).toBe(workflow); // Same object reference
      expect(result.nodeTypes).toHaveLength(1); // No duplicate added
    });
  });

  describe('removeNodeType', () => {
    it('should remove node type from workflow', () => {
      const workflow = createTestWorkflow();
      // Add a type that's not referenced by any instance
      const withExtra = addNodeType(workflow, createSampleNodeType('unused'));

      const result = removeNodeType(withExtra, 'unused');

      expect(result.nodeTypes).toHaveLength(1);
      expect(result.nodeTypes[0].name).toBe('processor');
    });

    it('should throw when removing node type with instances', () => {
      const workflow = createTestWorkflow();

      expect(() => removeNodeType(workflow, 'processor')).toThrow(/instance.*still reference/);
    });

    it("should throw when node type doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => removeNodeType(workflow, 'nonExistent')).toThrow(/not found/);
    });
  });

  describe('updateNodeType', () => {
    it('should update node type properties', () => {
      const workflow = createTestWorkflow();

      const result = updateNodeType(workflow, 'processor', {
        label: 'Data Processor',
        description: 'Processes data',
      });

      expect(result.nodeTypes[0].label).toBe('Data Processor');
      expect(result.nodeTypes[0].description).toBe('Processes data');
      expect(workflow.nodeTypes[0].label).toBeUndefined(); // Original unchanged
    });

    it("should throw when node type doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => updateNodeType(workflow, 'nonExistent', { label: 'Test' })).toThrow(/not found/);
    });
  });

  describe('getNodeType', () => {
    it('should return node type when it exists', () => {
      const workflow = createTestWorkflow();

      const nodeType = getNodeType(workflow, 'processor');

      expect(nodeType).toBeDefined();
      expect(nodeType?.name).toBe('processor');
    });

    it("should return undefined when node type doesn't exist", () => {
      const workflow = createTestWorkflow();

      const nodeType = getNodeType(workflow, 'nonExistent');

      expect(nodeType).toBeUndefined();
    });
  });

  describe('hasNodeType', () => {
    it('should return true when node type exists', () => {
      const workflow = createTestWorkflow();

      expect(hasNodeType(workflow, 'processor')).toBe(true);
    });

    it("should return false when node type doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(hasNodeType(workflow, 'nonExistent')).toBe(false);
    });
  });

  describe('listNodeTypes', () => {
    it('should return array of all node types', () => {
      const workflow = createTestWorkflow();

      const types = listNodeTypes(workflow);

      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('processor');
    });

    it('should return copy of array (not reference)', () => {
      const workflow = createTestWorkflow();

      const types = listNodeTypes(workflow);
      types.push(createSampleNodeType('extra'));

      expect(workflow.nodeTypes).toHaveLength(1); // Original unchanged
    });
  });
});

// ============================================================================
// NODE INSTANCE OPERATIONS
// ============================================================================

describe('Manipulation API - Node Instance Operations', () => {
  describe('addNode', () => {
    it('should add node instance to workflow', () => {
      const workflow = createTestWorkflow();
      const newNode = createSampleNode('node2');

      const result = addNode(workflow, newNode);

      expect(result.instances).toHaveLength(2);
      expect(result.instances[1]).toEqual(newNode);
      expect(workflow.instances).toHaveLength(1); // Original unchanged
    });

    it('should throw on duplicate node ID', () => {
      const workflow = createTestWorkflow();
      const duplicate = createSampleNode('node1'); // Already exists

      expect(() => addNode(workflow, duplicate)).toThrow(/already exists/);
    });

    it('should allow adding node with nonexistent type (eventual consistency)', () => {
      // addNode uses eventual consistency - doesn't throw for nonexistent types
      // Diagnostics will catch INVALID_NODE_TYPE if needed
      const workflow = createTestWorkflow();
      const invalidNode = createSampleNode('node2', 'nonExistentType');

      const result = addNode(workflow, invalidNode);
      expect(result.instances).toHaveLength(2);
      expect(result.instances[1].nodeType).toBe('nonExistentType');
    });
  });

  describe('removeNode', () => {
    it('should remove node and its connections by default', () => {
      const workflow = createTestWorkflowWithBypass();

      const result = removeNode(workflow, 'node1');

      expect(result.instances).toHaveLength(0);
      expect(result.connections).toHaveLength(1); // Only bypass connection remains
    });

    it('should remove node without connections when specified', () => {
      const workflow = createTestWorkflow();

      // removeConnections: false leaves connections intact (even if dangling)
      // This is intentional - the user explicitly opted to keep connections
      const result = removeNode(workflow, 'node1', { removeConnections: false });

      // Node removed but connections remain (dangling references)
      expect(result.instances.find((n) => n.id === 'node1')).toBeUndefined();
      // Original connections still reference the removed node
      expect(result.connections.length).toBeGreaterThan(0);
    });

    it("should throw when node doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => removeNode(workflow, 'nonExistent')).toThrow(/not found/);
    });

    it('should remove node from scopes', () => {
      let workflow = createTestWorkflowWithBypass();
      workflow = createScope(workflow, 'testScope', ['node1']);

      const result = removeNode(workflow, 'node1');

      expect(result.scopes?.testScope).toEqual([]);
    });
  });

  describe('renameNode', () => {
    it('should rename node and update all connections', () => {
      const workflow = createTestWorkflow();

      const result = renameNode(workflow, 'node1', 'renamedNode');

      expect(result.instances[0].id).toBe('renamedNode');
      expect(result.connections[0].to.node).toBe('renamedNode');
      expect(result.connections[1].from.node).toBe('renamedNode');
      expect(workflow.instances[0].id).toBe('node1'); // Original unchanged
    });

    it('should update scopes when renaming node', () => {
      let workflow = createTestWorkflow();
      workflow = createScope(workflow, 'testScope', ['node1']);

      const result = renameNode(workflow, 'node1', 'renamedNode');

      expect(result.scopes?.testScope).toEqual(['renamedNode']);
    });

    it("should throw when old ID doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => renameNode(workflow, 'nonExistent', 'newName')).toThrow(/not found/);
    });

    it('should throw when new ID already exists', () => {
      const workflow = addNode(createTestWorkflow(), createSampleNode('node2'));

      expect(() => renameNode(workflow, 'node1', 'node2')).toThrow(/already exists/);
    });
  });

  describe('updateNode', () => {
    it('should update node properties', () => {
      const workflow = createTestWorkflow();

      const result = updateNode(workflow, 'node1', {
        config: { x: 100, y: 200, label: 'Main Node' },
      });

      expect(result.instances[0].config?.x).toBe(100);
      expect(result.instances[0].config?.y).toBe(200);
      expect(result.instances[0].config?.label).toBe('Main Node');
      expect(workflow.instances[0].config).toBeUndefined(); // Original unchanged
    });

    it("should throw when node doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => updateNode(workflow, 'nonExistent', { config: {} })).toThrow(/not found/);
    });
  });

  describe('addNodes', () => {
    it('should add multiple nodes at once', () => {
      const workflow = createTestWorkflow();
      const nodes = [createSampleNode('node2'), createSampleNode('node3')];

      const result = addNodes(workflow, nodes);

      expect(result.instances).toHaveLength(3);
      expect(result.instances[1].id).toBe('node2');
      expect(result.instances[2].id).toBe('node3');
    });

    it('should throw if any node has duplicate ID', () => {
      const workflow = createTestWorkflow();
      const nodes = [createSampleNode('node2'), createSampleNode('node1')]; // node1 exists

      expect(() => addNodes(workflow, nodes)).toThrow(/already exists/);
    });
  });

  describe('removeNodes', () => {
    it('should remove multiple nodes at once', () => {
      let workflow = createTestWorkflow();
      workflow = addNode(workflow, createSampleNode('node2'));
      workflow = addNode(workflow, createSampleNode('node3'));

      const result = removeNodes(workflow, ['node2', 'node3']);

      expect(result.instances).toHaveLength(1);
      expect(result.instances[0].id).toBe('node1');
    });

    it('should remove connections for all removed nodes', () => {
      let workflow = createTestWorkflowWithBypass();
      workflow = addNode(workflow, createSampleNode('node2'));
      workflow = addConnection(workflow, 'node1.output', 'node2.input');

      const result = removeNodes(workflow, ['node1', 'node2']);

      expect(result.connections).toHaveLength(1); // Only bypass connection remains
    });

    it("should throw if any node doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => removeNodes(workflow, ['node1', 'nonExistent'])).toThrow(/not found/);
    });
  });

  describe('setNodeConfig', () => {
    it('should set node configuration', () => {
      const workflow = createTestWorkflow();
      const config = { x: 150, y: 250, label: 'Test' };

      const result = setNodeConfig(workflow, 'node1', config);

      expect(result.instances[0].config).toEqual(config);
    });
  });

  describe('setNodePosition', () => {
    it('should set node position', () => {
      const workflow = createTestWorkflow();

      const result = setNodePosition(workflow, 'node1', 300, 400);

      expect(result.instances[0].config?.x).toBe(300);
      expect(result.instances[0].config?.y).toBe(400);
    });

    it('should preserve existing config properties', () => {
      let workflow = createTestWorkflow();
      workflow = setNodeConfig(workflow, 'node1', { label: 'Test' });

      const result = setNodePosition(workflow, 'node1', 100, 200);

      expect(result.instances[0].config?.label).toBe('Test');
      expect(result.instances[0].config?.x).toBe(100);
    });
  });

  describe('setNodeMinimized', () => {
    it('should set minimized to true', () => {
      const workflow = createTestWorkflow();

      const result = setNodeMinimized(workflow, 'node1', true);

      expect(result.instances[0].config?.minimized).toBe(true);
    });

    it('should set minimized to false', () => {
      let workflow = createTestWorkflow();
      workflow = setNodeMinimized(workflow, 'node1', true);

      const result = setNodeMinimized(workflow, 'node1', false);

      expect(result.instances[0].config?.minimized).toBe(false);
    });

    it('should create config object if not exists', () => {
      const workflow = createTestWorkflow();
      // Ensure node has no config (fixture doesn't set config by default)
      expect(workflow.instances[0].config).toBeUndefined();

      const result = setNodeMinimized(workflow, 'node1', true);

      expect(result.instances[0].config).toBeDefined();
      expect(result.instances[0].config?.minimized).toBe(true);
    });

    it('should preserve existing config properties', () => {
      let workflow = createTestWorkflow();
      workflow = setNodeConfig(workflow, 'node1', { label: 'Test Label' });

      const result = setNodeMinimized(workflow, 'node1', true);

      expect(result.instances[0].config?.label).toBe('Test Label');
      expect(result.instances[0].config?.minimized).toBe(true);
    });

    it("should throw when node doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => setNodeMinimized(workflow, 'nonexistent', true)).toThrow();
    });

    it('should not mutate original workflow (immutability)', () => {
      const workflow = createTestWorkflow();
      const originalInstances = workflow.instances;

      setNodeMinimized(workflow, 'node1', true);

      expect(workflow.instances).toBe(originalInstances);
      expect(workflow.instances[0].config?.minimized).toBeUndefined();
    });
  });

  describe('setNodeLabel', () => {
    it('should set node label', () => {
      const workflow = createTestWorkflow();

      const result = setNodeLabel(workflow, 'node1', 'My Custom Label');

      expect(result.instances[0].config?.label).toBe('My Custom Label');
    });

    it('should create config object if not exists', () => {
      const workflow = createTestWorkflow();
      expect(workflow.instances[0].config).toBeUndefined();

      const result = setNodeLabel(workflow, 'node1', 'Test Label');

      expect(result.instances[0].config).toBeDefined();
      expect(result.instances[0].config?.label).toBe('Test Label');
    });

    it('should preserve existing config properties', () => {
      let workflow = createTestWorkflow();
      workflow = setNodePosition(workflow, 'node1', 100, 200);

      const result = setNodeLabel(workflow, 'node1', 'Labeled Node');

      expect(result.instances[0].config?.x).toBe(100);
      expect(result.instances[0].config?.y).toBe(200);
      expect(result.instances[0].config?.label).toBe('Labeled Node');
    });

    it('should clear label when set to empty string', () => {
      let workflow = createTestWorkflow();
      workflow = setNodeLabel(workflow, 'node1', 'Initial Label');

      const result = setNodeLabel(workflow, 'node1', '');

      expect(result.instances[0].config?.label).toBeUndefined();
    });

    it('should clear label when set to undefined', () => {
      let workflow = createTestWorkflow();
      workflow = setNodeLabel(workflow, 'node1', 'Initial Label');

      const result = setNodeLabel(workflow, 'node1', undefined);

      expect(result.instances[0].config?.label).toBeUndefined();
    });

    it("should throw when node doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => setNodeLabel(workflow, 'nonexistent', 'Label')).toThrow();
    });

    it('should not mutate original workflow (immutability)', () => {
      const workflow = createTestWorkflow();

      setNodeLabel(workflow, 'node1', 'New Label');

      expect(workflow.instances[0].config?.label).toBeUndefined();
    });
  });

  describe('setNodeSize', () => {
    it('should set width and height', () => {
      const workflow = createTestWorkflow();

      const result = setNodeSize(workflow, 'node1', 200, 150);

      expect(result.instances[0].config?.width).toBe(200);
      expect(result.instances[0].config?.height).toBe(150);
    });

    it('should handle zero dimensions', () => {
      const workflow = createTestWorkflow();

      const result = setNodeSize(workflow, 'node1', 0, 0);

      expect(result.instances[0].config?.width).toBe(0);
      expect(result.instances[0].config?.height).toBe(0);
    });

    it('should create config object if not exists', () => {
      const workflow = createTestWorkflow();

      const result = setNodeSize(workflow, 'node1', 100, 80);

      expect(result.instances[0].config).toBeDefined();
      expect(result.instances[0].config?.width).toBe(100);
      expect(result.instances[0].config?.height).toBe(80);
    });

    it('should preserve existing config properties', () => {
      let workflow = createTestWorkflow();
      workflow = setNodeConfig(workflow, 'node1', { label: 'Sized Node' });

      const result = setNodeSize(workflow, 'node1', 250, 180);

      expect(result.instances[0].config?.label).toBe('Sized Node');
      expect(result.instances[0].config?.width).toBe(250);
      expect(result.instances[0].config?.height).toBe(180);
    });

    it("should throw when node doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => setNodeSize(workflow, 'nonexistent', 100, 100)).toThrow();
    });

    it('should not mutate original workflow (immutability)', () => {
      const workflow = createTestWorkflow();

      setNodeSize(workflow, 'node1', 300, 200);

      expect(workflow.instances[0].config?.width).toBeUndefined();
      expect(workflow.instances[0].config?.height).toBeUndefined();
    });
  });
});

// ============================================================================
// WORKFLOW METADATA OPERATIONS
// ============================================================================

describe('Manipulation API - Workflow Metadata Operations', () => {
  describe('setWorkflowMetadata', () => {
    it('should set forceAsync metadata', () => {
      const workflow = createTestWorkflow();

      const result = setWorkflowMetadata(workflow, { forceAsync: true });

      expect(result.metadata?.forceAsync).toBe(true);
    });

    it('should merge with existing metadata', () => {
      let workflow = createTestWorkflow();
      workflow = setWorkflowMetadata(workflow, { forceAsync: true });

      const result = setWorkflowMetadata(workflow, { layout: { zoom: 1.5 } } as any);

      expect(result.metadata?.forceAsync).toBe(true);
      expect((result.metadata as any)?.layout?.zoom).toBe(1.5);
    });

    it('should not mutate original workflow (immutability)', () => {
      const workflow = createTestWorkflow();
      const originalMetadata = workflow.metadata;

      setWorkflowMetadata(workflow, { forceAsync: true });

      expect(workflow.metadata).toBe(originalMetadata);
    });
  });

  describe('setOutputFileType', () => {
    it('should change .ts to .tsx', () => {
      const workflow = createTestWorkflow();
      // Ensure source file ends with .ts
      workflow.sourceFile = '/path/to/workflow.ts';

      const result = setOutputFileType(workflow, 'tsx');

      expect(result.sourceFile).toBe('/path/to/workflow.tsx');
    });

    it('should change .js to .jsx', () => {
      const workflow = createTestWorkflow();
      workflow.sourceFile = '/path/to/workflow.js';

      const result = setOutputFileType(workflow, 'jsx');

      expect(result.sourceFile).toBe('/path/to/workflow.jsx');
    });

    it('should change .tsx to .ts', () => {
      const workflow = createTestWorkflow();
      workflow.sourceFile = '/path/to/workflow.tsx';

      const result = setOutputFileType(workflow, 'ts');

      expect(result.sourceFile).toBe('/path/to/workflow.ts');
    });

    it('should handle files with dots in name', () => {
      const workflow = createTestWorkflow();
      workflow.sourceFile = '/path/to/my.workflow.file.ts';

      const result = setOutputFileType(workflow, 'jsx');

      expect(result.sourceFile).toBe('/path/to/my.workflow.file.jsx');
    });

    it('should not mutate original workflow (immutability)', () => {
      const workflow = createTestWorkflow();
      workflow.sourceFile = '/path/to/workflow.ts';
      const originalSourceFile = workflow.sourceFile;

      setOutputFileType(workflow, 'tsx');

      expect(workflow.sourceFile).toBe(originalSourceFile);
    });
  });
});

// ============================================================================
// CONNECTION OPERATIONS
// ============================================================================

describe('Manipulation API - Connection Operations', () => {
  describe('addConnection', () => {
    it('should add connection using string format', () => {
      let workflow = createTestWorkflow();
      workflow = addNode(workflow, createSampleNode('node2'));

      const result = addConnection(workflow, 'node1.output', 'node2.input');

      expect(result.connections).toHaveLength(3);
      expect(result.connections[2].from).toEqual({ node: 'node1', port: 'output' });
      expect(result.connections[2].to).toEqual({ node: 'node2', port: 'input' });
    });

    it('should add connection using object format', () => {
      let workflow = createTestWorkflow();
      workflow = addNode(workflow, createSampleNode('node2'));

      const result = addConnection(
        workflow,
        { node: 'node1', port: 'output' },
        { node: 'node2', port: 'input' }
      );

      expect(result.connections).toHaveLength(3);
    });

    it('should throw on duplicate connection', () => {
      const workflow = createTestWorkflow();

      expect(() => addConnection(workflow, 'Start.x', 'node1.input')).toThrow(/already exists/);
    });

    it('should throw on invalid port reference format', () => {
      const workflow = createTestWorkflow();

      expect(() => addConnection(workflow, 'invalid', 'node1.input')).toThrow(
        /Invalid port reference/
      );
    });
  });

  describe('removeConnection', () => {
    it('should remove specific connection', () => {
      const workflow = createTestWorkflow();

      const result = removeConnection(workflow, 'Start.x', 'node1.input');

      expect(result.connections).toHaveLength(1);
      expect(result.connections[0].from.node).toBe('node1');
    });

    it("should throw when connection doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => removeConnection(workflow, 'Start.x', 'node2.input')).toThrow(/not found/);
    });
  });

  describe('removeAllConnections', () => {
    it('should remove all connections for a node', () => {
      const workflow = createTestWorkflowWithBypass();

      const result = removeAllConnections(workflow, 'node1');

      expect(result.connections).toHaveLength(1); // Only bypass connection remains
    });

    it('should remove connections for specific port only', () => {
      const workflow = createTestWorkflow();

      const result = removeAllConnections(workflow, 'node1', 'input');

      expect(result.connections).toHaveLength(1);
      expect(result.connections[0].from.node).toBe('node1'); // Output connection remains
    });
  });

  describe('reconnect', () => {
    it('should change connection target', () => {
      let workflow = createTestWorkflow();
      workflow = addNode(workflow, createSampleNode('node2'));

      const result = reconnect(workflow, 'Start.x', 'node1.input', 'node2.input');

      expect(result.connections[0].to).toEqual({ node: 'node2', port: 'input' });
      expect(workflow.connections[0].to.node).toBe('node1'); // Original unchanged
    });

    it("should throw when connection doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => reconnect(workflow, 'Start.y', 'node1.input', 'node1.output')).toThrow(
        /not found/
      );
    });
  });

  describe('addConnections', () => {
    it('should add multiple connections at once', () => {
      let workflow = createTestWorkflow();
      workflow = addNode(workflow, createSampleNode('node2'));

      const connections = [
        {
          type: 'Connection' as const,
          from: { node: 'node1', port: 'output' },
          to: { node: 'node2', port: 'input' },
        },
      ];

      const result = addConnections(workflow, connections);

      expect(result.connections).toHaveLength(3);
    });

    it('should skip duplicate connections', () => {
      const workflow = createTestWorkflow();

      const connections = [
        {
          type: 'Connection' as const,
          from: { node: 'Start', port: 'x' },
          to: { node: 'node1', port: 'input' },
        },
      ];

      const result = addConnections(workflow, connections);

      expect(result.connections).toHaveLength(2); // No duplicate added
    });
  });

  describe('replaceConnections', () => {
    it('should replace all connections for a node', () => {
      let workflow = createTestWorkflowWithBypass();
      workflow = addNode(workflow, createSampleNode('node2'));

      const newConnections = [
        {
          type: 'Connection' as const,
          from: { node: 'node1', port: 'output' },
          to: { node: 'node2', port: 'input' },
        },
      ];

      const result = replaceConnections(workflow, 'node1', newConnections);

      // Old connections to/from node1 removed, new one added, bypass remains
      expect(result.connections.some((c) => c.from.node === 'Start' && c.to.node === 'Exit')).toBe(
        true
      );
      expect(result.connections.some((c) => c.to.node === 'node2')).toBe(true);
    });
  });
});

// ============================================================================
// SCOPE OPERATIONS
// ============================================================================

describe('Manipulation API - Scope Operations', () => {
  describe('createScope', () => {
    it('should create new scope with nodes', () => {
      const workflow = createTestWorkflow();

      const result = createScope(workflow, 'testScope', ['node1']);

      expect(result.scopes).toBeDefined();
      expect(result.scopes!.testScope).toEqual(['node1']);
      expect(result.instances[0].parent).toEqual({ id: 'testScope', scope: '' });
    });

    it('should throw when scope already exists', () => {
      let workflow = createTestWorkflow();
      workflow = createScope(workflow, 'testScope', ['node1']);

      expect(() => createScope(workflow, 'testScope', [])).toThrow(/already exists/);
    });

    it("should throw when node doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => createScope(workflow, 'testScope', ['nonExistent'])).toThrow(/not found/);
    });
  });

  describe('removeScope', () => {
    it('should remove scope and clear parent scope from nodes', () => {
      let workflow = createTestWorkflow();
      workflow = createScope(workflow, 'testScope', ['node1']);

      const result = removeScope(workflow, 'testScope');

      expect(result.scopes?.testScope).toBeUndefined();
      expect(result.instances[0].parent).toBeUndefined();
    });

    it("should throw when scope doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => removeScope(workflow, 'nonExistent')).toThrow(/not found/);
    });
  });

  describe('addToScope', () => {
    it('should add node to existing scope', () => {
      let workflow = createTestWorkflow();
      workflow = addNode(workflow, createSampleNode('node2'));
      workflow = createScope(workflow, 'testScope', ['node1']);

      const result = addToScope(workflow, 'testScope', 'node2');

      expect(result.scopes!.testScope).toEqual(['node1', 'node2']);
      expect(result.instances[1].parent).toEqual({ id: 'testScope', scope: '' });
    });

    it('should not add duplicate node to scope', () => {
      let workflow = createTestWorkflow();
      workflow = createScope(workflow, 'testScope', ['node1']);

      const result = addToScope(workflow, 'testScope', 'node1');

      expect(result.scopes!.testScope).toEqual(['node1']); // Still just one
    });

    it("should throw when scope doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => addToScope(workflow, 'nonExistent', 'node1')).toThrow(/not found/);
    });
  });

  describe('removeFromScope', () => {
    it('should remove node from scope', () => {
      let workflow = createTestWorkflow();
      workflow = createScope(workflow, 'testScope', ['node1']);

      const result = removeFromScope(workflow, 'testScope', 'node1');

      expect(result.scopes!.testScope).toEqual([]);
      expect(result.instances[0].parent).toBeUndefined();
    });

    it("should throw when scope doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => removeFromScope(workflow, 'nonExistent', 'node1')).toThrow(/not found/);
    });
  });

  describe('moveToScope', () => {
    it('should move node from one scope to another', () => {
      let workflow = createTestWorkflow();
      workflow = createScope(workflow, 'scope1', ['node1']);
      workflow = createScope(workflow, 'scope2', []);

      const result = moveToScope(workflow, 'node1', 'scope2');

      expect(result.scopes!.scope1).toEqual([]);
      expect(result.scopes!.scope2).toEqual(['node1']);
      expect(result.instances[0].parent).toEqual({ id: 'scope2', scope: '' });
    });

    it("should throw when target scope doesn't exist", () => {
      let workflow = createTestWorkflow();
      workflow = createScope(workflow, 'scope1', ['node1']);

      expect(() => moveToScope(workflow, 'node1', 'nonExistent')).toThrow(/not found/);
    });

    it("should throw when node doesn't exist", () => {
      let workflow = createTestWorkflow();
      workflow = createScope(workflow, 'scope1', []);

      expect(() => moveToScope(workflow, 'nonExistent', 'scope1')).toThrow(/not found/);
    });
  });
});

// ============================================================================
// PORT OPERATIONS
// ============================================================================

describe('Manipulation API - Port Operations', () => {
  describe('swapPortOrder', () => {
    it('should throw error for non-Start/Exit nodes', () => {
      const workflow = createTestWorkflow();

      // Add a node type
      const nodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'TestNode',
        functionName: 'testNode',
        inputs: {
          input1: { dataType: 'NUMBER', optional: true, metadata: { order: 0 } },
          input2: { dataType: 'NUMBER', optional: true, metadata: { order: 1 } },
        },
        outputs: {
          output: { dataType: 'NUMBER' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const workflowWithNodeType = addNodeType(workflow, nodeType);

      // Should throw error because TestNode is not Start or Exit
      expect(() => swapPortOrder(workflowWithNodeType, 'TestNode', 'input1', 'input2')).toThrow(
        /only supports Start\/Exit nodes/
      );
    });

    it('should swap order of Start ports (workflow inputs)', () => {
      const workflow: TWorkflowAST = {
        type: 'Workflow',
        name: 'testWorkflow',
        functionName: 'testWorkflow',
        sourceFile: 'test.ts',
        startPorts: {
          param1: { dataType: 'NUMBER', metadata: { order: 0 } },
          param2: { dataType: 'NUMBER', metadata: { order: 1 } },
          param3: { dataType: 'STRING', metadata: { order: 2 } },
        },
        exitPorts: {
          result: { dataType: 'NUMBER' },
        },
        instances: [],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'param1' },
            to: { node: 'Exit', port: 'result' },
          },
        ],
        nodeTypes: [],
        scopes: {},
        imports: [],
      };

      const result = swapPortOrder(workflow, 'Start', 'param1', 'param3');

      expect(result.startPorts!.param1.metadata?.order).toBe(2);
      expect(result.startPorts!.param2.metadata?.order).toBe(1); // Unchanged
      expect(result.startPorts!.param3.metadata?.order).toBe(0);
    });

    it('should swap order of Exit ports (workflow outputs)', () => {
      const workflow: TWorkflowAST = {
        type: 'Workflow',
        name: 'testWorkflow',
        functionName: 'testWorkflow',
        sourceFile: 'test.ts',
        startPorts: {
          param: { dataType: 'NUMBER' },
        },
        exitPorts: {
          result1: { dataType: 'NUMBER', metadata: { order: 0 } },
          result2: { dataType: 'STRING', metadata: { order: 1 } },
          result3: { dataType: 'BOOLEAN', metadata: { order: 2 } },
        },
        instances: [],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'param' },
            to: { node: 'Exit', port: 'result1' },
          },
        ],
        nodeTypes: [],
        scopes: {},
        imports: [],
      };

      const result = swapPortOrder(workflow, 'Exit', 'result1', 'result2');

      expect(result.exitPorts!.result1.metadata?.order).toBe(1);
      expect(result.exitPorts!.result2.metadata?.order).toBe(0);
      expect(result.exitPorts!.result3.metadata?.order).toBe(2); // Unchanged
    });
  });

  describe('swapNodeInstancePortOrder', () => {
    it('should swap order of input ports on an instance', () => {
      const workflow = createTestWorkflow();

      // Add a node type with multiple input ports
      const nodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'TestNode',
        functionName: 'testNode',
        inputs: {
          input1: { dataType: 'NUMBER', optional: true, metadata: { order: 0 } },
          input2: { dataType: 'NUMBER', optional: true, metadata: { order: 1 } },
          input3: { dataType: 'NUMBER', optional: true, metadata: { order: 2 } },
        },
        outputs: {
          output: { dataType: 'NUMBER' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      let workflowWithNodeType = addNodeType(workflow, nodeType);
      const testInstance = createNodeInstance('testInstance', 'testNode');
      workflowWithNodeType = addNode(workflowWithNodeType, testInstance);

      const result = swapNodeInstancePortOrder(
        workflowWithNodeType,
        'testInstance',
        'input1',
        'input2'
      );

      // Check that instance config was created
      const instance = result.instances.find((inst) => inst.id === 'testInstance');
      expect(instance!.config?.portConfigs).toBeDefined();
      expect(instance!.config!.portConfigs!.length).toBeGreaterThan(0);

      // Check that port orders were swapped in instance config
      const input1Config = instance!.config!.portConfigs!.find(
        (pc) => pc.portName === 'input1'
      );
      const input2Config = instance!.config!.portConfigs!.find(
        (pc) => pc.portName === 'input2'
      );

      expect(input1Config?.order).toBe(1); // input2's original order
      expect(input2Config?.order).toBe(0); // input1's original order

      // CRITICAL: Node type should remain unchanged
      const updatedNodeType = result.nodeTypes.find((nt) => nt.name === 'TestNode');
      expect(updatedNodeType!.inputs!.input1.metadata?.order).toBe(0); // Unchanged
      expect(updatedNodeType!.inputs!.input2.metadata?.order).toBe(1); // Unchanged
      expect(updatedNodeType!.inputs!.input3.metadata?.order).toBe(2); // Unchanged
    });

    it('should swap order of output ports on an instance', () => {
      const workflow = createTestWorkflow();

      const nodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'TestNode',
        functionName: 'testNode',
        inputs: {
          input: { dataType: 'NUMBER', optional: true },
        },
        outputs: {
          output1: { dataType: 'NUMBER', metadata: { order: 0 } },
          output2: { dataType: 'NUMBER', metadata: { order: 1 } },
          output3: { dataType: 'NUMBER', metadata: { order: 2 } },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      let workflowWithNodeType = addNodeType(workflow, nodeType);
      const testInstance = createNodeInstance('testInstance', 'testNode');
      workflowWithNodeType = addNode(workflowWithNodeType, testInstance);

      const result = swapNodeInstancePortOrder(
        workflowWithNodeType,
        'testInstance',
        'output2',
        'output3'
      );

      const instance = result.instances.find((inst) => inst.id === 'testInstance');
      const output2Config = instance!.config!.portConfigs!.find(
        (pc) => pc.portName === 'output2'
      );
      const output3Config = instance!.config!.portConfigs!.find(
        (pc) => pc.portName === 'output3'
      );

      expect(output2Config?.order).toBe(2); // output3's original order
      expect(output3Config?.order).toBe(1); // output2's original order

      // Node type should remain unchanged
      const updatedNodeType = result.nodeTypes.find((nt) => nt.name === 'TestNode');
      expect(updatedNodeType!.outputs!.output1.metadata?.order).toBe(0); // Unchanged
      expect(updatedNodeType!.outputs!.output2.metadata?.order).toBe(1); // Unchanged
      expect(updatedNodeType!.outputs!.output3.metadata?.order).toBe(2); // Unchanged
    });

    it('should handle ports without existing order metadata', () => {
      const workflow = createTestWorkflow();

      const nodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'TestNode',
        functionName: 'testNode',
        inputs: {
          input1: { dataType: 'NUMBER', optional: true }, // No metadata - implicit order 0
          input2: { dataType: 'NUMBER', optional: true, metadata: { order: 1 } },
        },
        outputs: {},
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      let workflowWithNodeType = addNodeType(workflow, nodeType);
      const testInstance = createNodeInstance('testInstance', 'testNode');
      workflowWithNodeType = addNode(workflowWithNodeType, testInstance);

      const result = swapNodeInstancePortOrder(
        workflowWithNodeType,
        'testInstance',
        'input1',
        'input2'
      );

      const instance = result.instances.find((inst) => inst.id === 'testInstance');
      const input1Config = instance!.config!.portConfigs!.find(
        (pc) => pc.portName === 'input1'
      );
      const input2Config = instance!.config!.portConfigs!.find(
        (pc) => pc.portName === 'input2'
      );

      // Visual order BEFORE swap (sorted by explicit then implicit):
      // - input2: explicit order=1, so it sorts first → visual position 0
      // - input1: no explicit order (Infinity), so it sorts last → visual position 1
      // After swap, they exchange visual positions:
      expect(input1Config?.order).toBe(0); // Swapped from position 1 to position 0
      expect(input2Config?.order).toBe(1); // Swapped from position 0 to position 1
    });

    it("should throw when instance doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => swapNodeInstancePortOrder(workflow, 'NonExistent', 'port1', 'port2')).toThrow(
        /not found/
      );
    });

    it("should throw when ports don't exist", () => {
      const workflow = createTestWorkflow();

      const nodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'TestNode',
        functionName: 'testNode',
        inputs: {
          input1: { dataType: 'NUMBER', optional: true },
        },
        outputs: {},
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      let workflowWithNodeType = addNodeType(workflow, nodeType);
      const testInstance = createNodeInstance('testInstance', 'testNode');
      workflowWithNodeType = addNode(workflowWithNodeType, testInstance);

      expect(() =>
        swapNodeInstancePortOrder(workflowWithNodeType, 'testInstance', 'input1', 'nonExistent')
      ).toThrow(/not found/);
    });

    it('should preserve original workflow immutably', () => {
      const workflow = createTestWorkflow();

      const nodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'TestNode',
        functionName: 'testNode',
        inputs: {
          input1: { dataType: 'NUMBER', optional: true, metadata: { order: 0 } },
          input2: { dataType: 'NUMBER', optional: true, metadata: { order: 1 } },
        },
        outputs: {},
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      let workflowWithNodeType = addNodeType(workflow, nodeType);
      const testInstance = createNodeInstance('testInstance', 'testNode');
      workflowWithNodeType = addNode(workflowWithNodeType, testInstance);

      const result = swapNodeInstancePortOrder(
        workflowWithNodeType,
        'testInstance',
        'input1',
        'input2'
      );

      // Original should be unchanged
      const originalInstance = workflowWithNodeType.instances.find(
        (inst) => inst.id === 'testInstance'
      );
      expect(originalInstance!.config?.portConfigs).toBeUndefined(); // No config before

      // Result should have swapped values in instance config
      const updatedInstance = result.instances.find((inst) => inst.id === 'testInstance');
      const input1Config = updatedInstance!.config!.portConfigs!.find(
        (pc) => pc.portName === 'input1'
      );
      const input2Config = updatedInstance!.config!.portConfigs!.find(
        (pc) => pc.portName === 'input2'
      );

      expect(input1Config?.order).toBe(1);
      expect(input2Config?.order).toBe(0);
    });

    it('should not affect other instances of the same node type', () => {
      const workflow = createTestWorkflow();

      const nodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'TestNode',
        functionName: 'testNode',
        inputs: {
          input1: { dataType: 'NUMBER', optional: true, metadata: { order: 0 } },
          input2: { dataType: 'NUMBER', optional: true, metadata: { order: 1 } },
        },
        outputs: {},
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      let workflowWithNodeType = addNodeType(workflow, nodeType);
      const instance1 = createNodeInstance('instance1', 'testNode');
      workflowWithNodeType = addNode(workflowWithNodeType, instance1);
      const instance2 = createNodeInstance('instance2', 'testNode');
      workflowWithNodeType = addNode(workflowWithNodeType, instance2);

      // Swap ports ONLY on instance1
      const result = swapNodeInstancePortOrder(
        workflowWithNodeType,
        'instance1',
        'input1',
        'input2'
      );

      // Instance1 should have swapped port order
      const resultInstance1 = result.instances.find((inst) => inst.id === 'instance1');
      const instance1Input1Config = resultInstance1!.config!.portConfigs!.find(
        (pc: any) => pc.portName === 'input1'
      );
      const instance1Input2Config = resultInstance1!.config!.portConfigs!.find(
        (pc: any) => pc.portName === 'input2'
      );

      expect(instance1Input1Config?.order).toBe(1);
      expect(instance1Input2Config?.order).toBe(0);

      // Instance2 should have NO port config (still using node type defaults)
      const resultInstance2 = result.instances.find((inst) => inst.id === 'instance2');
      expect(resultInstance2!.config?.portConfigs).toBeUndefined();

      // Node type should remain unchanged
      const nodeTypeResult = result.nodeTypes.find((nt) => nt.name === 'TestNode');
      expect(nodeTypeResult!.inputs!.input1.metadata?.order).toBe(0);
      expect(nodeTypeResult!.inputs!.input2.metadata?.order).toBe(1);
    });
  });

  describe('setStartExitPorts', () => {
    it('should set startPorts on workflow', () => {
      const workflow: TWorkflowAST = {
        type: 'Workflow',
        sourceFile: 'test.ts',
        name: 'test',
        functionName: 'test',
        nodeTypes: [],
        instances: [],
        connections: [],
        startPorts: {
          param1: { dataType: 'STRING' },
        },
        exitPorts: {},
        imports: [],
      };

      const newStartPorts = {
        param1: { dataType: 'STRING' as const, metadata: { order: 1 } },
        param2: { dataType: 'NUMBER' as const, metadata: { order: 0 } },
      };

      const result = setStartExitPorts(workflow, 'Start', newStartPorts);

      expect(result.startPorts).toEqual(newStartPorts);
      expect(result.exitPorts).toEqual({}); // Unchanged
    });

    it('should set exitPorts on workflow', () => {
      const workflow: TWorkflowAST = {
        type: 'Workflow',
        sourceFile: 'test.ts',
        name: 'test',
        functionName: 'test',
        nodeTypes: [],
        instances: [],
        connections: [],
        startPorts: {},
        exitPorts: {
          result1: { dataType: 'STRING' },
        },
        imports: [],
      };

      const newExitPorts = {
        result1: { dataType: 'STRING' as const, metadata: { order: 1 } },
        result2: { dataType: 'BOOLEAN' as const, metadata: { order: 0 } },
      };

      const result = setStartExitPorts(workflow, 'Exit', newExitPorts);

      expect(result.exitPorts).toEqual(newExitPorts);
      expect(result.startPorts).toEqual({}); // Unchanged
    });

    it('should throw for invalid nodeType', () => {
      const workflow = createTestWorkflow();

      expect(() => setStartExitPorts(workflow, 'Invalid' as any, {})).toThrow(
        /must be "Start" or "Exit"/
      );
    });

    it('should be immutable', () => {
      const workflow: TWorkflowAST = {
        type: 'Workflow',
        sourceFile: 'test.ts',
        name: 'test',
        functionName: 'test',
        nodeTypes: [],
        instances: [],
        connections: [],
        startPorts: { param1: { dataType: 'STRING' } },
        exitPorts: {},
        imports: [],
      };

      const newPorts = { param2: { dataType: 'NUMBER' as const } };
      const result = setStartExitPorts(workflow, 'Start', newPorts);

      expect(result).not.toBe(workflow);
      expect(workflow.startPorts).toEqual({ param1: { dataType: 'STRING' } });
    });
  });

  describe('setInstancePortConfigs', () => {
    it('should set portConfigs on an instance', () => {
      const workflow = createTestWorkflow();
      const nodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'TestNode',
        functionName: 'TestNode',
        inputs: { input1: { dataType: 'ANY' }, input2: { dataType: 'ANY' } },
        outputs: { output1: { dataType: 'ANY' } },
        hasSuccessPort: false,
        hasFailurePort: false,
        executeWhen: 'CONJUNCTION',
        isAsync: false,
      };
      let workflowWithNode = addNodeType(workflow, nodeType);
      const instance = createNodeInstance('testInstance', 'TestNode');
      workflowWithNode = addNode(workflowWithNode, instance);

      const portConfigs = [
        { portName: 'input1', direction: 'INPUT' as const, order: 1 },
        { portName: 'input2', direction: 'INPUT' as const, order: 0 },
      ];

      const result = setInstancePortConfigs(workflowWithNode, 'testInstance', portConfigs);

      const resultInstance = result.instances.find((inst) => inst.id === 'testInstance');
      expect(resultInstance!.config!.portConfigs).toEqual(portConfigs);
    });

    it('should replace existing portConfigs', () => {
      const workflow = createTestWorkflow();
      const nodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'TestNode',
        functionName: 'TestNode',
        inputs: { input1: { dataType: 'ANY' }, input2: { dataType: 'ANY' } },
        outputs: { output1: { dataType: 'ANY' } },
        hasSuccessPort: false,
        hasFailurePort: false,
        executeWhen: 'CONJUNCTION',
        isAsync: false,
      };
      let workflowWithNode = addNodeType(workflow, nodeType);
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'testInstance',
        nodeType: 'TestNode',
        config: {
          portConfigs: [{ portName: 'input1', direction: 'INPUT' as const, order: 5 }],
        },
      };
      workflowWithNode = addNode(workflowWithNode, instance);

      const newPortConfigs = [
        { portName: 'input1', direction: 'INPUT' as const, order: 1 },
        { portName: 'input2', direction: 'INPUT' as const, order: 0 },
      ];

      const result = setInstancePortConfigs(workflowWithNode, 'testInstance', newPortConfigs);

      const resultInstance = result.instances.find((inst) => inst.id === 'testInstance');
      expect(resultInstance!.config!.portConfigs).toEqual(newPortConfigs);
      expect(resultInstance!.config!.portConfigs).toHaveLength(2);
    });

    it("should throw when instance doesn't exist", () => {
      const workflow = createTestWorkflow();

      expect(() => setInstancePortConfigs(workflow, 'nonExistent', [])).toThrow(/not found/);
    });

    it('should be immutable', () => {
      const workflow = createTestWorkflow();
      const nodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'TestNode',
        functionName: 'TestNode',
        inputs: { input1: { dataType: 'ANY' } },
        outputs: {},
        hasSuccessPort: false,
        hasFailurePort: false,
        executeWhen: 'CONJUNCTION',
        isAsync: false,
      };
      let workflowWithNode = addNodeType(workflow, nodeType);
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'testInstance',
        nodeType: 'TestNode',
        config: {
          portConfigs: [{ portName: 'input1', direction: 'INPUT' as const, order: 0 }],
        },
      };
      workflowWithNode = addNode(workflowWithNode, instance);

      const newPortConfigs = [{ portName: 'input1', direction: 'INPUT' as const, order: 5 }];
      const result = setInstancePortConfigs(workflowWithNode, 'testInstance', newPortConfigs);

      expect(result).not.toBe(workflowWithNode);
      const originalInstance = workflowWithNode.instances.find(
        (inst) => inst.id === 'testInstance'
      );
      expect(originalInstance!.config!.portConfigs![0].order).toBe(0);
    });

    it('should create config if not present', () => {
      const workflow = createTestWorkflow();
      const nodeType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'TestNode',
        functionName: 'TestNode',
        inputs: { input1: { dataType: 'ANY' } },
        outputs: {},
        hasSuccessPort: false,
        hasFailurePort: false,
        executeWhen: 'CONJUNCTION',
        isAsync: false,
      };
      let workflowWithNode = addNodeType(workflow, nodeType);
      const instance: TNodeInstanceAST = {
        type: 'NodeInstance',
        id: 'testInstance',
        nodeType: 'TestNode',
        // No config
      };
      workflowWithNode = addNode(workflowWithNode, instance);

      const portConfigs = [{ portName: 'input1', direction: 'INPUT' as const, order: 1 }];
      const result = setInstancePortConfigs(workflowWithNode, 'testInstance', portConfigs);

      const resultInstance = result.instances.find((inst) => inst.id === 'testInstance');
      expect(resultInstance!.config).toBeDefined();
      expect(resultInstance!.config!.portConfigs).toEqual(portConfigs);
    });
  });
});
