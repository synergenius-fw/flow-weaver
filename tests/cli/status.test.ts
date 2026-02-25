/**
 * Tests for status command (implementation progress reporting)
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { statusCommand } from '../../src/cli/commands/status.js';

const STATUS_TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-status-${process.pid}`);

beforeAll(() => fs.mkdirSync(STATUS_TEMP_DIR, { recursive: true }));
afterAll(() => fs.rmSync(STATUS_TEMP_DIR, { recursive: true, force: true }));

let origLog: typeof console.log;
let origError: typeof console.error;
let origWarn: typeof console.warn;
let origExit: typeof process.exit;
const logs: string[] = [];

beforeEach(() => {
  logs.length = 0;
  origLog = console.log;
  origError = console.error;
  origWarn = console.warn;
  origExit = process.exit;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  console.error = vi.fn();
  console.warn = vi.fn();
  process.exit = vi.fn() as never;
});

afterEach(() => {
  console.log = origLog;
  console.error = origError;
  console.warn = origWarn;
  process.exit = origExit;
});

// ── Sample workflows ─────────────────────────────────────────────────────────

const WORKFLOW_WITH_STUBS = `
/**
 * @flowWeaver nodeType
 * @input data
 * @output result
 */
declare function stubProcessor(execute: boolean, data: string): { onSuccess: boolean; onFailure: boolean; result: string };

/**
 * @flowWeaver nodeType
 * @input value
 * @output doubled
 */
function realProcessor(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; doubled: number } {
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @name mixedWorkflow
 * @node s stubProcessor
 * @node r realProcessor
 * @connect Start.data -> s.data
 * @connect s.result -> Exit.result
 * @connect Start.value -> r.value
 * @connect r.doubled -> Exit.doubled
 * @connect r.onSuccess -> Exit.onSuccess
 */
export function mixedWorkflow(
  execute: boolean,
  params: { data: string; value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: string; doubled: number }> {
  throw new Error("Not implemented");
}
`;

const FULLY_IMPLEMENTED_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function adder(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: x + 1 };
}

/**
 * @flowWeaver workflow
 * @name fullWorkflow
 * @node a adder
 * @connect Start.x -> a.x
 * @connect a.result -> Exit.result
 * @connect a.onSuccess -> Exit.onSuccess
 */
export function fullWorkflow(
  execute: boolean,
  params: { x: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error("Not implemented");
}
`;

const INVALID_WORKFLOW = `
/**
 * @flowWeaver nodeType
 */
function broken(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @name badWorkflow
 * @node b broken
 * @connect b.nonExistentPort -> Exit.onSuccess
 */
export function badWorkflow(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;

function writeStatusFixture(name: string, content: string): string {
  const filePath = path.join(STATUS_TEMP_DIR, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// ── statusCommand ────────────────────────────────────────────────────────────

describe('statusCommand', () => {
  it('should report implementation progress with stubs', async () => {
    const file = writeStatusFixture('mixed.ts', WORKFLOW_WITH_STUBS);

    await statusCommand(file, { json: true });

    const output = JSON.parse(logs.join(''));
    expect(output.name).toBe('mixedWorkflow');
    expect(output.total).toBe(2);
    // One stub, one implemented
    expect(output.nodes).toHaveLength(2);

    const stub = output.nodes.find((n: { name: string }) => n.name === 'stubProcessor');
    const real = output.nodes.find((n: { name: string }) => n.name === 'realProcessor');
    expect(stub?.status).toBe('STUB');
    expect(real?.status).toBe('OK');
  });

  it('should report all nodes as OK for fully implemented workflow', async () => {
    const file = writeStatusFixture('full.ts', FULLY_IMPLEMENTED_WORKFLOW);

    await statusCommand(file, { json: true });

    const output = JSON.parse(logs.join(''));
    expect(output.name).toBe('fullWorkflow');
    expect(output.implemented).toBe(output.total);
    expect(output.nodes.every((n: { status: string }) => n.status === 'OK')).toBe(true);
  });

  it('should include structural validity info', async () => {
    const file = writeStatusFixture('structural.ts', FULLY_IMPLEMENTED_WORKFLOW);

    await statusCommand(file, { json: true });

    const output = JSON.parse(logs.join(''));
    expect(output).toHaveProperty('structurallyValid');
    expect(output).toHaveProperty('structuralErrors');
    expect(output.structurallyValid).toBe(true);
    expect(output.structuralErrors).toHaveLength(0);
  });

  it('should include port information for each node', async () => {
    const file = writeStatusFixture('ports.ts', FULLY_IMPLEMENTED_WORKFLOW);

    await statusCommand(file, { json: true });

    const output = JSON.parse(logs.join(''));
    const node = output.nodes[0];
    expect(node.inputs).toBeDefined();
    expect(node.outputs).toBeDefined();
    expect(Array.isArray(node.inputs)).toBe(true);
    expect(Array.isArray(node.outputs)).toBe(true);
  });

  it('should exit(1) for nonexistent file', async () => {
    await statusCommand('/nonexistent/file.ts', { json: true });

    expect(process.exit).toHaveBeenCalledWith(1);
    // The first log entry contains the JSON error
    expect(logs.length).toBeGreaterThan(0);
    const output = JSON.parse(logs[0]);
    expect(output.error).toContain('File not found');
  });

  it('should exit(1) when file has parse errors', async () => {
    const file = writeStatusFixture('parse-error.ts', 'not valid TypeScript workflow {{{{');

    await statusCommand(file, { json: true });

    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should produce human-readable output when json is false', async () => {
    const file = writeStatusFixture('human.ts', FULLY_IMPLEMENTED_WORKFLOW);

    await statusCommand(file, { json: false });

    const allOutput = logs.join(' ');
    expect(allOutput).toContain('fullWorkflow');
    expect(allOutput).toContain('[OK]');
    expect(allOutput).toContain('valid');
  });

  it('should display stub status in human-readable mode', async () => {
    const file = writeStatusFixture('human-stubs.ts', WORKFLOW_WITH_STUBS);

    await statusCommand(file, { json: false });

    // Collect both console.log and console.warn output
    const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock?.calls ?? [];
    const allOutput = [...logs, ...warnCalls.map((c: unknown[]) => c.map(String).join(' '))].join(' ');
    expect(allOutput).toContain('[STUB]');
  });

  it('should handle --workflowName option', async () => {
    const file = writeStatusFixture('named.ts', FULLY_IMPLEMENTED_WORKFLOW);

    await statusCommand(file, { json: true, workflowName: 'fullWorkflow' });

    const output = JSON.parse(logs.join(''));
    expect(output.name).toBe('fullWorkflow');
  });

  it('should report non-STUB structural errors separately', async () => {
    const file = writeStatusFixture('invalid.ts', INVALID_WORKFLOW);

    await statusCommand(file, { json: true });

    const output = JSON.parse(logs.join(''));
    // The workflow has invalid connections, so structuralErrors should be populated
    expect(output.structurallyValid).toBe(false);
    expect(output.structuralErrors.length).toBeGreaterThan(0);
  });
});
