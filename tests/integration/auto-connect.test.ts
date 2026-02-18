/**
 * Integration tests for @autoConnect
 * Validates that linear pipelines are auto-wired correctly and execute end-to-end.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { generator } from '../../src/generator';
import { parseWorkflow } from '../../src/api/index';
import { validator } from '../../src/validator';

describe('@autoConnect - Integration', () => {
  const outputDir = path.join(os.tmpdir(), `flow-weaver-autoconnect-e2e-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  it('should auto-wire a linear 2-node pipeline (name matching)', async () => {
    const source = `
/** @flowWeaver nodeType @expression */
function formatName(name: string): { formatted: string } {
  return { formatted: name.trim().toUpperCase() };
}

/** @flowWeaver nodeType @expression */
function buildGreeting(formatted: string): { greeting: string } {
  return { greeting: \`Hello, \${formatted}!\` };
}

/**
 * @flowWeaver workflow
 * @autoConnect
 * @node fmt formatName
 * @node greet buildGreeting
 * @param name
 * @returns greeting
 * @returns onSuccess
 * @returns onFailure
 */
export function pipeline(execute: boolean, params: { name: string }): { greeting: string; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(outputDir, 'autoconnect-linear.ts');
    fs.writeFileSync(testFile, source);

    // Validate
    const parseResult = await parseWorkflow(testFile);
    expect(parseResult.errors).toHaveLength(0);

    const validation = validator.validate(parseResult.ast);
    expect(validation.errors).toHaveLength(0);

    // Compile and execute
    const code = await generator.generate(testFile, 'pipeline');
    const outputFile = path.join(outputDir, 'autoconnect-linear.generated.ts');
    fs.writeFileSync(outputFile, code);

    const module = await import(outputFile);
    const result = await module.pipeline(true, { name: '  alice  ' });

    expect(result.greeting).toBe('Hello, ALICE!');
    expect(result.onSuccess).toBe(true);
    expect(result.onFailure).toBe(false);
  });

  it('should auto-wire Start data ports to first node inputs', async () => {
    const source = `
/** @flowWeaver nodeType @expression */
function add(a: number, b: number): { sum: number } {
  return { sum: a + b };
}

/**
 * @flowWeaver workflow
 * @autoConnect
 * @node adder add
 * @param a
 * @param b
 * @returns sum
 * @returns onSuccess
 * @returns onFailure
 */
export function addWorkflow(execute: boolean, params: { a: number; b: number }): { sum: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(outputDir, 'autoconnect-start.ts');
    fs.writeFileSync(testFile, source);

    const parseResult = await parseWorkflow(testFile);
    expect(parseResult.errors).toHaveLength(0);

    const validation = validator.validate(parseResult.ast);
    expect(validation.errors).toHaveLength(0);

    const code = await generator.generate(testFile, 'addWorkflow');
    const outputFile = path.join(outputDir, 'autoconnect-start.generated.ts');
    fs.writeFileSync(outputFile, code);

    const module = await import(outputFile);
    const result = await module.addWorkflow(true, { a: 3, b: 7 });

    expect(result.sum).toBe(10);
    expect(result.onSuccess).toBe(true);
  });

  it('should auto-wire 3-node pipeline with port name matching', async () => {
    const source = `
/** @flowWeaver nodeType @expression */
function step1(input: string): { processed: string } {
  return { processed: input.toUpperCase() };
}

/** @flowWeaver nodeType @expression */
function step2(processed: string): { transformed: string } {
  return { transformed: processed + '!' };
}

/** @flowWeaver nodeType @expression */
function step3(transformed: string): { result: string } {
  return { result: 'Final: ' + transformed };
}

/**
 * @flowWeaver workflow
 * @autoConnect
 * @node s1 step1
 * @node s2 step2
 * @node s3 step3
 * @param input
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function threeStep(execute: boolean, params: { input: string }): { result: string; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(outputDir, 'autoconnect-three.ts');
    fs.writeFileSync(testFile, source);

    const parseResult = await parseWorkflow(testFile);
    expect(parseResult.errors).toHaveLength(0);

    const validation = validator.validate(parseResult.ast);
    expect(validation.errors).toHaveLength(0);

    const code = await generator.generate(testFile, 'threeStep');
    const outputFile = path.join(outputDir, 'autoconnect-three.generated.ts');
    fs.writeFileSync(outputFile, code);

    const module = await import(outputFile);
    const result = await module.threeStep(true, { input: 'hello' });

    expect(result.result).toBe('Final: HELLO!');
    expect(result.onSuccess).toBe(true);
  });

  it('should not auto-connect when explicit @connect annotations exist', async () => {
    const source = `
/** @flowWeaver nodeType @expression */
function double(value: number): { result: number } {
  return { result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @autoConnect
 * @node d double
 * @connect Start.value -> d.value
 * @connect d.result -> Exit.result
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.onFailure -> Exit.onFailure
 * @param value
 * @returns result
 * @returns onSuccess
 * @returns onFailure
 */
export function explicitConnections(execute: boolean, params: { value: number }): { result: number; onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
    const testFile = path.join(outputDir, 'autoconnect-explicit.ts');
    fs.writeFileSync(testFile, source);

    const parseResult = await parseWorkflow(testFile);
    expect(parseResult.errors).toHaveLength(0);

    const validation = validator.validate(parseResult.ast);
    expect(validation.errors).toHaveLength(0);

    const code = await generator.generate(testFile, 'explicitConnections');
    const outputFile = path.join(outputDir, 'autoconnect-explicit.generated.ts');
    fs.writeFileSync(outputFile, code);

    const module = await import(outputFile);
    const result = await module.explicitConnections(true, { value: 5 });

    expect(result.result).toBe(10);
    expect(result.onSuccess).toBe(true);
  });
});
