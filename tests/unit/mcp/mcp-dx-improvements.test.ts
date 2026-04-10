/**
 * Tests for MCP developer experience improvements:
 * 1. @async accepted in workflow blocks
 * 2. fw_validate draft mode
 * 3. fw_compile draft mode
 * 4. fw_create_model DATA connection wiring
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseWorkflow, validateWorkflow } from '../../../src/api/index.js';
import { AnnotationParser } from '../../../src/parser.js';

// ── Mock MCP SDK ──────────────────────────────────────────────────────────────
const toolHandlers = new Map<string, (args: unknown) => Promise<unknown>>();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class MockMcpServer {
    tool(
      name: string,
      _description: string,
      _schema: Record<string, unknown>,
      handler: (args: unknown) => Promise<unknown>,
    ): void {
      toolHandlers.set(name, handler);
    }
  }
  return { McpServer: MockMcpServer };
});

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerModelTools } from '../../../src/mcp/tools-model.js';

function parseResult(result: unknown): { success: boolean; data?: unknown; error?: unknown } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

// =============================================================================
// 1. @async in workflow blocks
// =============================================================================

describe('@async in workflow blocks', () => {
  it('should not warn on @async annotation in workflow JSDoc', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(`
/** @flowWeaver nodeType */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}

/**
 * @flowWeaver workflow @async
 * @node a myNode
 * @connect Start.execute -> a.execute
 * @connect a.onSuccess -> Exit.onSuccess
 */
export async function myWorkflow(execute: boolean, params: {}): { onSuccess: boolean } {
  throw new Error('Not implemented');
}
`);
    const asyncWarnings = result.warnings.filter((w: string) => w.includes('Unknown annotation @async'));
    expect(asyncWarnings).toHaveLength(0);
  });
});

// =============================================================================
// 2. fw_validate draft mode
// =============================================================================

describe('fw_validate draft mode', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-validate-draft-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('draft mode should suppress STUB_NODE errors', async () => {
    const src = `
/** @flowWeaver node */
declare function myStub(x: string): string;

/**
 * @flowWeaver workflow @autoConnect
 * @node myStub myStub
 * @path Start -> myStub -> Exit
 */
export async function testWf() {}
`;
    const file = path.join(tmpDir, 'stub.ts');
    fs.writeFileSync(file, src);

    const parseRes = await parseWorkflow(file);
    expect(parseRes.errors).toHaveLength(0);

    // Normal mode: STUB_NODE errors present
    const normalResult = validateWorkflow(parseRes.ast);
    expect(normalResult.errors.some((e) => e.code === 'STUB_NODE')).toBe(true);

    // Draft mode: STUB_NODE errors suppressed (reclassified to warnings)
    const draftResult = validateWorkflow(parseRes.ast, { mode: 'draft' });
    expect(draftResult.errors.some((e) => e.code === 'STUB_NODE')).toBe(false);
  });
});

// =============================================================================
// 3. fw_create_model DATA connection wiring
// =============================================================================

describe('fw_create_model DATA connections', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    registerModelTools(mcp);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-model-connect-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function callCreate(args: Record<string, unknown>) {
    const handler = toolHandlers.get('fw_create_model')!;
    return handler(args);
  }

  it('should generate @connect for matching port names between adjacent steps', async () => {
    const outFile = path.join(tmpDir, 'connected.ts');

    await callCreate({
      name: 'pipeline',
      steps: [
        { name: 'stepA', inputs: { data: 'STRING' }, outputs: { result: 'STRING' } },
        { name: 'stepB', inputs: { result: 'STRING' }, outputs: { final: 'STRING' } },
      ],
      flow: 'Start -> stepA -> stepB -> Exit',
      filePath: outFile,
    });

    const content = fs.readFileSync(outFile, 'utf-8');
    // stepA outputs 'result', stepB inputs 'result' -- should be connected
    expect(content).toContain('@connect stepA.result -> stepB.result');
  });

  it('should not generate @connect for non-matching port names', async () => {
    const outFile = path.join(tmpDir, 'no-match.ts');

    await callCreate({
      name: 'pipeline',
      steps: [
        { name: 'stepA', inputs: { data: 'STRING' }, outputs: { output: 'STRING' } },
        { name: 'stepB', inputs: { input: 'STRING' }, outputs: { result: 'STRING' } },
      ],
      flow: 'Start -> stepA -> stepB -> Exit',
      filePath: outFile,
    });

    const content = fs.readFileSync(outFile, 'utf-8');
    expect(content).not.toContain('@connect');
  });

  it('DATA connections should reduce MISSING_REQUIRED_INPUT errors', async () => {
    const outFile = path.join(tmpDir, 'validated.ts');

    await callCreate({
      name: 'pipeline',
      steps: [
        { name: 'enrich', inputs: { data: 'OBJECT' }, outputs: { score: 'NUMBER' } },
        { name: 'route', inputs: { score: 'NUMBER' }, outputs: { result: 'OBJECT' } },
      ],
      flow: 'Start -> enrich -> route -> Exit',
      filePath: outFile,
    });

    const parseRes = await parseWorkflow(outFile);
    expect(parseRes.errors).toHaveLength(0);

    // The 'score' port should be connected, so no MISSING_REQUIRED_INPUT for it
    const result = validateWorkflow(parseRes.ast, { mode: 'draft' });
    const missingScore = result.errors.filter(
      (e) => e.code === 'MISSING_REQUIRED_INPUT' && e.message.includes('score'),
    );
    expect(missingScore).toHaveLength(0);
  });
});
