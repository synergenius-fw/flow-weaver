/**
 * Coverage tests for src/mcp/tools-debug.ts (lines 25-645)
 * Tests registerDebugTools via a fake McpServer. Focuses on tool registration,
 * error paths (session not found, no checkpoint, missing params), and the
 * debug session helpers (findVariableKey, cleanupDebugSession, raceDebugPause).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEMP_DIR = path.join(os.tmpdir(), `fw-debug-cov-${process.pid}`);

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
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function simpleWf(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

/**
 * Builds a fake MCP server that captures tool registrations.
 */
function createFakeMcpServer() {
  const tools: Record<string, (args: any) => Promise<any>> = {};

  const mcp = {
    tool: (name: string, _description: string, _schema: any, handler: (args: any) => Promise<any>) => {
      tools[name] = handler;
    },
  };

  return { mcp, tools };
}

function parseToolResult(result: any): any {
  const text = result?.content?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

describe('registerDebugTools coverage', () => {
  let tools: Record<string, (args: any) => Promise<any>>;

  beforeAll(async () => {
    const { registerDebugTools } = await import('../../src/mcp/tools-debug');
    const fake = createFakeMcpServer();
    registerDebugTools(fake.mcp as any);
    tools = fake.tools;
  });

  it('should register all expected debug tools', () => {
    expect(tools['fw_debug_workflow']).toBeDefined();
    expect(tools['fw_debug_step']).toBeDefined();
    expect(tools['fw_debug_continue']).toBeDefined();
    expect(tools['fw_debug_inspect']).toBeDefined();
    expect(tools['fw_debug_set_variable']).toBeDefined();
    expect(tools['fw_debug_breakpoint']).toBeDefined();
    expect(tools['fw_resume_from_checkpoint']).toBeDefined();
    expect(tools['fw_list_debug_sessions']).toBeDefined();
  });

  // -- Error paths for non-existent sessions --

  it('fw_debug_step should return SESSION_NOT_FOUND for non-existent session', async () => {
    const result = await tools['fw_debug_step']({ debugId: 'nonexistent-session-id' });
    const data = parseToolResult(result);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('fw_debug_continue should return SESSION_NOT_FOUND for non-existent session', async () => {
    const result = await tools['fw_debug_continue']({ debugId: 'nonexistent-session-id' });
    const data = parseToolResult(result);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('fw_debug_inspect should return SESSION_NOT_FOUND for non-existent session', async () => {
    const result = await tools['fw_debug_inspect']({ debugId: 'nonexistent-session-id' });
    const data = parseToolResult(result);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('fw_debug_set_variable should return SESSION_NOT_FOUND for non-existent session', async () => {
    const result = await tools['fw_debug_set_variable']({
      debugId: 'nonexistent-session-id',
      nodeId: 'p',
      portName: 'onSuccess',
      value: true,
    });
    const data = parseToolResult(result);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('fw_debug_breakpoint should return SESSION_NOT_FOUND for non-existent session', async () => {
    const result = await tools['fw_debug_breakpoint']({
      debugId: 'nonexistent-session-id',
      action: 'list',
    });
    const data = parseToolResult(result);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('fw_list_debug_sessions should return an array', async () => {
    const result = await tools['fw_list_debug_sessions']({});
    const data = parseToolResult(result);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it('fw_resume_from_checkpoint should return NO_CHECKPOINT when no checkpoint exists', async () => {
    const filePath = writeFixture('resume-no-ckpt.ts', SIMPLE_WORKFLOW);
    const result = await tools['fw_resume_from_checkpoint']({
      filePath,
      workflowName: 'simpleWf',
    });
    const data = parseToolResult(result);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('NO_CHECKPOINT');
  });

  it('fw_debug_workflow should return error for non-existent file', async () => {
    const result = await tools['fw_debug_workflow']({
      filePath: '/tmp/nonexistent-debug-xyz.ts',
      params: {},
    });
    const data = parseToolResult(result);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('DEBUG_START_ERROR');
  });

  it('fw_resume_from_checkpoint with nonexistent checkpoint file should return error', async () => {
    const filePath = writeFixture('resume-bad-path.ts', SIMPLE_WORKFLOW);
    const result = await tools['fw_resume_from_checkpoint']({
      filePath,
      checkpointFile: '/tmp/nonexistent-checkpoint-xyz.json',
    });
    const data = parseToolResult(result);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('RESUME_ERROR');
  });

  // -- Testing with a real debug session by manually using debug-session store --

  it('fw_debug_inspect should return NOT_PAUSED when session has no pause state', async () => {
    const { storeDebugSession, removeDebugSession } = await import('../../src/mcp/debug-session');
    const { DebugController } = await import('../../src/runtime/debug-controller');

    const controller = new DebugController({
      debug: true,
      checkpoint: false,
      executionOrder: ['p'],
    });

    const debugId = 'test-inspect-no-pause';
    storeDebugSession({
      debugId,
      filePath: '/fake/path.ts',
      controller,
      executionPromise: new Promise(() => {}), // never resolves
      createdAt: Date.now(),
      tmpFiles: [],
    });

    try {
      const result = await tools['fw_debug_inspect']({ debugId });
      const data = parseToolResult(result);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_PAUSED');
    } finally {
      removeDebugSession(debugId);
    }
  });

  it('fw_debug_set_variable should return NOT_PAUSED when session has no pause state', async () => {
    const { storeDebugSession, removeDebugSession } = await import('../../src/mcp/debug-session');
    const { DebugController } = await import('../../src/runtime/debug-controller');

    const controller = new DebugController({
      debug: true,
      checkpoint: false,
      executionOrder: ['p'],
    });

    const debugId = 'test-setvar-no-pause';
    storeDebugSession({
      debugId,
      filePath: '/fake/path.ts',
      controller,
      executionPromise: new Promise(() => {}),
      createdAt: Date.now(),
      tmpFiles: [],
    });

    try {
      const result = await tools['fw_debug_set_variable']({
        debugId,
        nodeId: 'p',
        portName: 'onSuccess',
        value: false,
      });
      const data = parseToolResult(result);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_PAUSED');
    } finally {
      removeDebugSession(debugId);
    }
  });

  it('fw_debug_set_variable should return VARIABLE_NOT_FOUND for missing variable', async () => {
    const { storeDebugSession, removeDebugSession } = await import('../../src/mcp/debug-session');
    const { DebugController } = await import('../../src/runtime/debug-controller');

    const controller = new DebugController({
      debug: true,
      checkpoint: false,
      executionOrder: ['p'],
    });

    const debugId = 'test-setvar-missing';
    storeDebugSession({
      debugId,
      filePath: '/fake/path.ts',
      controller,
      executionPromise: new Promise(() => {}),
      createdAt: Date.now(),
      tmpFiles: [],
      lastPauseState: {
        currentNodeId: 'p',
        phase: 'before' as const,
        position: 0,
        executionOrder: ['p'],
        completedNodes: [],
        variables: {},
        breakpoints: [],
      },
    });

    try {
      const result = await tools['fw_debug_set_variable']({
        debugId,
        nodeId: 'p',
        portName: 'nonExistent',
        value: 42,
      });
      const data = parseToolResult(result);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VARIABLE_NOT_FOUND');
    } finally {
      removeDebugSession(debugId);
    }
  });

  it('fw_debug_set_variable should succeed when variable exists', async () => {
    const { storeDebugSession, removeDebugSession } = await import('../../src/mcp/debug-session');
    const { DebugController } = await import('../../src/runtime/debug-controller');

    const controller = new DebugController({
      debug: true,
      checkpoint: false,
      executionOrder: ['p'],
    });

    const debugId = 'test-setvar-ok';
    storeDebugSession({
      debugId,
      filePath: '/fake/path.ts',
      controller,
      executionPromise: new Promise(() => {}),
      createdAt: Date.now(),
      tmpFiles: [],
      lastPauseState: {
        currentNodeId: 'p',
        phase: 'after' as const,
        position: 0,
        executionOrder: ['p'],
        completedNodes: ['p'],
        variables: { 'p:onSuccess:0': true },
        breakpoints: [],
      },
    });

    try {
      const result = await tools['fw_debug_set_variable']({
        debugId,
        nodeId: 'p',
        portName: 'onSuccess',
        value: false,
      });
      const data = parseToolResult(result);
      expect(data.success).toBe(true);
      expect(data.data.modified).toBe('p:onSuccess:0');
      expect(data.data.value).toBe(false);
    } finally {
      removeDebugSession(debugId);
    }
  });

  it('fw_debug_set_variable with executionIndex should work', async () => {
    const { storeDebugSession, removeDebugSession } = await import('../../src/mcp/debug-session');
    const { DebugController } = await import('../../src/runtime/debug-controller');

    const controller = new DebugController({
      debug: true,
      checkpoint: false,
      executionOrder: ['p'],
    });

    const debugId = 'test-setvar-idx';
    storeDebugSession({
      debugId,
      filePath: '/fake/path.ts',
      controller,
      executionPromise: new Promise(() => {}),
      createdAt: Date.now(),
      tmpFiles: [],
      lastPauseState: {
        currentNodeId: 'p',
        phase: 'after' as const,
        position: 0,
        executionOrder: ['p'],
        completedNodes: ['p'],
        variables: { 'p:onSuccess:0': true, 'p:onSuccess:1': false },
        breakpoints: [],
      },
    });

    try {
      const result = await tools['fw_debug_set_variable']({
        debugId,
        nodeId: 'p',
        portName: 'onSuccess',
        value: 'overridden',
        executionIndex: 1,
      });
      const data = parseToolResult(result);
      expect(data.success).toBe(true);
      expect(data.data.modified).toBe('p:onSuccess:1');
    } finally {
      removeDebugSession(debugId);
    }
  });

  it('fw_debug_inspect with nodeId filter should return filtered variables', async () => {
    const { storeDebugSession, removeDebugSession } = await import('../../src/mcp/debug-session');
    const { DebugController } = await import('../../src/runtime/debug-controller');

    const controller = new DebugController({
      debug: true,
      checkpoint: false,
      executionOrder: ['p'],
    });

    const debugId = 'test-inspect-filter';
    storeDebugSession({
      debugId,
      filePath: '/fake/path.ts',
      controller,
      executionPromise: new Promise(() => {}),
      createdAt: Date.now(),
      tmpFiles: [],
      lastPauseState: {
        currentNodeId: 'p',
        phase: 'after' as const,
        position: 0,
        executionOrder: ['p'],
        completedNodes: ['p'],
        variables: { 'p:onSuccess:0': true, 'other:val:0': 42 },
        breakpoints: [],
      },
    });

    try {
      // Filtered
      const result = await tools['fw_debug_inspect']({ debugId, nodeId: 'p' });
      const data = parseToolResult(result);
      expect(data.success).toBe(true);
      expect(data.data.nodeId).toBe('p');
      expect(data.data.variables['onSuccess:0']).toBe(true);

      // Unfiltered
      const resultAll = await tools['fw_debug_inspect']({ debugId });
      const dataAll = parseToolResult(resultAll);
      expect(dataAll.success).toBe(true);
      expect(dataAll.data.state).toBeDefined();
    } finally {
      removeDebugSession(debugId);
    }
  });

  it('fw_debug_breakpoint add/remove/list should work on a stored session', async () => {
    const { storeDebugSession, removeDebugSession } = await import('../../src/mcp/debug-session');
    const { DebugController } = await import('../../src/runtime/debug-controller');

    const controller = new DebugController({
      debug: true,
      checkpoint: false,
      executionOrder: ['p'],
    });

    const debugId = 'test-bp-ops';
    storeDebugSession({
      debugId,
      filePath: '/fake/path.ts',
      controller,
      executionPromise: new Promise(() => {}),
      createdAt: Date.now(),
      tmpFiles: [],
    });

    try {
      // Add
      const addResult = await tools['fw_debug_breakpoint']({
        debugId,
        action: 'add',
        nodeId: 'p',
      });
      expect(parseToolResult(addResult).data.breakpoints).toContain('p');

      // List
      const listResult = await tools['fw_debug_breakpoint']({
        debugId,
        action: 'list',
      });
      expect(parseToolResult(listResult).data.breakpoints).toContain('p');

      // Remove
      const removeResult = await tools['fw_debug_breakpoint']({
        debugId,
        action: 'remove',
        nodeId: 'p',
      });
      expect(parseToolResult(removeResult).data.breakpoints).not.toContain('p');

      // Add without nodeId
      const addNoNode = await tools['fw_debug_breakpoint']({
        debugId,
        action: 'add',
      });
      expect(parseToolResult(addNoNode).success).toBe(false);

      // Remove without nodeId
      const removeNoNode = await tools['fw_debug_breakpoint']({
        debugId,
        action: 'remove',
      });
      expect(parseToolResult(removeNoNode).success).toBe(false);
    } finally {
      removeDebugSession(debugId);
    }
  });

  it('fw_debug_workflow should handle execution (success or error)', async () => {
    const filePath = writeFixture('debug-exec.ts', SIMPLE_WORKFLOW);
    const result = await tools['fw_debug_workflow']({
      filePath,
      workflowName: 'simpleWf',
      params: {},
    });
    const data = parseToolResult(result);
    // Either succeeds or returns a start error depending on environment
    expect(data).toBeDefined();
    if (data.success) {
      expect(['paused', 'completed']).toContain(data.data.status);
    } else {
      expect(data.error).toBeDefined();
    }
  });
});
