/**
 * Coverage for src/runtime/checkpoint.ts remaining uncovered lines:
 * - loadCheckpoint with workflowFilePath (stale detection, lines 269-271)
 * - loadCheckpoint with unsafe nodes triggering rerunNodes (lines 284-287)
 * - findLatestCheckpoint (lines 310-328)
 * - CheckpointWriter.cleanup (lines 180-194)
 * - serializeValue with non-JSON-serializable values (lines 113-122)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  CheckpointWriter,
  loadCheckpoint,
  findLatestCheckpoint,
} from '../../src/runtime/checkpoint';
import { GeneratedExecutionContext } from '../../src/runtime/ExecutionContext';

let tmpDir: string;
let workflowFile: string;

function writeWorkflowFile(content = 'export function test() { return 1; }'): void {
  fs.writeFileSync(workflowFile, content, 'utf8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-cp-cov2-'));
  workflowFile = path.join(tmpDir, 'workflow.ts');
  writeWorkflowFile();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadCheckpoint - stale detection', () => {
  it('marks checkpoint as stale when workflow file changed', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('node1');
    ctx.setVariable({ id: 'node1', portName: 'result', executionIndex: idx }, 42);

    const writer = new CheckpointWriter(workflowFile, 'test', 'stale-check');
    await writer.write(['node1'], ['node1'], 1, ctx);

    // Modify the workflow file so the hash changes
    writeWorkflowFile('export function test() { return 2; }');

    const { stale, skipNodes } = loadCheckpoint(writer.getCheckpointPath(), workflowFile);
    expect(stale).toBe(true);
    expect(skipNodes.has('node1')).toBe(true);
  });

  it('marks checkpoint as not stale when workflow file is unchanged', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('node1');
    ctx.setVariable({ id: 'node1', portName: 'result', executionIndex: idx }, 42);

    const writer = new CheckpointWriter(workflowFile, 'test', 'same-check');
    await writer.write(['node1'], ['node1'], 1, ctx);

    const { stale } = loadCheckpoint(writer.getCheckpointPath(), workflowFile);
    expect(stale).toBe(false);
  });
});

describe('loadCheckpoint - unsafe nodes and rerun', () => {
  it('puts unsafe nodes and subsequent nodes into rerunNodes', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx1 = ctx.addExecution('safeNode');
    ctx.setVariable({ id: 'safeNode', portName: 'out', executionIndex: idx1 }, 'ok');
    const idx2 = ctx.addExecution('unsafeNode');
    ctx.setVariable(
      { id: 'unsafeNode', portName: 'pending', executionIndex: idx2 },
      new Promise(() => {}),
    );
    const idx3 = ctx.addExecution('afterUnsafe');
    ctx.setVariable({ id: 'afterUnsafe', portName: 'out', executionIndex: idx3 }, 'also ok');

    const writer = new CheckpointWriter(workflowFile, 'test', 'unsafe-test');
    await writer.write(
      ['safeNode', 'unsafeNode', 'afterUnsafe'],
      ['safeNode', 'unsafeNode', 'afterUnsafe'],
      3,
      ctx,
    );

    const { rerunNodes, skipNodes } = loadCheckpoint(writer.getCheckpointPath());
    // safeNode should be skippable
    expect(skipNodes.has('safeNode')).toBe(true);
    // unsafeNode and everything after it should need re-running
    expect(rerunNodes).toContain('unsafeNode');
    expect(rerunNodes).toContain('afterUnsafe');
    expect(rerunNodes).toHaveLength(2);
  });
});

describe('findLatestCheckpoint', () => {
  it('returns null when no checkpoint directory exists', () => {
    const result = findLatestCheckpoint(workflowFile);
    expect(result).toBeNull();
  });

  it('returns null when checkpoint directory is empty', () => {
    const cpDir = path.join(tmpDir, '.fw-checkpoints');
    fs.mkdirSync(cpDir);
    const result = findLatestCheckpoint(workflowFile);
    expect(result).toBeNull();
  });

  it('returns the most recent checkpoint file', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('n1');
    ctx.setVariable({ id: 'n1', portName: 'r', executionIndex: idx }, 1);

    const writer1 = new CheckpointWriter(workflowFile, 'test', 'run-old');
    await writer1.write(['n1'], ['n1'], 1, ctx);

    // Brief delay to ensure different mtime
    await new Promise((r) => setTimeout(r, 50));

    const writer2 = new CheckpointWriter(workflowFile, 'test', 'run-new');
    await writer2.write(['n1'], ['n1'], 1, ctx);

    const latest = findLatestCheckpoint(workflowFile, 'test');
    expect(latest).toBe(writer2.getCheckpointPath());
  });

  it('filters by workflow name when provided', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('n1');
    ctx.setVariable({ id: 'n1', portName: 'r', executionIndex: idx }, 1);

    const writer1 = new CheckpointWriter(workflowFile, 'alpha', 'run1');
    await writer1.write(['n1'], ['n1'], 1, ctx);

    const writer2 = new CheckpointWriter(workflowFile, 'beta', 'run1');
    await writer2.write(['n1'], ['n1'], 1, ctx);

    const alphaResult = findLatestCheckpoint(workflowFile, 'alpha');
    expect(alphaResult).toBe(writer1.getCheckpointPath());

    const betaResult = findLatestCheckpoint(workflowFile, 'beta');
    expect(betaResult).toBe(writer2.getCheckpointPath());
  });

  it('returns latest regardless of name when workflowName not specified', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('n1');
    ctx.setVariable({ id: 'n1', portName: 'r', executionIndex: idx }, 1);

    const writer = new CheckpointWriter(workflowFile, 'any', 'run1');
    await writer.write(['n1'], ['n1'], 1, ctx);

    const result = findLatestCheckpoint(workflowFile);
    expect(result).not.toBeNull();
  });
});

describe('CheckpointWriter.cleanup', () => {
  it('removes checkpoint file and directory when empty', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('n1');
    ctx.setVariable({ id: 'n1', portName: 'r', executionIndex: idx }, 1);

    const writer = new CheckpointWriter(workflowFile, 'test', 'cleanup-run');
    await writer.write(['n1'], ['n1'], 1, ctx);

    expect(fs.existsSync(writer.getCheckpointPath())).toBe(true);

    writer.cleanup();
    expect(fs.existsSync(writer.getCheckpointPath())).toBe(false);

    const cpDir = path.join(tmpDir, '.fw-checkpoints');
    expect(fs.existsSync(cpDir)).toBe(false);
  });

  it('keeps directory if other checkpoint files remain', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('n1');
    ctx.setVariable({ id: 'n1', portName: 'r', executionIndex: idx }, 1);

    const writer1 = new CheckpointWriter(workflowFile, 'test', 'keep-run');
    await writer1.write(['n1'], ['n1'], 1, ctx);

    const writer2 = new CheckpointWriter(workflowFile, 'test', 'delete-run');
    await writer2.write(['n1'], ['n1'], 1, ctx);

    writer2.cleanup();
    // writer1's file should still exist, along with the directory
    expect(fs.existsSync(writer1.getCheckpointPath())).toBe(true);
    const cpDir = path.join(tmpDir, '.fw-checkpoints');
    expect(fs.existsSync(cpDir)).toBe(true);
  });

  it('does not throw when checkpoint file does not exist', () => {
    const writer = new CheckpointWriter(workflowFile, 'test', 'no-file');
    // cleanup without ever writing
    expect(() => writer.cleanup()).not.toThrow();
  });
});

describe('serializeValue - non-JSON-serializable values', () => {
  it('marks circular references as unserializable', async () => {
    const ctx = new GeneratedExecutionContext(true);
    const idx = ctx.addExecution('circNode');
    const circular: any = { a: 1 };
    circular.self = circular;
    ctx.setVariable(
      { id: 'circNode', portName: 'data', executionIndex: idx },
      circular,
    );

    const writer = new CheckpointWriter(workflowFile, 'test', 'circular');
    await writer.write(['circNode'], ['circNode'], 1, ctx);

    const data = JSON.parse(fs.readFileSync(writer.getCheckpointPath(), 'utf8'));
    expect(data.unsafeNodes).toContain('circNode');
    const marker = data.variables['circNode:data:0'];
    expect(marker.__fw_unserializable__).toBe(true);
    expect(marker.reason).toBe('Not JSON-serializable');
  });
});
