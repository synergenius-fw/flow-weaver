import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseWorkflow } from '../../../src/api/index.js';

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

describe('fw_create_model - compilable output', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    registerModelTools(mcp);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-model-compilable-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function callCreate(args: Record<string, unknown>) {
    const handler = toolHandlers.get('fw_create_model')!;
    expect(handler).toBeDefined();
    return handler(args);
  }

  it('should generate an async function declaration, not a const draft', async () => {
    const outFile = path.join(tmpDir, 'workflow.ts');

    await callCreate({
      name: 'emailWorkflow',
      description: 'Processes incoming emails',
      steps: [
        { name: 'validateEmail', inputs: { email: 'STRING' }, outputs: { valid: 'BOOLEAN' } },
        { name: 'sendReply', inputs: { to: 'STRING', body: 'STRING' }, outputs: { sent: 'BOOLEAN' } },
      ],
      flow: 'Start -> validateEmail -> sendReply -> Exit',
      filePath: outFile,
    });

    const content = fs.readFileSync(outFile, 'utf-8');

    // Should NOT contain the old draft format
    expect(content).not.toContain("= 'flowWeaver:draft'");

    // Should contain an async function declaration
    expect(content).toContain('export async function emailWorkflow()');
  });

  it('should produce output that the real parser can parse', async () => {
    const outFile = path.join(tmpDir, 'parseable.ts');

    await callCreate({
      name: 'leadQualification',
      description: 'Lead qualification pipeline',
      steps: [
        { name: 'enrichCompany', inputs: { form: 'OBJECT' }, outputs: { company: 'OBJECT' } },
        { name: 'scoreLead', inputs: { data: 'OBJECT' }, outputs: { score: 'NUMBER' } },
      ],
      flow: 'Start -> enrichCompany -> scoreLead -> Exit',
      filePath: outFile,
    });

    // Parse with the real parser - should succeed without errors
    const result = await parseWorkflow(outFile);
    expect(result.errors).toHaveLength(0);
    expect(result.ast).toBeDefined();
    expect(result.ast.name).toBe('leadQualification');
  });

  it('should produce output with the correct workflow structure', async () => {
    const outFile = path.join(tmpDir, 'structured.ts');

    await callCreate({
      name: 'testPipeline',
      steps: [
        { name: 'stepA', inputs: { x: 'STRING' }, outputs: { y: 'STRING' } },
        { name: 'stepB', inputs: { y: 'STRING' }, outputs: { z: 'NUMBER' } },
      ],
      flow: 'Start -> stepA -> stepB -> Exit',
      filePath: outFile,
    });

    const result = await parseWorkflow(outFile);
    expect(result.errors).toHaveLength(0);

    const ast = result.ast;
    // Should have the 2 declared node types (stubs)
    const stubTypes = ast.nodeTypes.filter(
      (nt: { functionName: string }) => nt.functionName === 'stepA' || nt.functionName === 'stepB',
    );
    expect(stubTypes.length).toBe(2);
    expect(stubTypes.map((nt: { functionName: string }) => nt.functionName).sort()).toEqual(
      ['stepA', 'stepB'],
    );

    // Should have 2 instances
    expect(ast.instances.length).toBe(2);

    // Should have connections from the @path
    expect(ast.connections.length).toBeGreaterThan(0);
  });

  it('should still work with fw_implement_node after generation', async () => {
    const outFile = path.join(tmpDir, 'implement.ts');

    await callCreate({
      name: 'implTest',
      steps: [
        { name: 'myNode', inputs: { x: 'STRING' }, outputs: { y: 'STRING' } },
      ],
      flow: 'Start -> myNode -> Exit',
      filePath: outFile,
    });

    const content = fs.readFileSync(outFile, 'utf-8');

    // The declare function stub should still be present for fw_implement_node to find
    expect(content).toContain('declare function myNode(x: string): string;');
    // The workflow function should be separate
    expect(content).toContain('export async function implTest()');
  });
});
