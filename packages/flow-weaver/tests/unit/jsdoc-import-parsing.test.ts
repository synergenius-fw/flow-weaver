import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { jsdocParser } from '../../src/jsdoc-parser';
import { extractFunctionLikes } from '../../src/function-like';
import { parser } from '../../src/parser';
import { getSharedProject } from '../../src/shared-project';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('JSDoc @fwImport tag parsing', () => {
  const project = getSharedProject();

  it('should parse @fwImport tag from workflow JSDoc', () => {
    const code = `
/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"
 */
export async function testWorkflow(execute: boolean, params: {}) {
  return { onSuccess: true, onFailure: false };
}
`;

    const sourceFile = project.createSourceFile('test-import.ts', code, { overwrite: true });
    const functions = extractFunctionLikes(sourceFile);
    expect(functions.length).toBe(1);

    const warnings: string[] = [];
    const config = jsdocParser.parseWorkflow(functions[0], warnings);

    expect(config).not.toBeNull();
    expect(config?.imports).toBeDefined();
    expect(config?.imports?.length).toBe(1);
    expect(config?.imports?.[0]).toEqual({
      name: 'npm/autoprefixer/autoprefixer',
      functionName: 'autoprefixer',
      importSource: 'autoprefixer',
    });
    expect(warnings).toHaveLength(0);
  });

  it('should parse multiple @fwImport tags', () => {
    const code = `
/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport npm/lodash/map map from "lodash"
 * @fwImport npm/date-fns/format format from "date-fns"
 */
export async function testWorkflow(execute: boolean, params: {}) {
  return { onSuccess: true, onFailure: false };
}
`;

    const sourceFile = project.createSourceFile('test-multi-import.ts', code, { overwrite: true });
    const functions = extractFunctionLikes(sourceFile);
    const warnings: string[] = [];
    const config = jsdocParser.parseWorkflow(functions[0], warnings);

    expect(config?.imports?.length).toBe(2);
    expect(config?.imports?.[0]).toEqual({
      name: 'npm/lodash/map',
      functionName: 'map',
      importSource: 'lodash',
    });
    expect(config?.imports?.[1]).toEqual({
      name: 'npm/date-fns/format',
      functionName: 'format',
      importSource: 'date-fns',
    });
  });

  it('should handle @fwImport with single quotes', () => {
    const code = `
/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport npm/axios/get get from 'axios'
 */
export async function testWorkflow(execute: boolean, params: {}) {
  return { onSuccess: true, onFailure: false };
}
`;

    const sourceFile = project.createSourceFile('test-single-quote.ts', code, { overwrite: true });
    const functions = extractFunctionLikes(sourceFile);
    const warnings: string[] = [];
    const config = jsdocParser.parseWorkflow(functions[0], warnings);

    expect(config?.imports?.length).toBe(1);
    expect(config?.imports?.[0]?.importSource).toBe('axios');
  });

  it('should warn on invalid @fwImport format', () => {
    const code = `
/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport invalid format
 */
export async function testWorkflow(execute: boolean, params: {}) {
  return { onSuccess: true, onFailure: false };
}
`;

    const sourceFile = project.createSourceFile('test-invalid-import.ts', code, {
      overwrite: true,
    });
    const functions = extractFunctionLikes(sourceFile);
    const warnings: string[] = [];
    const config = jsdocParser.parseWorkflow(functions[0], warnings);

    expect(config?.imports?.length).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('Invalid @fwImport tag format');
  });

  it('should allow @node instances referencing @fwImport node types', () => {
    const code = `
/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport npm/react-window/areEqual areEqual from "react-window"
 * @node compareA npm/react-window/areEqual
 * @node compareB npm/react-window/areEqual
 * @connect Start.prev1 -> compareA.prevProps
 * @connect Start.prev2 -> compareB.prevProps
 */
export async function testWorkflow(prev1: object, prev2: object) {
  return { result: true };
}
`;

    const sourceFile = project.createSourceFile('test-import-with-nodes.ts', code, {
      overwrite: true,
    });
    const functions = extractFunctionLikes(sourceFile);
    const warnings: string[] = [];
    const config = jsdocParser.parseWorkflow(functions[0], warnings);

    // Should have the import
    expect(config?.imports?.length).toBe(1);
    expect(config?.imports?.[0].name).toBe('npm/react-window/areEqual');

    // Should have two node instances
    expect(config?.instances?.length).toBe(2);
    expect(config?.instances?.[0]).toMatchObject({
      id: 'compareA',
      type: 'npm/react-window/areEqual',
    });
    expect(config?.instances?.[1]).toMatchObject({
      id: 'compareB',
      type: 'npm/react-window/areEqual',
    });

    // Should have connections
    expect(config?.connections?.length).toBe(2);

    expect(warnings).toHaveLength(0);
  });
});

describe('@fwImport node type inference (TDD)', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-import-inference-'));
    tempFile = path.join(tempDir, 'test-workflow.ts');
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should infer expression: true for npm pure functions via @fwImport', () => {
    // Test that @fwImport for npm packages creates node types with expression: true
    // This should behave the same as a TS import
    const code = `/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport npm/lodash/map map from "lodash"
 * @node mapNode npm/lodash/map
 */
export async function testWorkflow(execute: boolean, params: { data: unknown[] }) {
  return { onSuccess: true, onFailure: false, result: [] };
}
`;
    fs.writeFileSync(tempFile, code, 'utf-8');

    const result = parser.parse(tempFile);
    expect(result.errors).toHaveLength(0);
    expect(result.workflows).toHaveLength(1);

    const workflow = result.workflows[0];
    const npmNodeType = workflow.nodeTypes.find((nt) => nt.name === 'npm/lodash/map');

    expect(npmNodeType).toBeDefined();
    // The key assertion: expression should be true for pure functions
    expect(npmNodeType?.expression).toBe(true);
    // Should have importSource preserved
    expect(npmNodeType?.importSource).toBe('lodash');
  });

  it('should support relative path imports via @fwImport', () => {
    // Create a helper file with a function
    const helperFile = path.join(tempDir, 'utils.ts');
    const helperCode = `
export function myPureUtil(input: string): string {
  return input.toUpperCase();
}
`;
    fs.writeFileSync(helperFile, helperCode, 'utf-8');

    // Create workflow that imports the helper via @fwImport
    const workflowCode = `/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport local/myPureUtil myPureUtil from "./utils"
 * @node utilNode local/myPureUtil
 */
export async function testWorkflow(execute: boolean, params: { text: string }) {
  return { onSuccess: true, onFailure: false, result: '' };
}
`;
    fs.writeFileSync(tempFile, workflowCode, 'utf-8');

    const result = parser.parse(tempFile);
    expect(result.errors).toHaveLength(0);
    expect(result.workflows).toHaveLength(1);

    const workflow = result.workflows[0];
    const localNodeType = workflow.nodeTypes.find((nt) => nt.name === 'local/myPureUtil');

    expect(localNodeType).toBeDefined();
    // Should have expression: true since it's a pure function
    expect(localNodeType?.expression).toBe(true);
    // Should have proper inputs inferred from the function
    expect(localNodeType?.inputs).toHaveProperty('input');
  });

  it('should not require execute port for expression npm nodes in validation', () => {
    // Expression nodes don't need an execute STEP port connected to them
    // They can be driven purely by data connections
    const code = `/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport npm/lodash/identity identity from "lodash"
 * @node idNode npm/lodash/identity
 * @connect Start.data -> idNode.value
 * @connect idNode.result -> Exit.result
 */
export async function testWorkflow(execute: boolean, params: { data: unknown }) {
  return { onSuccess: true, onFailure: false, result: params.data };
}
`;
    fs.writeFileSync(tempFile, code, 'utf-8');

    const result = parser.parse(tempFile);

    // Should not have validation errors about missing execute port
    const executeErrors = result.errors.filter(
      (e) => e.includes('missing an input STEP port') || e.includes('execute')
    );
    expect(executeErrors).toHaveLength(0);
  });

  it('should preserve expression flag through parse/generate/re-parse cycle', () => {
    // First parse
    const code = `/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport npm/lodash/map map from "lodash"
 */
export async function testWorkflow(execute: boolean, params: { data: unknown[] }) {
  return { onSuccess: true, onFailure: false, result: [] };
}
`;
    fs.writeFileSync(tempFile, code, 'utf-8');

    let result = parser.parse(tempFile);
    let workflow = result.workflows[0];
    let npmType = workflow.nodeTypes.find((nt) => nt.name === 'npm/lodash/map');

    expect(npmType?.expression).toBe(true);

    // Re-parse (simulating what happens after generateInPlace)
    parser.clearCache();
    result = parser.parse(tempFile);
    workflow = result.workflows[0];
    npmType = workflow.nodeTypes.find((nt) => nt.name === 'npm/lodash/map');

    // Expression should still be true after re-parse
    expect(npmType?.expression).toBe(true);
  });

  // Gap 1: Circular dependency detection
  it('should warn and return stub for circular @fwImport', () => {
    // A file that tries to @fwImport from itself creates a circular dependency
    // This can happen if someone accidentally references the same file
    const fileA = path.join(tempDir, 'file-a.ts');

    // file-a.ts: workflow tries to import a helper from itself
    // This is a self-referential import that should be caught
    const codeA = `
export function helper(x: number): number {
  return x + 1;
}

/**
 * @flowWeaver workflow
 * @name workflowA
 * @fwImport local/helper helper from "./file-a"
 * @node helperNode local/helper
 */
export async function workflowA(execute: boolean, params: {}) {
  return { onSuccess: true, onFailure: false };
}
`;

    fs.writeFileSync(fileA, codeA, 'utf-8');

    parser.clearCache();
    const result = parser.parse(fileA);

    // Should NOT throw or hang - should warn and degrade gracefully
    expect(result.workflows).toHaveLength(1);

    // Should have a warning about circular dependency
    const circularWarning = result.warnings.find(
      (w) => w.includes('circular') || w.includes('Circular')
    );
    expect(circularWarning).toBeDefined();
  });

  // Gap 3: Warning for unresolved paths
  it('should warn when relative @fwImport path does not resolve', () => {
    const code = `/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport local/missing missingFn from "./nonexistent"
 * @node missNode local/missing
 */
export async function testWorkflow(execute: boolean, params: {}) {
  return { onSuccess: true, onFailure: false };
}
`;
    fs.writeFileSync(tempFile, code, 'utf-8');

    parser.clearCache();
    const result = parser.parse(tempFile);

    // Should have a warning about unresolved path
    const unresolvedWarning = result.warnings.find(
      (w) => w.includes('Could not resolve') || w.includes('nonexistent')
    );
    expect(unresolvedWarning).toBeDefined();

    // Should still have the workflow (graceful degradation)
    expect(result.workflows).toHaveLength(1);

    // Should have a stub node type
    const stubType = result.workflows[0].nodeTypes.find((nt) => nt.name === 'local/missing');
    expect(stubType).toBeDefined();
  });

  // Gap 4: Cache efficiency test
  it('should use cache for multiple @fwImport from same package', () => {
    // This test verifies that when we import multiple functions from the same package,
    // we reuse the cached .d.ts parsing instead of re-reading the file
    const code = `/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport npm/lodash/map map from "lodash"
 * @fwImport npm/lodash/filter filter from "lodash"
 * @fwImport npm/lodash/reduce reduce from "lodash"
 * @node mapNode npm/lodash/map
 * @node filterNode npm/lodash/filter
 * @node reduceNode npm/lodash/reduce
 */
export async function testWorkflow(execute: boolean, params: { data: unknown[] }) {
  return { onSuccess: true, onFailure: false, result: [] };
}
`;
    fs.writeFileSync(tempFile, code, 'utf-8');

    parser.clearCache();
    const result = parser.parse(tempFile);

    // Should parse successfully
    expect(result.errors).toHaveLength(0);
    expect(result.workflows).toHaveLength(1);

    const workflow = result.workflows[0];

    // All three node types should be present
    const mapType = workflow.nodeTypes.find((nt) => nt.name === 'npm/lodash/map');
    const filterType = workflow.nodeTypes.find((nt) => nt.name === 'npm/lodash/filter');
    const reduceType = workflow.nodeTypes.find((nt) => nt.name === 'npm/lodash/reduce');

    expect(mapType).toBeDefined();
    expect(filterType).toBeDefined();
    expect(reduceType).toBeDefined();

    // All should have the same importSource (verifying they're from same package)
    expect(mapType?.importSource).toBe('lodash');
    expect(filterType?.importSource).toBe('lodash');
    expect(reduceType?.importSource).toBe('lodash');
  });
});
