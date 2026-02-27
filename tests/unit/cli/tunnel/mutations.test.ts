import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { mutationHandlers } from '../../../../src/cli/tunnel/handlers/mutations.js';
import type { TunnelContext } from '../../../../src/cli/tunnel/dispatch.js';

const WORKFLOW_SOURCE = `
/**
 * @flowWeaver nodeType
 * @input execute [order:0] - Execute
 * @input value [order:0]
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output result [order:2]
 */
function proc(execute: boolean, value: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver nodeType
 * @input execute [order:0] - Execute
 * @input data [order:0]
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output output [order:2]
 */
function transformer(execute: boolean, data: string) {
  return { onSuccess: true, onFailure: false, output: data.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @node p proc
 * @connect Start.value -> p.value
 * @connect Start.execute -> p.execute
 * @connect p.result -> Exit.result
 * @connect p.onSuccess -> Exit.onSuccess
 * @param execute - Execute
 * @param value
 * @returns onSuccess
 * @returns result
 */
export async function myWorkflow(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; result: number }> {
  throw new Error('Not implemented');
}
`;

let tmpDir: string;
let ctx: TunnelContext;
let workflowFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutations-test-'));
  ctx = { workspaceRoot: tmpDir };
  workflowFile = path.join(tmpDir, 'workflow.ts');
  await fs.writeFile(workflowFile, WORKFLOW_SOURCE, 'utf-8');
});

describe('mutation handlers', () => {
  it('addNode adds a new node instance', async () => {
    const result = (await mutationHandlers.addNode(
      {
        filePath: '/workflow.ts',
        functionName: 'myWorkflow',
        node: { type: 'NodeInstance', id: 't1', nodeType: 'transformer' },
      },
      ctx,
    )) as any;

    expect(result).toBeDefined();
    const node = result.instances?.find((n: any) => n.id === 't1');
    expect(node).toBeDefined();
    expect(node.nodeType).toBe('transformer');
  });

  it('removeNode removes an existing node', async () => {
    const result = (await mutationHandlers.removeNode(
      {
        filePath: '/workflow.ts',
        functionName: 'myWorkflow',
        nodeId: 'p',
      },
      ctx,
    )) as any;

    expect(result).toBeDefined();
    const node = result.instances?.find((n: any) => n.id === 'p');
    expect(node).toBeUndefined();
  });

  it('setNodePosition succeeds and returns workflow AST', async () => {
    const result = (await mutationHandlers.setNodePosition(
      {
        filePath: '/workflow.ts',
        functionName: 'myWorkflow',
        nodeId: 'p',
        x: 200,
        y: 300,
      },
      ctx,
    )) as any;

    expect(result).toBeDefined();
    expect(result.instances).toBeDefined();
    const node = result.instances?.find((n: any) => n.id === 'p');
    expect(node).toBeDefined();
    // Position may be stored in UI metadata rather than directly on instance
  });

  it('addConnection adds a connection', async () => {
    // First add a new node so we can connect to it
    await mutationHandlers.addNode(
      {
        filePath: '/workflow.ts',
        functionName: 'myWorkflow',
        node: { type: 'NodeInstance', id: 't1', nodeType: 'transformer' },
      },
      ctx,
    );

    const result = (await mutationHandlers.addConnection(
      {
        filePath: '/workflow.ts',
        functionName: 'myWorkflow',
        from: { node: 'p', port: 'result' },
        to: { node: 't1', port: 'data' },
      },
      ctx,
    )) as any;

    expect(result).toBeDefined();
    const conn = result.connections?.find(
      (c: any) => c.from?.node === 'p' && c.to?.node === 't1',
    );
    expect(conn).toBeDefined();
  });

  it('removeConnection removes a connection', async () => {
    const result = (await mutationHandlers.removeConnection(
      {
        filePath: '/workflow.ts',
        functionName: 'myWorkflow',
        from: { node: 'p', port: 'result' },
        to: { node: 'Exit', port: 'result' },
      },
      ctx,
    )) as any;

    expect(result).toBeDefined();
    const conn = result.connections?.find(
      (c: any) => c.from?.node === 'p' && c.from?.port === 'result' && c.to?.node === 'Exit' && c.to?.port === 'result',
    );
    expect(conn).toBeUndefined();
  });

  it('addNodeType adds a new node type', async () => {
    const result = (await mutationHandlers.addNodeType(
      {
        filePath: '/workflow.ts',
        functionName: 'myWorkflow',
        nodeType: {
          type: 'NodeType',
          name: 'newType',
          functionName: 'newType',
          inputs: [],
          outputs: [],
        },
      },
      ctx,
    )) as any;

    expect(result).toBeDefined();
    const nt = result.nodeTypes?.find((t: any) => t.name === 'newType');
    expect(nt).toBeDefined();
  });

  it('saveWorkflowState persists the workflow as-is', async () => {
    // Load current state
    const { astOpsHandlers } = await import(
      '../../../../src/cli/tunnel/handlers/ast-ops.js'
    );
    const ast = (await astOpsHandlers.loadWorkflowAST(
      { filePath: '/workflow.ts' },
      ctx,
    )) as any;

    const result = (await mutationHandlers.saveWorkflowState(
      {
        filePath: '/workflow.ts',
        functionName: 'myWorkflow',
        workflow: ast,
      },
      ctx,
    )) as any;

    expect(result).toBeDefined();
    expect(result.instances).toBeDefined();
  });

  it('setCurrentWorkflow returns success', async () => {
    const result = await mutationHandlers.setCurrentWorkflow({}, ctx);
    expect(result).toEqual({ success: true });
  });
});
