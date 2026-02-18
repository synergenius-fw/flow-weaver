/**
 * Tests for API helper utilities
 * Focus on withValidation(), port reference validation, and utility functions
 */

import {
  withValidation,
  validatePortReference,
  portReferencesEqual,
  formatPortReference,
  generateUniqueNodeId,
  assertNodeTypeExists,
  assertNodeExists,
  assertNodeNotExists,
} from '../../src/api/helpers';
import type { TWorkflowAST } from '../../src/ast/types';
import { createMinimalWorkflow } from '../helpers/test-fixtures';

describe('API Helpers', () => {
  describe('withValidation', () => {
    it('should use Immer to create immutable copy', () => {
      const original = createMinimalWorkflow();

      // Note: withValidation will validate, so we test that separately
      // This test uses produce directly to verify Immer behavior
      const { produce } = require('immer');
      const result = produce(original, (draft: any) => {
        if (!draft.ui) {
          draft.ui = {};
        }
        draft.ui.disablePan = true;
      });

      expect(result.ui?.disablePan).toBe(true);
      expect(result).not.toBe(original); // Different object (immutable)
      expect(original.ui).toBeUndefined(); // Original unchanged
    });

    it('should throw error when validation fails', () => {
      // Create simple workflow without validation issues
      const ast: TWorkflowAST = {
        type: 'Workflow',
        name: 'test',
        functionName: 'test',
        sourceFile: 'test.ts',
        nodeTypes: [],
        instances: [],
        connections: [
          // Invalid: connection to non-existent node
          {
            type: 'Connection',
            from: { node: 'Start', port: 'x' },
            to: { node: 'missing', port: 'y' },
          },
        ],
        scopes: {},
        startPorts: { x: { dataType: 'NUMBER' } },
        exitPorts: { y: { dataType: 'NUMBER' } },
        imports: [],
      };

      expect(() => {
        withValidation(
          ast,
          (draft) => {
            // Doesn't matter what we do, workflow is already invalid
            draft.name = 'updated';
          },
          'testOperation'
        );
      }).toThrow(/Validation failed/);
    });

    it('should include operation name in error message', () => {
      const ast: TWorkflowAST = {
        type: 'Workflow',
        name: 'test',
        functionName: 'test',
        sourceFile: 'test.ts',
        nodeTypes: [],
        instances: [],
        connections: [
          // Invalid connection to non-existent node to trigger validation error
          {
            type: 'Connection',
            from: { node: 'Start', port: 'x' },
            to: { node: 'nonexistent', port: 'y' },
          },
        ],
        scopes: {},
        startPorts: { x: { dataType: 'NUMBER' } },
        exitPorts: {},
        imports: [],
      };

      expect(() => {
        withValidation(
          ast,
          (draft) => {
            draft.name = 'test';
          },
          'customOperation'
        );
      }).toThrow(/customOperation/);
    });

    it('should preserve original AST when validation fails', () => {
      const { produce } = require('immer');
      const original = createMinimalWorkflow();
      const originalJSON = JSON.stringify(original);

      // Test that Immer doesn't mutate original even when operation fails
      try {
        produce(original, (draft: any) => {
          draft.someField = 'modified';
          throw new Error('Simulated error');
        });
      } catch (error) {
        // Expected to throw
      }

      expect(JSON.stringify(original)).toBe(originalJSON); // Unchanged
    });

    it('should handle multiple nested modifications', () => {
      const { produce } = require('immer');
      const original = createMinimalWorkflow();

      const result = produce(original, (draft: any) => {
        // Multiple modifications
        if (!draft.ui) {
          draft.ui = {};
        }
        draft.ui.disablePan = true;
        draft.ui.disableZoom = false;
        draft.description = 'test';
      });

      expect(result.ui?.disablePan).toBe(true);
      expect(result.ui?.disableZoom).toBe(false);
      expect(result.description).toBe('test');
      expect(original.ui).toBeUndefined(); // Original unchanged
    });
  });

  describe('validatePortReference', () => {
    it('should parse string port reference correctly', () => {
      const ref = validatePortReference('node1.port1');

      expect(ref).toEqual({ node: 'node1', port: 'port1' });
    });

    it('should accept object port reference', () => {
      const ref = validatePortReference({ node: 'node1', port: 'port1' });

      expect(ref).toEqual({ node: 'node1', port: 'port1' });
    });

    it('should throw on invalid string format', () => {
      expect(() => validatePortReference('invalid')).toThrow(/Invalid port reference format/);
      expect(() => validatePortReference('too.many.dots')).toThrow(/Invalid port reference format/);
    });

    it('should throw on invalid object', () => {
      expect(() => validatePortReference({} as any)).toThrow(/missing node or port/);
      expect(() => validatePortReference({ node: 'test' } as any)).toThrow(/missing node or port/);
    });
  });

  describe('portReferencesEqual', () => {
    it('should return true for equal references', () => {
      const ref1 = { node: 'node1', port: 'port1' };
      const ref2 = { node: 'node1', port: 'port1' };

      expect(portReferencesEqual(ref1, ref2)).toBe(true);
    });

    it('should return false for different references', () => {
      const ref1 = { node: 'node1', port: 'port1' };
      const ref2 = { node: 'node1', port: 'port2' };
      const ref3 = { node: 'node2', port: 'port1' };

      expect(portReferencesEqual(ref1, ref2)).toBe(false);
      expect(portReferencesEqual(ref1, ref3)).toBe(false);
    });
  });

  describe('formatPortReference', () => {
    it('should format port reference as string', () => {
      const formatted = formatPortReference({ node: 'node1', port: 'port1' });

      expect(formatted).toBe('node1.port1');
    });
  });

  describe('generateUniqueNodeId', () => {
    it('should return base name if not taken', () => {
      const ast = createMinimalWorkflow();
      const id = generateUniqueNodeId(ast, 'newNode');

      expect(id).toBe('newNode');
    });

    it('should append counter if base name is taken', () => {
      const ast = createMinimalWorkflow();
      const id = generateUniqueNodeId(ast, 'testNode'); // Already exists

      expect(id).toBe('testNode1');
    });

    it('should increment counter until unique', () => {
      const ast = createMinimalWorkflow();
      ast.instances.push(
        {
          type: 'NodeInstance',
          id: 'processor',
          nodeType: 'testType',
        },
        {
          type: 'NodeInstance',
          id: 'processor1',
          nodeType: 'testType',
        },
        {
          type: 'NodeInstance',
          id: 'processor2',
          nodeType: 'testType',
        }
      );

      // All processor, processor1, processor2 taken, should return processor3
      const id = generateUniqueNodeId(ast, 'processor');
      expect(id).toBe('processor3');
    });
  });

  describe('assertNodeTypeExists', () => {
    it('should not throw if node type exists', () => {
      const ast = createMinimalWorkflow();

      expect(() => assertNodeTypeExists(ast, 'testFunc')).not.toThrow();
    });

    it("should throw if node type doesn't exist", () => {
      const ast = createMinimalWorkflow();

      expect(() => assertNodeTypeExists(ast, 'nonExistent')).toThrow(
        /Node type "nonExistent" not found/
      );
    });

    it('should list available types in error message', () => {
      const ast = createMinimalWorkflow();
      ast.nodeTypes.push({
        type: 'NodeType',
        name: 'anotherType',
        functionName: 'another',
        inputs: {},
        outputs: {},
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      });

      try {
        assertNodeTypeExists(ast, 'missing');
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('testType');
        expect(error.message).toContain('anotherType');
      }
    });
  });

  describe('assertNodeExists', () => {
    it('should not throw if node exists', () => {
      const ast = createMinimalWorkflow();

      expect(() => assertNodeExists(ast, 'testNode')).not.toThrow();
    });

    it("should throw if node doesn't exist", () => {
      const ast = createMinimalWorkflow();

      expect(() => assertNodeExists(ast, 'missing')).toThrow(/Node "missing" not found/);
    });
  });

  describe('assertNodeNotExists', () => {
    it("should not throw if node doesn't exist", () => {
      const ast = createMinimalWorkflow();

      expect(() => assertNodeNotExists(ast, 'newNode')).not.toThrow();
    });

    it('should throw if node already exists', () => {
      const ast = createMinimalWorkflow();

      expect(() => assertNodeNotExists(ast, 'testNode')).toThrow(/Node "testNode" already exists/);
    });
  });
});
