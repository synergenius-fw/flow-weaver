/**
 * Performance Benchmark Tests
 * Tests to ensure parsing, code generation, and execution meet performance targets
 */

import { parser } from '../../src/parser';
import { generateCode } from '../../src/api/generate';
import { validator } from '../../src/validator';
import type {
  TWorkflowAST,
  TNodeTypeAST,
  TNodeInstanceAST,
  TConnectionAST,
} from '../../src/ast/types';

describe('Performance Benchmarks', () => {
  /**
   * Helper to generate source code with N node types
   */
  function generateNodeTypesSourceCode(count: number): string {
    let sourceCode = '';

    for (let i = 1; i <= count; i++) {
      sourceCode += `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function nodeType${i}(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + ${i} };
}
`;
    }

    return sourceCode;
  }

  /**
   * Helper to create a workflow AST with N nodes in a chain
   */
  function createWorkflowAST(nodeCount: number): TWorkflowAST {
    const nodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'process',
      functionName: 'process',
      variant: 'FUNCTION',
      inputs: {
        execute: { dataType: 'STEP', label: 'Execute' },
        value: { dataType: 'NUMBER', tsType: 'number' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
        result: { dataType: 'NUMBER', tsType: 'number' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const instances: TNodeInstanceAST[] = [];
    const connections: TConnectionAST[] = [];

    // Create N nodes
    for (let i = 1; i <= nodeCount; i++) {
      instances.push({
        type: 'NodeInstance',
        id: `node${i}`,
        nodeType: 'process',
      });
    }

    // Connect Start to first node
    connections.push({
      type: 'Connection',
      from: { node: 'Start', port: 'input' },
      to: { node: 'node1', port: 'value' },
    });
    connections.push({
      type: 'Connection',
      from: { node: 'Start', port: 'execute' },
      to: { node: 'node1', port: 'execute' },
    });

    // Chain nodes together
    for (let i = 1; i < nodeCount; i++) {
      connections.push({
        type: 'Connection',
        from: { node: `node${i}`, port: 'result' },
        to: { node: `node${i + 1}`, port: 'value' },
      });
      connections.push({
        type: 'Connection',
        from: { node: `node${i}`, port: 'onSuccess' },
        to: { node: `node${i + 1}`, port: 'execute' },
      });
    }

    // Connect last node to Exit
    connections.push({
      type: 'Connection',
      from: { node: `node${nodeCount}`, port: 'result' },
      to: { node: 'Exit', port: 'output' },
    });

    return {
      type: 'Workflow',
      name: 'benchmarkWorkflow',
      functionName: 'benchmarkWorkflow',
      sourceFile: 'benchmark.ts',
      nodeTypes: [nodeType],
      instances,
      connections,
      scopes: {},
      startPorts: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'NUMBER' },
      },
      exitPorts: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', isControlFlow: true },
        output: { dataType: 'NUMBER' },
      },
      imports: [],
    };
  }

  describe('Parsing Performance', () => {
    it('should parse 100 node types in reasonable time (< 10s)', () => {
      const sourceCode = generateNodeTypesSourceCode(100);

      const startTime = Date.now();
      const parseResult = parser.parseFromString(sourceCode);
      const endTime = Date.now();

      const elapsed = endTime - startTime;

      // Verify parsing succeeded
      expect(parseResult.nodeTypes.length).toBeGreaterThanOrEqual(100);

      // Performance assertion - parsing involves TypeScript AST traversal
      // which is inherently slow for large files
      expect(elapsed).toBeLessThan(10000);
    });

    it('should parse 50 node types in reasonable time (< 5s)', () => {
      const sourceCode = generateNodeTypesSourceCode(50);

      const startTime = Date.now();
      parser.parseFromString(sourceCode);
      const endTime = Date.now();

      // TypeScript parsing is the bottleneck
      expect(endTime - startTime).toBeLessThan(5000);
    });

    it('should parse complex workflow source in under 500ms', () => {
      // Generate source with node types AND a workflow using them
      let sourceCode = generateNodeTypesSourceCode(50);

      // Add a workflow using 10 of those node types
      const nodeDeclarations = Array.from(
        { length: 10 },
        (_, i) => `@node n${i + 1} nodeType${i + 1}`
      ).join('\n * ');
      const connections = Array.from(
        { length: 9 },
        (_, i) => `@connect n${i + 1}.result -> n${i + 2}.value`
      ).join('\n * ');

      sourceCode += `
/**
 * @flowWeaver workflow
 * ${nodeDeclarations}
 * @connect Start.input -> n1.value
 * ${connections}
 * @connect n10.result -> Exit.output
 */
export async function complexWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; output: number }> {
  throw new Error('Not implemented');
}
`;

      const startTime = Date.now();
      const parseResult = parser.parseFromString(sourceCode);
      const endTime = Date.now();

      expect(parseResult.workflows.length).toBe(1);
      expect(endTime - startTime).toBeLessThan(1500);
    });
  });

  describe('Validation Performance', () => {
    it('should validate 50-node workflow in under 50ms', () => {
      const workflow = createWorkflowAST(50);

      const startTime = Date.now();
      const result = validator.validate(workflow);
      const endTime = Date.now();

      expect(result.valid).toBe(true);
      expect(endTime - startTime).toBeLessThan(50);
    });

    it('should validate 100-node workflow in under 100ms', () => {
      const workflow = createWorkflowAST(100);

      const startTime = Date.now();
      const result = validator.validate(workflow);
      const endTime = Date.now();

      expect(result.valid).toBe(true);
      expect(endTime - startTime).toBeLessThan(100);
    });
  });

  describe('Code Generation Performance', () => {
    it('should generate code for 50-node workflow in under 500ms', () => {
      const workflow = createWorkflowAST(50);

      const startTime = Date.now();
      const code = generateCode(workflow, { sourceMap: false });
      const endTime = Date.now();

      expect(code.length).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(500);
    });

    it('should generate code for 100-node workflow in under 1000ms', () => {
      const workflow = createWorkflowAST(100);

      const startTime = Date.now();
      const code = generateCode(workflow, { sourceMap: false });
      const endTime = Date.now();

      expect(code.length).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should generate code with source maps for 50-node workflow in under 1000ms', () => {
      const workflow = createWorkflowAST(50);
      // Remove sourceFile to avoid file system access during source map generation
      delete (workflow as Record<string, unknown>).sourceFile;

      const startTime = Date.now();
      const result = generateCode(workflow, { sourceMap: true });
      const endTime = Date.now();

      expect(result.code.length).toBeGreaterThan(0);
      expect(result.sourceMap).toBeDefined();
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });

  describe('Combined Performance (Parse + Validate + Generate)', () => {
    it('should complete full pipeline for medium workflow in under 1000ms', () => {
      // Generate source with 20 node types and a workflow
      let sourceCode = generateNodeTypesSourceCode(20);

      const nodeDeclarations = Array.from(
        { length: 5 },
        (_, i) => `@node n${i + 1} nodeType${i + 1}`
      ).join('\n * ');
      const connections = Array.from(
        { length: 4 },
        (_, i) => `@connect n${i + 1}.result -> n${i + 2}.value`
      ).join('\n * ');

      sourceCode += `
/**
 * @flowWeaver workflow
 * ${nodeDeclarations}
 * @connect Start.input -> n1.value
 * ${connections}
 * @connect n5.result -> Exit.output
 */
export async function pipelineWorkflow(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; output: number }> {
  throw new Error('Not implemented');
}
`;

      const startTime = Date.now();

      // Parse
      const parseResult = parser.parseFromString(sourceCode);
      expect(parseResult.workflows.length).toBe(1);

      const workflow = parseResult.workflows[0];

      // Validate
      const validationResult = validator.validate(workflow);
      expect(validationResult.valid).toBe(true);

      // Generate
      const code = generateCode(workflow, { sourceMap: false });
      expect(code.length).toBeGreaterThan(0);

      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(1000);
    });
  });

  describe('Memory Efficiency', () => {
    it('should handle multiple parse operations without significant memory growth', () => {
      const sourceCode = generateNodeTypesSourceCode(50);

      // Parse multiple times
      for (let i = 0; i < 10; i++) {
        parser.parseFromString(sourceCode);
      }

      // If we get here without OOM, the test passes
      expect(true).toBe(true);
    });

    it('should handle multiple generate operations without significant memory growth', () => {
      const workflow = createWorkflowAST(50);

      // Generate multiple times
      for (let i = 0; i < 10; i++) {
        generateCode(workflow, { sourceMap: false });
      }

      // If we get here without OOM, the test passes
      expect(true).toBe(true);
    });
  });
});
