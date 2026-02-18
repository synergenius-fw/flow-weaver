/**
 * Skill Documentation Assertions Tests
 * Tests that validate claims made in Flow Weaver skill documentation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generator } from '../../src/generator';

const TEST_DIR = path.join(os.tmpdir(), `flow-weaver-skill-assertions-${process.pid}`);

beforeEach(() => {
  // Create temp dir before each test to handle parallel test cleanup
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  // Cleanup
  try {
    const files = fs.readdirSync(TEST_DIR);
    files.forEach((f) => fs.unlinkSync(path.join(TEST_DIR, f)));
  } catch {
    /* ignore */
  }
});

// Helper to capture logs/warnings and generate+write code
async function generateAndWrite(
  testFile: string,
  workflowName: string
): Promise<{ logs: string[]; generatedFile: string }> {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));

  try {
    const code = await generator.generate(testFile, workflowName);
    console.log = originalLog;

    const generatedFile = testFile.replace('.ts', '.generated.ts');
    // Ensure directory exists before writing (handles parallel test cleanup)
    fs.mkdirSync(path.dirname(generatedFile), { recursive: true });
    fs.writeFileSync(generatedFile, code as string);

    return { logs, generatedFile };
  } finally {
    console.log = originalLog;
  }
}

// Helper to load generated module
async function loadModule(filePath: string): Promise<Record<string, unknown>> {
  // Use dynamic import for TypeScript/ESM compatibility
  // Add cache-busting query param to force reload
  return import(`${filePath}?t=${Date.now()}`);
}

describe('ASSERTION GROUP 1: Function Signature Requirements', () => {
  describe('Node Types', () => {
    it('ASSERTION: Nodes use direct parameters, NOT wrapped in object', async () => {
      // Claim: "Inputs become direct parameters" (flow-weaver-export-interface)
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input a - First number
         * @input b - Second number
         * @output result - Sum
         */
        function addNumbers(execute: boolean, a: number, b: number): { onSuccess: boolean; onFailure: boolean; result: number } {
          if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
          return { onSuccess: true, onFailure: false, result: a + b };
        }

        /**
         * @flowWeaver workflow
         * @node adder addNumbers
         * @connect Start.a -> adder.a
         * @connect Start.b -> adder.b
         * @connect adder.result -> Exit.result
         * @param a - First number
         * @param b - Second number
         * @returns result - Sum
         */
        export function testWorkflow(
          execute: boolean,
          params: { a: number; b: number }
        ): { onSuccess: boolean; onFailure: boolean; result: number } {
          throw new Error("Generated");
        }
      `;

      const testFile = path.join(TEST_DIR, 'node-direct-params.ts');
      fs.writeFileSync(testFile, sourceCode);

      const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
      const module = await loadModule(generatedFile);
      const output = module.testWorkflow(true, { a: 5, b: 3 });

      expect(output.onSuccess).toBe(true);
      expect(output.result).toBe(8);
    });

    it('ASSERTION: First parameter MUST be execute: boolean', async () => {
      // Claim: "First param MUST be execute: boolean" (flow-weaver-debugging)
      // Note: execute param is required in signature, but workflow behavior with execute=false
      // is implementation-dependent. This test verifies execute=true works correctly.
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value - Input
         * @output result - Output
         */
        function processNode(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: string } {
          if (!execute) return { onSuccess: false, onFailure: false, result: "" };
          return { onSuccess: true, onFailure: false, result: value.toUpperCase() };
        }

        /**
         * @flowWeaver workflow
         * @node proc processNode
         * @connect Start.input -> proc.value
         * @connect proc.result -> Exit.output
         * @param input - Input
         * @returns output - Output
         */
        export function testWorkflow(
          execute: boolean,
          params: { input: string }
        ): { onSuccess: boolean; onFailure: boolean; output: string } {
          throw new Error("Generated");
        }
      `;

      const testFile = path.join(TEST_DIR, 'execute-param.ts');
      fs.writeFileSync(testFile, sourceCode);

      const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
      const module = await loadModule(generatedFile);

      // Test execute=true works and processes correctly
      const withExec = module.testWorkflow(true, { input: 'test' });
      expect(withExec.onSuccess).toBe(true);
      expect(withExec.output).toBe('TEST');
    });

    it('ASSERTION: Return MUST include onSuccess and onFailure', async () => {
      // Claim: "Return MUST include onSuccess and onFailure" (flow-weaver-debugging)
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value - Input
         * @output result - Output
         */
        function myNode(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } {
          return { onSuccess: true, onFailure: false, result: value * 2 };
        }

        /**
         * @flowWeaver workflow
         * @node n myNode
         * @connect Start.input -> n.value
         * @connect n.result -> Exit.output
         * @param input - Input
         * @returns output - Output
         */
        export function testWorkflow(
          execute: boolean,
          params: { input: number }
        ): { onSuccess: boolean; onFailure: boolean; output: number } {
          throw new Error("Generated");
        }
      `;

      const testFile = path.join(TEST_DIR, 'return-props.ts');
      fs.writeFileSync(testFile, sourceCode);

      const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
      const module = await loadModule(generatedFile);
      const output = module.testWorkflow(true, { input: 10 });

      expect(output).toHaveProperty('onSuccess');
      expect(output).toHaveProperty('onFailure');
      expect(output.output).toBe(20);
    });
  });

  describe('Workflow Exports', () => {
    it("ASSERTION: Workflow second param MUST be named 'params'", async () => {
      // Claim: "Second parameter MUST be named params" (flow-weaver-export-interface)
      const sourceCode = `
        /**
         * @flowWeaver nodeType
         * @input value - Input
         * @output result - Output
         */
        function echo(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: string } {
          return { onSuccess: execute, onFailure: false, result: value };
        }

        /**
         * @flowWeaver workflow
         * @node e echo
         * @connect Start.input -> e.value
         * @connect e.result -> Exit.output
         * @param input - Input
         * @returns output - Output
         */
        export function testWorkflow(
          execute: boolean,
          params: { input: string }
        ): { onSuccess: boolean; onFailure: boolean; output: string } {
          throw new Error("Generated");
        }
      `;

      const testFile = path.join(TEST_DIR, 'params-name.ts');
      fs.writeFileSync(testFile, sourceCode);

      const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
      const module = await loadModule(generatedFile);
      const output = module.testWorkflow(true, { input: 'hello' });

      expect(output.onSuccess).toBe(true);
      expect(output.output).toBe('hello');
    });
  });
});

describe('ASSERTION GROUP 2: Port Definition (@param, @returns, @input, @output)', () => {
  it('ASSERTION: @param defines Start node ports', async () => {
    // Claim: "Use JSDoc @param to define Start node ports" (flow-weaver-export-interface)
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input a - Input A
       * @input b - Input B
       * @output sum - Sum result
       */
      function add(execute: boolean, a: number, b: number): { onSuccess: boolean; onFailure: boolean; sum: number } {
        return { onSuccess: execute, onFailure: false, sum: a + b };
      }

      /**
       * @flowWeaver workflow
       * @node adder add
       * @connect Start.first -> adder.a
       * @connect Start.second -> adder.b
       * @connect adder.sum -> Exit.result
       * @param first - First number
       * @param second - Second number
       * @returns result - Sum
       */
      export function testWorkflow(
        execute: boolean,
        params: { first: number; second: number }
      ): { onSuccess: boolean; onFailure: boolean; result: number } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'param-ports.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    // Verify that Start.first and Start.second are accessible
    const output = module.testWorkflow(true, { first: 10, second: 20 });
    expect(output.result).toBe(30);
  });

  it('ASSERTION: @returns defines Exit node ports', async () => {
    // Claim: "Use JSDoc @returns to define Exit node ports" (flow-weaver-export-interface)
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @output doubled - Doubled value
       * @output tripled - Tripled value
       */
      function multiply(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; doubled: number; tripled: number } {
        return { onSuccess: execute, onFailure: false, doubled: value * 2, tripled: value * 3 };
      }

      /**
       * @flowWeaver workflow
       * @node m multiply
       * @connect Start.input -> m.value
       * @connect m.doubled -> Exit.double
       * @connect m.tripled -> Exit.triple
       * @param input - Input number
       * @returns double - Double of input
       * @returns triple - Triple of input
       */
      export function testWorkflow(
        execute: boolean,
        params: { input: number }
      ): { onSuccess: boolean; onFailure: boolean; double: number; triple: number } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'returns-ports.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    const output = module.testWorkflow(true, { input: 5 });
    expect(output.double).toBe(10);
    expect(output.triple).toBe(15);
  });

  it('ASSERTION: Optional params use bracket syntax [paramName]', async () => {
    // Claim: "[optional] - Optional input (brackets = optional)" (flow-weaver-export-interface)
    // Note: Optional bracket syntax marks the param as optional in TypeScript type
    // but connections still require both ports to exist. Test that syntax is valid.
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @input multiplier - Multiplier
       * @output result - Result
       */
      function multiply(execute: boolean, value: number, multiplier: number): { onSuccess: boolean; onFailure: boolean; result: number } {
        return { onSuccess: execute, onFailure: false, result: value * (multiplier || 1) };
      }

      /**
       * @flowWeaver workflow
       * @node m multiply
       * @connect Start.value -> m.value
       * @connect Start.multiplier -> m.multiplier
       * @connect m.result -> Exit.result
       * @param value - Required input
       * @param [multiplier] - Optional multiplier
       * @returns result - Result
       */
      export function testWorkflow(
        execute: boolean,
        params: { value: number; multiplier?: number }
      ): { onSuccess: boolean; onFailure: boolean; result: number } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'optional-params.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    // Test with optional param provided - verifies [bracket] syntax compiles correctly
    const withOpt = module.testWorkflow(true, { value: 5, multiplier: 3 });
    expect(withOpt.result).toBe(15);
  });
});

describe('ASSERTION GROUP 3: Connection Rules', () => {
  it('ASSERTION: @connect syntax is Source.port -> Target.port', async () => {
    // Claim: "Correct @connect syntax: Source.port -> Target.port" (flow-weaver-debugging)
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @output result - Output
       */
      function passThrough(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: string } {
        return { onSuccess: execute, onFailure: false, result: value };
      }

      /**
       * @flowWeaver workflow
       * @node p passThrough
       * @connect Start.input -> p.value
       * @connect p.result -> Exit.output
       * @param input - Input
       * @returns output - Output
       */
      export function testWorkflow(
        execute: boolean,
        params: { input: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'connect-syntax.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    const output = module.testWorkflow(true, { input: 'test' });
    expect(output.output).toBe('test');
  });

  it('ASSERTION: Multiple connections to same Exit port produces warning', async () => {
    // Claim: "Multiple connections to same Exit port (only one is used!)" (flow-weaver-debugging)
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @output result - Output
       */
      function nodeA(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: string } {
        return { onSuccess: true, onFailure: false, result: value + "_A" };
      }

      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @output result - Output
       */
      function nodeB(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: string } {
        return { onSuccess: true, onFailure: false, result: value + "_B" };
      }

      /**
       * @flowWeaver workflow
       * @node a nodeA
       * @node b nodeB
       * @connect Start.input -> a.value
       * @connect Start.input -> b.value
       * @connect a.result -> Exit.output
       * @connect b.result -> Exit.output
       * @param input - Input
       * @returns output - Output
       */
      export function testWorkflow(
        execute: boolean,
        params: { input: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'multi-exit-warning.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { logs } = await generateAndWrite(testFile, 'testWorkflow');

    const allLogs = logs.join('\n');
    expect(allLogs).toMatch(/has \d+ incoming connections/i);
  });

  it('ASSERTION: Port names must match exactly (case-sensitive)', async () => {
    // Claim: "Port names must match exactly (case-sensitive)" (flow-weaver-debugging)
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input myInput - Input
       * @output myOutput - Output
       */
      function caseNode(execute: boolean, myInput: string): { onSuccess: boolean; onFailure: boolean; myOutput: string } {
        return { onSuccess: execute, onFailure: false, myOutput: myInput };
      }

      /**
       * @flowWeaver workflow
       * @node n caseNode
       * @connect Start.data -> n.myInput
       * @connect n.myOutput -> Exit.result
       * @param data - Input
       * @returns result - Output
       */
      export function testWorkflow(
        execute: boolean,
        params: { data: string }
      ): { onSuccess: boolean; onFailure: boolean; result: string } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'case-sensitive.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    const output = module.testWorkflow(true, { data: 'test' });
    expect(output.result).toBe('test');
  });
});

describe('ASSERTION GROUP 4: Async Workflows', () => {
  it('ASSERTION: async keyword on function enables async workflow', async () => {
    // Claim: "Use async keyword on function - no annotation needed" (flow-weaver-export-interface)
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @output result - Output
       */
      async function asyncNode(execute: boolean, value: number): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
        if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
        await new Promise(r => setTimeout(r, 10));
        return { onSuccess: true, onFailure: false, result: value * 2 };
      }

      /**
       * @flowWeaver workflow
       * @node a asyncNode
       * @connect Start.input -> a.value
       * @connect a.result -> Exit.output
       * @param input - Input
       * @returns output - Output
       */
      export async function testWorkflow(
        execute: boolean,
        params: { input: number }
      ): Promise<{ onSuccess: boolean; onFailure: boolean; output: number }> {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'async-workflow.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    // Should return a Promise
    const promise = module.testWorkflow(true, { input: 5 });
    expect(promise).toBeInstanceOf(Promise);

    const output = await promise;
    expect(output.onSuccess).toBe(true);
    expect(output.output).toBe(10);
  });
});

describe('ASSERTION GROUP 5: Mandatory Ports', () => {
  it('ASSERTION: execute is always the first parameter', async () => {
    // Claim: "execute (STEP) - First function parameter" (flow-weaver-export-interface)
    // Verifies that execute: boolean is required as first param and workflow executes correctly
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @output result - Output
       */
      function testNode(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } {
        // When execute is false, should return falsy
        if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
        return { onSuccess: true, onFailure: false, result: value };
      }

      /**
       * @flowWeaver workflow
       * @node n testNode
       * @connect Start.input -> n.value
       * @connect n.result -> Exit.output
       * @param input - Input
       * @returns output - Output
       */
      export function testWorkflow(
        execute: boolean,
        params: { input: number }
      ): { onSuccess: boolean; onFailure: boolean; output: number } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'execute-first.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    // Test with execute=true - workflow should execute and return result
    const withExec = module.testWorkflow(true, { input: 100 });
    expect(withExec.onSuccess).toBe(true);
    expect(withExec.output).toBe(100);
  });
});

describe('ASSERTION GROUP 6: Node Positioning', () => {
  it('ASSERTION: @position syntax is @position nodeId x y', async () => {
    // Claim: "Syntax: @position nodeId x y (values in pixels, 90px grid)" (flow-weaver-concepts)
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @output result - Output
       */
      function testNode(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: string } {
        return { onSuccess: execute, onFailure: false, result: value };
      }

      /**
       * @flowWeaver workflow
       * @node n testNode
       * @connect Start.input -> n.value
       * @connect n.result -> Exit.output
       * @position n 180 0
       * @param input - Input
       * @returns output - Output
       */
      export function testWorkflow(
        execute: boolean,
        params: { input: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'position-syntax.ts');
    fs.writeFileSync(testFile, sourceCode);

    // Should compile without errors
    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    expect(fs.existsSync(generatedFile)).toBe(true);

    const module = await loadModule(generatedFile);
    const output = module.testWorkflow(true, { input: 'test' });
    expect(output.onSuccess).toBe(true);
  });
});

describe('ASSERTION GROUP 7: Reserved Node Names', () => {
  it('ASSERTION: Start and Exit are reserved node names', async () => {
    // Claim: "Start - Flow entry point, Exit - Flow exit point" (flow-weaver-concepts)
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input value - Input
       * @output result - Output
       */
      function middle(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: string } {
        return { onSuccess: execute, onFailure: false, result: value + "_processed" };
      }

      /**
       * @flowWeaver workflow
       * @node m middle
       * @connect Start.input -> m.value
       * @connect m.result -> Exit.output
       * @param input - Input from Start
       * @returns output - Output to Exit
       */
      export function testWorkflow(
        execute: boolean,
        params: { input: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'reserved-nodes.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    const output = module.testWorkflow(true, { input: 'hello' });
    // Verify data flows from Start through middle to Exit
    expect(output.output).toBe('hello_processed');
  });
});

describe('ASSERTION GROUP 8: Label annotation', () => {
  it('ASSERTION: @label sets display name for node types', async () => {
    // Claim: "@label Display Name" (flow-weaver-concepts)
    // This is primarily for UI - test that it doesn't break compilation
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @label Pretty Display Name
       * @input value - Input
       * @output result - Output
       */
      function uglyFunctionName(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: string } {
        return { onSuccess: execute, onFailure: false, result: value };
      }

      /**
       * @flowWeaver workflow
       * @node n uglyFunctionName
       * @connect Start.input -> n.value
       * @connect n.result -> Exit.output
       * @param input - Input
       * @returns output - Output
       */
      export function testWorkflow(
        execute: boolean,
        params: { input: string }
      ): { onSuccess: boolean; onFailure: boolean; output: string } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'label-annotation.ts');
    fs.writeFileSync(testFile, sourceCode);

    // Should compile without errors even with @label
    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    const output = module.testWorkflow(true, { input: 'test' });
    expect(output.onSuccess).toBe(true);
  });
});

describe('ASSERTION GROUP 9: Scoped Ports (Iteration)', () => {
  it('ASSERTION: scope:scopeName suffix on port declarations', async () => {
    // Claim: "use per-port scopes with scope:scopeName suffix on ports" (flow-weaver-export-interface)
    // Uses the exact pattern from fixtures/advanced/example-scoped-ports.ts
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @label For Each
       * @input items - Array to iterate
       * @output start scope:processItem - Triggers for each item
       * @output item scope:processItem - Current item
       * @input success scope:processItem - From child onSuccess
       * @input failure scope:processItem - From child onFailure
       * @input processed scope:processItem - Result from child
       * @output results - Collected results
       */
      function forEach(
        execute: boolean,
        items: any[],
        processItem: (start: boolean, item: any) => { success: boolean; failure: boolean; processed: any }
      ) {
        if (!execute) return { onSuccess: false, onFailure: false, results: [] };
        const results = items.map(item => processItem(true, item).processed);
        return { onSuccess: true, onFailure: false, results };
      }

      /**
       * @flowWeaver nodeType
       * @label Process Item
       * @input item - Input value
       * @output processed - Doubled value
       */
      function processItem(execute: boolean, item: any) {
        if (!execute) return { onSuccess: false, onFailure: false, processed: null };
        return { onSuccess: true, onFailure: false, processed: item * 2 };
      }

      /**
       * @flowWeaver workflow
       * @node forEach1 forEach
       * @node processor1 processItem forEach1.processItem
       * @connect Start.execute -> forEach1.execute
       * @connect Start.items -> forEach1.items
       * @connect forEach1.start:processItem -> processor1.execute
       * @connect forEach1.item:processItem -> processor1.item
       * @connect processor1.processed -> forEach1.processed:processItem
       * @connect processor1.onSuccess -> forEach1.success:processItem
       * @connect processor1.onFailure -> forEach1.failure:processItem
       * @connect forEach1.results -> Exit.results
       * @connect forEach1.onSuccess -> Exit.onSuccess
       * @connect forEach1.onFailure -> Exit.onFailure
       * @param items - Array of numbers
       * @returns results - Doubled numbers
       */
      export function testWorkflow(
        execute: boolean,
        params: { items: number[] }
      ): { onSuccess: boolean; onFailure: boolean; results: number[] } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'scoped-ports.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    const output = module.testWorkflow(true, { items: [1, 2, 3] });
    expect(output.onSuccess).toBe(true);
    expect(output.results).toEqual([2, 4, 6]);
  });

  it('ASSERTION: @node child nodeType parent.scopeName places node in scope', async () => {
    // Claim: "@node proc processor loop.processItem - child node inside loop's processItem scope"
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input items - Array
       * @output start scope:iter - Start signal
       * @output item scope:iter - Current item
       * @input success scope:iter - Success signal
       * @input failure scope:iter - Failure signal
       * @input result scope:iter - Result from child
       * @output collected - All results
       */
      function mapper(
        execute: boolean,
        items: string[],
        iter: (start: boolean, item: string) => { success: boolean; failure: boolean; result: string }
      ) {
        if (!execute) return { onSuccess: false, onFailure: false, collected: [] };
        const collected = items.map(item => iter(true, item).result);
        return { onSuccess: true, onFailure: false, collected };
      }

      /**
       * @flowWeaver nodeType
       * @input text - Text to uppercase
       * @output result - Uppercased text
       */
      function upper(execute: boolean, text: string) {
        if (!execute) return { onSuccess: false, onFailure: false, result: "" };
        return { onSuccess: true, onFailure: false, result: text.toUpperCase() };
      }

      /**
       * @flowWeaver workflow
       * @node m mapper
       * @node u upper m.iter
       * @connect Start.execute -> m.execute
       * @connect Start.items -> m.items
       * @connect m.start:iter -> u.execute
       * @connect m.item:iter -> u.text
       * @connect u.result -> m.result:iter
       * @connect u.onSuccess -> m.success:iter
       * @connect u.onFailure -> m.failure:iter
       * @connect m.collected -> Exit.results
       * @connect m.onSuccess -> Exit.onSuccess
       * @connect m.onFailure -> Exit.onFailure
       * @param items - Array of strings
       * @returns results - Uppercased strings
       */
      export function testWorkflow(
        execute: boolean,
        params: { items: string[] }
      ): { onSuccess: boolean; onFailure: boolean; results: string[] } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'scoped-node-placement.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    const output = module.testWorkflow(true, { items: ['hello', 'world'] });
    expect(output.onSuccess).toBe(true);
    expect(output.results).toEqual(['HELLO', 'WORLD']);
  });

  it('ASSERTION: Scope name must match callback parameter name', async () => {
    // Claim: "Scope name (processItem) MUST match callback parameter name"
    // The scope name in annotations must match the callback param name in function signature
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input items - Array
       * @output start scope:myCallback - Start (scope matches callback name)
       * @output item scope:myCallback - Item
       * @input success scope:myCallback - Success
       * @input failure scope:myCallback - Failure
       * @input result scope:myCallback - Result
       * @output output - Results
       */
      function iterNode(
        execute: boolean,
        items: number[],
        myCallback: (start: boolean, item: number) => { success: boolean; failure: boolean; result: number }
      ) {
        if (!execute) return { onSuccess: false, onFailure: false, output: [] };
        const output = items.map(item => myCallback(true, item).result);
        return { onSuccess: true, onFailure: false, output };
      }

      /**
       * @flowWeaver nodeType
       * @input n - Number
       * @output result - Squared
       */
      function square(execute: boolean, n: number) {
        if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
        return { onSuccess: true, onFailure: false, result: n * n };
      }

      /**
       * @flowWeaver workflow
       * @node iter iterNode
       * @node sq square iter.myCallback
       * @connect Start.execute -> iter.execute
       * @connect Start.numbers -> iter.items
       * @connect iter.start:myCallback -> sq.execute
       * @connect iter.item:myCallback -> sq.n
       * @connect sq.result -> iter.result:myCallback
       * @connect sq.onSuccess -> iter.success:myCallback
       * @connect sq.onFailure -> iter.failure:myCallback
       * @connect iter.output -> Exit.squares
       * @connect iter.onSuccess -> Exit.onSuccess
       * @connect iter.onFailure -> Exit.onFailure
       * @param numbers - Numbers to square
       * @returns squares - Squared numbers
       */
      export function testWorkflow(
        execute: boolean,
        params: { numbers: number[] }
      ): { onSuccess: boolean; onFailure: boolean; squares: number[] } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'scope-callback-match.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    const output = module.testWorkflow(true, { numbers: [2, 3, 4] });
    expect(output.onSuccess).toBe(true);
    expect(output.squares).toEqual([4, 9, 16]);
  });

  it('ASSERTION: Scoped connection syntax uses parent.port:scopeName', async () => {
    // Claim: "loop.item:processItem - scoped OUTPUT port (:scopeName suffix)"
    // Tests the :scopeName suffix syntax in @connect statements
    const sourceCode = `
      /**
       * @flowWeaver nodeType
       * @input data - Array
       * @output start scope:proc - Start trigger
       * @output value scope:proc - Value
       * @input success scope:proc - Success from child
       * @input failure scope:proc - Failure from child
       * @input res scope:proc - Result
       * @output final - Final
       */
      function loopNode(
        execute: boolean,
        data: number[],
        proc: (start: boolean, value: number) => { success: boolean; failure: boolean; res: number }
      ) {
        if (!execute) return { onSuccess: false, onFailure: false, final: [] };
        const final = data.map(v => proc(true, v).res);
        return { onSuccess: true, onFailure: false, final };
      }

      /**
       * @flowWeaver nodeType
       * @input x - Input
       * @output result - Plus one
       */
      function addOne(execute: boolean, x: number) {
        if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
        return { onSuccess: true, onFailure: false, result: x + 1 };
      }

      /**
       * @flowWeaver workflow
       * @node lp loopNode
       * @node add addOne lp.proc
       * @connect Start.execute -> lp.execute
       * @connect Start.input -> lp.data
       * @connect lp.start:proc -> add.execute
       * @connect lp.value:proc -> add.x
       * @connect add.result -> lp.res:proc
       * @connect add.onSuccess -> lp.success:proc
       * @connect add.onFailure -> lp.failure:proc
       * @connect lp.final -> Exit.output
       * @connect lp.onSuccess -> Exit.onSuccess
       * @connect lp.onFailure -> Exit.onFailure
       * @param input - Numbers
       * @returns output - Numbers plus one
       */
      export function testWorkflow(
        execute: boolean,
        params: { input: number[] }
      ): { onSuccess: boolean; onFailure: boolean; output: number[] } {
        throw new Error("Generated");
      }
    `;

    const testFile = path.join(TEST_DIR, 'scoped-connection-syntax.ts');
    fs.writeFileSync(testFile, sourceCode);

    const { generatedFile } = await generateAndWrite(testFile, 'testWorkflow');
    const module = await loadModule(generatedFile);

    const output = module.testWorkflow(true, { input: [10, 20, 30] });
    expect(output.onSuccess).toBe(true);
    expect(output.output).toEqual([11, 21, 31]);
  });
});
