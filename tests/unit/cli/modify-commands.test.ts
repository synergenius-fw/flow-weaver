import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  modifyAddNodeCommand,
  modifyRemoveNodeCommand,
  modifyAddConnectionCommand,
  modifyRemoveConnectionCommand,
} from '../../../src/cli/commands/modify';
import { applyModifyOperation, validateModifyParams } from '../../../src/api/modify-operation';
import { AnnotationParser } from '../../../src/parser';

const FIXTURE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @expression
 * @input data [order:0] - Data
 * @output result [order:0] - Result
 * @output onFailure [hidden]
 */
export function processor(data: number): { result: number } {
  return { result: data * 2 };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input value [order:0] - Value
 * @output formatted [order:0] - Formatted
 * @output onFailure [hidden]
 */
export function formatter(value: number): { formatted: string } {
  return { formatted: String(value) };
}

/**
 * @flowWeaver workflow
 *
 * @node a processor [position: 200 100]
 * @node b formatter [position: 400 100]
 *
 * @connect Start.execute -> a.execute
 * @connect a.result -> b.value
 * @connect a.onSuccess -> b.execute
 * @connect b.onSuccess -> Exit.onSuccess
 *
 * @param execute [order:-1] - Execute
 * @param data [order:0] - Data input
 * @returns onSuccess [order:-2] - On Success
 * @returns onFailure [order:-1] [hidden] - On Failure
 * @returns formatted [order:0] - Formatted result
 *
 * @position Start 0 100
 * @position Exit 600 100
 */
export function testWorkflow(
  execute: boolean,
  params: { data: number },
): { onSuccess: boolean; onFailure: boolean; formatted: string } {
  // @flow-weaver-body-start
  // @flow-weaver-body-end
  return { onSuccess: false, onFailure: true, formatted: '' };
}
`;

let tmpDir: string;
let workflowFile: string;

function writeFixture(): void {
  fs.writeFileSync(workflowFile, FIXTURE_WORKFLOW, 'utf-8');
}

function parseFile(): ReturnType<AnnotationParser['parse']> {
  const parser = new AnnotationParser();
  return parser.parse(workflowFile);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-modify-test-'));
  workflowFile = path.join(tmpDir, 'test-workflow.ts');
  writeFixture();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('modify addNode', () => {
  it('adds a node instance to the workflow', async () => {
    await modifyAddNodeCommand(workflowFile, { nodeId: 'c', nodeType: 'processor' });

    const result = parseFile();
    const wf = result.workflows[0];
    const nodeIds = wf.instances.map((i) => i.id);
    expect(nodeIds).toContain('c');
  });

  it('warns when node type does not exist', async () => {
    await modifyAddNodeCommand(workflowFile, { nodeId: 'x', nodeType: 'nonExistent' });

    const result = parseFile();
    const wf = result.workflows[0];
    const nodeIds = wf.instances.map((i) => i.id);
    expect(nodeIds).toContain('x');
  });
});

describe('modify removeNode', () => {
  it('removes a node and its connections', async () => {
    await modifyRemoveNodeCommand(workflowFile, { nodeId: 'b' });

    const result = parseFile();
    const wf = result.workflows[0];
    const nodeIds = wf.instances.map((i) => i.id);
    expect(nodeIds).not.toContain('b');

    const hasConnectionToB = wf.connections.some(
      (c) => c.from.node === 'b' || c.to.node === 'b'
    );
    expect(hasConnectionToB).toBe(false);
  });

  it('throws for non-existent node', async () => {
    let error: Error | undefined;
    try {
      await modifyRemoveNodeCommand(workflowFile, { nodeId: 'zzz' });
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain('zzz');
  });
});

describe('modify addConnection', () => {
  it('adds a connection between nodes', async () => {
    await modifyAddConnectionCommand(workflowFile, {
      from: 'Start.data',
      to: 'a.data',
    });

    const result = parseFile();
    const wf = result.workflows[0];
    const hasConn = wf.connections.some(
      (c) => c.from.node === 'Start' && c.from.port === 'data' &&
             c.to.node === 'a' && c.to.port === 'data'
    );
    expect(hasConn).toBe(true);
  });

  it('throws for invalid connection format', async () => {
    let error: Error | undefined;
    try {
      await modifyAddConnectionCommand(workflowFile, { from: 'badformat', to: 'a.data' });
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain('node.port');
  });

  it('throws for non-existent source node', async () => {
    let error: Error | undefined;
    try {
      await modifyAddConnectionCommand(workflowFile, { from: 'missing.output', to: 'a.data' });
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain('missing');
  });
});

describe('modify removeConnection', () => {
  it('removes an existing connection', async () => {
    await modifyRemoveConnectionCommand(workflowFile, {
      from: 'a.result',
      to: 'b.value',
    });

    const result = parseFile();
    const wf = result.workflows[0];
    const hasConn = wf.connections.some(
      (c) => c.from.node === 'a' && c.from.port === 'result' &&
             c.to.node === 'b' && c.to.port === 'value'
    );
    expect(hasConn).toBe(false);
  });
});

describe('chained operations', () => {
  it('add node then connect it', async () => {
    await modifyAddNodeCommand(workflowFile, { nodeId: 'c', nodeType: 'processor' });
    await modifyAddConnectionCommand(workflowFile, { from: 'a.result', to: 'c.data' });

    const result = parseFile();
    const wf = result.workflows[0];
    expect(wf.instances.map((i) => i.id)).toContain('c');
    const hasConn = wf.connections.some(
      (c) => c.from.node === 'a' && c.from.port === 'result' &&
             c.to.node === 'c' && c.to.port === 'data'
    );
    expect(hasConn).toBe(true);
  });
});

describe('validateModifyParams', () => {
  it('accepts valid addNode params', () => {
    const result = validateModifyParams('addNode', { nodeId: 'x', nodeType: 'y' });
    expect(result.success).toBe(true);
  });

  it('rejects missing nodeId', () => {
    const result = validateModifyParams('addNode', { nodeType: 'y' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown operation', () => {
    const result = validateModifyParams('blah', {});
    expect(result.success).toBe(false);
  });
});

describe('applyModifyOperation', () => {
  it('is exported from the public API', async () => {
    const api = await import('../../../src/api/index');
    expect(api.applyModifyOperation).toBeDefined();
    expect(api.validateModifyParams).toBeDefined();
  });
});
