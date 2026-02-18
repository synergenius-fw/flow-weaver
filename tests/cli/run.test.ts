/**
 * Tests for the run command
 *
 * Tests CLI execution of workflows with various options.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runCommand } from '../../src/cli/commands/run';

const tempDir = path.join(os.tmpdir(), `flow-weaver-run-test-${process.pid}`);

// Sample workflow for testing
const SAMPLE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input a - First number
 * @input b - Second number
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output result - Sum result
 */
function add(execute: boolean, a: number, b: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: a + b };
}

/**
 * @flowWeaver workflow
 * @name calculator
 * @node adder add
 * @connect Start.execute -> adder.execute
 * @connect Start.a -> adder.a
 * @connect Start.b -> adder.b
 * @connect adder.onSuccess -> Exit.onSuccess
 * @connect adder.result -> Exit.result
 */
export function calculator(
  execute: boolean,
  params: { a: number; b: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

// Multi-workflow file for testing --workflow option
const MULTI_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input x - Input value
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output result - Doubled result
 */
function double(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: x * 2 };
}

/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input x - Input value
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output result - Tripled result
 */
function triple(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: x * 3 };
}

/**
 * @flowWeaver workflow
 * @name doubleWorkflow
 * @node d double
 * @connect Start.execute -> d.execute
 * @connect Start.x -> d.x
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.result -> Exit.result
 */
export function doubleWorkflow(
  execute: boolean,
  params: { x: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}

/**
 * @flowWeaver workflow
 * @name tripleWorkflow
 * @node t triple
 * @connect Start.execute -> t.execute
 * @connect Start.x -> t.x
 * @connect t.onSuccess -> Exit.onSuccess
 * @connect t.result -> Exit.result
 */
export function tripleWorkflow(
  execute: boolean,
  params: { x: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

// Setup temp directory
beforeAll(() => {
  fs.mkdirSync(tempDir, { recursive: true });
});

// Cleanup
afterAll(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe('run command', () => {
  describe('basic execution', () => {
    it('should execute a workflow and return result', async () => {
      const filePath = path.join(tempDir, 'basic-workflow.ts');
      fs.writeFileSync(filePath, SAMPLE_WORKFLOW);

      // Capture console output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      try {
        await runCommand(filePath, { params: '{"a": 5, "b": 3}' });

        // Should have some output
        expect(logs.length).toBeGreaterThan(0);

        // Should contain result
        const output = logs.join('\n');
        expect(output).toContain('result');
      } finally {
        console.log = originalLog;
      }
    });

    it('should throw error for non-existent file', async () => {
      await expect(runCommand('/nonexistent/file.ts', {})).rejects.toThrow('File not found');
    });
  });

  describe('params parsing', () => {
    it('should parse JSON params from --params', async () => {
      const filePath = path.join(tempDir, 'params-test.ts');
      fs.writeFileSync(filePath, SAMPLE_WORKFLOW);

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      try {
        await runCommand(filePath, { params: '{"a": 10, "b": 20}' });

        // Result should reflect the parameters
        const output = logs.join('\n');
        expect(output).toContain('30'); // 10 + 20 = 30
      } finally {
        console.log = originalLog;
      }
    });

    it('should throw error for invalid JSON in --params', async () => {
      const filePath = path.join(tempDir, 'invalid-params.ts');
      fs.writeFileSync(filePath, SAMPLE_WORKFLOW);

      await expect(runCommand(filePath, { params: 'not valid json' })).rejects.toThrow(
        'Invalid JSON in --params'
      );
    });

    it('should read params from --params-file', async () => {
      const filePath = path.join(tempDir, 'params-file-test.ts');
      const paramsFilePath = path.join(tempDir, 'params.json');

      fs.writeFileSync(filePath, SAMPLE_WORKFLOW);
      fs.writeFileSync(paramsFilePath, JSON.stringify({ a: 7, b: 8 }));

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      try {
        await runCommand(filePath, { paramsFile: paramsFilePath });

        const output = logs.join('\n');
        expect(output).toContain('15'); // 7 + 8 = 15
      } finally {
        console.log = originalLog;
      }
    });

    it('should throw error for non-existent params file', async () => {
      const filePath = path.join(tempDir, 'missing-params-file.ts');
      fs.writeFileSync(filePath, SAMPLE_WORKFLOW);

      await expect(
        runCommand(filePath, { paramsFile: '/nonexistent/params.json' })
      ).rejects.toThrow('Params file not found');
    });
  });

  describe('workflow selection', () => {
    it('should run specific workflow with --workflow', async () => {
      const filePath = path.join(tempDir, 'multi-workflow.ts');
      fs.writeFileSync(filePath, MULTI_WORKFLOW);

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      try {
        await runCommand(filePath, {
          workflow: 'tripleWorkflow',
          params: '{"x": 5}',
        });

        const output = logs.join('\n');
        expect(output).toContain('15'); // 5 * 3 = 15
      } finally {
        console.log = originalLog;
      }
    });

    it('should run first workflow by default', async () => {
      const filePath = path.join(tempDir, 'multi-workflow-default.ts');
      fs.writeFileSync(filePath, MULTI_WORKFLOW);

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      try {
        await runCommand(filePath, { params: '{"x": 4}' });

        const output = logs.join('\n');
        expect(output).toContain('8'); // 4 * 2 = 8 (doubleWorkflow)
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('output modes', () => {
    it('should output JSON with --json flag', async () => {
      const filePath = path.join(tempDir, 'json-output.ts');
      fs.writeFileSync(filePath, SAMPLE_WORKFLOW);

      const chunks: string[] = [];
      const originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array) => {
        chunks.push(chunk.toString());
        return true;
      }) as typeof process.stdout.write;

      try {
        await runCommand(filePath, {
          params: '{"a": 1, "b": 2}',
          json: true,
        });

        // Should be valid JSON output
        const output = chunks.join('').trim();
        const parsed = JSON.parse(output);

        expect(parsed.success).toBe(true);
        expect(parsed.workflow).toBeDefined();
        expect(parsed.executionTime).toBeDefined();
        expect(parsed.result).toBeDefined();
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  });

  describe('execution options', () => {
    it('should support production mode', async () => {
      const filePath = path.join(tempDir, 'production-mode.ts');
      fs.writeFileSync(filePath, SAMPLE_WORKFLOW);

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      try {
        await runCommand(filePath, {
          params: '{"a": 1, "b": 1}',
          production: true,
        });

        // Should still execute successfully
        const output = logs.join('\n');
        expect(output).toContain('2');
      } finally {
        console.log = originalLog;
      }
    });

    it('should include trace when requested', async () => {
      const filePath = path.join(tempDir, 'trace-mode.ts');
      fs.writeFileSync(filePath, SAMPLE_WORKFLOW);

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      try {
        await runCommand(filePath, {
          params: '{"a": 1, "b": 1}',
          trace: true,
        });

        const output = logs.join('\n');
        // Should mention trace in some form
        expect(output.toLowerCase()).toMatch(/trace|event/i);
      } finally {
        console.log = originalLog;
      }
    });
  });
});
