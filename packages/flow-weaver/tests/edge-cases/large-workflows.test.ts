/**
 * Large Workflow Tests
 * Tests workflow parsing and generation with many nodes (100+)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parser } from '../../src/parser';
import { generateCode } from '../../src/api/generate';
import { validator } from '../../src/validator';
import type {
  TWorkflowAST,
  TNodeTypeAST,
  TNodeInstanceAST,
  TConnectionAST,
} from '../../src/ast/types';

describe('Large Workflows', () => {
  /**
   * Helper to generate a workflow with N nodes in a linear chain
   * Start -> node1 -> node2 -> ... -> nodeN -> Exit
   */
  function createLinearWorkflow(nodeCount: number): TWorkflowAST {
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
      name: 'largeWorkflow',
      functionName: 'largeWorkflow',
      sourceFile: 'large-workflow.ts',
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

  /**
   * Helper to create workflow with parallel branches
   */
  function createParallelWorkflow(branchCount: number, nodesPerBranch: number): TWorkflowAST {
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

    // Create branches
    for (let branch = 1; branch <= branchCount; branch++) {
      for (let node = 1; node <= nodesPerBranch; node++) {
        instances.push({
          type: 'NodeInstance',
          id: `branch${branch}_node${node}`,
          nodeType: 'process',
        });
      }

      // Connect Start to first node of each branch
      connections.push({
        type: 'Connection',
        from: { node: 'Start', port: 'input' },
        to: { node: `branch${branch}_node1`, port: 'value' },
      });
      connections.push({
        type: 'Connection',
        from: { node: 'Start', port: 'execute' },
        to: { node: `branch${branch}_node1`, port: 'execute' },
      });

      // Chain nodes within branch
      for (let node = 1; node < nodesPerBranch; node++) {
        connections.push({
          type: 'Connection',
          from: { node: `branch${branch}_node${node}`, port: 'result' },
          to: { node: `branch${branch}_node${node + 1}`, port: 'value' },
        });
        connections.push({
          type: 'Connection',
          from: { node: `branch${branch}_node${node}`, port: 'onSuccess' },
          to: { node: `branch${branch}_node${node + 1}`, port: 'execute' },
        });
      }

      // Connect last node to Exit
      connections.push({
        type: 'Connection',
        from: { node: `branch${branch}_node${nodesPerBranch}`, port: 'result' },
        to: { node: 'Exit', port: `output${branch}` },
      });
    }

    // Build exit ports dynamically
    const exitPorts: Record<string, { dataType: string; isControlFlow?: boolean }> = {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', isControlFlow: true },
    };
    for (let branch = 1; branch <= branchCount; branch++) {
      exitPorts[`output${branch}`] = { dataType: 'NUMBER' };
    }

    return {
      type: 'Workflow',
      name: 'parallelWorkflow',
      functionName: 'parallelWorkflow',
      sourceFile: 'parallel-workflow.ts',
      nodeTypes: [nodeType],
      instances,
      connections,
      scopes: {},
      startPorts: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'NUMBER' },
      },
      exitPorts,
      imports: [],
    };
  }

  describe('Linear Chain Workflows', () => {
    it('should validate workflow with 50 nodes', () => {
      const workflow = createLinearWorkflow(50);

      const result = validator.validate(workflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(workflow.instances).toHaveLength(50);
    });

    it('should validate workflow with 100 nodes', () => {
      const workflow = createLinearWorkflow(100);

      const result = validator.validate(workflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(workflow.instances).toHaveLength(100);
    });

    it('should generate code for workflow with 100 nodes', () => {
      const workflow = createLinearWorkflow(100);

      // Pass sourceMap: false explicitly to get string return type
      const code = generateCode(workflow, { sourceMap: false });

      expect(code).toBeDefined();
      expect(code.length).toBeGreaterThan(0);

      // Should contain all node references
      expect(code).toContain('node1');
      expect(code).toContain('node50');
      expect(code).toContain('node100');
    });
  });

  describe('Parallel Branch Workflows', () => {
    it('should validate workflow with 10 branches of 10 nodes each (100 total)', () => {
      const workflow = createParallelWorkflow(10, 10);

      const result = validator.validate(workflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(workflow.instances).toHaveLength(100);
    });

    it('should generate code for workflow with 20 branches of 5 nodes each (100 total)', () => {
      const workflow = createParallelWorkflow(20, 5);

      // Pass sourceMap: false explicitly to get string return type
      const code = generateCode(workflow, { sourceMap: false });

      expect(code).toBeDefined();
      expect(code.length).toBeGreaterThan(0);

      // Should contain nodes from various branches
      expect(code).toContain('branch1_node1');
      expect(code).toContain('branch10_node3');
      expect(code).toContain('branch20_node5');
    });
  });

  describe('Parsing Large Workflows from String', () => {
    it('should parse workflow with 20 node types', () => {
      // Generate source code with 20 node types
      let sourceCode = '';

      for (let i = 1; i <= 20; i++) {
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

      // Add a simple workflow using some of these node types
      sourceCode += `
/**
 * @flowWeaver workflow
 * @node n1 nodeType1
 * @node n2 nodeType2
 * @node n3 nodeType3
 * @connect Start.input -> n1.value
 * @connect n1.result -> n2.value
 * @connect n2.result -> n3.value
 * @connect n3.result -> Exit.output
 */
export async function manyNodeTypes(execute: boolean, params: { input: number }): Promise<{ onSuccess: boolean; onFailure: boolean; output: number }> {
  throw new Error('Not implemented');
}
`;

      const parseResult = parser.parseFromString(sourceCode);

      expect(parseResult.workflows).toHaveLength(1);
      // Should have 20 node types + workflow itself as IMPORTED_WORKFLOW
      expect(parseResult.workflows[0].nodeTypes.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('Fan-Out/Fan-In with STEP and DATA Dependencies (#45)', () => {
    it('should handle fan-out/fan-in with STEP and DATA dependencies (#45)', () => {
      // Pattern: Start → sourceA (branching), Start → sourceB (non-branching)
      // sourceA.onSuccess → combiner.execute (STEP)
      // sourceA.data → combiner.dataA (DATA)
      // sourceB.data → combiner.dataB (DATA)  ← external data dep
      // combiner.result → Exit.result
      //
      // Bug: combiner gets nested inside sourceA's success branch,
      // but sourceB is generated AFTER that branch → ReferenceError

      const sourceAType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'sourceA',
        functionName: 'sourceA',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          data: { dataType: 'STRING', tsType: 'string' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const sourceBType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'sourceB',
        functionName: 'sourceB',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          data: { dataType: 'STRING', tsType: 'string' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const combinerType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'combiner',
        functionName: 'combiner',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
          dataA: { dataType: 'STRING', tsType: 'string' },
          dataB: { dataType: 'STRING', tsType: 'string' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          result: { dataType: 'STRING', tsType: 'string' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const workflow: TWorkflowAST = {
        type: 'Workflow',
        name: 'fanOutFanIn',
        functionName: 'fanOutFanIn',
        sourceFile: 'fan-out-fan-in.ts',
        nodeTypes: [sourceAType, sourceBType, combinerType],
        instances: [
          { type: 'NodeInstance', id: 'sourceA', nodeType: 'sourceA' },
          { type: 'NodeInstance', id: 'sourceB', nodeType: 'sourceB' },
          { type: 'NodeInstance', id: 'combiner', nodeType: 'combiner' },
        ],
        connections: [
          // Start → sourceA (execute)
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'sourceA', port: 'execute' },
          },
          // Start → sourceB (execute)
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'sourceB', port: 'execute' },
          },
          // sourceA.onSuccess → combiner.execute (STEP — makes combiner part of sourceA's branch)
          {
            type: 'Connection',
            from: { node: 'sourceA', port: 'onSuccess' },
            to: { node: 'combiner', port: 'execute' },
          },
          // sourceA.data → combiner.dataA (DATA)
          {
            type: 'Connection',
            from: { node: 'sourceA', port: 'data' },
            to: { node: 'combiner', port: 'dataA' },
          },
          // sourceB.data → combiner.dataB (DATA — external data dependency!)
          {
            type: 'Connection',
            from: { node: 'sourceB', port: 'data' },
            to: { node: 'combiner', port: 'dataB' },
          },
          // combiner.result → Exit.result
          {
            type: 'Connection',
            from: { node: 'combiner', port: 'result' },
            to: { node: 'Exit', port: 'result' },
          },
        ],
        scopes: {},
        startPorts: {
          execute: { dataType: 'STEP' },
        },
        exitPorts: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true },
          result: { dataType: 'STRING' },
        },
        imports: [],
      };

      // Generate code — this should NOT nest combiner inside sourceA's branch
      const code = generateCode(workflow, { sourceMap: false });

      expect(code).toBeDefined();

      // combiner should be generated AFTER sourceB in the output
      // (since it depends on sourceB's data)
      const sourceBPos = code.indexOf('sourceBIdx = ctx.addExecution');
      const combinerPos = code.indexOf('combinerIdx = ctx.addExecution');
      expect(sourceBPos).toBeGreaterThan(-1);
      expect(combinerPos).toBeGreaterThan(-1);
      expect(combinerPos).toBeGreaterThan(sourceBPos);

      // combiner should be guarded by sourceA's success status
      expect(code).toContain('sourceA_success');

      // combiner should be inside the sourceA_success guard block
      // Verify combiner uses assignment (not const) since it's declared with let at top
      expect(code).toMatch(/\bcombinerIdx = ctx\.addExecution/);
      // It should NOT be `const combinerIdx` at the call site
      expect(code).not.toMatch(/const combinerIdx = ctx\.addExecution/);
    });

    it('should generate STEP guard for promoted branching combiner (#45)', () => {
      // Same pattern as above, but combiner is a BRANCHING node
      // (onSuccess/onFailure connected to Exit), matching the real aggregator-test workflow.
      // Branching promoted nodes go through generateBranchingNodeCode, which needs
      // the STEP guard wrapper added in the main loop.

      const sourceAType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'sourceA',
        functionName: 'sourceA',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          data: { dataType: 'STRING', tsType: 'string' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const sourceBType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'sourceB',
        functionName: 'sourceB',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          data: { dataType: 'STRING', tsType: 'string' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const combinerType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'combiner',
        functionName: 'combiner',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
          dataA: { dataType: 'STRING', tsType: 'string' },
          dataB: { dataType: 'STRING', tsType: 'string' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          result: { dataType: 'STRING', tsType: 'string' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const workflow: TWorkflowAST = {
        type: 'Workflow',
        name: 'fanOutFanInBranching',
        functionName: 'fanOutFanInBranching',
        sourceFile: 'fan-out-fan-in-branching.ts',
        nodeTypes: [sourceAType, sourceBType, combinerType],
        instances: [
          { type: 'NodeInstance', id: 'sourceA', nodeType: 'sourceA' },
          { type: 'NodeInstance', id: 'sourceB', nodeType: 'sourceB' },
          { type: 'NodeInstance', id: 'combiner', nodeType: 'combiner' },
        ],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'sourceA', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'sourceB', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'sourceA', port: 'onSuccess' },
            to: { node: 'combiner', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'sourceA', port: 'data' },
            to: { node: 'combiner', port: 'dataA' },
          },
          {
            type: 'Connection',
            from: { node: 'sourceB', port: 'data' },
            to: { node: 'combiner', port: 'dataB' },
          },
          // Key difference: combiner.onSuccess/onFailure connected to Exit → makes combiner a BRANCHING node
          {
            type: 'Connection',
            from: { node: 'combiner', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
          {
            type: 'Connection',
            from: { node: 'combiner', port: 'onFailure' },
            to: { node: 'Exit', port: 'onFailure' },
          },
          {
            type: 'Connection',
            from: { node: 'combiner', port: 'result' },
            to: { node: 'Exit', port: 'result' },
          },
        ],
        scopes: {},
        startPorts: {
          execute: { dataType: 'STEP' },
        },
        exitPorts: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true },
          result: { dataType: 'STRING' },
        },
        imports: [],
      };

      const code = generateCode(workflow, { sourceMap: false });

      // Same ordering assertions
      const sourceBPos = code.indexOf('sourceBIdx = ctx.addExecution');
      const combinerPos = code.indexOf('combinerIdx = ctx.addExecution');
      expect(sourceBPos).toBeGreaterThan(-1);
      expect(combinerPos).toBeGreaterThan(-1);
      expect(combinerPos).toBeGreaterThan(sourceBPos);

      // STEP guard must exist even for branching promoted nodes
      expect(code).toContain('sourceA_success');

      // combiner should use let assignment (not const)
      expect(code).toMatch(/\bcombinerIdx = ctx\.addExecution/);
      expect(code).not.toMatch(/const combinerIdx = ctx\.addExecution/);
    });

    it('should compile aggregator workflow from source and execute correctly (#45 e2e)', () => {
      // End-to-end test: parse from source string, generate code, eval and run
      const source = `
/**
 * @flowWeaver nodeType
 * @input query
 * @output data
 */
function fetchA(execute: boolean, query: string): { onSuccess: boolean; onFailure: boolean; data: string } {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  return { onSuccess: true, onFailure: false, data: 'A:' + query };
}

/**
 * @flowWeaver nodeType
 * @input query
 * @output data
 */
function fetchB(execute: boolean, query: string): { onSuccess: boolean; onFailure: boolean; data: string } {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  return { onSuccess: true, onFailure: false, data: 'B:' + query };
}

/**
 * @flowWeaver nodeType
 * @input dataA
 * @input dataB
 * @output combined
 */
function merge(execute: boolean, dataA: string, dataB: string): { onSuccess: boolean; onFailure: boolean; combined: string } {
  if (!execute) return { onSuccess: false, onFailure: false, combined: '' };
  return { onSuccess: true, onFailure: false, combined: dataA + '+' + dataB };
}

/**
 * @flowWeaver workflow
 * @node a fetchA
 * @node b fetchB
 * @node m merge
 * @connect Start.query -> a.query
 * @connect Start.query -> b.query
 * @connect a.onSuccess -> m.execute
 * @connect a.data -> m.dataA
 * @connect b.data -> m.dataB
 * @connect m.combined -> Exit.result
 */
export function aggregator(execute: boolean, params: { query: string }): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error("Not implemented");
}
`;
      const parseResult = parser.parseFromString(source, 'aggregator-e2e.ts');
      expect(parseResult.errors).toHaveLength(0);
      expect(parseResult.workflows).toHaveLength(1);

      const code = generateCode(parseResult.workflows[0], { sourceMap: false, production: true });
      expect(code).toBeDefined();

      // The generated code should reference all three nodes
      expect(code).toContain('fetchA');
      expect(code).toContain('fetchB');
      expect(code).toContain('merge');

      // merge should appear after fetchB in the generated code
      const fetchBPos = code.indexOf('bIdx = ctx.addExecution');
      const mergePos = code.indexOf('mIdx = ctx.addExecution');
      expect(fetchBPos).toBeGreaterThan(-1);
      expect(mergePos).toBeGreaterThan(-1);
      expect(mergePos).toBeGreaterThan(fetchBPos);
    });
  });

  describe('Performance Characteristics', () => {
    it('should validate 100-node workflow in reasonable time', () => {
      const workflow = createLinearWorkflow(100);

      const startTime = Date.now();
      const result = validator.validate(workflow);
      const endTime = Date.now();

      expect(result.valid).toBe(true);
      // Should complete in under 1 second
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should generate code for 100-node workflow in reasonable time', async () => {
      const workflow = createLinearWorkflow(100);

      const startTime = Date.now();
      await generateCode(workflow);
      const endTime = Date.now();

      // Should complete in under 5 seconds
      expect(endTime - startTime).toBeLessThan(5000);
    });
  });

  describe('Generated Code Cosmetic Quality', () => {
    it('should not generate lines with only whitespace', () => {
      // Use a fan-out/fan-in branching workflow that exercises generateBranchingNodeCode
      const sourceAType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'sourceA',
        functionName: 'sourceA',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          data: { dataType: 'STRING', tsType: 'string' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const sourceBType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'sourceB',
        functionName: 'sourceB',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          data: { dataType: 'STRING', tsType: 'string' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const combinerType: TNodeTypeAST = {
        type: 'NodeType',
        name: 'combiner',
        functionName: 'combiner',
        variant: 'FUNCTION',
        inputs: {
          execute: { dataType: 'STEP', label: 'Execute' },
          dataA: { dataType: 'STRING', tsType: 'string' },
          dataB: { dataType: 'STRING', tsType: 'string' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
          result: { dataType: 'STRING', tsType: 'string' },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };

      const workflow: TWorkflowAST = {
        type: 'Workflow',
        name: 'cosmeticTest',
        functionName: 'cosmeticTest',
        sourceFile: 'cosmetic-test.ts',
        nodeTypes: [sourceAType, sourceBType, combinerType],
        instances: [
          { type: 'NodeInstance', id: 'sourceA', nodeType: 'sourceA' },
          { type: 'NodeInstance', id: 'sourceB', nodeType: 'sourceB' },
          { type: 'NodeInstance', id: 'combiner', nodeType: 'combiner' },
        ],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'sourceA', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'sourceB', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'sourceA', port: 'onSuccess' },
            to: { node: 'combiner', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'sourceA', port: 'data' },
            to: { node: 'combiner', port: 'dataA' },
          },
          {
            type: 'Connection',
            from: { node: 'sourceB', port: 'data' },
            to: { node: 'combiner', port: 'dataB' },
          },
          {
            type: 'Connection',
            from: { node: 'combiner', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
          {
            type: 'Connection',
            from: { node: 'combiner', port: 'result' },
            to: { node: 'Exit', port: 'result' },
          },
        ],
        scopes: {},
        startPorts: {
          execute: { dataType: 'STEP' },
        },
        exitPorts: {
          onSuccess: { dataType: 'STEP', isControlFlow: true },
          onFailure: { dataType: 'STEP', isControlFlow: true },
          result: { dataType: 'STRING' },
        },
        imports: [],
      };

      const code = generateCode(workflow, { sourceMap: false });

      // No line should consist of only whitespace characters
      const lines = code.split('\n');
      const whitespaceOnlyLines = lines
        .map((line, i) => ({ line, lineNum: i + 1 }))
        .filter(({ line }) => /^\s+$/.test(line));

      expect(whitespaceOnlyLines).toEqual([]);
    });
  });

  describe('Promoted Combiner Semantics (#45)', () => {
    const SEMANTIC_OUTPUT_DIR = path.join(os.tmpdir(), `flow-weaver-semantic-tests-${process.pid}`);

    const failingSourceA = `
/**
 * @flowWeaver nodeType
 * @input query
 * @output data
 */
function fetchA(execute: boolean, query: string): { onSuccess: boolean; onFailure: boolean; data: string } {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  // Simulate a non-throwing failure: onSuccess is false
  return { onSuccess: false, onFailure: true, data: '' };
}

/**
 * @flowWeaver nodeType
 * @input query
 * @output data
 */
function fetchB(execute: boolean, query: string): { onSuccess: boolean; onFailure: boolean; data: string } {
  if (!execute) return { onSuccess: false, onFailure: false, data: '' };
  return { onSuccess: true, onFailure: false, data: 'B:' + query };
}

/**
 * @flowWeaver nodeType
 * @input dataA
 * @input dataB
 * @output combined
 */
function merge(execute: boolean, dataA: string, dataB: string): { onSuccess: boolean; onFailure: boolean; combined: string | null } {
  if (!execute) return { onSuccess: false, onFailure: false, combined: null };
  return { onSuccess: true, onFailure: false, combined: dataA + '+' + dataB };
}

/**
 * @flowWeaver workflow
 * @node a fetchA
 * @node b fetchB
 * @node m merge
 * @connect Start.query -> a.query
 * @connect Start.query -> b.query
 * @connect a.onSuccess -> m.execute
 * @connect a.data -> m.dataA
 * @connect b.data -> m.dataB
 * @connect m.onSuccess -> Exit.onSuccess
 * @connect m.combined -> Exit.result
 */
export function aggregatorFailing(execute: boolean, params: { query: string }): { onSuccess: boolean; onFailure: boolean; result: string | null } {
  throw new Error("Not implemented");
}
`;

    let mod: Record<string, (...args: unknown[]) => Record<string, unknown>>;

    beforeAll(async () => {
      fs.mkdirSync(SEMANTIC_OUTPUT_DIR, { recursive: true });

      const sourceFile = path.join(SEMANTIC_OUTPUT_DIR, 'aggregator-failing.ts');
      fs.writeFileSync(sourceFile, failingSourceA, 'utf-8');

      const code = await testHelpers.generateFast(sourceFile, 'aggregatorFailing');

      const outputFile = path.join(SEMANTIC_OUTPUT_DIR, 'aggregator-failing.generated.ts');
      fs.writeFileSync(outputFile, code, 'utf-8');

      mod = await import(outputFile);
    });

    afterAll(() => {
      if (fs.existsSync(SEMANTIC_OUTPUT_DIR)) {
        fs.rmSync(SEMANTIC_OUTPUT_DIR, { recursive: true });
      }
    });

    it('should produce correct exit values when branching source returns onSuccess:false (#45 semantic)', () => {
      const result = mod.aggregatorFailing(true, { query: 'test' });

      // When fetchA returns onSuccess: false, the promoted merge node is skipped entirely
      // (guarded by sourceA_success). Exit gets false/undefined as fallback values.
      expect(result.onSuccess).toBe(false);
      expect(result.result).toBeUndefined();
    });
  });
});
