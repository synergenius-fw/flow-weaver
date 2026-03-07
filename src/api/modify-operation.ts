import { z } from 'zod';
import type { TWorkflowAST } from '../ast/types.js';
import {
  addNode as manipAddNode,
  removeNode as manipRemoveNode,
  renameNode as manipRenameNode,
  addConnection as manipAddConnection,
  removeConnection as manipRemoveConnection,
  setNodePosition as manipSetNodePosition,
  setNodeLabel as manipSetNodeLabel,
} from './manipulation/index.js';
import { findIsolatedNodes } from './query.js';

export const modifyParamsSchemas: Record<string, z.ZodType> = {
  addNode: z.object({
    nodeId: z.string({ required_error: 'nodeId is required' }),
    nodeType: z.string({ required_error: 'nodeType is required' }),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  removeNode: z.object({
    nodeId: z.string({ required_error: 'nodeId is required' }),
  }),
  renameNode: z.object({
    oldId: z.string({ required_error: 'oldId is required' }),
    newId: z.string({ required_error: 'newId is required' }),
  }),
  addConnection: z.object({
    from: z.string({ required_error: 'from is required (format: "node.port")' }),
    to: z.string({ required_error: 'to is required (format: "node.port")' }),
  }),
  removeConnection: z.object({
    from: z.string({ required_error: 'from is required (format: "node.port")' }),
    to: z.string({ required_error: 'to is required (format: "node.port")' }),
  }),
  setNodePosition: z.object({
    nodeId: z.string({ required_error: 'nodeId is required' }),
    x: z.number({ required_error: 'x is required', invalid_type_error: 'x must be a number' }),
    y: z.number({ required_error: 'y is required', invalid_type_error: 'y must be a number' }),
  }),
  setNodeLabel: z.object({
    nodeId: z.string({ required_error: 'nodeId is required' }),
    label: z.string({ required_error: 'label is required' }),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AST manipulation functions use loose typing
  let modifiedAST = ast as any;

  switch (operation) {
    case 'addNode': {
      const nodeId = p.nodeId as string;
      const nodeType = p.nodeType as string;
      const nodeTypeExists = modifiedAST.nodeTypes.some(
        (nt: { name: string; functionName: string }) =>
          nt.name === nodeType || nt.functionName === nodeType
      );
      if (!nodeTypeExists) {
        warnings.push(
          `Node type "${nodeType}" is not defined in the file. ` +
            `The node will be added but may not render until the type is defined.`
        );
      }

      let autoX = typeof p.x === 'number' ? p.x : undefined;
      let autoY = typeof p.y === 'number' ? p.y : undefined;
      if (autoX === undefined || autoY === undefined) {
        const positions = modifiedAST.instances
          .map((inst: { config?: { x?: number; y?: number } }) => inst.config)
          .filter(
            (c: unknown): c is { x: number; y: number } =>
              c !== undefined &&
              c !== null &&
              typeof (c as Record<string, unknown>).x === 'number' &&
              typeof (c as Record<string, unknown>).y === 'number'
          );
        if (positions.length > 0) {
          const maxX = Math.max(...positions.map((pos: { x: number }) => pos.x));
          if (autoX === undefined) autoX = maxX + 180;
          if (autoY === undefined) autoY = 0;
        } else {
          if (autoX === undefined) autoX = 0;
          if (autoY === undefined) autoY = 0;
        }
      }

      modifiedAST = manipAddNode(modifiedAST, {
        type: 'NodeInstance',
        id: nodeId,
        nodeType,
        config: { x: autoX, y: autoY },
      });
      break;
    }
    case 'removeNode': {
      const nodeId = p.nodeId as string;
      const removedConnections = modifiedAST.connections
        .filter(
          (c: { from: { node: string }; to: { node: string } }) =>
            c.from.node === nodeId || c.to.node === nodeId
        )
        .map((c: { from: { node: string; port: string }; to: { node: string; port: string } }) => ({
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
        ...modifiedAST.instances.map((i: { id: string }) => i.id),
      ];
      if (!validNodes.includes(fromNode)) {
        throw new Error(`Source node "${fromNode}" not found. Available: ${validNodes.join(', ')}`);
      }
      if (!validNodes.includes(toNode)) {
        throw new Error(`Target node "${toNode}" not found. Available: ${validNodes.join(', ')}`);
      }

      if (fromNode !== 'Start' && fromNode !== 'Exit') {
        const inst = modifiedAST.instances.find((i: { id: string }) => i.id === fromNode);
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
        const inst = modifiedAST.instances.find((i: { id: string }) => i.id === toNode);
        const nt = modifiedAST.nodeTypes.find(
          (t: { name: string }) => t.name === (inst as { nodeType: string })?.nodeType
        );
        if (nt && !(nt.inputs as Record<string, unknown>)[toPort]) {
          throw new Error(
            `Node "${toNode}" has no input "${toPort}". Available: ${Object.keys(nt.inputs).join(', ')}`
          );
        }
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
    case 'setNodePosition': {
      modifiedAST = manipSetNodePosition(
        modifiedAST,
        p.nodeId as string,
        p.x as number,
        p.y as number
      );
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
