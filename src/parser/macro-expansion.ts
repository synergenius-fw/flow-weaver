/**
 * Workflow macro expansion.
 *
 * These functions expand the @map / @path / @fanOut / @fanIn / @coerce macros
 * into instances, connections and scopes, and generate the implicit
 * @autoConnect connections. All inputs and outputs are explicit parameters.
 */

import type {
  TNodeTypeAST,
  TPortDefinition,
  TConnectionAST,
  TNodeInstanceAST,
  TWorkflowMacro,
} from '../ast/types';
import { isControlFlowPort } from '../constants';
import { COERCE_TYPE_MAP } from '../built-in-nodes/coercion-types';
import { impliedPathDataEdgesInto } from './path-data-resolution';

export function expandMapMacro(
  mapConfig: {
    instanceId: string;
    childId: string;
    sourceNode: string;
    sourcePort: string;
    inputPort?: string;
    outputPort?: string;
  },
  instances: TNodeInstanceAST[],
  connections: TConnectionAST[],
  scopes: Record<string, string[]>,
  availableNodeTypes: TNodeTypeAST[],
  macros: TWorkflowMacro[],
  errors: string[],
  _warnings: string[]
): void {
  const { instanceId, childId, sourceNode, sourcePort } = mapConfig;
  const scopeName = 'iterate';

  // Find the child node instance (must already be declared via @node)
  const childInstance = instances.find((inst) => inst.id === childId);
  if (!childInstance) {
    errors.push(
      `@map "${instanceId}": child node "${childId}" not found. Declare it with @node before using @map.`
    );
    return;
  }

  // Find the child's node type to determine ports
  const childNodeType = availableNodeTypes.find(
    (nt) => nt.name === childInstance.nodeType || nt.functionName === childInstance.nodeType
  );
  if (!childNodeType) {
    errors.push(
      `@map "${instanceId}": node type "${childInstance.nodeType}" for child "${childId}" not found.`
    );
    return;
  }

  // Determine input/output ports on the child
  // Auto-infer: first non-execute data input, first non-control-flow data output
  let inputPort = mapConfig.inputPort;
  let outputPort = mapConfig.outputPort;

  if (!inputPort) {
    const dataInputs = Object.entries(childNodeType.inputs).filter(
      ([name, def]) => name !== 'execute' && def.dataType !== 'STEP'
    );
    if (dataInputs.length === 0) {
      errors.push(
        `@map "${instanceId}": child node "${childId}" has no data input ports to receive items.`
      );
      return;
    }
    inputPort = dataInputs[0][0];
  }

  if (!outputPort) {
    const dataOutputs = Object.entries(childNodeType.outputs).filter(
      ([name, def]) =>
        name !== 'onSuccess' && name !== 'onFailure' && def.dataType !== 'STEP' && !def.isControlFlow && !def.failure
    );
    if (dataOutputs.length === 0) {
      errors.push(
        `@map "${instanceId}": child node "${childId}" has no data output ports for results.`
      );
      return;
    }
    outputPort = dataOutputs[0][0];
  }

  // Get type info from child ports for the synthetic type
  const childInputDef = childNodeType.inputs[inputPort];
  const childOutputDef = childNodeType.outputs[outputPort];

  // Create synthetic MAP_ITERATOR node type
  const syntheticTypeName = `__map_${instanceId}__`;
  const syntheticNodeType: TNodeTypeAST = {
    type: 'NodeType',
    name: syntheticTypeName,
    functionName: syntheticTypeName,
    variant: 'MAP_ITERATOR',
    isAsync: true,
    executeWhen: 'CONJUNCTION',
    hasSuccessPort: true,
    hasFailurePort: true,
    scope: scopeName,
    scopes: [scopeName],
    inputs: {
      execute: { dataType: 'STEP', label: 'Execute' },
      items: {
        dataType: 'ARRAY',
        label: 'Items',
        tsType: childInputDef?.tsType ? `(${childInputDef.tsType})[]` : 'unknown[]',
      },
      // Scoped INPUT ports (receive from children)
      success: { dataType: 'STEP', scope: scopeName },
      failure: { dataType: 'STEP', scope: scopeName },
      processed: {
        dataType: childOutputDef?.dataType || 'ANY',
        scope: scopeName,
        ...(childOutputDef?.tsType && { tsType: childOutputDef.tsType }),
      },
    },
    outputs: {
      onSuccess: { dataType: 'STEP', label: 'On Success', isControlFlow: true },
      onFailure: { dataType: 'STEP', label: 'On Failure', isControlFlow: true, failure: true },
      results: {
        dataType: 'ARRAY',
        label: 'Results',
        tsType: childOutputDef?.tsType ? `(${childOutputDef.tsType})[]` : 'unknown[]',
      },
      // Scoped OUTPUT ports (send to children)
      start: { dataType: 'STEP', scope: scopeName },
      item: {
        dataType: childInputDef?.dataType || 'ANY',
        scope: scopeName,
        ...(childInputDef?.tsType && { tsType: childInputDef.tsType }),
      },
    },
  };

  // Add synthetic type to available types
  availableNodeTypes.push(syntheticNodeType);

  // Create instance for the map iterator
  const mapInstance: TNodeInstanceAST = {
    type: 'NodeInstance',
    id: instanceId,
    nodeType: syntheticTypeName,
  };
  instances.push(mapInstance);

  // Move child instance into the scope
  childInstance.parent = { id: instanceId, scope: scopeName };

  // Generate scoped connections
  // loop.start:iterate -> proc.execute
  connections.push({
    type: 'Connection',
    from: { node: instanceId, port: 'start', scope: scopeName },
    to: { node: childId, port: 'execute', scope: scopeName },
  });

  // loop.item:iterate -> proc.<inputPort>
  connections.push({
    type: 'Connection',
    from: { node: instanceId, port: 'item', scope: scopeName },
    to: { node: childId, port: inputPort, scope: scopeName },
  });

  // proc.<outputPort> -> loop.processed:iterate
  connections.push({
    type: 'Connection',
    from: { node: childId, port: outputPort, scope: scopeName },
    to: { node: instanceId, port: 'processed', scope: scopeName },
  });

  // proc.onSuccess -> loop.success:iterate
  connections.push({
    type: 'Connection',
    from: { node: childId, port: 'onSuccess', scope: scopeName },
    to: { node: instanceId, port: 'success', scope: scopeName },
  });

  // proc.onFailure -> loop.failure:iterate
  connections.push({
    type: 'Connection',
    from: { node: childId, port: 'onFailure', scope: scopeName },
    to: { node: instanceId, port: 'failure', scope: scopeName },
  });

  // Generate upstream connection: source.port -> loop.items
  connections.push({
    type: 'Connection',
    from: { node: sourceNode, port: sourcePort },
    to: { node: instanceId, port: 'items' },
  });

  // Register scope
  scopes[`${instanceId}.${scopeName}`] = [childId];

  // Store macro for round-trip preservation
  macros.push({
    type: 'map',
    instanceId,
    childId,
    sourcePort: `${sourceNode}.${sourcePort}`,
    ...(mapConfig.inputPort && { inputPort: mapConfig.inputPort }),
    ...(mapConfig.outputPort && { outputPort: mapConfig.outputPort }),
  });
}

/**
 * Expand @path macros into multi-step execution routes with scope walking.
 * Processes all paths together for shared deduplication.
 */
export function expandPathMacros(
  pathConfigs: Array<{ steps: Array<{ node: string; route?: 'ok' | 'fail' }> }>,
  instances: TNodeInstanceAST[],
  connections: TConnectionAST[],
  availableNodeTypes: TNodeTypeAST[],
  startPorts: Record<string, TPortDefinition>,
  exitPorts: Record<string, TPortDefinition>,
  macros: TWorkflowMacro[],
  errors: string[],
  _warnings: string[],
): void {
  // Helper to find a node type by name or functionName
  const findNodeType = (nodeTypeName: string): TNodeTypeAST | undefined =>
    availableNodeTypes.find(
      (nt) => nt.name === nodeTypeName || nt.functionName === nodeTypeName
    );

  // Helper to resolve instance → node type
  const getNodeType = (nodeId: string): TNodeTypeAST | undefined => {
    const instance = instances.find((inst) => inst.id === nodeId);
    if (!instance) return undefined;
    return findNodeType(instance.nodeType);
  };

  // Helper to get output ports for a node (handling Start/Exit)
  const getOutputPorts = (nodeId: string): Record<string, TPortDefinition> => {
    if (nodeId === 'Start') return startPorts;
    if (nodeId === 'Exit') return exitPorts;
    const nodeType = getNodeType(nodeId);
    return nodeType?.outputs || {};
  };

  // Helper to get input ports for a node (handling Start/Exit)
  const getInputPorts = (nodeId: string): Record<string, TPortDefinition> => {
    if (nodeId === 'Exit') return exitPorts;
    if (nodeId === 'Start') return startPorts;
    const nodeType = getNodeType(nodeId);
    return nodeType?.inputs || {};
  };

  // Build a set of existing connection keys for deduplication
  const existingKeys = new Set<string>();
  for (const conn of connections) {
    existingKeys.add(`${conn.from.node}.${conn.from.port}->${conn.to.node}.${conn.to.port}`);
  }

  const addConnection = (fromNode: string, fromPort: string, toNode: string, toPort: string) => {
    const key = `${fromNode}.${fromPort}->${toNode}.${toPort}`;
    if (existingKeys.has(key)) return;
    existingKeys.add(key);
    connections.push({
      type: 'Connection',
      from: { node: fromNode, port: fromPort },
      to: { node: toNode, port: toPort },
    });
  };

  for (const pathConfig of pathConfigs) {
    const { steps } = pathConfig;

    if (steps.length < 2) {
      errors.push(`@path requires at least 2 steps, got ${steps.length}.`);
      continue;
    }

    // Validate all node references exist
    let valid = true;
    for (const step of steps) {
      if (step.node === 'Start' || step.node === 'Exit') continue;
      const instance = instances.find((inst) => inst.id === step.node);
      if (!instance) {
        errors.push(
          `@path: node "${step.node}" not found. Declare it with @node before using @path.`
        );
        valid = false;
      }
    }
    if (!valid) continue;

    // Generate connections for each consecutive pair
    for (let i = 0; i < steps.length - 1; i++) {
      const current = steps[i];
      const next = steps[i + 1];
      const currentId = current.node;
      const nextId = next.node;
      const route = current.route || 'ok';

      // Control flow connection
      if (currentId === 'Start') {
        // Exit has no execute port: a path straight from Start ends on its onSuccess.
        addConnection('Start', 'execute', nextId, nextId === 'Exit' ? 'onSuccess' : 'execute');
      } else if (nextId === 'Exit') {
        if (route === 'fail') {
          addConnection(currentId, 'onFailure', 'Exit', 'onFailure');
        } else {
          addConnection(currentId, 'onSuccess', 'Exit', 'onSuccess');
        }
      } else {
        if (route === 'fail') {
          addConnection(currentId, 'onFailure', nextId, 'execute');
        } else {
          addConnection(currentId, 'onSuccess', nextId, 'execute');
        }
      }


      // Data ports of this step resolve by name to the nearest ancestor in the
      // path (Exit included; see path-data-resolution.ts for the rule). A port
      // the author already connected with @connect is left alone.
      for (const edge of impliedPathDataEdgesInto(steps, i + 1, { inputs: getInputPorts, outputs: getOutputPorts })) {
        const alreadyConnected = connections.some(
          c => c.to.node === edge.to.node && c.to.port === edge.to.port
        );
        if (alreadyConnected) continue;
        addConnection(edge.from.node, edge.from.port, edge.to.node, edge.to.port);
      }
    }

    // Store macro for round-trip preservation
    macros.push({
      type: 'path',
      steps: steps.map(s => s.route ? { node: s.node, route: s.route } : { node: s.node }),
    });
  }
}

/**
 * Expand @fanOut macros into 1-to-N connections.
 */
export function expandFanOutMacros(
  fanOutConfigs: Array<{ source: { node: string; port: string }; targets: Array<{ node: string; port?: string }> }>,
  instances: TNodeInstanceAST[],
  connections: TConnectionAST[],
  startPorts: Record<string, TPortDefinition>,
  exitPorts: Record<string, TPortDefinition>,
  macros: TWorkflowMacro[],
  errors: string[],
): void {
  const instanceIds = new Set(instances.map(i => i.id));
  instanceIds.add('Start');
  instanceIds.add('Exit');

  for (const config of fanOutConfigs) {
    const { source, targets } = config;

    // Validate source node exists
    if (!instanceIds.has(source.node)) {
      errors.push(`@fanOut: source node "${source.node}" does not exist`);
      continue;
    }

    let valid = true;
    for (const target of targets) {
      if (!instanceIds.has(target.node)) {
        errors.push(`@fanOut: target node "${target.node}" does not exist`);
        valid = false;
      }
    }
    if (!valid) continue;

    // Create connections
    for (const target of targets) {
      const targetPort = target.port ?? source.port;
      const conn: TConnectionAST = {
        type: 'Connection',
        from: { node: source.node, port: source.port },
        to: { node: target.node, port: targetPort },
      };
      // Deduplicate
      const exists = connections.some(
        c => c.from.node === conn.from.node && c.from.port === conn.from.port &&
             c.to.node === conn.to.node && c.to.port === conn.to.port
      );
      if (!exists) {
        connections.push(conn);
      }
    }

    // Store macro for round-trip preservation
    macros.push({
      type: 'fanOut',
      source: { node: source.node, port: source.port },
      targets: targets.map(t => t.port ? { node: t.node, port: t.port } : { node: t.node }),
    });
  }
}

/**
 * Expand @fanIn macros into N-to-1 connections.
 */
export function expandFanInMacros(
  fanInConfigs: Array<{ sources: Array<{ node: string; port?: string }>; target: { node: string; port: string } }>,
  instances: TNodeInstanceAST[],
  connections: TConnectionAST[],
  startPorts: Record<string, TPortDefinition>,
  exitPorts: Record<string, TPortDefinition>,
  macros: TWorkflowMacro[],
  errors: string[],
): void {
  const instanceIds = new Set(instances.map(i => i.id));
  instanceIds.add('Start');
  instanceIds.add('Exit');

  for (const config of fanInConfigs) {
    const { sources, target } = config;

    // Validate target node exists
    if (!instanceIds.has(target.node)) {
      errors.push(`@fanIn: target node "${target.node}" does not exist`);
      continue;
    }

    let valid = true;
    for (const source of sources) {
      if (!instanceIds.has(source.node)) {
        errors.push(`@fanIn: source node "${source.node}" does not exist`);
        valid = false;
      }
    }
    if (!valid) continue;

    // Create connections
    for (const source of sources) {
      const sourcePort = source.port ?? target.port;
      const conn: TConnectionAST = {
        type: 'Connection',
        from: { node: source.node, port: sourcePort },
        to: { node: target.node, port: target.port },
      };
      // Deduplicate
      const exists = connections.some(
        c => c.from.node === conn.from.node && c.from.port === conn.from.port &&
             c.to.node === conn.to.node && c.to.port === conn.to.port
      );
      if (!exists) {
        connections.push(conn);
      }
    }

    // Store macro for round-trip preservation
    macros.push({
      type: 'fanIn',
      sources: sources.map(s => s.port ? { node: s.node, port: s.port } : { node: s.node }),
      target: { node: target.node, port: target.port },
    });
  }
}

/**
 * Expand @coerce macros into synthetic coercion node instances + connections.
 */
export function expandCoerceMacros(
  coerceConfigs: Array<{
    instanceId: string;
    source: { node: string; port: string };
    target: { node: string; port: string };
    targetType: 'string' | 'number' | 'boolean' | 'json' | 'object';
  }>,
  instances: TNodeInstanceAST[],
  connections: TConnectionAST[],
  startPorts: Record<string, TPortDefinition>,
  exitPorts: Record<string, TPortDefinition>,
  macros: TWorkflowMacro[],
  errors: string[],
): void {
  const instanceIds = new Set(instances.map(i => i.id));
  instanceIds.add('Start');
  instanceIds.add('Exit');

  for (const config of coerceConfigs) {
    const { instanceId, source, target, targetType } = config;

    // Validate source and target nodes exist
    if (!instanceIds.has(source.node)) {
      errors.push(`@coerce: source node "${source.node}" does not exist`);
      continue;
    }
    if (!instanceIds.has(target.node)) {
      errors.push(`@coerce: target node "${target.node}" does not exist`);
      continue;
    }

    // Check for duplicate instance ID
    if (instanceIds.has(instanceId)) {
      errors.push(`@coerce: instance ID "${instanceId}" already exists`);
      continue;
    }

    const nodeTypeName = COERCE_TYPE_MAP[targetType];
    if (!nodeTypeName) {
      errors.push(`@coerce: unknown target type "${targetType}"`);
      continue;
    }

    // Add synthetic instance
    instances.push({
      type: 'NodeInstance',
      id: instanceId,
      nodeType: nodeTypeName,
    });
    instanceIds.add(instanceId);

    // Add connections: source -> coercion.value, coercion.result -> target
    connections.push({
      type: 'Connection',
      from: { node: source.node, port: source.port },
      to: { node: instanceId, port: 'value' },
    });
    connections.push({
      type: 'Connection',
      from: { node: instanceId, port: 'result' },
      to: { node: target.node, port: target.port },
    });

    // Store macro for round-trip preservation
    macros.push({
      type: 'coerce',
      instanceId,
      source: { node: source.node, port: source.port },
      target: { node: target.node, port: target.port },
      targetType,
    });
  }
}

/**
 * Generate automatic connections for @autoConnect workflows.
 * Wires nodes in declaration order as a linear pipeline:
 * Start -> first node -> second node -> ... -> last node -> Exit
 *
 * For each consecutive pair:
 * - Connect execute flow: previous.onSuccess -> next.execute
 * - Connect data ports where output name matches input name
 * For first node: Start.execute -> first.execute + match Start data ports to first inputs
 * For last node: last.onSuccess -> Exit.execute + match last outputs to Exit ports
 */
export function generateAutoConnections(
  instances: TNodeInstanceAST[],
  availableNodeTypes: TNodeTypeAST[],
  startPorts: Record<string, TPortDefinition>,
  exitPorts: Record<string, TPortDefinition>
): TConnectionAST[] {
  const connections: TConnectionAST[] = [];

  // Helper to find a node type by name or functionName
  const findNodeType = (nodeTypeName: string): TNodeTypeAST | undefined =>
    availableNodeTypes.find(
      (nt) => nt.name === nodeTypeName || nt.functionName === nodeTypeName
    );

  // Connect Start -> first node
  if (instances.length > 0) {
    const firstInstance = instances[0];
    const firstNodeType = findNodeType(firstInstance.nodeType);

    // Start.execute -> first.execute (execution flow)
    connections.push({
      type: 'Connection',
      from: { node: 'Start', port: 'execute' },
      to: { node: firstInstance.id, port: 'execute' },
    });

    // Match Start data ports to first node's data inputs
    if (firstNodeType) {
      for (const [portName, portDef] of Object.entries(startPorts)) {
        if (portDef.dataType === 'STEP') continue; // Skip control flow
        if (portName in firstNodeType.inputs && !isControlFlowPort(portName)) {
          connections.push({
            type: 'Connection',
            from: { node: 'Start', port: portName },
            to: { node: firstInstance.id, port: portName },
          });
        }
      }
    }
  }

  // Connect consecutive nodes
  for (let i = 0; i < instances.length - 1; i++) {
    const current = instances[i];
    const next = instances[i + 1];
    const currentNodeType = findNodeType(current.nodeType);
    const nextNodeType = findNodeType(next.nodeType);

    // current.onSuccess -> next.execute (execution flow)
    connections.push({
      type: 'Connection',
      from: { node: current.id, port: 'onSuccess' },
      to: { node: next.id, port: 'execute' },
    });

    // Match data ports: current outputs -> next inputs (by matching port names)
    if (currentNodeType && nextNodeType) {
      for (const [outputName, outputDef] of Object.entries(currentNodeType.outputs)) {
        if (outputDef.dataType === 'STEP' || isControlFlowPort(outputName)) continue;
        if (outputName in nextNodeType.inputs && !isControlFlowPort(outputName)) {
          connections.push({
            type: 'Connection',
            from: { node: current.id, port: outputName },
            to: { node: next.id, port: outputName },
          });
        }
      }
    }
  }

  // Connect last node -> Exit
  if (instances.length > 0) {
    const lastInstance = instances[instances.length - 1];
    const lastNodeType = findNodeType(lastInstance.nodeType);

    // last.onSuccess -> Exit.onSuccess (execution flow)
    connections.push({
      type: 'Connection',
      from: { node: lastInstance.id, port: 'onSuccess' },
      to: { node: 'Exit', port: 'onSuccess' },
    });

    // Match last node's data outputs to Exit data ports
    if (lastNodeType) {
      for (const [portName, portDef] of Object.entries(exitPorts)) {
        if (portDef.dataType === 'STEP' || portDef.isControlFlow) continue;
        if (lastNodeType.outputs[portName] && !isControlFlowPort(portName)) {
          connections.push({
            type: 'Connection',
            from: { node: lastInstance.id, port: portName },
            to: { node: 'Exit', port: portName },
          });
        }
      }
    }
  }

  return connections;
}

