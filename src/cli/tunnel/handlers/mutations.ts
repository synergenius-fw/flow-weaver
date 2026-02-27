/**
 * Workflow mutation handlers for the tunnel CLI.
 * Ported from flow-weaver-platform/src/services/ast-helpers.ts mutation wrappers.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parser, resolveNpmNodeTypes } from '../../../parser.js';
import { generateInPlace } from '../../../api/generate-in-place.js';
import {
  addNode,
  removeNode,
  updateNode,
  renameNode,
  setNodePosition,
  setNodeMinimized,
  setNodeSize,
} from '../../../api/manipulation/nodes.js';
import { addConnection, removeConnection } from '../../../api/manipulation/connections.js';
import {
  addNodeType,
  removeNodeType,
  renameNodeType,
  updateNodeType,
} from '../../../api/manipulation/node-types.js';
import { setStartExitPorts, setInstancePortConfigs } from '../../../api/manipulation/ports.js';
import type { TWorkflowAST, TNodeTypeAST } from '../../../ast/types.js';
import { resolvePath } from '../path-resolver.js';
import { withFileLock } from '../file-lock.js';
import { prepareMutationResult, getWorkflowName } from './ast-ops.js';
import type { HandlerFn } from '../dispatch.js';

// ---------------------------------------------------------------------------
// Core mutation engine — ported from ast-helpers.ts:95-159
// ---------------------------------------------------------------------------

async function mutateWorkflowFile({
  filePath,
  functionName,
  mutator,
}: {
  filePath: string;
  functionName?: string;
  mutator: (workflow: TWorkflowAST) => TWorkflowAST;
}): Promise<TWorkflowAST> {
  return withFileLock(filePath, async () => {
    const sourceCode = await fs.readFile(filePath, 'utf-8');
    const parsed = parser.parse(filePath);
    const workflows = parsed.workflows || [];

    if (workflows.length === 0) {
      throw new Error(`No workflows found in ${filePath}`);
    }

    const targetIndex = functionName
      ? workflows.findIndex((w: any) => w.functionName === functionName)
      : 0;

    if (targetIndex < 0) {
      throw new Error(`Workflow "${functionName}" not found in ${filePath}`);
    }

    const original = workflows[targetIndex] as TWorkflowAST;
    const updated = mutator(original);

    // Preserve importSource for node types through mutation
    const importSourceMap = new Map<string, string>();
    for (const nt of (original as any).nodeTypes || []) {
      if (nt.importSource) {
        importSourceMap.set(nt.name, nt.importSource);
      }
    }

    const updatedNodeTypes = ((updated as any).nodeTypes || []).map((nt: any) => {
      if (!nt.importSource && importSourceMap.has(nt.name)) {
        return { ...nt, importSource: importSourceMap.get(nt.name) };
      }
      return nt;
    });

    // Re-append node types that existed in original but are missing after mutation
    const updatedTypeNames = new Set(updatedNodeTypes.map((nt: any) => nt.name));
    const missingTypes: TNodeTypeAST[] = [];
    for (const nt of (original as any).nodeTypes || []) {
      if (!updatedTypeNames.has(nt.name)) {
        missingTypes.push(nt);
      }
    }

    const workflowForGeneration = {
      ...updated,
      nodeTypes: [...updatedNodeTypes, ...missingTypes],
    };

    const result = generateInPlace(sourceCode, workflowForGeneration as any);
    await fs.writeFile(filePath, result.code, 'utf-8');

    return resolveNpmNodeTypes(updated, path.dirname(filePath));
  });
}

// ---------------------------------------------------------------------------
// Handler factory — reduces boilerplate for simple mutations
// ---------------------------------------------------------------------------

function makeMutationHandler(
  extractMutator: (
    params: Record<string, unknown>,
  ) => (workflow: TWorkflowAST) => TWorkflowAST,
): HandlerFn {
  return async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) throw new Error('filePath is required');

    const functionName = getWorkflowName(params);
    const resolved = resolvePath(ctx.workspaceRoot, filePath);

    const result = await mutateWorkflowFile({
      filePath: resolved,
      functionName,
      mutator: extractMutator(params),
    });

    return prepareMutationResult(result as Record<string, unknown>, ctx.workspaceRoot);
  };
}

// ---------------------------------------------------------------------------
// Exported handlers
// ---------------------------------------------------------------------------

export const mutationHandlers: Record<string, HandlerFn> = {
  addNode: makeMutationHandler((params) => {
    let node = params.node as any;
    if (!node) {
      const nodeType = params.nodeType as string;
      const nodeName = params.nodeName as string;
      const position = params.position as { x: number; y: number } | undefined;
      node = { type: 'NodeInstance', id: nodeName, nodeType, ...(position && { position }) };
    }
    return (wf) => addNode(wf, node);
  }),

  removeNode: makeMutationHandler((params) => {
    const nodeId = (params.nodeName || params.nodeId) as string;
    if (!nodeId) throw new Error('nodeId is required');
    return (wf) => removeNode(wf, nodeId, { removeConnections: true });
  }),

  updateNode: makeMutationHandler((params) => {
    const nodeId = (params.nodeId || params.nodeName) as string;
    const updates = params.updates as Record<string, unknown>;
    if (!nodeId) throw new Error('nodeId is required');
    return (wf) => updateNode(wf, nodeId, updates as any);
  }),

  renameNode: makeMutationHandler((params) => {
    const oldId = params.oldId as string;
    const newId = params.newId as string;
    if (!oldId || !newId) throw new Error('oldId and newId are required');
    return (wf) => renameNode(wf, oldId, newId);
  }),

  setNodePosition: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const x = params.x as number;
    const y = params.y as number;
    return (wf) => setNodePosition(wf, nodeId, x, y);
  }),

  setNodePositions: makeMutationHandler((params) => {
    const positions = params.positions as Array<{ nodeId: string; x: number; y: number }>;
    if (!positions) throw new Error('positions are required');
    return (wf) => {
      let result = wf;
      for (const { nodeId, x, y } of positions) {
        result = setNodePosition(result, nodeId, x, y);
      }
      return result;
    };
  }),

  setNodeMinimized: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const minimized = params.minimized as boolean;
    return (wf) => setNodeMinimized(wf, nodeId, minimized);
  }),

  setNodeSize: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const width = params.width as number;
    const height = params.height as number;
    return (wf) => setNodeSize(wf, nodeId, width, height);
  }),

  setNodeLabel: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const label = params.label as string | undefined;
    return (wf) => updateNode(wf, nodeId, { label } as any);
  }),

  addNodes: makeMutationHandler((params) => {
    const nodes = params.nodes as any[];
    if (!nodes) throw new Error('nodes are required');
    return (wf) => {
      let result = wf;
      for (const node of nodes) {
        result = addNode(result, node);
      }
      return result;
    };
  }),

  removeNodes: makeMutationHandler((params) => {
    const nodeIds = params.nodeIds as string[];
    if (!nodeIds) throw new Error('nodeIds are required');
    return (wf) => {
      let result = wf;
      for (const nodeId of nodeIds) {
        result = removeNode(result, nodeId, { removeConnections: true });
      }
      return result;
    };
  }),

  addConnection: makeMutationHandler((params) => {
    const from = params.from || { node: params.fromNode, port: params.fromPort };
    const to = params.to || { node: params.toNode, port: params.toPort };
    return (wf) => addConnection(wf, from as any, to as any);
  }),

  removeConnection: makeMutationHandler((params) => {
    const from = params.from || { node: params.fromNode, port: params.fromPort };
    const to = params.to || { node: params.toNode, port: params.toPort };
    return (wf) => removeConnection(wf, from as any, to as any);
  }),

  setConnections: makeMutationHandler((params) => {
    const connections = params.connections as any[];
    return (wf) => ({ ...wf, connections });
  }),

  addConnections: makeMutationHandler((params) => {
    const connections = params.connections as any[];
    return (wf) => ({ ...wf, connections: [...(wf as any).connections, ...connections] });
  }),

  updateNodePortConfig: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const portName = params.portName as string;
    const portConfig = params.portConfig as Record<string, unknown>;
    return (wf) => {
      const node = (wf as any).instances?.find((n: any) => n.id === nodeId);
      if (!node) throw new Error(`Node "${nodeId}" not found`);

      const existing = node.config?.portConfigs || [];
      const idx = existing.findIndex((pc: any) => pc.portName === portName);
      const updated = [...existing];
      if (idx >= 0) {
        updated[idx] = { ...updated[idx], ...portConfig };
      } else {
        updated.push({ portName, ...portConfig });
      }
      return updateNode(wf, nodeId, { config: { ...node.config, portConfigs: updated } } as any);
    };
  }),

  resetNodePortConfig: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const portName = params.portName as string;
    return (wf) => {
      const node = (wf as any).instances?.find((n: any) => n.id === nodeId);
      if (!node) throw new Error(`Node "${nodeId}" not found`);

      const existing = node.config?.portConfigs || [];
      const filtered = existing.filter((pc: any) => pc.portName !== portName);
      return updateNode(wf, nodeId, { config: { ...node.config, portConfigs: filtered } } as any);
    };
  }),

  updateInstancePortConfigs: makeMutationHandler((params) => {
    const instanceId = params.instanceId as string;
    const portConfigs = params.portConfigs as any[];
    return (wf) => setInstancePortConfigs(wf, instanceId, portConfigs);
  }),

  updateWorkflowPorts: makeMutationHandler((params) => {
    const nodeType = params.nodeType as 'Start' | 'Exit';
    const ports = params.ports as any;
    return (wf) => setStartExitPorts(wf, nodeType, ports);
  }),

  addNodeType: makeMutationHandler((params) => {
    const nodeType = params.nodeType as TNodeTypeAST;
    return (wf) => addNodeType(wf, nodeType);
  }),

  removeNodeType: makeMutationHandler((params) => {
    const typeName = params.typeName as string;
    if (!typeName) throw new Error('typeName is required');
    return (wf) => removeNodeType(wf, typeName);
  }),

  renameNodeType: makeMutationHandler((params) => {
    const oldTypeName = params.oldTypeName as string;
    const newTypeName = params.newTypeName as string;
    return (wf) => renameNodeType(wf, oldTypeName, newTypeName);
  }),

  updateNodeType: makeMutationHandler((params) => {
    const typeName = params.typeName as string;
    const updates = params.updates as Partial<TNodeTypeAST>;
    return (wf) => updateNodeType(wf, typeName, updates);
  }),

  setNodeTypes: makeMutationHandler((params) => {
    const nodeTypes = params.nodeTypes as TNodeTypeAST[];
    return (wf) => ({ ...wf, nodeTypes });
  }),

  saveWorkflowState: makeMutationHandler((params) => {
    const workflow = params.workflow as TWorkflowAST;
    return () => workflow;
  }),

  setNodeParent: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const parentId = params.parentId as string | null;
    return (wf) => updateNode(wf, nodeId, { parent: parentId } as any);
  }),

  setNodesParent: makeMutationHandler((params) => {
    const nodeIds = params.nodeIds as string[];
    const parentId = params.parentId as string | null;
    return (wf) => {
      let result = wf;
      for (const nodeId of nodeIds) {
        result = updateNode(result, nodeId, { parent: parentId } as any);
      }
      return result;
    };
  }),

  setCurrentWorkflow: async () => ({ success: true }),

  setWorkflowForceAsync: makeMutationHandler((params) => {
    const forceAsync = params.forceAsync as boolean;
    return (wf) => ({ ...wf, forceAsync } as any);
  }),
};
