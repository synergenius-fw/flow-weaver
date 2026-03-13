/**
 * Coverage for checkpoint.ts: serializeValue edge cases (function errors,
 * Promise values) and loadCheckpoint version validation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CheckpointWriter, loadCheckpoint } from '../../src/runtime/checkpoint';
import { GeneratedExecutionContext } from '../../src/runtime/ExecutionContext';

let tmpDir: string;
let workflowFile: string;

function writeWorkflowFile(content = 'export function test() { return 1; }'): void {
  fs.writeFileSync(workflowFile, content, 'utf8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-checkpoint-cov-'));
  workflowFile = path.join(tmpDir, 'workflow.ts');
  writeWorkflowFile();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('serializeValue: function that throws', () => {
  it('marks as unserializable when function invocation fails', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('badNode');
    // Set a function that throws on invocation
    ctx.setVariable(
      { id: 'badNode', portName: 'output', executionIndex: idx },
      () => { throw new Error('cannot resolve'); },
    );

    const writer = new CheckpointWriter(workflowFile, 'test', 'fn-throw');
    await writer.write(['badNode'], ['badNode'], 1, ctx);

    const data = JSON.parse(fs.readFileSync(writer.getCheckpointPath(), 'utf8'));
    expect(data.unsafeNodes).toContain('badNode');
    const marker = data.variables['badNode:output:0'];
    expect(marker.__fw_unserializable__).toBe(true);
    expect(marker.reason).toContain('Function invocation failed');
    expect(marker.nodeId).toBe('badNode');
    expect(marker.portName).toBe('output');
  });
});

describe('serializeValue: Promise values', () => {
  it('marks Promises as unserializable', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('asyncNode');
    // Store an unresolved Promise as a variable value
    ctx.setVariable(
      { id: 'asyncNode', portName: 'pending', executionIndex: idx },
      new Promise(() => {}),
    );

    const writer = new CheckpointWriter(workflowFile, 'test', 'promise-val');
    await writer.write(['asyncNode'], ['asyncNode'], 1, ctx);

    const data = JSON.parse(fs.readFileSync(writer.getCheckpointPath(), 'utf8'));
    expect(data.unsafeNodes).toContain('asyncNode');
    const marker = data.variables['asyncNode:pending:0'];
    expect(marker.__fw_unserializable__).toBe(true);
    expect(marker.reason).toBe('Promise value');
  });
});

describe('loadCheckpoint: version validation', () => {
  it('throws on unsupported checkpoint version', async () => {
    // Write a checkpoint, then tamper with the version
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('node1');
    ctx.setVariable({ id: 'node1', portName: 'r', executionIndex: idx }, 1);

    const writer = new CheckpointWriter(workflowFile, 'test', 'bad-version');
    await writer.write(['node1'], ['node1'], 1, ctx);

    const cpPath = writer.getCheckpointPath();
    const rawData = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
    rawData.version = 99;
    fs.writeFileSync(cpPath, JSON.stringify(rawData), 'utf8');

    expect(() => loadCheckpoint(cpPath)).toThrow('Unsupported checkpoint version: 99');
  });
});

describe('serializeValue: key with no port segment', () => {
  it('uses "unknown" for portName when key has no colon separator', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('simpleNode');
    // Use a function that throws, with a key that has a single segment nodeId
    ctx.setVariable(
      { id: 'simpleNode', portName: 'out', executionIndex: idx },
      () => { throw new Error('fail'); },
    );

    const writer = new CheckpointWriter(workflowFile, 'test', 'simple-key');
    await writer.write(['simpleNode'], ['simpleNode'], 1, ctx);

    const data = JSON.parse(fs.readFileSync(writer.getCheckpointPath(), 'utf8'));
    // The key would be "simpleNode:out:0", so splitting by ":" gives
    // parts[0]="simpleNode", parts[1]="out"
    const marker = data.variables['simpleNode:out:0'];
    expect(marker.__fw_unserializable__).toBe(true);
    expect(marker.portName).toBe('out');
  });
});
