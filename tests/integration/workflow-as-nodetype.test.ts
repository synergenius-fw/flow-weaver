/**
 * Tests for using workflows as node types
 * Workflows exported from other files should be usable as nodes in workflows
 */

import * as path from 'path';
import * as fs from 'fs';
import { AnnotationParser } from '../../src/parser';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/cross-file');

describe('Workflow as NodeType', () => {
  let parser: AnnotationParser;

  beforeEach(() => {
    parser = new AnnotationParser();
    parser.clearCache();
  });

  describe('Importing workflows as node types', () => {
    it('should parse file with workflows that can be imported', () => {
      const utilsFile = path.join(FIXTURES_DIR, 'workflow-utils.ts');
      const result = parser.parse(utilsFile);

      // Should have node types (validateNumber, formatNumber)
      expect(result.nodeTypes.length).toBeGreaterThanOrEqual(2);
      // Should have workflows (validateAndTransform, formatValue)
      expect(result.workflows.length).toBe(2);

      // Workflows are in workflows array, not nodeTypes (for local parsing)
      const validateAndTransform = result.workflows.find((w) => w.name === 'validateAndTransform');
      expect(validateAndTransform).toBeDefined();
      expect(validateAndTransform?.startPorts.data).toBeDefined();
      expect(validateAndTransform?.exitPorts.result).toBeDefined();
    });

    it('should use imported workflow in another workflow', () => {
      const usesWorkflow = path.join(FIXTURES_DIR, 'uses-workflow.ts');
      const result = parser.parse(usesWorkflow);

      // Should have one workflow
      expect(result.workflows.length).toBe(1);
      const workflow = result.workflows[0];
      expect(workflow.name).toBe('processData');

      // Should have instances that reference imported workflows
      expect(workflow.instances.length).toBe(2);

      const validateInstance = workflow.instances.find((i) => i.id === 'validate');
      const formatInstance = workflow.instances.find((i) => i.id === 'format');

      expect(validateInstance).toBeDefined();
      expect(validateInstance?.nodeType).toBe('validateAndTransform');

      expect(formatInstance).toBeDefined();
      expect(formatInstance?.nodeType).toBe('formatValue');
    });

    it('should have imported workflow node types available with correct ports', () => {
      const usesWorkflow = path.join(FIXTURES_DIR, 'uses-workflow.ts');
      const result = parser.parse(usesWorkflow);

      // Imported workflows should be in nodeTypes
      const validateAndTransform = result.nodeTypes.find(
        (nt) => nt.name === 'validateAndTransform'
      );
      const formatValue = result.nodeTypes.find((nt) => nt.name === 'formatValue');

      expect(validateAndTransform).toBeDefined();
      expect(formatValue).toBeDefined();

      // Check validateAndTransform ports (from @param/@returns in workflow-utils.ts)
      expect(validateAndTransform?.inputs.data).toBeDefined();
      expect(validateAndTransform?.outputs.result).toBeDefined();
      expect(validateAndTransform?.outputs.onSuccess).toBeDefined();
      expect(validateAndTransform?.outputs.onFailure).toBeDefined();

      // Check formatValue ports
      expect(formatValue?.inputs.value).toBeDefined();
      expect(formatValue?.outputs.output).toBeDefined();
    });

    it('should validate connections to imported workflow ports', () => {
      const usesWorkflow = path.join(FIXTURES_DIR, 'uses-workflow.ts');
      const result = parser.parse(usesWorkflow);

      // Should parse without errors
      expect(result.errors).toHaveLength(0);

      // Check connections exist
      const workflow = result.workflows[0];
      expect(workflow.connections.length).toBeGreaterThan(0);

      // Start.input -> validate.data
      const inputConnection = workflow.connections.find(
        (c) => c.from.node === 'Start' && c.from.port === 'input'
      );
      expect(inputConnection).toBeDefined();
      expect(inputConnection?.to.node).toBe('validate');
      expect(inputConnection?.to.port).toBe('data');
    });

    it('should mark imported workflow as workflow variant', () => {
      const usesWorkflow = path.join(FIXTURES_DIR, 'uses-workflow.ts');
      const result = parser.parse(usesWorkflow);

      const validateAndTransform = result.nodeTypes.find(
        (nt) => nt.name === 'validateAndTransform'
      );

      // Should have a marker indicating it's an imported workflow
      expect(validateAndTransform?.variant).toBe('IMPORTED_WORKFLOW');
    });
  });

  describe('Workflow chaining', () => {
    it('should support multi-level workflow nesting', () => {
      // Create a workflow that uses processData which itself uses validateAndTransform
      const testCode = `
import { processData } from './uses-workflow';

/**
 * @flowWeaver workflow
 * @node process processData
 * @connect Start.rawData -> process.input
 * @connect process.result -> Exit.finalResult
 * @connect process.onSuccess -> Exit.onSuccess
 * @connect process.onFailure -> Exit.onFailure
 * @param rawData - Raw input
 * @returns finalResult - Final processed result
 */
export function topLevelWorkflow(
  execute: boolean,
  params: { rawData: any }
): { onSuccess: boolean; onFailure: boolean; finalResult: string } {
  return { onSuccess: true, onFailure: false, finalResult: "" };
}
`;
      const tempFile = path.join(FIXTURES_DIR, 'temp-nested.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        const result = parser.parse(tempFile);

        expect(result.workflows.length).toBe(1);
        expect(result.errors).toHaveLength(0);

        // processData should be available as node type
        const processDataNode = result.nodeTypes.find((nt) => nt.name === 'processData');
        expect(processDataNode).toBeDefined();
        expect(processDataNode?.variant).toBe('IMPORTED_WORKFLOW');
      } finally {
        fs.unlinkSync(tempFile);
      }
    });
  });

  describe('Error handling', () => {
    it('should parse workflow with bad port connection (validation is separate)', () => {
      // Note: Port validation happens in the validator, not parser.
      // The parser will accept the connection syntax; validation is a separate step.
      const testCode = `
import { validateAndTransform } from './workflow-utils';

/**
 * @flowWeaver workflow
 * @node v validateAndTransform
 * @connect Start.input -> v.nonExistentPort
 * @connect v.result -> Exit.output
 * @param input - Input
 * @returns output - Output
 */
export function badConnectionWorkflow(
  execute: boolean,
  params: { input: any }
): { onSuccess: boolean; onFailure: boolean; output: any } {
  return { onSuccess: true, onFailure: false, output: null };
}
`;
      const tempFile = path.join(FIXTURES_DIR, 'temp-bad-conn.ts');
      fs.writeFileSync(tempFile, testCode);

      try {
        const result = parser.parse(tempFile);
        // Parser accepts the syntax - connection is recorded
        expect(result.workflows.length).toBe(1);
        const workflow = result.workflows[0];
        // Connection to nonExistentPort is recorded (validation happens separately)
        const badConn = workflow.connections.find((c) => c.to.port === 'nonExistentPort');
        expect(badConn).toBeDefined();
      } finally {
        fs.unlinkSync(tempFile);
      }
    });
  });
});
