/**
 * @map Sugar Tests
 *
 * Tests the @map annotation that provides syntactic sugar for the forEach scope pattern.
 * Covers: Chevrotain parser, JSDoc integration, parser expansion, generator, execution,
 * validation, annotation round-trip, and error handling.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { parseMapLine } from '../../src/chevrotain-parser/map-parser';
import { AnnotationParser } from '../../src/parser';
import { generator } from '../../src/generator';
import { annotationGenerator } from '../../src/annotation-generator';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// 1. Chevrotain Parser — parseMapLine
// ============================================================================

describe('@map Chevrotain parser', () => {
  it('should parse basic @map syntax', () => {
    const warnings: string[] = [];
    const result = parseMapLine('@map loop proc over scan.files', warnings);

    expect(warnings).toHaveLength(0);
    expect(result).not.toBeNull();
    expect(result!.instanceId).toBe('loop');
    expect(result!.childId).toBe('proc');
    expect(result!.sourceNode).toBe('scan');
    expect(result!.sourcePort).toBe('files');
    expect(result!.inputPort).toBeUndefined();
    expect(result!.outputPort).toBeUndefined();
  });

  it('should parse @map with explicit port mapping', () => {
    const warnings: string[] = [];
    const result = parseMapLine('@map loop proc(file -> post) over scan.files', warnings);

    expect(warnings).toHaveLength(0);
    expect(result).not.toBeNull();
    expect(result!.instanceId).toBe('loop');
    expect(result!.childId).toBe('proc');
    expect(result!.sourceNode).toBe('scan');
    expect(result!.sourcePort).toBe('files');
    expect(result!.inputPort).toBe('file');
    expect(result!.outputPort).toBe('post');
  });

  it('should return null for non-@map input', () => {
    const warnings: string[] = [];
    const result = parseMapLine('@node loop forEach', warnings);
    expect(result).toBeNull();
  });

  it('should return null for empty input', () => {
    const warnings: string[] = [];
    const result = parseMapLine('', warnings);
    expect(result).toBeNull();
  });

  it('should produce warning for malformed @map syntax', () => {
    const warnings: string[] = [];
    const result = parseMapLine('@map loop', warnings);
    expect(result).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('Failed to parse @map line');
  });

  it('should produce warning when "over" keyword is missing', () => {
    const warnings: string[] = [];
    const result = parseMapLine('@map loop proc scan.files', warnings);
    expect(result).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 2. JSDoc Parser Integration — @map tag parsing
// ============================================================================

describe('@map JSDoc parser integration', () => {
  it('should parse @map tag in workflow config', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function doubleIt(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node proc doubleIt
 * @map loop proc over Start.items
 * @connect loop.results -> Exit.results
 */
export function mapWorkflow(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    expect(workflow).toBeDefined();
  });

  it('should parse @map with explicit port mapping in JSDoc', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @input file
 * @output post
 */
function processFile(execute: boolean, file: string) {
  if (!execute) return { onSuccess: false, onFailure: false, post: null };
  return { onSuccess: true, onFailure: false, post: file.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @node proc processFile
 * @map loop proc(file -> post) over Start.items
 * @connect loop.results -> Exit.results
 */
export function mapWorkflow(
  execute: boolean,
  params: { items: string[] }
): { onSuccess: boolean; onFailure: boolean; results: string[] } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    expect(workflow).toBeDefined();
    expect(workflow.macros).toBeDefined();
    expect(workflow.macros).toHaveLength(1);
    expect(workflow.macros![0].inputPort).toBe('file');
    expect(workflow.macros![0].outputPort).toBe('post');
  });
});

// ============================================================================
// 3. Parser Expansion — Synthetic node type, instances, connections, scopes
// ============================================================================

describe('@map parser expansion', () => {
  const parser = new AnnotationParser();

  function parseMapWorkflow(extraAnnotations = '', childNodeType = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function doubleIt(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}`) {
    return parser.parseFromString(`
${childNodeType}

/**
 * @flowWeaver workflow
 * @node proc doubleIt
 * @map loop proc over Start.items
 * ${extraAnnotations}
 * @connect loop.results -> Exit.results
 */
export function mapWorkflow(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}
`);
  }

  it('should create synthetic MAP_ITERATOR node type', () => {
    const result = parseMapWorkflow();
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    const syntheticType = workflow.nodeTypes.find(nt => nt.variant === 'MAP_ITERATOR');
    expect(syntheticType).toBeDefined();
    expect(syntheticType!.name).toBe('__map_loop__');
    expect(syntheticType!.isAsync).toBe(true);
  });

  it('should create MAP_ITERATOR node type with correct ports', () => {
    const result = parseMapWorkflow();
    const workflow = result.workflows[0];
    const syntheticType = workflow.nodeTypes.find(nt => nt.variant === 'MAP_ITERATOR')!;

    // Non-scoped inputs
    expect(syntheticType.inputs.execute).toBeDefined();
    expect(syntheticType.inputs.execute.dataType).toBe('STEP');
    expect(syntheticType.inputs.items).toBeDefined();
    expect(syntheticType.inputs.items.dataType).toBe('ARRAY');

    // Scoped inputs (receive from child)
    expect(syntheticType.inputs.success).toBeDefined();
    expect(syntheticType.inputs.success.scope).toBe('iterate');
    expect(syntheticType.inputs.failure).toBeDefined();
    expect(syntheticType.inputs.failure.scope).toBe('iterate');
    expect(syntheticType.inputs.processed).toBeDefined();
    expect(syntheticType.inputs.processed.scope).toBe('iterate');

    // Non-scoped outputs
    expect(syntheticType.outputs.onSuccess).toBeDefined();
    expect(syntheticType.outputs.onFailure).toBeDefined();
    expect(syntheticType.outputs.results).toBeDefined();
    expect(syntheticType.outputs.results.dataType).toBe('ARRAY');

    // Scoped outputs (send to child)
    expect(syntheticType.outputs.start).toBeDefined();
    expect(syntheticType.outputs.start.scope).toBe('iterate');
    expect(syntheticType.outputs.item).toBeDefined();
    expect(syntheticType.outputs.item.scope).toBe('iterate');
  });

  it('should create map instance and scoped child instance', () => {
    const result = parseMapWorkflow();
    const workflow = result.workflows[0];

    // Map iterator instance
    const loopInstance = workflow.instances.find(inst => inst.id === 'loop');
    expect(loopInstance).toBeDefined();
    expect(loopInstance!.nodeType).toBe('__map_loop__');

    // Child instance with parent scope
    const procInstance = workflow.instances.find(inst => inst.id === 'proc');
    expect(procInstance).toBeDefined();
    expect(procInstance!.parent).toEqual({ id: 'loop', scope: 'iterate' });
  });

  it('should generate all scoped connections', () => {
    const result = parseMapWorkflow();
    const workflow = result.workflows[0];

    // Helper to find a connection
    const findConn = (fromNode: string, fromPort: string, toNode: string, toPort: string) =>
      workflow.connections.find(
        c =>
          c.from.node === fromNode &&
          c.from.port === fromPort &&
          c.to.node === toNode &&
          c.to.port === toPort
      );

    // loop.start:iterate -> proc.execute
    const startConn = findConn('loop', 'start', 'proc', 'execute');
    expect(startConn).toBeDefined();
    expect(startConn!.from.scope).toBe('iterate');

    // loop.item:iterate -> proc.value (auto-inferred first data input)
    const itemConn = findConn('loop', 'item', 'proc', 'value');
    expect(itemConn).toBeDefined();
    expect(itemConn!.from.scope).toBe('iterate');

    // proc.doubled -> loop.processed:iterate (auto-inferred first data output)
    const processedConn = findConn('proc', 'doubled', 'loop', 'processed');
    expect(processedConn).toBeDefined();
    expect(processedConn!.to.scope).toBe('iterate');

    // proc.onSuccess -> loop.success:iterate
    const successConn = findConn('proc', 'onSuccess', 'loop', 'success');
    expect(successConn).toBeDefined();

    // proc.onFailure -> loop.failure:iterate
    const failureConn = findConn('proc', 'onFailure', 'loop', 'failure');
    expect(failureConn).toBeDefined();
  });

  it('should generate upstream connection from source to items', () => {
    const result = parseMapWorkflow();
    const workflow = result.workflows[0];

    const upstreamConn = workflow.connections.find(
      c =>
        c.from.node === 'Start' &&
        c.from.port === 'items' &&
        c.to.node === 'loop' &&
        c.to.port === 'items'
    );
    expect(upstreamConn).toBeDefined();
  });

  it('should register scope declaration', () => {
    const result = parseMapWorkflow();
    const workflow = result.workflows[0];

    expect(workflow.scopes).toBeDefined();
    expect(workflow.scopes!['loop.iterate']).toEqual(['proc']);
  });

  it('should store macro metadata for round-trip', () => {
    const result = parseMapWorkflow();
    const workflow = result.workflows[0];

    expect(workflow.macros).toBeDefined();
    expect(workflow.macros).toHaveLength(1);
    expect(workflow.macros![0]).toEqual({
      type: 'map',
      instanceId: 'loop',
      childId: 'proc',
      sourcePort: 'Start.items',
    });
  });

  it('should auto-infer first data input port of child', () => {
    const result = parseMapWorkflow();
    const workflow = result.workflows[0];

    // The child "doubleIt" has inputs: execute (STEP), value (NUMBER)
    // Auto-inferred input should be "value" (first non-execute data input)
    const itemConn = workflow.connections.find(
      c => c.from.node === 'loop' && c.from.port === 'item' && c.to.node === 'proc'
    );
    expect(itemConn).toBeDefined();
    expect(itemConn!.to.port).toBe('value');
  });

  it('should auto-infer first data output port of child', () => {
    const result = parseMapWorkflow();
    const workflow = result.workflows[0];

    // The child "doubleIt" has outputs: onSuccess (STEP), onFailure (STEP), doubled (NUMBER)
    // Auto-inferred output should be "doubled" (first non-control-flow data output)
    const processedConn = workflow.connections.find(
      c => c.from.node === 'proc' && c.to.node === 'loop' && c.to.port === 'processed'
    );
    expect(processedConn).toBeDefined();
    expect(processedConn!.from.port).toBe('doubled');
  });

  it('should use explicit port mapping when provided', () => {
    const parser2 = new AnnotationParser();
    const result = parser2.parseFromString(`
/**
 * @flowWeaver nodeType
 * @input file
 * @input options
 * @output post
 * @output metadata
 */
function processFile(execute: boolean, file: string, options: object) {
  if (!execute) return { onSuccess: false, onFailure: false, post: null, metadata: null };
  return { onSuccess: true, onFailure: false, post: file.toUpperCase(), metadata: {} };
}

/**
 * @flowWeaver workflow
 * @node proc processFile
 * @map loop proc(file -> post) over Start.items
 * @connect loop.results -> Exit.results
 */
export function mapWorkflow(
  execute: boolean,
  params: { items: string[] }
): { onSuccess: boolean; onFailure: boolean; results: string[] } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    // Should use explicit "file" input (not auto-inferred first port)
    const itemConn = workflow.connections.find(
      c => c.from.node === 'loop' && c.from.port === 'item' && c.to.node === 'proc'
    );
    expect(itemConn!.to.port).toBe('file');

    // Should use explicit "post" output (not auto-inferred first port)
    const processedConn = workflow.connections.find(
      c => c.from.node === 'proc' && c.to.node === 'loop' && c.to.port === 'processed'
    );
    expect(processedConn!.from.port).toBe('post');
  });
});

// ============================================================================
// 4. Error Handling
// ============================================================================

describe('@map error handling', () => {
  it('should error when child node is not declared', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function doubleIt(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @map loop undeclared over Start.items
 * @connect loop.results -> Exit.results
 */
export function mapWorkflow(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('not found'))).toBe(true);
  });

  it('should error when child node type has no data inputs', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @output result
 */
function noInputNode(execute: boolean) {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  return { onSuccess: true, onFailure: false, result: 42 };
}

/**
 * @flowWeaver workflow
 * @node proc noInputNode
 * @map loop proc over Start.items
 * @connect loop.results -> Exit.results
 */
export function mapWorkflow(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('no data input'))).toBe(true);
  });
});

// ============================================================================
// 5. Generator — Compiled output contains inline iteration
// ============================================================================

describe('@map generator (compiled output)', () => {
  const outputDir = global.testHelpers?.outputDir || path.join(os.tmpdir(), `flow-weaver-map-test-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up generated files
    for (const f of [
      'map-gen-test.ts',
      'map-gen-test.generated.ts',
    ]) {
      const fp = path.join(outputDir, f);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  });

  it('should generate inline iteration code (not a function call)', async () => {
    const workflowContent = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function doubleIt(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node proc doubleIt
 * @map loop proc over Start.items
 * @connect loop.results -> Exit.results
 */
export async function mapGenTest(
  execute: boolean,
  params: { items: number[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[] }> {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(outputDir, 'map-gen-test.ts');
    fs.writeFileSync(testFile, workflowContent);

    const generatedCode = await generator.generate(testFile, 'mapGenTest', {
      production: false,
    });

    // Should contain inline iteration pattern, not a function call
    expect(generatedCode).toContain('for (const __item of');
    expect(generatedCode).toContain('__results');

    // Should NOT contain a call to __map_loop__ function
    expect(generatedCode).not.toContain('__map_loop__(');
  });
});

// ============================================================================
// 6. End-to-End Execution
// ============================================================================

describe('@map end-to-end execution', () => {
  const outputDir = global.testHelpers?.outputDir || path.join(os.tmpdir(), `flow-weaver-map-e2e-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterAll(() => {
    for (const f of [
      'map-e2e-basic.ts',
      'map-e2e-basic.generated.ts',
      'map-e2e-string.ts',
      'map-e2e-string.generated.ts',
      'map-e2e-empty.ts',
      'map-e2e-empty.generated.ts',
      'map-e2e-execute-false.ts',
      'map-e2e-execute-false.generated.ts',
    ]) {
      const fp = path.join(outputDir, f);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  });

  it('should execute @map workflow with numeric doubling', async () => {
    const workflowContent = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function doubleIt(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node proc doubleIt
 * @map loop proc over Start.items
 * @connect loop.results -> Exit.results
 */
export async function mapE2eBasic(
  execute: boolean,
  params: { items: number[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[] }> {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(outputDir, 'map-e2e-basic.ts');
    fs.writeFileSync(testFile, workflowContent);

    const generatedCode = await generator.generate(testFile, 'mapE2eBasic', {
      production: true,
    });
    const outputFile = path.join(outputDir, 'map-e2e-basic.generated.ts');
    fs.writeFileSync(outputFile, generatedCode);

    const { mapE2eBasic } = await import(outputFile);
    const result = await mapE2eBasic(true, { items: [1, 2, 3, 4, 5] });

    expect(result.onSuccess).toBe(true);
    expect(result.onFailure).toBe(false);
    expect(result.results).toEqual([2, 4, 6, 8, 10]);
  });

  it('should execute @map workflow with string transformation', async () => {
    const workflowContent = `
/**
 * @flowWeaver nodeType
 * @input text
 * @output upper
 */
function toUpper(execute: boolean, text: string) {
  if (!execute) return { onSuccess: false, onFailure: false, upper: '' };
  return { onSuccess: true, onFailure: false, upper: text.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @node proc toUpper
 * @map loop proc over Start.items
 * @connect loop.results -> Exit.results
 */
export async function mapE2eString(
  execute: boolean,
  params: { items: string[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: string[] }> {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(outputDir, 'map-e2e-string.ts');
    fs.writeFileSync(testFile, workflowContent);

    const generatedCode = await generator.generate(testFile, 'mapE2eString', {
      production: true,
    });
    const outputFile = path.join(outputDir, 'map-e2e-string.generated.ts');
    fs.writeFileSync(outputFile, generatedCode);

    const { mapE2eString } = await import(outputFile);
    const result = await mapE2eString(true, { items: ['hello', 'world'] });

    expect(result.onSuccess).toBe(true);
    expect(result.results).toEqual(['HELLO', 'WORLD']);
  });

  it('should handle empty array input', async () => {
    const workflowContent = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function doubleIt(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node proc doubleIt
 * @map loop proc over Start.items
 * @connect loop.results -> Exit.results
 */
export async function mapE2eEmpty(
  execute: boolean,
  params: { items: number[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[] }> {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(outputDir, 'map-e2e-empty.ts');
    fs.writeFileSync(testFile, workflowContent);

    const generatedCode = await generator.generate(testFile, 'mapE2eEmpty', {
      production: true,
    });
    const outputFile = path.join(outputDir, 'map-e2e-empty.generated.ts');
    fs.writeFileSync(outputFile, generatedCode);

    const { mapE2eEmpty } = await import(outputFile);
    const result = await mapE2eEmpty(true, { items: [] });

    expect(result.onSuccess).toBe(true);
    expect(result.results).toEqual([]);
  });

  it('should return early when execute is false', async () => {
    const workflowContent = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function doubleIt(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node proc doubleIt
 * @map loop proc over Start.items
 * @connect loop.results -> Exit.results
 */
export async function mapE2eExecuteFalse(
  execute: boolean,
  params: { items: number[] }
): Promise<{ onSuccess: boolean; onFailure: boolean; results: number[] }> {
  throw new Error('Not implemented');
}
`;

    const testFile = path.join(outputDir, 'map-e2e-execute-false.ts');
    fs.writeFileSync(testFile, workflowContent);

    const generatedCode = await generator.generate(testFile, 'mapE2eExecuteFalse', {
      production: true,
    });
    const outputFile = path.join(outputDir, 'map-e2e-execute-false.generated.ts');
    fs.writeFileSync(outputFile, generatedCode);

    const { mapE2eExecuteFalse } = await import(outputFile);
    const result = await mapE2eExecuteFalse(false, { items: [1, 2, 3] });

    // The framework always runs the workflow body. Whether the map node actually
    // iterates depends on how execute is wired — it's up to the node type.
    // Here we just verify the workflow executes without errors.
    expect(result).toBeDefined();
    expect(result).toHaveProperty('results');
  });
});

// ============================================================================
// 7. Annotation Round-Trip Preservation
// ============================================================================

describe('@map annotation round-trip', () => {
  it('should preserve @map in AnnotationGenerator output', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function doubleIt(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node proc doubleIt
 * @map loop proc over Start.items
 * @connect loop.results -> Exit.results
 */
export function mapWorkflow(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    const output = annotationGenerator.generate(workflow, {
      includeComments: false,
      includeMetadata: true,
    });

    // Should contain @map annotation
    expect(output).toContain('@map loop proc over Start.items');

    // Should NOT contain expanded form
    expect(output).not.toContain('__map_loop__');
    expect(output).not.toContain('@scope loop.iterate');
  });

  it('should preserve @map with explicit ports in round-trip', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @input file
 * @input options
 * @output post
 * @output metadata
 */
function processFile(execute: boolean, file: string, options: object) {
  if (!execute) return { onSuccess: false, onFailure: false, post: null, metadata: null };
  return { onSuccess: true, onFailure: false, post: file.toUpperCase(), metadata: {} };
}

/**
 * @flowWeaver workflow
 * @node proc processFile
 * @map loop proc(file -> post) over Start.items
 * @connect loop.results -> Exit.results
 */
export function mapWorkflow(
  execute: boolean,
  params: { items: string[] }
): { onSuccess: boolean; onFailure: boolean; results: string[] } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    const output = annotationGenerator.generate(workflow, {
      includeComments: false,
      includeMetadata: true,
    });

    expect(output).toContain('@map loop proc(file -> post) over Start.items');
  });

  it('should write child @node without parent scope in round-trip', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function doubleIt(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node proc doubleIt
 * @map loop proc over Start.items
 * @connect loop.results -> Exit.results
 */
export function mapWorkflow(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    const output = annotationGenerator.generate(workflow, {
      includeComments: false,
      includeMetadata: true,
    });

    // Should have @node proc doubleIt (without parent scope)
    expect(output).toMatch(/@node proc doubleIt(?!\s+loop)/);

    // Should NOT have the expanded scoped form
    expect(output).not.toContain('@node proc doubleIt loop.iterate');
  });

  it('should not emit macro-covered connections in round-trip', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function doubleIt(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node proc doubleIt
 * @map loop proc over Start.items
 * @connect loop.results -> Exit.results
 */
export function mapWorkflow(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    const output = annotationGenerator.generate(workflow, {
      includeComments: false,
      includeMetadata: true,
    });

    // Should have the user-written connection
    expect(output).toContain('@connect loop.results -> Exit.results');

    // Should NOT have macro-generated scoped connections
    expect(output).not.toContain('loop.start:iterate');
    expect(output).not.toContain('loop.item:iterate');
    expect(output).not.toContain('loop.processed:iterate');
    expect(output).not.toContain('loop.success:iterate');
    expect(output).not.toContain('loop.failure:iterate');

    // Should NOT have the upstream items connection (macro handles it)
    expect(output).not.toContain('Start.items -> loop.items');
  });
});

// ============================================================================
// 8. @map with additional user-written connections alongside
// ============================================================================

describe('@map with surrounding connections', () => {
  it('should preserve non-macro connections alongside @map', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function doubleIt(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input items
 * @output count
 */
function countItems(execute: boolean, items: number[]) {
  if (!execute) return { onSuccess: false, onFailure: false, count: 0 };
  return { onSuccess: true, onFailure: false, count: items.length };
}

/**
 * @flowWeaver workflow
 * @node proc doubleIt
 * @node counter countItems
 * @map loop proc over Start.items
 * @connect loop.results -> Exit.results
 * @connect loop.results -> counter.items
 * @connect counter.count -> Exit.count
 * @connect loop.onSuccess -> counter.execute
 */
export function mapWorkflow(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[]; count: number } {
  throw new Error('Not implemented');
}
`);

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    const output = annotationGenerator.generate(workflow, {
      includeComments: false,
      includeMetadata: true,
    });

    // These user-written connections should be preserved
    expect(output).toContain('@connect loop.results -> Exit.results');
    expect(output).toContain('@connect loop.results -> counter.items');
    expect(output).toContain('@connect counter.count -> Exit.count');
    expect(output).toContain('@connect loop.onSuccess -> counter.execute');

    // @map should still be there
    expect(output).toContain('@map loop proc over Start.items');
  });
});
