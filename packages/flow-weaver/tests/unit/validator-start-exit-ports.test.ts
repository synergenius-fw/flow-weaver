/**
 * Tests for Start/Exit port name validation (Fix B1+S2)
 * Validates that Start output ports and Exit input ports are checked
 * against declared @param/@returns ports with "Did you mean?" suggestions.
 */

import { WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST } from '../../src/ast/types';
import { createProcessorNodeType, createNodeInstance } from '../helpers/test-fixtures';

function createWorkflowWithStartConnection(
  startPort: string,
  startPorts: Record<string, { dataType: string }> = {}
): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'test',
    functionName: 'test',
    sourceFile: 'test.ts',
    nodeTypes: [createProcessorNodeType()],
    instances: [createNodeInstance('node1', 'process')],
    connections: [
      {
        type: 'Connection',
        from: { node: 'Start', port: startPort },
        to: { node: 'node1', port: 'input' },
      },
      {
        type: 'Connection',
        from: { node: 'node1', port: 'output' },
        to: { node: 'Exit', port: 'onSuccess' },
      },
    ],
    scopes: {},
    startPorts,
    exitPorts: {},
    imports: [],
  };
}

function createWorkflowWithExitConnection(
  exitPort: string,
  exitPorts: Record<string, { dataType: string }> = {}
): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'test',
    functionName: 'test',
    sourceFile: 'test.ts',
    nodeTypes: [createProcessorNodeType()],
    instances: [createNodeInstance('node1', 'process')],
    connections: [
      {
        type: 'Connection',
        from: { node: 'Start', port: 'execute' },
        to: { node: 'node1', port: 'input' },
      },
      {
        type: 'Connection',
        from: { node: 'node1', port: 'output' },
        to: { node: 'Exit', port: exitPort },
      },
    ],
    scopes: {},
    startPorts: {},
    exitPorts,
    imports: [],
  };
}

describe('Validator - Start/Exit port validation', () => {
  const validator = new WorkflowValidator();

  describe('Start node output ports', () => {
    it('should error on unknown Start port with no @param ports', () => {
      const workflow = createWorkflowWithStartConnection('datax', {});
      const result = validator.validate(workflow);

      const err = result.errors.find(
        (e) => e.code === 'UNKNOWN_SOURCE_PORT' && e.message.includes('Start node')
      );
      expect(err).toBeDefined();
      expect(err!.message).toContain('"datax"');
    });

    it('should suggest close match when one exists', () => {
      const workflow = createWorkflowWithStartConnection('datax', {
        data: { dataType: 'STRING' },
      });
      const result = validator.validate(workflow);

      const err = result.errors.find(
        (e) => e.code === 'UNKNOWN_SOURCE_PORT' && e.message.includes('Start node')
      );
      expect(err).toBeDefined();
      expect(err!.message).toContain('Did you mean "data"');
    });

    it('should always accept "execute" (implicit)', () => {
      const workflow = createWorkflowWithStartConnection('execute', {});
      const result = validator.validate(workflow);

      const startPortErrors = result.errors.filter(
        (e) => e.code === 'UNKNOWN_SOURCE_PORT' && e.message.includes('Start node')
      );
      expect(startPortErrors).toHaveLength(0);
    });

    it('should accept declared @param port', () => {
      const workflow = createWorkflowWithStartConnection('data', {
        data: { dataType: 'STRING' },
      });
      const result = validator.validate(workflow);

      const startPortErrors = result.errors.filter(
        (e) => e.code === 'UNKNOWN_SOURCE_PORT' && e.message.includes('Start node')
      );
      expect(startPortErrors).toHaveLength(0);
    });
  });

  describe('Exit node input ports', () => {
    it('should error on unknown Exit port with no @returns ports', () => {
      const workflow = createWorkflowWithExitConnection('resultx', {});
      const result = validator.validate(workflow);

      const err = result.errors.find(
        (e) => e.code === 'UNKNOWN_TARGET_PORT' && e.message.includes('Exit node')
      );
      expect(err).toBeDefined();
      expect(err!.message).toContain('"resultx"');
    });

    it('should suggest close match when one exists', () => {
      const workflow = createWorkflowWithExitConnection('resultx', {
        result: { dataType: 'STRING' },
      });
      const result = validator.validate(workflow);

      const err = result.errors.find(
        (e) => e.code === 'UNKNOWN_TARGET_PORT' && e.message.includes('Exit node')
      );
      expect(err).toBeDefined();
      expect(err!.message).toContain('Did you mean "result"');
    });

    it('should always accept "onSuccess" and "onFailure" (implicit)', () => {
      const workflowSuccess = createWorkflowWithExitConnection('onSuccess', {});
      const resultSuccess = validator.validate(workflowSuccess);
      const exitPortErrorsSuccess = resultSuccess.errors.filter(
        (e) => e.code === 'UNKNOWN_TARGET_PORT' && e.message.includes('Exit node')
      );
      expect(exitPortErrorsSuccess).toHaveLength(0);

      const workflowFailure = createWorkflowWithExitConnection('onFailure', {});
      const resultFailure = validator.validate(workflowFailure);
      const exitPortErrorsFailure = resultFailure.errors.filter(
        (e) => e.code === 'UNKNOWN_TARGET_PORT' && e.message.includes('Exit node')
      );
      expect(exitPortErrorsFailure).toHaveLength(0);
    });

    it('should accept declared @returns port', () => {
      const workflow = createWorkflowWithExitConnection('data', {
        data: { dataType: 'STRING' },
      });
      const result = validator.validate(workflow);

      const exitPortErrors = result.errors.filter(
        (e) => e.code === 'UNKNOWN_TARGET_PORT' && e.message.includes('Exit node')
      );
      expect(exitPortErrors).toHaveLength(0);
    });
  });
});
