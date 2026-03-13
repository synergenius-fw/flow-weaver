/**
 * Additional coverage tests for src/cli/commands/status.ts
 * Targets uncovered branches: formatPortList filtering, human-readable structural errors,
 * non-JSON error paths, port display with arrows.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { statusCommand } from '../../src/cli/commands/status';

const TEMP_DIR = path.join(os.tmpdir(), `fw-status-cov-${process.pid}`);

beforeAll(() => fs.mkdirSync(TEMP_DIR, { recursive: true }));
afterAll(() => fs.rmSync(TEMP_DIR, { recursive: true, force: true }));

let origLog: typeof console.log;
let origError: typeof console.error;
let origWarn: typeof console.warn;
let origExit: typeof process.exit;
const logs: string[] = [];
const errors: string[] = [];
const warns: string[] = [];

beforeEach(() => {
  logs.length = 0;
  errors.length = 0;
  warns.length = 0;
  origLog = console.log;
  origError = console.error;
  origWarn = console.warn;
  origExit = process.exit;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  console.warn = (...args: unknown[]) => warns.push(args.map(String).join(' '));
  process.exit = vi.fn() as never;
  process.exitCode = undefined;
});

afterEach(() => {
  console.log = origLog;
  console.error = origError;
  console.warn = origWarn;
  process.exit = origExit;
  process.exitCode = undefined;
});

function writeFixture(name: string, content: string): string {
  const filePath = path.join(TEMP_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

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

const FULLY_IMPLEMENTED = `
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

describe('statusCommand non-JSON file not found', () => {
  it('should log error and set exitCode when file not found (non-JSON)', async () => {
    await statusCommand('/nonexistent/file-xyz.ts', { json: false });

    expect(process.exitCode).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('File not found');
  });
});

describe('statusCommand non-JSON parse errors', () => {
  it('should log parse errors and set exitCode (non-JSON)', async () => {
    const filePath = writeFixture('parse-err-nojson.ts', 'not valid TS {{{{');

    await statusCommand(filePath, { json: false });

    expect(process.exitCode).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('statusCommand human-readable structural errors', () => {
  it('should display structural errors in human-readable mode', async () => {
    const filePath = writeFixture('structural-hr.ts', INVALID_WORKFLOW);

    await statusCommand(filePath, { json: false });

    const allOutput = [...logs, ...errors, ...warns].join(' ');
    // Should show structural errors section
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('statusCommand human-readable valid structure', () => {
  it('should show "Graph structure is valid" for valid workflow', async () => {
    const filePath = writeFixture('valid-struct-hr.ts', FULLY_IMPLEMENTED);

    await statusCommand(filePath, { json: false });

    const allOutput = [...logs, ...errors, ...warns].join(' ');
    expect(allOutput).toContain('valid');
  });
});

describe('statusCommand human-readable with stubs and OK nodes', () => {
  it('should display both STUB and OK tags with port info', async () => {
    const filePath = writeFixture('stubs-hr.ts', WORKFLOW_WITH_STUBS);

    await statusCommand(filePath, { json: false });

    const allOutput = [...logs, ...warns].join(' ');
    expect(allOutput).toContain('[STUB]');
    expect(allOutput).toContain('[OK]');
  });
});

describe('statusCommand port display formatting', () => {
  it('should include inputs and outputs in JSON output', async () => {
    const filePath = writeFixture('ports-json.ts', WORKFLOW_WITH_STUBS);

    await statusCommand(filePath, { json: true });

    const output = JSON.parse(logs.join(''));
    const stub = output.nodes.find((n: { name: string }) => n.name === 'stubProcessor');
    expect(stub.inputs).toBeDefined();
    expect(stub.outputs).toBeDefined();
    // formatPortList should filter out execute, onSuccess, onFailure
    const allPorts = [...stub.inputs, ...stub.outputs];
    expect(allPorts.every((p: string) => !p.startsWith('execute') && !p.startsWith('onSuccess') && !p.startsWith('onFailure'))).toBe(true);
  });
});

describe('statusCommand human-readable with no inputs or outputs', () => {
  it('should handle nodes with no custom ports gracefully', async () => {
    const noPortsWorkflow = `
/**
 * @flowWeaver nodeType
 */
function simpleNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @name simpleWf
 * @node s simpleNode
 * @connect s.onSuccess -> Exit.onSuccess
 */
export function simpleWf(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error("Not implemented");
}
`;
    const filePath = writeFixture('no-ports.ts', noPortsWorkflow);

    await statusCommand(filePath, { json: false });

    // Should complete without error
    const allOutput = [...logs, ...warns].join(' ');
    expect(allOutput).toContain('[OK]');
  });
});

describe('statusCommand catch block with parse errors', () => {
  it('should set exitCode and log error when file has parse errors (non-JSON)', async () => {
    // A file that will cause parse errors (invalid content)
    const filePath = writeFixture('catch-nojson.ts', 'not valid TS at all {{{{ @@@@');

    await statusCommand(filePath, { json: false });

    expect(process.exitCode).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should output JSON error when file has parse errors with json=true', async () => {
    const filePath = writeFixture('catch-json.ts', 'not valid TS at all {{{{ @@@@');

    await statusCommand(filePath, { json: true });

    expect(process.exitCode).toBe(1);
    const output = JSON.parse(logs[0]);
    expect(output.error).toBeDefined();
  });
});

describe('statusCommand node deduplication', () => {
  it('should deduplicate nodes when same type used in multiple instances', async () => {
    const dupWorkflow = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output result
 */
function sharedNode(execute: boolean, x: number): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: x };
}

/**
 * @flowWeaver workflow
 * @name dedupWf
 * @node a sharedNode
 * @node b sharedNode
 * @connect Start.x -> a.x
 * @connect a.onSuccess -> b.execute
 * @connect a.result -> b.x
 * @connect b.onSuccess -> Exit.onSuccess
 * @connect b.result -> Exit.result
 */
export function dedupWf(
  execute: boolean,
  params: { x: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error("Not implemented");
}
`;
    const filePath = writeFixture('dedup.ts', dupWorkflow);

    await statusCommand(filePath, { json: true });

    const output = JSON.parse(logs.join(''));
    // Should only report sharedNode once despite two instances
    expect(output.nodes.length).toBe(1);
    expect(output.nodes[0].name).toBe('sharedNode');
  });
});
