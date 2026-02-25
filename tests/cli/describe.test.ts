/**
 * Tests for describe command
 * Uses direct function calls for speed, with 1 CLI smoke test for wiring
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { parseWorkflow } from '../../src/api/index';
import {
  describeWorkflow,
  describeCommand,
  formatDescribeOutput,
  buildGraph,
  enumeratePaths,
  formatPaths,
  generateMermaid,
  DescribeOutput,
  FocusedNodeOutput,
} from '../../src/cli/commands/describe';
import type { TWorkflowAST } from '../../src/ast/types';

const TEST_WORKFLOW = path.resolve(__dirname, '../fixtures/lead-processing.ts');

describe('describe command', () => {
  // Parse once, reuse for all tests
  let ast: TWorkflowAST;

  beforeAll(async () => {
    const parseResult = await parseWorkflow(TEST_WORKFLOW, { workflowName: 'processLead' });
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors: ${parseResult.errors.join(', ')}`);
    }
    ast = parseResult.ast;
  }, 60000);

  describe('describeWorkflow (pure function)', () => {
    it('should return workflow name and description', () => {
      const result = describeWorkflow(ast) as DescribeOutput;

      expect(result.name).toBe('processLead');
      expect('description' in result).toBe(true);
    });

    it('should include nodes array with id, type, inputs, outputs', () => {
      const result = describeWorkflow(ast) as DescribeOutput;

      expect(result.nodes).toBeInstanceOf(Array);
      expect(result.nodes.length).toBeGreaterThan(0);

      const node = result.nodes.find((n) => n.id === 'validator');
      expect(node).toBeDefined();
      expect(node!.type).toBe('validateLead');
      expect(node!.inputs).toBeInstanceOf(Array);
      expect(node!.outputs).toBeInstanceOf(Array);
    });

    it('should include connections array', () => {
      const result = describeWorkflow(ast) as DescribeOutput;

      expect(result.connections).toBeInstanceOf(Array);
      expect(result.connections.length).toBeGreaterThan(0);

      const conn = result.connections[0];
      expect(conn.from).toBeDefined();
      expect(conn.to).toBeDefined();
    });

    it('should include graph representation', () => {
      const result = describeWorkflow(ast) as DescribeOutput;

      expect(result.graph).toBeDefined();
      expect(typeof result.graph).toBe('string');
      expect(result.graph).toContain('validator');
    });

    it('should include validation results', () => {
      const result = describeWorkflow(ast) as DescribeOutput;

      expect(result.validation).toBeDefined();
      expect(typeof result.validation.valid).toBe('boolean');
      expect(result.validation.errors).toBeInstanceOf(Array);
      expect(result.validation.warnings).toBeInstanceOf(Array);
    });
  });

  describe('node filtering', () => {
    it('should focus on specific node when node option provided', () => {
      const result = describeWorkflow(ast, { node: 'validator' }) as FocusedNodeOutput;

      expect(result.focusNode).toBe('validator');
      expect(result.node).toBeDefined();
      expect(result.node.id).toBe('validator');
    });

    it('should include incoming and outgoing connections for focused node', () => {
      const result = describeWorkflow(ast, { node: 'validator' }) as FocusedNodeOutput;

      expect(result.incoming).toBeInstanceOf(Array);
      expect(result.outgoing).toBeInstanceOf(Array);
    });

    it('should throw for non-existent node', () => {
      expect(() => describeWorkflow(ast, { node: 'nonexistent' })).toThrow(
        'Node not found: nonexistent'
      );
    });
  });

  describe('formatDescribeOutput', () => {
    it('should output valid JSON for json format', () => {
      const output = describeWorkflow(ast) as DescribeOutput;
      const formatted = formatDescribeOutput(ast, output, 'json');

      expect(() => JSON.parse(formatted)).not.toThrow();
      const parsed = JSON.parse(formatted);
      expect(parsed.name).toBe('processLead');
    });

    it('should output human-readable text for text format', () => {
      const output = describeWorkflow(ast) as DescribeOutput;
      const formatted = formatDescribeOutput(ast, output, 'text');

      expect(formatted).toContain('processLead');
      expect(formatted).toContain('validator');
    });

    it('should output Mermaid diagram for mermaid format', () => {
      const output = describeWorkflow(ast) as DescribeOutput;
      const formatted = formatDescribeOutput(ast, output, 'mermaid');

      expect(formatted).toContain('graph');
      expect(formatted).toContain('-->');
    });
  });

  describe('buildGraph helper', () => {
    it('should build readable flow string', () => {
      const graph = buildGraph(ast);

      expect(graph).toContain('validator');
      expect(graph).toContain('->');
    });
  });

  describe('generateMermaid helper', () => {
    it('should generate valid Mermaid syntax', () => {
      const mermaid = generateMermaid(ast);

      expect(mermaid).toContain('graph LR');
      expect(mermaid).toContain('-->');
      expect(mermaid).toContain('validator');
      expect(mermaid).toContain('enricher');
      expect(mermaid).toContain('scorer');
    });

    it('should deduplicate edges between same node pairs', () => {
      const dupAST = {
        ...ast,
        connections: [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'validator', port: 'execute' } },
          { from: { node: 'Start', port: 'data' }, to: { node: 'validator', port: 'data' } },
          {
            from: { node: 'validator', port: 'onSuccess' },
            to: { node: 'enricher', port: 'execute' },
          },
          { from: { node: 'validator', port: 'result' }, to: { node: 'enricher', port: 'data' } },
        ],
      } as unknown as TWorkflowAST;

      const mermaid = generateMermaid(dupAST);
      const lines = mermaid.split('\n').filter((l) => l.includes('-->'));
      // Should have 2 unique edges, not 4
      expect(lines).toHaveLength(2);
    });
  });

  describe('buildGraph deduplication', () => {
    it('should not produce duplicate flow lines from same Start node', () => {
      const dupAST = {
        ...ast,
        instances: [{ id: 'validator', nodeType: 'validateLead', config: {} }],
        connections: [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'validator', port: 'execute' } },
          { from: { node: 'Start', port: 'data' }, to: { node: 'validator', port: 'data' } },
          {
            from: { node: 'validator', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
        ],
      } as unknown as TWorkflowAST;

      const graph = buildGraph(dupAST);
      const lines = graph.split('\n');
      // Should have 1 flow line, not 2 duplicates
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('Start');
      expect(lines[0]).toContain('validator');
    });
  });

  describe('buildGraph all-paths DFS', () => {
    it('should show both paths for branching workflow', () => {
      const branchAST = {
        ...ast,
        instances: [
          { id: 'a', nodeType: 'validateLead', config: {} },
          { id: 'b', nodeType: 'validateLead', config: {} },
          { id: 'c', nodeType: 'validateLead', config: {} },
        ],
        connections: [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } },
          { from: { node: 'a', port: 'onFailure' }, to: { node: 'c', port: 'execute' } },
          { from: { node: 'b', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
          { from: { node: 'c', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      } as unknown as TWorkflowAST;

      const graph = buildGraph(branchAST);
      const lines = graph.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines).toContain('Start -> a -> b -> Exit');
      expect(lines).toContain('Start -> a -> c -> Exit');
    });

    it('should produce same output for linear workflow', () => {
      const linearAST = {
        ...ast,
        instances: [
          { id: 'a', nodeType: 'validateLead', config: {} },
          { id: 'b', nodeType: 'validateLead', config: {} },
        ],
        connections: [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } },
          { from: { node: 'b', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      } as unknown as TWorkflowAST;

      const graph = buildGraph(linearAST);
      expect(graph).toBe('Start -> a -> b -> Exit');
    });
  });

  describe('enumeratePaths helper', () => {
    it('should return all Start-to-Exit paths', () => {
      const branchAST = {
        ...ast,
        instances: [
          { id: 'a', nodeType: 'validateLead', config: {} },
          { id: 'b', nodeType: 'validateLead', config: {} },
          { id: 'c', nodeType: 'validateLead', config: {} },
        ],
        connections: [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } },
          { from: { node: 'a', port: 'onFailure' }, to: { node: 'c', port: 'execute' } },
          { from: { node: 'b', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
          { from: { node: 'c', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      } as unknown as TWorkflowAST;

      const paths = enumeratePaths(branchAST);
      expect(paths).toHaveLength(2);
      expect(paths).toContainEqual(['Start', 'a', 'b', 'Exit']);
      expect(paths).toContainEqual(['Start', 'a', 'c', 'Exit']);
    });
  });

  describe('formatPaths helper', () => {
    it('should format paths as arrow-separated lines', () => {
      const linearAST = {
        ...ast,
        instances: [{ id: 'a', nodeType: 'validateLead', config: {} }],
        connections: [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      } as unknown as TWorkflowAST;

      const output = formatPaths(linearAST);
      expect(output).toBe('Start -> a -> Exit');
    });

    it('should return message when no complete paths exist', () => {
      const noPathAST = {
        ...ast,
        instances: [{ id: 'a', nodeType: 'validateLead', config: {} }],
        connections: [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        ],
      } as unknown as TWorkflowAST;

      const output = formatPaths(noPathAST);
      expect(output).toBe('(no complete Start-to-Exit paths found)');
    });
  });

  describe('formatDescribeOutput with paths format', () => {
    it('should return paths output for paths format', () => {
      const output = describeWorkflow(ast) as DescribeOutput;
      const formatted = formatDescribeOutput(ast, output, 'paths');

      expect(formatted).toContain('->');
      expect(formatted).toContain('Start');
    });
  });

  describe('WU4: text format shows all paths for branching workflows', () => {
    it('should show multiple labeled paths when workflow branches', () => {
      const branchAST = {
        ...ast,
        instances: [
          { id: 'validator', nodeType: 'validateLead', config: {} },
          { id: 'formatter', nodeType: 'validateLead', config: {} },
          { id: 'errorLogger', nodeType: 'validateLead', config: {} },
        ],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'validator', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'validator', port: 'onSuccess' },
            to: { node: 'formatter', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'validator', port: 'onFailure' },
            to: { node: 'errorLogger', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'formatter', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
          {
            type: 'Connection',
            from: { node: 'errorLogger', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
        ],
      } as unknown as TWorkflowAST;

      const output = describeWorkflow(branchAST) as DescribeOutput;
      const text = formatDescribeOutput(branchAST, output, 'text');

      // Should show labeled paths instead of single "Flow:"
      expect(text).toContain('Path 1:');
      expect(text).toContain('Path 2:');
      expect(text).toContain('formatter');
      expect(text).toContain('errorLogger');
    });

    it('should keep single Flow: for linear workflows', () => {
      const linearAST = {
        ...ast,
        instances: [{ id: 'a', nodeType: 'validateLead', config: {} }],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'execute' },
            to: { node: 'a', port: 'execute' },
          },
          {
            type: 'Connection',
            from: { node: 'a', port: 'onSuccess' },
            to: { node: 'Exit', port: 'onSuccess' },
          },
        ],
      } as unknown as TWorkflowAST;

      const output = describeWorkflow(linearAST) as DescribeOutput;
      const text = formatDescribeOutput(linearAST, output, 'text');

      expect(text).toContain('Flow:');
      expect(text).not.toContain('Path 1:');
    });
  });

  describe('WU5: suppress STEP ports for expression nodes in text describe', () => {
    it('should not show execute/onSuccess/onFailure for expression nodes', () => {
      const expressionNodeType = {
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
        executeWhen: 'CONJUNCTION' as const,
      };

      const exprAST = {
        ...ast,
        nodeTypes: [expressionNodeType],
        instances: [{ id: 'dbl1', nodeType: 'doubler', config: {} }],
        connections: [
          {
            type: 'Connection',
            from: { node: 'Start', port: 'value' },
            to: { node: 'dbl1', port: 'value' },
          },
          {
            type: 'Connection',
            from: { node: 'dbl1', port: 'doubled' },
            to: { node: 'Exit', port: 'result' },
          },
        ],
      } as unknown as TWorkflowAST;

      const output = describeWorkflow(exprAST) as DescribeOutput;
      const text = formatDescribeOutput(exprAST, output, 'text');

      // The node line for dbl1 should show data ports but not STEP ports
      const nodeLines = text.split('\n').filter((l) => l.includes('dbl1'));
      const nodeLine = nodeLines.join(' ');

      expect(nodeLine).toContain('value'); // data input
      expect(nodeLine).toContain('doubled'); // data output
      expect(nodeLine).not.toMatch(/\bexecute\b/); // STEP input suppressed
      expect(nodeLine).not.toMatch(/\bonSuccess\b/); // STEP output suppressed
      expect(nodeLine).not.toMatch(/\bonFailure\b/); // STEP output suppressed
    });

    it('should still show all ports for non-expression nodes', () => {
      const output = describeWorkflow(ast) as DescribeOutput;
      const text = formatDescribeOutput(ast, output, 'text');

      // Regular nodes should show execute, onSuccess, onFailure
      expect(text).toContain('execute');
    });
  });

  describe('formatDescribeOutput with focused node', () => {
    it('should output JSON for focused node', () => {
      const result = describeWorkflow(ast, { node: 'validator' }) as FocusedNodeOutput;
      const formatted = formatDescribeOutput(ast, result, 'json');

      const parsed = JSON.parse(formatted);
      expect(parsed.focusNode).toBe('validator');
      expect(parsed.node.id).toBe('validator');
    });

    it('should output text for focused node with incoming/outgoing connections', () => {
      const result = describeWorkflow(ast, { node: 'validator' }) as FocusedNodeOutput;
      const formatted = formatDescribeOutput(ast, result, 'text');

      expect(formatted).toContain('Node: validator');
      expect(formatted).toContain('Inputs:');
      expect(formatted).toContain('Outputs:');
    });

    it('should still output mermaid diagram even when focusing on a node', () => {
      const result = describeWorkflow(ast, { node: 'validator' }) as FocusedNodeOutput;
      const formatted = formatDescribeOutput(ast, result, 'mermaid');

      // Mermaid output is the full graph, not node-specific
      expect(formatted).toContain('graph LR');
      expect(formatted).toContain('-->');
    });
  });

  describe('formatTextOutput edge cases', () => {
    it('should show (none) for nodes with no inputs or outputs', () => {
      // Create a node type with empty inputs/outputs
      const emptyNodeType = {
        type: 'NodeType',
        name: 'empty',
        functionName: 'empty',
        expression: false,
        inputs: {},
        outputs: {},
        hasSuccessPort: false,
        hasFailurePort: false,
        isAsync: false,
        executeWhen: 'CONJUNCTION' as const,
      };

      const emptyAST = {
        ...ast,
        nodeTypes: [emptyNodeType],
        instances: [{ id: 'e1', nodeType: 'empty', config: {} }],
        connections: [],
      } as unknown as TWorkflowAST;

      const output = describeWorkflow(emptyAST) as DescribeOutput;
      const text = formatDescribeOutput(emptyAST, output, 'text');

      // Node with no inputs/outputs should still render
      expect(text).toContain('e1');
    });

    it('should show description when workflow has one', () => {
      const output = describeWorkflow(ast) as DescribeOutput;
      const text = formatDescribeOutput(ast, output, 'text');

      expect(text).toContain('Workflow: processLead');
      expect(text).toContain('Validation:');
    });

    it('should show validation counts in text format', () => {
      const output = describeWorkflow(ast) as DescribeOutput;
      const text = formatDescribeOutput(ast, output, 'text');

      expect(text).toMatch(/Validation: \d+ errors, \d+ warnings/);
    });
  });

  describe('describeCommand error paths', () => {
    let originalExit: typeof process.exit;
    let originalLog: typeof console.log;
    let originalError: typeof console.error;

    beforeEach(() => {
      originalExit = process.exit;
      originalLog = console.log;
      originalError = console.error;
      process.exit = vi.fn() as never;
      console.log = vi.fn();
      console.error = vi.fn();
    });

    afterEach(() => {
      process.exit = originalExit;
      console.log = originalLog;
      console.error = originalError;
    });

    it('should exit with error for non-existent file', async () => {
      await describeCommand('/nonexistent/file.ts', {});
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should exit with error for non-existent node focus', async () => {
      const tmpDir = path.join(os.tmpdir(), `fw-describe-err-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      const content = `
/** @flowWeaver nodeType
 * @input execute
 * @output onSuccess
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/** @flowWeaver workflow
 * @node p proc
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function testWf(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}
`;
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, content);

      await describeCommand(filePath, { node: 'nonExistentNode' });
      expect(process.exit).toHaveBeenCalledWith(1);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should handle mermaid format via describeCommand', async () => {
      const tmpDir = path.join(os.tmpdir(), `fw-describe-mermaid-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      const content = `
/** @flowWeaver nodeType
 * @input execute
 * @output onSuccess
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/** @flowWeaver workflow
 * @node p proc
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function mermaidWf(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}
`;
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, content);

      await describeCommand(filePath, { format: 'mermaid' });
      // Should not exit with error
      expect(process.exit).not.toHaveBeenCalled();

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should handle text format via describeCommand', async () => {
      const tmpDir = path.join(os.tmpdir(), `fw-describe-text-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      const content = `
/** @flowWeaver nodeType
 * @input execute
 * @output onSuccess
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/** @flowWeaver workflow
 * @node p proc
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function textWf(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  throw new Error("Not implemented");
}
`;
      const filePath = path.join(tmpDir, 'workflow.ts');
      fs.writeFileSync(filePath, content);

      await describeCommand(filePath, { format: 'text' });
      expect(process.exit).not.toHaveBeenCalled();

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('describeCommand read-only by default', () => {
    const tmpDir = path.join(os.tmpdir(), `fw-describe-test-${process.pid}`);
    let originalExit: typeof process.exit;
    let originalLog: typeof console.log;

    beforeAll(() => {
      fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
      originalExit = process.exit;
      originalLog = console.log;
      process.exit = vi.fn() as never;
      console.log = vi.fn();
    });

    afterEach(() => {
      process.exit = originalExit;
      console.log = originalLog;
    });

    function writeFixture(name: string, content: string): string {
      const p = path.join(tmpDir, name);
      fs.writeFileSync(p, content);
      return p;
    }

    const workflowSource = `
/** @flowWeaver nodeType
 * @expression
 * @input x
 * @output doubled
 */
export function doubler(x: number) { return { doubled: x * 2 }; }

/** @flowWeaver workflow
 * @node d doubler
 * @connect Start.execute -> d.execute
 * @connect d.onSuccess -> Exit.onSuccess
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`;

    it('should NOT modify the source file by default', async () => {
      const filePath = writeFixture('describe-readonly.ts', workflowSource);
      const contentBefore = fs.readFileSync(filePath, 'utf8');

      await describeCommand(filePath, { format: 'json' });

      const contentAfter = fs.readFileSync(filePath, 'utf8');
      expect(contentAfter).toBe(contentBefore);
    });

    it('should modify the source file when --compile is passed', async () => {
      const filePath = writeFixture('describe-compile.ts', workflowSource);
      const contentBefore = fs.readFileSync(filePath, 'utf8');

      await describeCommand(filePath, { format: 'json', compile: true });

      const contentAfter = fs.readFileSync(filePath, 'utf8');
      expect(contentAfter).not.toBe(contentBefore);
      expect(contentAfter).toContain('@flow-weaver-runtime-start');
    });
  });
});
