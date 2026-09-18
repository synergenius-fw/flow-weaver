import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalCoordinator } from '../../src/coordinator/index.js';
import { registerRunTools } from '../../src/mcp/tools-run.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'continuation', 'fixtures');
const agentFixture = path.join(fixtures, 'durable-agent-labeled.ts');

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function createFakeMcpServer() {
  const tools: Record<string, Handler> = {};
  return {
    tools,
    mcp: {
      tool(name: string, _description: string, _schema: unknown, handler: Handler) {
        tools[name] = handler;
      },
    },
  };
}

async function call(handler: Handler, args: Record<string, unknown>) {
  const result = await handler(args);
  return { raw: result.content[0].text, body: JSON.parse(result.content[0].text), isError: result.isError };
}

let rootDir: string;
beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-runs-mcp-'));
});
afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('coordinated run MCP tools', () => {
  it('registers exactly three tools', () => {
    const { mcp, tools } = createFakeMcpServer();
    registerRunTools(mcp as never, createLocalCoordinator({ rootDir }));
    expect(Object.keys(tools).sort()).toEqual(['fw_resume', 'fw_run', 'fw_runs']);
  });

  it('drives an agent gate end to end with only {runId, gate} crossing the boundary', async () => {
    const { mcp, tools } = createFakeMcpServer();
    registerRunTools(mcp as never, createLocalCoordinator({ rootDir }));

    const paused = await call(tools.fw_run, {
      filePath: agentFixture,
      params: { path: 'notes.md', text: 'TODO: ship it.' },
    });
    expect(paused.body.success).toBe(true);
    expect(paused.body.data.status).toBe('waiting');
    expect(paused.body.data.gate).toEqual({
      kind: 'agent',
      node: 'agent',
      inputs: { agentId: 'review', context: 'TODO: ship it.', prompt: null },
      absent: ['prompt'],
    });
    // The token guard: none of the heavy fields may leak into a result.
    for (const key of ['trace', 'continuation', 'events', 'bundleDigest', 'summary']) {
      expect(paused.raw).not.toContain(`"${key}"`);
    }
    expect(paused.raw.length).toBeLessThan(400);

    const done = await call(tools.fw_resume, {
      runId: paused.body.data.runId,
      answer: { summary: 'No tests.', risk: 'high' },
    });
    expect(done.body.data.status).toBe('completed');
    expect(done.body.data.result.report).toContain('risk: high');

    const listed = await call(tools.fw_runs, {});
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({ status: 'completed', workflowName: 'reviewFile' });

    const one = await call(tools.fw_runs, { runId: paused.body.data.runId });
    expect(one.body.data.status).toBe('completed');
  });

  it('refuses ambiguous resume input and unknown runs with stable codes', async () => {
    const { mcp, tools } = createFakeMcpServer();
    registerRunTools(mcp as never, createLocalCoordinator({ rootDir }));

    const both = await call(tools.fw_resume, { runId: 'x', answer: 1, reject: 'no' });
    expect(both.isError).toBe(true);
    expect(both.body.error.code).toBe('INVALID_INPUT');

    const neither = await call(tools.fw_resume, { runId: 'x' });
    expect(neither.body.error.code).toBe('INVALID_INPUT');

    const missing = await call(tools.fw_resume, { runId: 'x', answer: 1 });
    expect(missing.body.error.code).toBe('RUN_NOT_FOUND');

    const inspect = await call(tools.fw_runs, { runId: 'x' });
    expect(inspect.body.error.code).toBe('RUN_NOT_FOUND');
  });

  it('maps a parse failure to PARSE_ERROR', async () => {
    const { mcp, tools } = createFakeMcpServer();
    registerRunTools(mcp as never, createLocalCoordinator({ rootDir }));
    const broken = path.join(rootDir, 'broken.ts');
    fs.writeFileSync(broken, '/** @flowWeaver workflow\n * @node x nope\n */\nexport async function w(execute: boolean) {}\n');
    const result = await call(tools.fw_run, { filePath: broken });
    expect(result.isError).toBe(true);
    expect(result.body.error.code).toBe('PARSE_ERROR');
  });
});
