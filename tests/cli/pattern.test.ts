/**
 * Tests for CLI pattern commands
 * Uses pure functions directly for fast testing, with CLI smoke tests for wiring
 */

import { vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parser } from '../../src/parser';

const MOCK_NONEXISTENT_PATH = path.join(os.tmpdir(), 'does-not-exist-fw-test');

// Test pattern file content
const TEST_PATTERN = `
/**
 * @flowWeaver pattern
 * @name validateTransform
 * @description Validates input then transforms it
 * @node v inputValidator
 * @node t dataTransformer
 * @connect IN.data -> v.input
 * @connect v.valid -> t.input
 * @connect t.output -> OUT.result
 * @connect v.invalid -> OUT.error
 * @port IN.data - Raw input data
 * @port OUT.result - Transformed data
 * @port OUT.error - Validation errors
 * @position v -90 0
 * @position t 90 0
 */
function patternPlaceholder() {}

/**
 * @flowWeaver nodeType
 * @input input - Data to validate
 * @output valid - Valid data
 * @output invalid - Invalid data with errors
 */
function inputValidator(execute: boolean, input: any) {
  if (!execute) return { onSuccess: false, onFailure: false, valid: null, invalid: null };
  if (input) {
    return { onSuccess: true, onFailure: false, valid: input, invalid: null };
  }
  return { onSuccess: false, onFailure: true, valid: null, invalid: { error: "Invalid input" } };
}

/**
 * @flowWeaver nodeType
 * @input input - Data to transform
 * @output output - Transformed data
 */
function dataTransformer(execute: boolean, input: any) {
  if (!execute) return { onSuccess: false, onFailure: false, output: null };
  return { onSuccess: true, onFailure: false, output: { transformed: input } };
}
`;

// Target workflow to apply pattern to
const TARGET_WORKFLOW = `
/**
 * @flowWeaver workflow
 * @param data - Input data
 * @returns result - Output result
 */
export function myWorkflow(
  execute: boolean,
  params: { data: any }
): { onSuccess: boolean; onFailure: boolean; result: any } {
  return { onSuccess: true, onFailure: false, result: null };
}
`;

// Workflow with extractable pattern
const EXTRACT_SOURCE = `
/**
 * @flowWeaver workflow
 * @node val validateInput
 * @node trans transformData
 * @connect Start.data -> val.input
 * @connect val.result -> trans.input
 * @connect trans.output -> Exit.result
 * @param data - Input
 * @returns result - Output
 */
export function sourceWorkflow(
  execute: boolean,
  params: { data: any }
): { onSuccess: boolean; onFailure: boolean; result: any } {
  return { onSuccess: true, onFailure: false, result: null };
}

/**
 * @flowWeaver nodeType
 * @input input - Input to validate
 * @output result - Validated result
 */
function validateInput(execute: boolean, input: any) {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };
  return { onSuccess: true, onFailure: false, result: input };
}

/**
 * @flowWeaver nodeType
 * @input input - Input to transform
 * @output output - Transformed output
 */
function transformData(execute: boolean, input: any) {
  if (!execute) return { onSuccess: false, onFailure: false, output: null };
  return { onSuccess: true, onFailure: false, output: { transformed: input } };
}
`;

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-weaver-pattern-test-'));
});

afterAll(() => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }
});

describe('Pattern parsing', () => {
  it('should parse pattern from file content', () => {
    const testFile = path.join(tempDir, 'parse-pattern.ts');
    fs.writeFileSync(testFile, TEST_PATTERN);

    const result = parser.parse(testFile);

    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].name).toBe('validateTransform');
  });

  it('should extract pattern description', () => {
    const testFile = path.join(tempDir, 'parse-desc.ts');
    fs.writeFileSync(testFile, TEST_PATTERN);

    const result = parser.parse(testFile);

    expect(result.patterns[0].description).toBe('Validates input then transforms it');
  });

  it('should extract pattern nodes', () => {
    const testFile = path.join(tempDir, 'parse-nodes.ts');
    fs.writeFileSync(testFile, TEST_PATTERN);

    const result = parser.parse(testFile);
    const pattern = result.patterns[0];

    expect(pattern.instances).toHaveLength(2);
    expect(pattern.instances.find((i) => i.id === 'v')).toBeDefined();
    expect(pattern.instances.find((i) => i.id === 't')).toBeDefined();
  });

  it('should extract input ports', () => {
    const testFile = path.join(tempDir, 'parse-in-ports.ts');
    fs.writeFileSync(testFile, TEST_PATTERN);

    const result = parser.parse(testFile);
    const pattern = result.patterns[0];

    expect(pattern.inputPorts).toBeDefined();
    expect(pattern.inputPorts['data']).toBeDefined();
    expect(pattern.inputPorts['data'].description).toBe('Raw input data');
  });

  it('should extract output ports', () => {
    const testFile = path.join(tempDir, 'parse-out-ports.ts');
    fs.writeFileSync(testFile, TEST_PATTERN);

    const result = parser.parse(testFile);
    const pattern = result.patterns[0];

    expect(pattern.outputPorts).toBeDefined();
    expect(pattern.outputPorts['result']).toBeDefined();
    expect(pattern.outputPorts['error']).toBeDefined();
  });

  it('should extract connections', () => {
    const testFile = path.join(tempDir, 'parse-conns.ts');
    fs.writeFileSync(testFile, TEST_PATTERN);

    const result = parser.parse(testFile);
    const pattern = result.patterns[0];

    expect(pattern.connections.length).toBeGreaterThan(0);
    expect(pattern.connections.some((c) => c.from.node === 'IN')).toBe(true);
    expect(pattern.connections.some((c) => c.to.node === 'OUT')).toBe(true);
  });

  it('should extract positions', () => {
    const testFile = path.join(tempDir, 'parse-pos.ts');
    fs.writeFileSync(testFile, TEST_PATTERN);

    const result = parser.parse(testFile);
    const pattern = result.patterns[0];

    const nodeV = pattern.instances.find((i) => i.id === 'v');
    expect(nodeV?.config?.x).toBe(-90);
    expect(nodeV?.config?.y).toBe(0);
  });

  it('should report no patterns when none exist', () => {
    const testFile = path.join(tempDir, 'no-pattern.ts');
    fs.writeFileSync(testFile, TARGET_WORKFLOW);

    const result = parser.parse(testFile);

    expect(result.patterns).toHaveLength(0);
  });

  it('should parse node types in pattern file', () => {
    const testFile = path.join(tempDir, 'parse-node-types.ts');
    fs.writeFileSync(testFile, TEST_PATTERN);

    const result = parser.parse(testFile);

    expect(result.nodeTypes).toHaveLength(2);
    expect(result.nodeTypes.find((nt) => nt.name === 'inputValidator')).toBeDefined();
    expect(result.nodeTypes.find((nt) => nt.name === 'dataTransformer')).toBeDefined();
  });
});

describe('Workflow extraction for patterns', () => {
  it('should parse workflow with extractable nodes', () => {
    const testFile = path.join(tempDir, 'extract-source.ts');
    fs.writeFileSync(testFile, EXTRACT_SOURCE);

    const result = parser.parse(testFile);

    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].instances).toHaveLength(2);
  });

  it('should identify internal connections between nodes', () => {
    const testFile = path.join(tempDir, 'extract-conns.ts');
    fs.writeFileSync(testFile, EXTRACT_SOURCE);

    const result = parser.parse(testFile);
    const workflow = result.workflows[0];

    // Connection from val.result -> trans.input
    const internalConn = workflow.connections.find(
      (c) => c.from.node === 'val' && c.to.node === 'trans'
    );
    expect(internalConn).toBeDefined();
  });

  it('should identify boundary connections (Start/Exit)', () => {
    const testFile = path.join(tempDir, 'extract-boundary.ts');
    fs.writeFileSync(testFile, EXTRACT_SOURCE);

    const result = parser.parse(testFile);
    const workflow = result.workflows[0];

    // Input boundary: Start.data -> val.input
    const inputBoundary = workflow.connections.find(
      (c) => c.from.node === 'Start' && c.to.node === 'val'
    );
    expect(inputBoundary).toBeDefined();

    // Output boundary: trans.output -> Exit.result
    const outputBoundary = workflow.connections.find(
      (c) => c.from.node === 'trans' && c.to.node === 'Exit'
    );
    expect(outputBoundary).toBeDefined();
  });

  it('should include node types used by extracted instances', () => {
    const testFile = path.join(tempDir, 'extract-types.ts');
    fs.writeFileSync(testFile, EXTRACT_SOURCE);

    const result = parser.parse(testFile);

    expect(result.nodeTypes.find((nt) => nt.name === 'validateInput')).toBeDefined();
    expect(result.nodeTypes.find((nt) => nt.name === 'transformData')).toBeDefined();
  });
});

describe('patternListCommand', () => {
  it('should throw friendly error for nonexistent path', async () => {
    const { patternListCommand } = await import('../../src/cli/commands/pattern');
    await expect(patternListCommand(MOCK_NONEXISTENT_PATH, {})).rejects.toThrow(
      `Path not found: ${MOCK_NONEXISTENT_PATH}`
    );
  });

  it('should list patterns from a single file in JSON mode', async () => {
    const { patternListCommand } = await import('../../src/cli/commands/pattern');
    const testFile = path.join(tempDir, 'list-json.ts');
    fs.writeFileSync(testFile, TEST_PATTERN);

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = vi.fn();
    console.warn = vi.fn();

    try {
      await patternListCommand(testFile, { json: true });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
    }

    expect(logs.length).toBeGreaterThan(0);
    const output = JSON.parse(logs.join(''));
    expect(Array.isArray(output)).toBe(true);
    expect(output.length).toBe(1);
    expect(output[0].name).toBe('validateTransform');
  });

  it('should list patterns from a directory', async () => {
    const { patternListCommand } = await import('../../src/cli/commands/pattern');
    const dir = path.join(tempDir, 'list-dir');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pattern-a.ts'), TEST_PATTERN);

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = vi.fn();
    console.warn = vi.fn();

    try {
      await patternListCommand(dir, { json: true });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
    }

    const output = JSON.parse(logs.join(''));
    expect(output.length).toBeGreaterThanOrEqual(1);
  });

  it('should show human-readable output when json is false', async () => {
    const { patternListCommand } = await import('../../src/cli/commands/pattern');
    const testFile = path.join(tempDir, 'list-human.ts');
    fs.writeFileSync(testFile, TEST_PATTERN);

    const logs: string[] = [];
    const errors: string[] = [];
    const warns: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
    console.warn = (...args: unknown[]) => warns.push(args.map(String).join(' '));

    try {
      await patternListCommand(testFile, { json: false });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
    }

    const allOutput = [...logs, ...errors, ...warns].join(' ');
    expect(allOutput).toContain('validateTransform');
  });

  it('should report no patterns for a non-pattern file', async () => {
    const { patternListCommand } = await import('../../src/cli/commands/pattern');
    const testFile = path.join(tempDir, 'list-no-patterns.ts');
    fs.writeFileSync(testFile, TARGET_WORKFLOW);

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = vi.fn();
    console.warn = vi.fn();

    try {
      await patternListCommand(testFile, { json: true });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
    }

    const output = JSON.parse(logs.join(''));
    expect(output).toEqual([]);
  });
});

describe('patternApplyCommand', () => {
  it('should apply a pattern in preview mode', async () => {
    const { patternApplyCommand } = await import('../../src/cli/commands/pattern');
    const patternFile = path.join(tempDir, 'apply-pattern.ts');
    const targetFile = path.join(tempDir, 'apply-target.ts');

    fs.writeFileSync(patternFile, TEST_PATTERN);
    fs.writeFileSync(targetFile, TARGET_WORKFLOW);

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = vi.fn();
    console.warn = vi.fn();

    try {
      await patternApplyCommand(patternFile, targetFile, { preview: true });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
    }

    // Preview should output modified content without writing to disk
    const output = logs.join('\n');
    expect(output).toContain('Pattern: validateTransform');

    // Target file should be unchanged (preview mode)
    const targetContent = fs.readFileSync(targetFile, 'utf8');
    expect(targetContent).toBe(TARGET_WORKFLOW);
  });

  it('should throw when pattern file has no patterns', async () => {
    const { patternApplyCommand } = await import('../../src/cli/commands/pattern');
    const noPatternFile = path.join(tempDir, 'apply-no-pattern.ts');
    const targetFile = path.join(tempDir, 'apply-target-2.ts');

    fs.writeFileSync(noPatternFile, TARGET_WORKFLOW);
    fs.writeFileSync(targetFile, TARGET_WORKFLOW);

    await expect(
      patternApplyCommand(noPatternFile, targetFile, { preview: true })
    ).rejects.toThrow('No patterns found');
  });

  it('should throw when named pattern does not exist', async () => {
    const { patternApplyCommand } = await import('../../src/cli/commands/pattern');
    const patternFile = path.join(tempDir, 'apply-named-missing.ts');
    const targetFile = path.join(tempDir, 'apply-target-3.ts');

    fs.writeFileSync(patternFile, TEST_PATTERN);
    fs.writeFileSync(targetFile, TARGET_WORKFLOW);

    await expect(
      patternApplyCommand(patternFile, targetFile, { preview: true, name: 'nonexistent' })
    ).rejects.toThrow('Pattern "nonexistent" not found');
  });

  it('should write to target file when not in preview mode', async () => {
    const { patternApplyCommand } = await import('../../src/cli/commands/pattern');
    const patternFile = path.join(tempDir, 'apply-write-pattern.ts');
    const targetFile = path.join(tempDir, 'apply-write-target.ts');

    fs.writeFileSync(patternFile, TEST_PATTERN);
    fs.writeFileSync(targetFile, TARGET_WORKFLOW);

    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = vi.fn();
    console.error = vi.fn();
    console.warn = vi.fn();

    try {
      await patternApplyCommand(patternFile, targetFile, { preview: false });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
    }

    const modified = fs.readFileSync(targetFile, 'utf8');
    expect(modified).toContain('Pattern: validateTransform');
  });
});

describe('patternExtractCommand', () => {
  it('should extract a pattern in preview mode', async () => {
    const { patternExtractCommand } = await import('../../src/cli/commands/pattern');
    const sourceFile = path.join(tempDir, 'extract-source.ts');
    fs.writeFileSync(sourceFile, EXTRACT_SOURCE);

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = vi.fn();
    console.warn = vi.fn();

    try {
      await patternExtractCommand(sourceFile, {
        nodes: 'val,trans',
        output: '/tmp/unused.ts',
        preview: true,
      });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
    }

    const output = logs.join('\n');
    expect(output).toContain('@flowWeaver pattern');
  });

  it('should write extracted pattern to output file', async () => {
    const { patternExtractCommand } = await import('../../src/cli/commands/pattern');
    const sourceFile = path.join(tempDir, 'extract-write-source.ts');
    const outputFile = path.join(tempDir, 'extract-output.ts');
    fs.writeFileSync(sourceFile, EXTRACT_SOURCE);

    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = vi.fn();
    console.error = vi.fn();
    console.warn = vi.fn();

    try {
      await patternExtractCommand(sourceFile, {
        nodes: 'val,trans',
        output: outputFile,
        name: 'myExtracted',
      });
    } finally {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
    }

    expect(fs.existsSync(outputFile)).toBe(true);
    const content = fs.readFileSync(outputFile, 'utf8');
    expect(content).toContain('@flowWeaver pattern');
    expect(content).toContain('myExtracted');
  });

  it('should throw when source has no workflows', async () => {
    const { patternExtractCommand } = await import('../../src/cli/commands/pattern');
    const noWfFile = path.join(tempDir, 'extract-no-wf.ts');
    fs.writeFileSync(noWfFile, '// no workflows here\nexport const x = 1;\n');

    await expect(
      patternExtractCommand(noWfFile, {
        nodes: 'a,b',
        output: '/tmp/unused.ts',
      })
    ).rejects.toThrow('No workflows found');
  });
});

describe('Multiple patterns', () => {
  const MULTI_PATTERN =
    TEST_PATTERN +
    `
/**
 * @flowWeaver pattern
 * @name simplePattern
 * @node p processor
 * @connect IN.data -> p.input
 * @connect p.output -> OUT.result
 * @port IN.data - Input
 * @port OUT.result - Output
 */
function placeholder2() {}
`;

  it('should parse multiple patterns from same file', () => {
    const testFile = path.join(tempDir, 'multi-pattern.ts');
    fs.writeFileSync(testFile, MULTI_PATTERN);

    const result = parser.parse(testFile);

    expect(result.patterns).toHaveLength(2);
    expect(result.patterns.find((p) => p.name === 'validateTransform')).toBeDefined();
    expect(result.patterns.find((p) => p.name === 'simplePattern')).toBeDefined();
  });
});
