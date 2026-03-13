/**
 * Coverage tests for src/cli/commands/describe.ts (lines 335-388, 442-444)
 * Targets: formatTextOutput with scoped ports, formatDescribeOutput with ascii/ascii-compact,
 * expression node port filtering, describeCommand error paths.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEMP_DIR = path.join(os.tmpdir(), `fw-describe-cov-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const filePath = path.join(TEMP_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

const SIMPLE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 */
function proc(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect Start.execute -> p.execute
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function simpleWf(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

const FOREACH_WORKFLOW = `
/**
 * @flowWeaver nodeType
 */
function transform(execute: boolean, item: unknown): { onSuccess: boolean; onFailure: boolean; result: unknown } {
  return { onSuccess: true, onFailure: false, result: item };
}

/**
 * @flowWeaver nodeType
 * @scope body
 */
function forEach(execute: boolean, items: unknown[]): { onSuccess: boolean; onFailure: boolean; item: unknown; bodyExecute: boolean; results: unknown[] } {
  return { onSuccess: true, onFailure: false, item: null, bodyExecute: true, results: [] };
}

/**
 * @flowWeaver workflow
 * @node loop forEach
 * @node t transform [scope: loop.body]
 * @connect loop.bodyExecute -> t.execute
 * @connect loop.item -> t.item
 * @connect loop.onSuccess -> Exit.onSuccess
 */
export function scopedWf(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

describe('formatDescribeOutput coverage', () => {
  it('should format as ascii', async () => {
    const { formatDescribeOutput, describeWorkflow } = await import('../../src/cli/commands/describe');
    const { parseWorkflow } = await import('../../src/api/index');

    const filePath = writeFixture('ascii.ts', SIMPLE_WORKFLOW);
    const result = await parseWorkflow(filePath, { workflowName: 'simpleWf' });
    const output = describeWorkflow(result.ast);
    const ascii = formatDescribeOutput(result.ast, output, 'ascii');
    expect(typeof ascii).toBe('string');
    expect(ascii.length).toBeGreaterThan(0);
  });

  it('should format as ascii-compact', async () => {
    const { formatDescribeOutput, describeWorkflow } = await import('../../src/cli/commands/describe');
    const { parseWorkflow } = await import('../../src/api/index');

    const filePath = writeFixture('ascii-compact.ts', SIMPLE_WORKFLOW);
    const result = await parseWorkflow(filePath, { workflowName: 'simpleWf' });
    const output = describeWorkflow(result.ast);
    const asciiCompact = formatDescribeOutput(result.ast, output, 'ascii-compact');
    expect(typeof asciiCompact).toBe('string');
    expect(asciiCompact.length).toBeGreaterThan(0);
  });

  it('should format as mermaid', async () => {
    const { formatDescribeOutput, describeWorkflow } = await import('../../src/cli/commands/describe');
    const { parseWorkflow } = await import('../../src/api/index');

    const filePath = writeFixture('mermaid.ts', SIMPLE_WORKFLOW);
    const result = await parseWorkflow(filePath, { workflowName: 'simpleWf' });
    const output = describeWorkflow(result.ast);
    const mermaid = formatDescribeOutput(result.ast, output, 'mermaid');
    expect(mermaid).toContain('graph LR');
  });

  it('should format as paths', async () => {
    const { formatDescribeOutput, describeWorkflow } = await import('../../src/cli/commands/describe');
    const { parseWorkflow } = await import('../../src/api/index');

    const filePath = writeFixture('paths.ts', SIMPLE_WORKFLOW);
    const result = await parseWorkflow(filePath, { workflowName: 'simpleWf' });
    const output = describeWorkflow(result.ast);
    const paths = formatDescribeOutput(result.ast, output, 'paths');
    expect(paths).toContain('->');
  });

  it('should format as json', async () => {
    const { formatDescribeOutput, describeWorkflow } = await import('../../src/cli/commands/describe');
    const { parseWorkflow } = await import('../../src/api/index');

    const filePath = writeFixture('json.ts', SIMPLE_WORKFLOW);
    const result = await parseWorkflow(filePath, { workflowName: 'simpleWf' });
    const output = describeWorkflow(result.ast);
    const json = formatDescribeOutput(result.ast, output, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('simpleWf');
  });
});

describe('formatTextOutput with scoped ports coverage', () => {
  it('should format text output with scoped forEach node', async () => {
    const { formatTextOutput, describeWorkflow } = await import('../../src/cli/commands/describe');
    const { parseWorkflow } = await import('../../src/api/index');

    const filePath = writeFixture('scoped.ts', FOREACH_WORKFLOW);
    const result = await parseWorkflow(filePath, { workflowName: 'scopedWf' });

    if (result.errors.length === 0) {
      const output = describeWorkflow(result.ast);
      const text = formatTextOutput(result.ast, output as any);
      expect(text).toContain('Workflow:');
      // The forEach node should show scoped port info if it has scope metadata
      expect(typeof text).toBe('string');
    }
  });

  it('should format text output for focused node', async () => {
    const { formatTextOutput, describeWorkflow } = await import('../../src/cli/commands/describe');
    const { parseWorkflow } = await import('../../src/api/index');

    const filePath = writeFixture('focused.ts', SIMPLE_WORKFLOW);
    const result = await parseWorkflow(filePath, { workflowName: 'simpleWf' });

    const output = describeWorkflow(result.ast, { node: 'p' });
    const text = formatTextOutput(result.ast, output);
    expect(text).toContain('Node: p');
    expect(text).toContain('proc');
  });
});

describe('describeWorkflow coverage', () => {
  it('should throw for unknown node id', async () => {
    const { describeWorkflow } = await import('../../src/cli/commands/describe');
    const { parseWorkflow } = await import('../../src/api/index');

    const filePath = writeFixture('unknown-node.ts', SIMPLE_WORKFLOW);
    const result = await parseWorkflow(filePath, { workflowName: 'simpleWf' });

    expect(() => describeWorkflow(result.ast, { node: 'nonexistent' })).toThrow(/Node not found/);
  });
});

describe('describeCommand coverage', () => {
  it('should handle file not found', async () => {
    const { describeCommand } = await import('../../src/cli/commands/describe');
    // vitest intercepts process.exit
    await expect(
      describeCommand('/tmp/nonexistent-describe-xyz.ts')
    ).rejects.toThrow(/process\.exit/);
  });

  it('should handle node not found error gracefully', async () => {
    const { describeCommand } = await import('../../src/cli/commands/describe');
    const filePath = writeFixture('describe-cmd.ts', SIMPLE_WORKFLOW);
    await expect(
      describeCommand(filePath, { node: 'nonexistent', workflowName: 'simpleWf' })
    ).rejects.toThrow(/process\.exit/);
  });

  it('should handle --compile flag', async () => {
    const { describeCommand } = await import('../../src/cli/commands/describe');
    const filePath = writeFixture('describe-compile.ts', SIMPLE_WORKFLOW);

    await describeCommand(filePath, { compile: true, workflowName: 'simpleWf' });
  });

  it('should output text format', async () => {
    const { describeCommand } = await import('../../src/cli/commands/describe');
    const filePath = writeFixture('describe-text.ts', SIMPLE_WORKFLOW);

    await describeCommand(filePath, { format: 'text', workflowName: 'simpleWf' });
  });
});

describe('enumeratePaths coverage', () => {
  it('should enumerate paths through workflow', async () => {
    const { enumeratePaths } = await import('../../src/cli/commands/describe');
    const { parseWorkflow } = await import('../../src/api/index');

    const filePath = writeFixture('enum-paths.ts', SIMPLE_WORKFLOW);
    const result = await parseWorkflow(filePath, { workflowName: 'simpleWf' });
    const paths = enumeratePaths(result.ast);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain('Start');
    expect(paths[0]).toContain('Exit');
  });
});

describe('buildGraph coverage', () => {
  it('should build graph string', async () => {
    const { buildGraph } = await import('../../src/cli/commands/describe');
    const { parseWorkflow } = await import('../../src/api/index');

    const filePath = writeFixture('build-graph.ts', SIMPLE_WORKFLOW);
    const result = await parseWorkflow(filePath, { workflowName: 'simpleWf' });
    const graph = buildGraph(result.ast);
    expect(graph).toContain('->');
  });
});

describe('generateMermaid coverage', () => {
  it('should generate mermaid diagram', async () => {
    const { generateMermaid } = await import('../../src/cli/commands/describe');
    const { parseWorkflow } = await import('../../src/api/index');

    const filePath = writeFixture('gen-mermaid.ts', SIMPLE_WORKFLOW);
    const result = await parseWorkflow(filePath, { workflowName: 'simpleWf' });
    const mermaid = generateMermaid(result.ast);
    expect(mermaid).toContain('graph LR');
    expect(mermaid).toContain('-->');
  });
});
