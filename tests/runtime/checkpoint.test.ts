import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CheckpointWriter, loadCheckpoint, findLatestCheckpoint } from '../../src/runtime/checkpoint';
import { GeneratedExecutionContext } from '../../src/runtime/ExecutionContext';

// Create a temp directory for test files
let tmpDir: string;
let workflowFile: string;

function writeWorkflowFile(content = 'export function test() { return 1; }'): void {
  fs.writeFileSync(workflowFile, content, 'utf8');
}

function makeCtxWithData(): GeneratedExecutionContext {
  const ctx = new GeneratedExecutionContext(true);
  const idx1 = ctx.addExecution('node1');
  ctx.setVariable({ id: 'node1', portName: 'result', executionIndex: idx1 }, 42);
  const idx2 = ctx.addExecution('node2');
  ctx.setVariable({ id: 'node2', portName: 'output', executionIndex: idx2 }, 'hello');
  return ctx;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-checkpoint-test-'));
  workflowFile = path.join(tmpDir, 'workflow.ts');
  writeWorkflowFile();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('CheckpointWriter', () => {
  it('writes a checkpoint file', async () => {
    const writer = new CheckpointWriter(workflowFile, 'test', 'run-1', { x: 5 });
    const ctx = makeCtxWithData();

    await writer.write(['node1', 'node2'], ['node1', 'node2', 'node3'], 2, ctx);

    expect(fs.existsSync(writer.getCheckpointPath())).toBe(true);

    const data = JSON.parse(fs.readFileSync(writer.getCheckpointPath(), 'utf8'));
    expect(data.version).toBe(1);
    expect(data.workflowName).toBe('test');
    expect(data.params).toEqual({ x: 5 });
    expect(data.completedNodes).toEqual(['node1', 'node2']);
    expect(data.executionOrder).toEqual(['node1', 'node2', 'node3']);
    expect(data.position).toBe(2);
    expect(data.variables['node1:result:0']).toBe(42);
    expect(data.variables['node2:output:1']).toBe('hello');
  });

  it('creates checkpoint directory if it does not exist', async () => {
    const writer = new CheckpointWriter(workflowFile, 'test', 'run-2');
    const ctx = makeCtxWithData();

    const checkpointDir = path.join(tmpDir, '.fw-checkpoints');
    expect(fs.existsSync(checkpointDir)).toBe(false);

    await writer.write(['node1'], ['node1'], 1, ctx);

    expect(fs.existsSync(checkpointDir)).toBe(true);
  });

  it('cleanup removes checkpoint file and empty directory', async () => {
    const writer = new CheckpointWriter(workflowFile, 'test', 'run-3');
    const ctx = makeCtxWithData();

    await writer.write(['node1'], ['node1'], 1, ctx);
    expect(fs.existsSync(writer.getCheckpointPath())).toBe(true);

    writer.cleanup();

    expect(fs.existsSync(writer.getCheckpointPath())).toBe(false);
    // Directory should also be removed since it's empty
    expect(fs.existsSync(path.join(tmpDir, '.fw-checkpoints'))).toBe(false);
  });

  it('handles concurrent writes with write lock', async () => {
    const writer = new CheckpointWriter(workflowFile, 'test', 'run-4');
    const ctx = makeCtxWithData();

    // Fire multiple writes concurrently
    await Promise.all([
      writer.write(['node1'], ['node1', 'node2'], 1, ctx),
      writer.write(['node1', 'node2'], ['node1', 'node2'], 2, ctx),
    ]);

    // Last write should win
    const data = JSON.parse(fs.readFileSync(writer.getCheckpointPath(), 'utf8'));
    expect(data.position).toBe(2);
    expect(data.completedNodes).toEqual(['node1', 'node2']);
  });

  it('handles non-serializable values with markers', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('node1');
    // Create a circular reference
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    ctx.setVariable({ id: 'node1', portName: 'bad', executionIndex: idx }, circular);

    const writer = new CheckpointWriter(workflowFile, 'test', 'run-5');
    await writer.write(['node1'], ['node1'], 1, ctx);

    const data = JSON.parse(fs.readFileSync(writer.getCheckpointPath(), 'utf8'));
    expect(data.unsafeNodes).toContain('node1');
    expect(data.variables['node1:bad:0'].__fw_unserializable__).toBe(true);
  });
});

describe('loadCheckpoint', () => {
  it('loads and validates a checkpoint', async () => {
    const writer = new CheckpointWriter(workflowFile, 'test', 'run-load');
    const ctx = makeCtxWithData();

    await writer.write(['node1', 'node2'], ['node1', 'node2', 'node3'], 2, ctx);

    const { data, stale, rerunNodes, skipNodes } = loadCheckpoint(
      writer.getCheckpointPath(),
      workflowFile
    );

    expect(data.version).toBe(1);
    expect(stale).toBe(false);
    expect(rerunNodes).toEqual([]);
    expect(skipNodes.size).toBe(2);
    expect(skipNodes.has('node1')).toBe(true);
    expect(skipNodes.has('node2')).toBe(true);
  });

  it('detects stale checkpoint when workflow changes', async () => {
    const writer = new CheckpointWriter(workflowFile, 'test', 'run-stale');
    const ctx = makeCtxWithData();

    await writer.write(['node1'], ['node1', 'node2'], 1, ctx);

    // Modify the workflow file
    writeWorkflowFile('export function test() { return 999; }');

    const { stale } = loadCheckpoint(writer.getCheckpointPath(), workflowFile);
    expect(stale).toBe(true);
  });

  it('marks nodes with unserializable outputs for re-run', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx1 = ctx.addExecution('node1');
    ctx.setVariable({ id: 'node1', portName: 'ok', executionIndex: idx1 }, 'fine');
    const idx2 = ctx.addExecution('node2');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    ctx.setVariable({ id: 'node2', portName: 'bad', executionIndex: idx2 }, circular);
    const idx3 = ctx.addExecution('node3');
    ctx.setVariable({ id: 'node3', portName: 'ok', executionIndex: idx3 }, 'also fine');

    const writer = new CheckpointWriter(workflowFile, 'test', 'run-unsafe');
    await writer.write(
      ['node1', 'node2', 'node3'],
      ['node1', 'node2', 'node3'],
      3,
      ctx
    );

    const { rerunNodes, skipNodes } = loadCheckpoint(writer.getCheckpointPath(), workflowFile);

    // node1 is safe (before the unsafe node)
    expect(skipNodes.has('node1')).toBe(true);
    // node2 has unserializable output: re-run from here
    expect(rerunNodes).toContain('node2');
    // node3 is after the unsafe node: also re-run
    expect(rerunNodes).toContain('node3');
  });
});

describe('findLatestCheckpoint', () => {
  it('returns null when no checkpoints exist', () => {
    const result = findLatestCheckpoint(workflowFile);
    expect(result).toBeNull();
  });

  it('finds the most recent checkpoint', async () => {
    const ctx = makeCtxWithData();

    const writer1 = new CheckpointWriter(workflowFile, 'test', 'old');
    await writer1.write(['node1'], ['node1'], 1, ctx);

    // Wait a tiny bit so mtime differs
    await new Promise((r) => setTimeout(r, 10));

    const writer2 = new CheckpointWriter(workflowFile, 'test', 'new');
    await writer2.write(['node1', 'node2'], ['node1', 'node2'], 2, ctx);

    const result = findLatestCheckpoint(workflowFile);
    expect(result).toBe(writer2.getCheckpointPath());
  });

  it('filters by workflow name', async () => {
    const ctx = makeCtxWithData();

    const writerA = new CheckpointWriter(workflowFile, 'alpha', 'run1');
    await writerA.write(['node1'], ['node1'], 1, ctx);

    const writerB = new CheckpointWriter(workflowFile, 'beta', 'run1');
    await writerB.write(['node1'], ['node1'], 1, ctx);

    const result = findLatestCheckpoint(workflowFile, 'alpha');
    expect(result).toBe(writerA.getCheckpointPath());
  });
});

describe('ExecutionContext serialize/restore', () => {
  it('round-trips through serialize and restore', () => {
    const ctx1 = new GeneratedExecutionContext(true);
    const idx = ctx1.addExecution('node1');
    ctx1.setVariable({ id: 'node1', portName: 'value', executionIndex: idx }, 'hello');

    const serialized = ctx1.serialize();
    expect(serialized.variables['node1:value:0']).toBe('hello');
    expect(serialized.executionCounter).toBeGreaterThan(0);

    const ctx2 = new GeneratedExecutionContext(true);
    ctx2.restore(serialized);

    // Should have the same variable
    expect(ctx2.hasVariable({ id: 'node1', portName: 'value', executionIndex: idx })).toBe(true);
  });

  it('resolves function values during serialization', () => {
    const ctx = new GeneratedExecutionContext(false);
    const idx = ctx.addExecution('node1');
    ctx.setVariable({ id: 'node1', portName: 'lazy', executionIndex: idx }, () => 99);

    const serialized = ctx.serialize();
    expect(serialized.variables['node1:lazy:0']).toBe(99);
  });
});
