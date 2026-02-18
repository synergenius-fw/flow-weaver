/**
 * Tests for generated code formatting and readability improvements
 *
 * Ensures the following code quality fixes remain in place:
 * 1. No empty else blocks
 * 2. No unnecessary non-null assertions on const variables
 * 3. Use const for nodes that always execute, let for conditional nodes
 * 4. No unnecessary undefined checks in exit code for const nodes
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generator } from '../../src/generator';

describe('Generated Code Formatting', () => {
  const uniqueId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempDir = path.join(os.tmpdir(), `flow-weaver-formatting-${uniqueId}`);

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('Simple Chain (no branching)', () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function addOne(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @node n1 addOne
 * @node n2 addOne
 * @connect Start.value -> n1.value
 * @connect n1.result -> n2.value
 * @connect n2.result -> Exit.result
 */
export function simpleChain(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}
`;

    let generatedCode: string;

    beforeAll(async () => {
      fs.mkdirSync(tempDir, { recursive: true });
      const sourceFile = path.join(tempDir, 'simple-chain.ts');
      fs.writeFileSync(sourceFile, sourceCode, 'utf-8');
      generatedCode = await generator.generate(sourceFile, 'simpleChain');
    });

    it('should use const for node index declarations (not let)', () => {
      // Simple chain nodes always execute, so should use const
      expect(generatedCode).toContain("const n1Idx = ctx.addExecution('n1')");
      expect(generatedCode).toContain("const n2Idx = ctx.addExecution('n2')");

      // Should NOT have let declarations for these nodes
      expect(generatedCode).not.toContain('let n1Idx:');
      expect(generatedCode).not.toContain('let n2Idx:');
    });

    it('should not have unnecessary non-null assertions after const declarations', () => {
      // startIdx is const, so no ! needed
      expect(generatedCode).toContain('executionIndex: startIdx }');
      expect(generatedCode).not.toMatch(/executionIndex: startIdx!/);
    });

    it('should not have undefined checks for const node indices in exit code', () => {
      // n2 always executes, so no undefined check needed
      expect(generatedCode).toMatch(/const exit_result = .*ctx\.getVariable\(\{ id: 'n2'/);
      expect(generatedCode).not.toMatch(/n2Idx !== undefined \?/);
    });
  });

  describe('Branching Workflow', () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function validate(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  if (value < 0) return { onSuccess: false, onFailure: true, result: 0 };
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function double(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node validator validate
 * @node doubler double
 * @connect Start.value -> validator.value
 * @connect validator.onSuccess -> doubler.execute
 * @connect validator.result -> doubler.value
 * @connect doubler.result -> Exit.result
 */
export function branchingWorkflow(
  execute: boolean,
  params: { value: number }
): { onSuccess?: boolean; onFailure?: boolean; result?: number } {
  throw new Error('Not implemented');
}
`;

    let generatedCode: string;

    beforeAll(async () => {
      fs.mkdirSync(tempDir, { recursive: true });
      const sourceFile = path.join(tempDir, 'branching.ts');
      fs.writeFileSync(sourceFile, sourceCode, 'utf-8');
      generatedCode = await generator.generate(sourceFile, 'branchingWorkflow');
    });

    it('should use let for branching node (validator)', () => {
      // Branching nodes need let for success flag tracking
      expect(generatedCode).toContain('let validatorIdx:');
    });

    it('should use let for nodes in success branch (doubler)', () => {
      // doubler is in success branch, might not execute
      expect(generatedCode).toContain('let doublerIdx:');
    });

    it('should NOT generate empty else blocks', () => {
      // When there's only a success branch (no failure branch nodes),
      // should not generate empty else { }
      expect(generatedCode).not.toMatch(/\}\s*else\s*\{\s*\}/);
    });

    it('should have undefined check for conditional node in exit code', () => {
      // doubler might not execute, so needs undefined check
      expect(generatedCode).toMatch(/doublerIdx !== undefined \?/);
    });

    it('should use non-null assertion only for let variables', () => {
      // validatorIdx is let, so needs ! when reading
      expect(generatedCode).toMatch(/executionIndex: validatorIdx!/);
    });
  });

  describe('Scoped Workflow (node-level scope)', () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @label Container
 * @scope container
 * @input value
 * @output value - Pass value to children in scope
 */
function container(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, value: 0 };
  return { onSuccess: true, onFailure: false, value };
}

/**
 * @flowWeaver nodeType
 * @input input
 * @output output
 */
function addTen(execute: boolean, input: number) {
  if (!execute) return { onSuccess: false, onFailure: false, output: 0 };
  return { onSuccess: true, onFailure: false, output: input + 10 };
}

/**
 * @flowWeaver workflow
 * @node cont container
 * @node child addTen cont.container
 * @connect Start.value -> cont.value
 * @connect cont.value -> child.input
 * @connect child.output -> Exit.result
 * @scope cont.container [child]
 */
export function scopedWorkflow(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}
`;

    let generatedCode: string;

    beforeAll(async () => {
      fs.mkdirSync(tempDir, { recursive: true });
      const sourceFile = path.join(tempDir, 'scoped.ts');
      fs.writeFileSync(sourceFile, sourceCode, 'utf-8');
      generatedCode = await generator.generate(sourceFile, 'scopedWorkflow');
    });

    it('should use const for parent node (container)', () => {
      // container is not in a branch, should use const
      expect(generatedCode).toContain("const contIdx = ctx.addExecution('cont')");
    });

    it('should not have non-null assertion when scope child references parent', () => {
      // When child references parent (cont), parent is const so no ! needed
      // Find lines with getVariable and cont
      const lines = generatedCode.split('\n');
      const contLines = lines.filter((l) => l.includes('getVariable') && l.includes("'cont'"));
      // All cont references should NOT have contIdx!
      contLines.forEach((line) => {
        expect(line).not.toContain('contIdx!');
      });
      // At least one reference should exist
      expect(contLines.length).toBeGreaterThan(0);
    });

    it('should use let for scope children (referenced outside scope block)', () => {
      // child is in a scope block but referenced for Exit, needs let
      expect(generatedCode).toContain('let childIdx:');
    });
  });

  describe("No 'any' type assertions", () => {
    const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function identity(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value };
}

/**
 * @flowWeaver workflow
 * @node n1 identity
 * @connect Start.value -> n1.value
 * @connect n1.result -> Exit.result
 */
export function noAnyAssertions(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  throw new Error('Not implemented');
}
`;

    let generatedCode: string;

    beforeAll(async () => {
      fs.mkdirSync(tempDir, { recursive: true });
      const sourceFile = path.join(tempDir, 'no-any.ts');
      fs.writeFileSync(sourceFile, sourceCode, 'utf-8');
      generatedCode = await generator.generate(sourceFile, 'noAnyAssertions');
    });

    it("should not use double 'as' assertions for __rd__", () => {
      // Should NOT have: (params as any)?.__rd__ ?? 0) as number
      expect(generatedCode).not.toMatch(/as any.*as number/);
      // Should have properly typed access
      expect(generatedCode).toContain('__rd__');
    });

    it('should use typed assertion for __rd__ access', () => {
      // Should have: (params as { __rd__?: number }).__rd__ ?? 0
      expect(generatedCode).toContain('params as { __rd__?: number }');
    });

    it("should use 'unknown' for error type in catch blocks", () => {
      // Catch blocks should use unknown instead of any
      expect(generatedCode).toContain('catch (error: unknown)');
      expect(generatedCode).not.toContain('catch (error: any)');
    });

    it('should use instanceof check for error message access', () => {
      // Should use: error instanceof Error ? error.message : String(error)
      expect(generatedCode).toContain('error instanceof Error ? error.message : String(error)');
      expect(generatedCode).not.toContain('error.message || String(error)');
    });
  });
});
