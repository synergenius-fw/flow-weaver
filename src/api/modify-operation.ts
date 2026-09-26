import { z } from 'zod';
import type { TWorkflowAST } from '../ast/types.js';
import {
  addNode as manipAddNode,
  removeNode as manipRemoveNode,
  renameNode as manipRenameNode,
  addConnection as manipAddConnection,
  removeConnection as manipRemoveConnection,
  setNodeLabel as manipSetNodeLabel,
} from './manipulation/index.js';
import { findIsolatedNodes } from './query.js';

// zod 4 unified `required_error` and `invalid_type_error` into a single `error`
// param (a string or a function of the issue). For these fields the message is
// the same regardless of whether the value is missing or the wrong type, so a
// plain string is the faithful translation.
const modifyParamsSchemas: Record<string, z.ZodType> = {
  addNode: z.object({
    nodeId: z.string({ error: 'nodeId is required' }),
    nodeType: z.string({ error: 'nodeType is required' }),
  }),
  removeNode: z.object({
    nodeId: z.string({ error: 'nodeId is required' }),
  }),
  renameNode: z.object({
    oldId: z.string({ error: 'oldId is required' }),
    newId: z.string({ error: 'newId is required' }),
  }),
  addConnection: z.object({
    from: z.string({ error: 'from is required (format: "node.port")' }),
    to: z.string({ error: 'to is required (format: "node.port")' }),
  }),
  removeConnection: z.object({
    from: z.string({ error: 'from is required (format: "node.port")' }),
    to: z.string({ error: 'to is required (format: "node.port")' }),
  }),
  setNodeLabel: z.object({
    nodeId: z.string({ error: 'nodeId is required' }),
    label: z.string({ error: 'label is required' }),
  }),
};

export function validateModifyParams(
  operation: string,
  params: Record<string, unknown>
): { success: true } | { success: false; error: string } {
  const schema = modifyParamsSchemas[operation];
  if (!schema) {
    return { success: false, error: `Unknown operation: ${operation}` };
  }
  const result = schema.safeParse(params);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join('; ');
    return { success: false, error: `${operation} params invalid: ${messages}` };
  }
  return { success: true };
}

export function applyModifyOperation(
  ast: TWorkflowAST,
  operation: string,
  params: Record<string, unknown>
): { ast: TWorkflowAST; warnings: string[]; extraData: Record<string, unknown> } {
  const p = params;
  const warnings: string[] = [];
  const extraData: Record<string, unknown> = {};
  let modifiedAST: TWorkflowAST = ast;

  switch (operation) {
    case 'addNode': {
      const nodeId = p.nodeId as string;
      const nodeType = p.nodeType as string;
      const nodeTypeExists = modifiedAST.nodeTypes.some(
        (nt) =>
          nt.name === nodeType || nt.functionName === nodeType
      );
      if (!nodeTypeExists) {
        warnings.push(
          `Node type "${nodeType}" is not defined in the file. ` +
            `The node will be added but may not render until the type is defined.`
        );
      }

      modifiedAST = manipAddNode(modifiedAST, {
        type: 'NodeInstance',
        id: nodeId,
        nodeType,
      });
      break;
    }
    case 'removeNode': {
      const nodeId = p.nodeId as string;
      const removedConnections = modifiedAST.connections
        .filter(
          (c) =>
            c.from.node === nodeId || c.to.node === nodeId
        )
        .map((c) => ({
          from: `${c.from.node}.${c.from.port}`,
          to: `${c.to.node}.${c.to.port}`,
        }));
      modifiedAST = manipRemoveNode(modifiedAST, nodeId);
      if (removedConnections.length > 0) {
        extraData.removedConnections = removedConnections;
      }
      break;
    }
    case 'renameNode': {
      modifiedAST = manipRenameNode(modifiedAST, p.oldId as string, p.newId as string);
      break;
    }
    case 'addConnection': {
      const from = p.from as string;
      const to = p.to as string;
      const [fromNode, fromPort] = from.split('.');
      const [toNode, toPort] = to.split('.');

      if (!fromPort || !toPort) {
        throw new Error('Connection format must be "node.port" (e.g., "Start.execute")');
      }

      const validNodes = [
        'Start',
        'Exit',
        ...modifiedAST.instances.map((i) => i.id),
      ];
      if (!validNodes.includes(fromNode)) {
        throw new Error(`Source node "${fromNode}" not found. Available: ${validNodes.join(', ')}`);
      }
      if (!validNodes.includes(toNode)) {
        throw new Error(`Target node "${toNode}" not found. Available: ${validNodes.join(', ')}`);
      }

      if (fromNode !== 'Start' && fromNode !== 'Exit') {
        const inst = modifiedAST.instances.find((i) => i.id === fromNode);
        const nt = modifiedAST.nodeTypes.find(
          (t: { name: string }) => t.name === (inst as { nodeType: string })?.nodeType
        );
        if (nt && !(nt.outputs as Record<string, unknown>)[fromPort]) {
          throw new Error(
            `Node "${fromNode}" has no output "${fromPort}". Available: ${Object.keys(nt.outputs).join(', ')}`
          );
        }
      }
      if (toNode !== 'Start' && toNode !== 'Exit') {
        const inst = modifiedAST.instances.find((i) => i.id === toNode);
        const nt = modifiedAST.nodeTypes.find(
          (t: { name: string }) => t.name === (inst as { nodeType: string })?.nodeType
        );
        if (nt && !(nt.inputs as Record<string, unknown>)[toPort]) {
          throw new Error(
            `Node "${toNode}" has no input "${toPort}". Available: ${Object.keys(nt.inputs).join(', ')}`
          );
        }
      }

      // Idempotent: a connection that is already present (explicitly or via
      // autoConnect) is reported and skipped, so one duplicate does not fail a
      // whole batch of otherwise valid edits.
      const alreadyConnected = (modifiedAST.connections as Array<{
        from: { node: string; port: string; scope?: string };
        to: { node: string; port: string; scope?: string };
      }>).some(
        (c) =>
          c.from.node === fromNode &&
          c.from.port === fromPort &&
          !c.from.scope &&
          c.to.node === toNode &&
          c.to.port === toPort &&
          !c.to.scope
      );
      if (alreadyConnected) {
        warnings.push(`Connection ${from} -> ${to} already exists, skipped`);
        break;
      }

      modifiedAST = manipAddConnection(modifiedAST, from, to);
      if (modifiedAST.options?.autoConnect) {
        modifiedAST = { ...modifiedAST, options: { ...modifiedAST.options, autoConnect: undefined } };
        warnings.push('autoConnect was disabled because connections were manually modified');
      }
      break;
    }
    case 'removeConnection': {
      modifiedAST = manipRemoveConnection(modifiedAST, p.from as string, p.to as string);
      if (modifiedAST.options?.autoConnect) {
        modifiedAST = { ...modifiedAST, options: { ...modifiedAST.options, autoConnect: undefined } };
        warnings.push('autoConnect was disabled because connections were manually modified');
      }
      const newlyIsolated = findIsolatedNodes(modifiedAST);
      if (newlyIsolated.length > 0) {
        extraData.newlyIsolatedNodes = newlyIsolated;
      }
      break;
    }
    case 'setNodeLabel': {
      modifiedAST = manipSetNodeLabel(modifiedAST, p.nodeId as string, p.label as string);
      break;
    }
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }

  return { ast: modifiedAST, warnings, extraData };
}
