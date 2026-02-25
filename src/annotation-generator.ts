import type { TNodeTypeAST, TNodeInstanceAST, TPortDefinition, TWorkflowAST, TDataType, TConnectionAST, TWorkflowMacro } from "./ast";
import { mapToTypeScript } from "./type-mappings";
import { isExecutePort, isSuccessPort, isFailurePort, isControlFlowPort } from "./constants";
import { shouldUseStepTag } from "./utils/port-tag-utils";
import { detectSugarPatterns, filterStaleMacros } from "./sugar-optimizer";

export interface GenerateAnnotationsOptions {
  includeComments?: boolean;
  includeMetadata?: boolean;
  indentSize?: number;
  skipParamReturns?: boolean;
}

export class AnnotationGenerator {
  generate(
    workflow: TWorkflowAST,
    options: GenerateAnnotationsOptions = {},
  ): string {
    const {
      includeComments = true,
      includeMetadata = true,
      indentSize = 2,
      skipParamReturns = false,
    } = options;
    const indent = " ".repeat(indentSize);
    const lines: string[] = [];
    if (includeComments) {
      lines.push("");
      lines.push("");
    }
    workflow.nodeTypes.forEach((nodeType) => {
      // Skip the workflow's own IMPORTED_WORKFLOW entry (would create duplicate)
      if (nodeType.variant === 'IMPORTED_WORKFLOW' && nodeType.functionName === workflow.functionName) {
        return;
      }
      // Skip synthetic MAP_ITERATOR node types — they're generated from @map macros
      if (nodeType.variant === 'MAP_ITERATOR') {
        return;
      }
      // Skip synthetic COERCION node types — they're generated from @coerce macros
      if (nodeType.variant === 'COERCION') {
        return;
      }
      // Skip inferred stubs — they have no @flowWeaver annotation and were auto-detected
      if (nodeType.variant === 'STUB' && nodeType.inferred) {
        return;
      }
      lines.push(
        ...this.generateNodeTypeAnnotation(
          nodeType,
          indent,
          includeComments,
          includeMetadata,
        ),
      );
      lines.push("");
    });
    lines.push(
      ...this.generateWorkflowAnnotation(workflow, indent, includeComments, skipParamReturns),
    );
    lines.push("");
    return lines.join("\n");
  }
  private generateNodeTypeAnnotation(
    nodeType: TNodeTypeAST,
    indent: string,
    includeComments: boolean,
    includeMetadata: boolean,
  ): string[] {
    const lines: string[] = [];

    // If functionText exists, it already includes the JSDoc - use it directly
    if (nodeType.functionText) {
      lines.push(nodeType.functionText);
      return lines;
    }

    // Generate JSDoc comment block (only when no functionText)
    lines.push("/**");

    // Add description if present (handle multi-line descriptions)
    if (includeComments && nodeType.description) {
      for (const descLine of nodeType.description.split('\n')) {
        lines.push(` * ${descLine}`);
      }
      lines.push(` *`);
    }

    // @flowWeaver marker: use 'node' shorthand for stubs and expression nodes
    const isStub = nodeType.variant === 'STUB';
    if (isStub || nodeType.expression) {
      lines.push(" * @flowWeaver node");
    } else {
      lines.push(" * @flowWeaver nodeType");
    }

    // Add label if present
    if (includeMetadata && nodeType.label) {
      lines.push(` * @label ${nodeType.label}`);
    }

    // Add name if different from function name (preserves display name across save/reload)
    if (includeMetadata && nodeType.name && nodeType.name !== nodeType.functionName) {
      lines.push(` * @name ${nodeType.name}`);
    }

    // Add scope if present
    if (nodeType.scope) {
      lines.push(` * @scope ${nodeType.scope}`);
    }

    // Add pullExecution if present
    if (nodeType.defaultConfig?.pullExecution) {
      lines.push(` * @pullExecution ${nodeType.defaultConfig.pullExecution.triggerPort}`);
    }

    // Add input ports (with automatic ordering)
    const inputEntries = this.assignPortOrders(Object.entries(nodeType.inputs), 'input');
    inputEntries.forEach(([name, port]) => {
      const portTag = this.generateJSDocPortTag(name, port, 'input');
      lines.push(` * ${portTag}`);
    });

    // Add output ports (with automatic ordering)
    const outputEntries = this.assignPortOrders(Object.entries(nodeType.outputs), 'output');
    outputEntries.forEach(([name, port]) => {
      const portTag = this.generateJSDocPortTag(name, port, 'output');
      lines.push(` * ${portTag}`);
    });

    lines.push(" */");

    // Generate function signature
    lines.push(...this.generateFunctionSignature(nodeType));
    return lines;
  }
  private generateJSDocPortTag(name: string, port: TPortDefinition, direction: 'input' | 'output', implicitOrder?: number): string {
    return generateJSDocPortTag(name, port, direction, implicitOrder);
  }

  private generateTPortDefinition(
    port: TPortDefinition,
    _indent: string,
  ): string {
    if (
      !port.optional &&
      port.default === undefined &&
      !port.expression &&
      !port.label &&
      !port.hidden &&
      !port.failure
    ) {
      return `'${port.dataType}'`;
    }
    const props: string[] = [];
    props.push(`type: '${port.dataType}'`);
    if (port.optional) {
      props.push(`optional: true`);
    }
    if (port.default !== undefined) {
      props.push(`defaultValue: ${JSON.stringify(port.default)}`);
    }
    if (port.expression) {
      props.push(`expression: \`${port.expression}\``);
    }
    if (port.label) {
      props.push(`label: '${port.label}'`);
    }
    if (port.hidden) {
      props.push(`hidden: true`);
    }
    if (port.failure) {
      props.push(`failure: true`);
    }
    return `{ ${props.join(", ")} }`;
  }
  private generateFunctionSignature(nodeType: TNodeTypeAST): string[] {
    return generateFunctionSignature(nodeType);
  }
  private generateWorkflowAnnotation(
    workflow: TWorkflowAST,
    indent: string,
    includeComments: boolean,
    skipParamReturns: boolean = false,
  ): string[] {
    const lines: string[] = [];

    // Build macro coverage sets for filtering (@map and @coerce)
    const macroInstanceIds = new Set<string>();
    const macroChildIds = new Set<string>();
    const macroScopeNames = new Set<string>();
    const coerceInstanceIds = new Set<string>();
    if (workflow.macros && workflow.macros.length > 0) {
      for (const macro of workflow.macros) {
        if (macro.type === 'map') {
          macroInstanceIds.add(macro.instanceId);
          macroChildIds.add(macro.childId);
          macroScopeNames.add(`${macro.instanceId}.iterate`);
        } else if (macro.type === 'coerce') {
          coerceInstanceIds.add(macro.instanceId);
        }
      }
    }

    // Generate JSDoc comment block
    lines.push("/**");

    // Add description if present
    if (includeComments && workflow.description) {
      lines.push(` * ${workflow.description}`);
      lines.push(` *`);
    }

    // @flowWeaver workflow marker
    lines.push(" * @flowWeaver workflow");

    // Add strictTypes option if enabled
    if (workflow.options?.strictTypes) {
      lines.push(" * @strictTypes");
    }

    // Add autoConnect option if enabled
    if (workflow.options?.autoConnect) {
      lines.push(" * @autoConnect");
    }

    // @trigger round-trip
    if (workflow.options?.trigger) {
      const t = workflow.options.trigger;
      const parts: string[] = [];
      if (t.event) parts.push(`event="${t.event}"`);
      if (t.cron) parts.push(`cron="${t.cron}"`);
      if (parts.length > 0) lines.push(` * @trigger ${parts.join(' ')}`);
    }
    // @cancelOn round-trip
    if (workflow.options?.cancelOn) {
      const c = workflow.options.cancelOn;
      let line = ` * @cancelOn event="${c.event}"`;
      if (c.match) line += ` match="${c.match}"`;
      if (c.timeout) line += ` timeout="${c.timeout}"`;
      lines.push(line);
    }
    // @retries round-trip
    if (workflow.options?.retries !== undefined) {
      lines.push(` * @retries ${workflow.options.retries}`);
    }
    // @timeout round-trip
    if (workflow.options?.timeout) {
      lines.push(` * @timeout "${workflow.options.timeout}"`);
    }
    // @throttle round-trip
    if (workflow.options?.throttle) {
      const t = workflow.options.throttle;
      let line = ` * @throttle limit=${t.limit}`;
      if (t.period) line += ` period="${t.period}"`;
      lines.push(line);
    }

    // Add name if different from export name
    if (workflow.name && workflow.name !== workflow.functionName) {
      lines.push(` * @name ${workflow.name}`);
    }

    // Add description tag
    if (workflow.description && includeComments) {
      lines.push(` * @description ${workflow.description}`);
    }

    // Add node instances — skip synthetic MAP_ITERATOR/COERCION instances, strip parent from macro children
    workflow.instances.forEach((instance) => {
      if (macroInstanceIds.has(instance.id)) return;
      if (coerceInstanceIds.has(instance.id)) return;
      if (macroChildIds.has(instance.id) && instance.parent) {
        const stripped = { ...instance, parent: undefined };
        lines.push(generateNodeInstanceTag(stripped));
      } else {
        lines.push(generateNodeInstanceTag(instance));
      }
    });

    // Filter stale macros (e.g. paths whose connections were deleted)
    const existingMacros = filterStaleMacros(
      workflow.macros || [],
      workflow.connections,
      workflow.instances,
    );

    // Auto-detect @path sugar patterns from connections
    const detected = detectSugarPatterns(
      workflow.connections,
      workflow.instances,
      existingMacros,
      workflow.nodeTypes,
      workflow.startPorts,
      workflow.exitPorts,
    );

    // Merge detected macros with existing ones
    const allMacros: TWorkflowMacro[] = [
      ...existingMacros,
      ...detected.paths,
    ];

    // Add @map and @path macros
    if (allMacros.length > 0) {
      for (const macro of allMacros) {
        if (macro.type === 'map') {
          let mapLine = ` * @map ${macro.instanceId} ${macro.childId}`;
          if (macro.inputPort || macro.outputPort) {
            mapLine += `(${macro.inputPort} -> ${macro.outputPort})`;
          }
          mapLine += ` over ${macro.sourcePort}`;
          lines.push(mapLine);
        } else if (macro.type === 'path') {
          const stepsStr = macro.steps.map(s => s.route ? `${s.node}:${s.route}` : s.node).join(' -> ');
          lines.push(` * @path ${stepsStr}`);
        } else if (macro.type === 'fanOut') {
          const src = `${macro.source.node}.${macro.source.port}`;
          const tgts = macro.targets.map(t => t.port ? `${t.node}.${t.port}` : t.node).join(', ');
          lines.push(` * @fanOut ${src} -> ${tgts}`);
        } else if (macro.type === 'fanIn') {
          const srcs = macro.sources.map(s => s.port ? `${s.node}.${s.port}` : s.node).join(', ');
          const tgt = `${macro.target.node}.${macro.target.port}`;
          lines.push(` * @fanIn ${srcs} -> ${tgt}`);
        } else if (macro.type === 'coerce') {
          const src = `${macro.source.node}.${macro.source.port}`;
          const tgt = `${macro.target.node}.${macro.target.port}`;
          lines.push(` * @coerce ${macro.instanceId} ${src} -> ${tgt} as ${macro.targetType}`);
        }
      }
    }

    // Add node positions (if they exist)
    // Start with Start node position if present
    if (workflow.ui?.startNode?.x !== undefined && workflow.ui?.startNode?.y !== undefined) {
      lines.push(` * @position Start ${Math.round(workflow.ui.startNode.x)} ${Math.round(workflow.ui.startNode.y)}`);
    }

    // Instance positions are now emitted as [position: x y] on @node lines

    // Add Exit node position if present
    if (workflow.ui?.exitNode?.x !== undefined && workflow.ui?.exitNode?.y !== undefined) {
      lines.push(` * @position Exit ${Math.round(workflow.ui.exitNode.x)} ${Math.round(workflow.ui.exitNode.y)}`);
    }

    // Add connections — skip connections covered by macros
    if (!workflow.options?.autoConnect) {
      workflow.connections.forEach((conn) => {
        if (allMacros.length > 0 && isConnectionCoveredByMacroStatic(conn, allMacros)) return;
        const fromScope = conn.from.scope ? `:${conn.from.scope}` : '';
        const toScope = conn.to.scope ? `:${conn.to.scope}` : '';
        lines.push(` * @connect ${conn.from.node}.${conn.from.port}${fromScope} -> ${conn.to.node}.${conn.to.port}${toScope}`);
      });
    }

    // Add @param annotations for start ports (workflow inputs)
    if (!skipParamReturns && workflow.startPorts && Object.keys(workflow.startPorts).length > 0) {
      const startPortEntries = this.assignPortOrders(Object.entries(workflow.startPorts), 'input');
      startPortEntries.forEach(([name, port], index) => {
        const paramTag = this.generateJSDocPortTag(name, port, 'input', index);
        // Replace @input with @param for workflow-level JSDoc
        lines.push(` * ${paramTag.replace('@input', '@param')}`);
      });
    }

    // Add @returns annotations for exit ports (workflow outputs)
    if (!skipParamReturns && workflow.exitPorts && Object.keys(workflow.exitPorts).length > 0) {
      const exitPortEntries = this.assignPortOrders(Object.entries(workflow.exitPorts), 'output');
      exitPortEntries.forEach(([name, port], index) => {
        const returnTag = this.generateJSDocPortTag(name, port, 'output', index);
        // Replace @output with @returns for workflow-level JSDoc
        lines.push(` * ${returnTag.replace('@output', '@returns')}`);
      });
    }

    // Add scopes — skip scopes covered by @map macros
    if (workflow.scopes) {
      Object.entries(workflow.scopes).forEach(([scopeName, children]) => {
        if (macroScopeNames.has(scopeName)) return;
        lines.push(` * @scope ${scopeName} [${children.join(', ')}]`);
      });
    }

    lines.push(" */");

    // Add workflow function signature
    lines.push(...this.generateWorkflowFunctionSignature(workflow));
    return lines;
  }
  private generateWorkflowFunctionSignature(workflow: TWorkflowAST): string[] {
    const lines: string[] = [];

    // Stub workflows use const declaration format
    if (workflow.stub) {
      lines.push(`export const ${workflow.functionName} = 'flowWeaver:draft';`);
      return lines;
    }

    const startPorts = workflow.startPorts || {};
    const exitPorts = workflow.exitPorts || {};

    // Build parameter types (excluding execute)
    const params: string[] = [];
    Object.entries(startPorts).forEach(([name, port]) => {
      if (isExecutePort(name)) return;
      const optional = port.optional ? "?" : "";
      params.push(`${name}${optional}: ${this.mapDataTypeToTS(port.dataType)}`);
    });

    // Build return types (including onSuccess/onFailure)
    const returns: string[] = [];
    Object.entries(exitPorts).forEach(([name, port]) => {
      const optional = port.optional ? "?" : "";
      returns.push(
        `${name}${optional}: ${this.mapDataTypeToTS(port.dataType)}`,
      );
    });

    // Generate async function signature with execute parameter
    lines.push(`export async function ${workflow.functionName}(`);
    lines.push(`  execute: boolean,`);
    lines.push(`  params: { ${params.join("; ")} }`);
    lines.push(`): Promise<{ ${returns.join("; ")} }> {`);
    lines.push(`  throw new Error('Not implemented');`);
    lines.push("}");
    return lines;
  }
  private assignPortOrders(
    ports: [string, TPortDefinition][],
    direction: 'input' | 'output'
  ): [string, TPortDefinition][] {
    return assignPortOrders(ports, direction);
  }

  private mapDataTypeToTS(dataType: string): string {
    return mapToTypeScript(dataType as TDataType);
  }
}

/**
 * Generate JSDoc port tag (e.g., @input name - Description)
 * Exported for reuse in generate-in-place.ts to maintain DRY principle
 *
 * New format (types derived from signature):
 * - @input name - Description
 * - @output name - Description
 * - @step name - Description (for explicit STEP/control-flow ports)
 *
 * Reserved STEP ports (execute, onSuccess, onFailure) use @input/@output.
 * Custom STEP ports use @step.
 */
export function generateJSDocPortTag(
  name: string,
  port: TPortDefinition,
  direction: 'input' | 'output',
  _implicitOrder?: number
): string {
  // Determine tag: @step for explicit control flow, @input/@output for data
  // Reserved STEP ports (execute, onSuccess, onFailure) stay as @input/@output
  // Scoped mandatory ports (start, success, failure) with scope attribute also stay as @input/@output
  const tag = shouldUseStepTag(name, port) ? 'step' : direction;

  // Format: @input [name=default] - Description
  // or: @input name - Expression: (ctx) => ...
  let portStr = `@${tag} `;

  // Handle optional with default value: [name=value]
  if (port.optional && port.default !== undefined) {
    portStr += `[${name}=${JSON.stringify(port.default)}]`;
  }
  // Handle optional without default: [name]
  else if (port.optional) {
    portStr += `[${name}]`;
  }
  // Handle required with default: name=value (though rare)
  else if (port.default !== undefined) {
    portStr += `${name}=${JSON.stringify(port.default)}`;
  }
  // Regular required port
  else {
    portStr += name;
  }

  // Add scope attribute if present (for per-port scoped architecture)
  if (port.scope) {
    portStr += ` scope:${port.scope}`;
  }

  // Add order metadata whenever it's explicitly set to preserve round-trip fidelity
  // Even if order matches position, we must write it to avoid losing metadata on re-parse
  if (port.metadata?.order !== undefined) {
    portStr += ` [order:${port.metadata.order}]`;
  }

  // Add placement metadata when explicitly set
  if (port.metadata?.placement !== undefined) {
    portStr += ` [placement:${port.metadata.placement}]`;
  }

  if (port.expression) {
    portStr += ` - Expression: ${port.expression}`;
  } else if (port.label && port.label !== name) {
    // Only add label if it differs from the port name
    portStr += ` - ${port.label}`;
  }

  return portStr;
}

/**
 * Check if a connection is covered by a macro (and should not be written as @connect).
 * Handles both @map and @path macros.
 */
function isConnectionCoveredByMacroStatic(conn: TConnectionAST, macros: TWorkflowMacro[]): boolean {
  for (const macro of macros) {
    if (macro.type === 'map') {
      const [sourceNode, sourcePort] = macro.sourcePort.split('.');

      // Scoped connections between the map instance and its child
      if (
        (conn.from.node === macro.instanceId || conn.from.node === macro.childId) &&
        (conn.to.node === macro.instanceId || conn.to.node === macro.childId) &&
        (conn.from.scope === 'iterate' || conn.to.scope === 'iterate')
      ) {
        return true;
      }

      // Upstream connection: source.port -> mapInstance.items
      if (
        conn.from.node === sourceNode &&
        conn.from.port === sourcePort &&
        !conn.from.scope &&
        conn.to.node === macro.instanceId &&
        conn.to.port === 'items' &&
        !conn.to.scope
      ) {
        return true;
      }
    } else if (macro.type === 'path') {
      if (conn.from.scope || conn.to.scope) continue;
      const steps = macro.steps;
      const fromIdx = steps.findIndex(s => s.node === conn.from.node);
      const toIdx = steps.findIndex(s => s.node === conn.to.node);
      if (fromIdx === -1 || toIdx === -1 || fromIdx >= toIdx) continue;

      // Control flow: check consecutive pairs
      if (toIdx === fromIdx + 1) {
        const route = steps[fromIdx].route || 'ok';
        // Start.execute -> next.execute
        if (conn.from.node === 'Start' && conn.from.port === 'execute' && conn.to.port === 'execute') return true;
        // To Exit: route determines which Exit port
        if (conn.to.node === 'Exit') {
          if (route === 'fail' && conn.from.port === 'onFailure' && conn.to.port === 'onFailure') return true;
          if (route === 'ok' && conn.from.port === 'onSuccess' && conn.to.port === 'onSuccess') return true;
        }
        // Normal: onSuccess/onFailure -> execute
        if (route === 'fail' && conn.from.port === 'onFailure' && conn.to.port === 'execute') return true;
        if (route === 'ok' && conn.from.port === 'onSuccess' && conn.to.port === 'execute') return true;
      }
      // Data: same-name non-control-flow, from before to, to is not Exit
      if (
        conn.to.node !== 'Exit' &&
        !isControlFlowPort(conn.from.port) &&
        !isControlFlowPort(conn.to.port) &&
        conn.from.port === conn.to.port
      ) {
        return true;
      }
    } else if (macro.type === 'fanOut') {
      if (conn.from.scope || conn.to.scope) continue;
      // Check if connection matches the fan-out pattern
      if (conn.from.node === macro.source.node && conn.from.port === macro.source.port) {
        for (const target of macro.targets) {
          const targetPort = target.port ?? macro.source.port;
          if (conn.to.node === target.node && conn.to.port === targetPort) {
            return true;
          }
        }
      }
    } else if (macro.type === 'fanIn') {
      if (conn.from.scope || conn.to.scope) continue;
      // Check if connection matches the fan-in pattern
      if (conn.to.node === macro.target.node && conn.to.port === macro.target.port) {
        for (const source of macro.sources) {
          const sourcePort = source.port ?? macro.target.port;
          if (conn.from.node === source.node && conn.from.port === sourcePort) {
            return true;
          }
        }
      }
    } else if (macro.type === 'coerce') {
      if (conn.from.scope || conn.to.scope) continue;
      // Connections to/from the synthetic coercion instance are covered
      if (conn.to.node === macro.instanceId || conn.from.node === macro.instanceId) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Simply return ports as-is to preserve exact order from the AST
 * Don't compute or add any new metadata - only preserve what's already there
 * This ensures perfect round-trip fidelity
 * Exported for reuse in generate-in-place.ts to maintain DRY principle
 */
export function assignPortOrders(
  ports: [string, TPortDefinition][],
  _direction: 'input' | 'output'
): [string, TPortDefinition][] {
  return ports;
}

/**
 * Generate @node tag for a single instance
 * Exported for reuse in generate-in-place.ts to maintain DRY principle
 */
export function generateNodeInstanceTag(instance: TNodeInstanceAST): string {
  const parent = instance.parent ? ` ${instance.parent.id}.${instance.parent.scope}` : '';

  // Generate [label: ...] attribute if present and different from id
  let labelAttr = '';
  if (instance.config?.label && instance.config.label !== instance.id) {
    // Escape quotes in the label
    const escapedLabel = instance.config.label.replace(/"/g, '\\"');
    labelAttr = ` [label: "${escapedLabel}"]`;
  }

  // Generate [portOrder: ...] attribute if present
  let portOrderAttr = '';
  if (instance.config?.portConfigs && instance.config.portConfigs.length > 0) {
    const orderConfigs = instance.config.portConfigs
      .filter(pc => pc.order !== undefined)
      .map(pc => `${pc.portName}=${pc.order}`)
      .join(',');

    if (orderConfigs) {
      portOrderAttr = ` [portOrder: ${orderConfigs}]`;
    }
  }

  // Generate [portLabel: ...] attribute if present
  let portLabelAttr = '';
  if (instance.config?.portConfigs && instance.config.portConfigs.length > 0) {
    const labelConfigs = instance.config.portConfigs
      .filter(pc => pc.label !== undefined && pc.label !== '')
      .map(pc => {
        const escapedLabel = String(pc.label).replace(/"/g, '\\"');
        return `${pc.portName}="${escapedLabel}"`;
      })
      .join(', ');

    if (labelConfigs) {
      portLabelAttr = ` [portLabel: ${labelConfigs}]`;
    }
  }

  // Generate [expr: ...] attribute if any port has an expression
  let exprAttr = '';
  if (instance.config?.portConfigs && instance.config.portConfigs.length > 0) {
    const exprConfigs = instance.config.portConfigs
      .filter(pc => pc.expression !== undefined)
      .map(pc => {
        // Escape quotes and */ (which would close the JSDoc comment)
        const escapedExpr = String(pc.expression)
          .replace(/"/g, '\\"')
          .replace(/\*\//g, '*\\/');
        return `${pc.portName}="${escapedExpr}"`;
      })
      .join(', ');

    if (exprConfigs) {
      exprAttr = ` [expr: ${exprConfigs}]`;
    }
  }

  // Generate [pullExecution: ...] attribute if present
  let pullExecutionAttr = '';
  if (instance.config?.pullExecution) {
    pullExecutionAttr = ` [pullExecution: ${instance.config.pullExecution.triggerPort}]`;
  }

  // Generate [minimized] attribute if present
  const minimizedAttr = instance.config?.minimized ? ' [minimized]' : '';

  // Generate [color: "value"] attribute if present
  let colorAttr = '';
  if (instance.config?.color) {
    colorAttr = ` [color: "${instance.config.color}"]`;
  }

  // Generate [icon: "value"] attribute if present
  let iconAttr = '';
  if (instance.config?.icon) {
    iconAttr = ` [icon: "${instance.config.icon}"]`;
  }

  // Generate [tags: "label" "tooltip", "label2"] attribute if present
  let tagsAttr = '';
  if (instance.config?.tags?.length) {
    const tagEntries = instance.config.tags.map(t =>
      t.tooltip ? `"${t.label}" "${t.tooltip}"` : `"${t.label}"`
    ).join(', ');
    tagsAttr = ` [tags: ${tagEntries}]`;
  }

  // Generate [size: width height] attribute if present
  let sizeAttr = '';
  if (instance.config?.width !== undefined && instance.config?.height !== undefined) {
    sizeAttr = ` [size: ${Math.round(instance.config.width)} ${Math.round(instance.config.height)}]`;
  }

  // Generate [position: x y] attribute if present
  let positionAttr = '';
  if (instance.config?.x !== undefined && instance.config?.y !== undefined) {
    positionAttr = ` [position: ${Math.round(instance.config.x)} ${Math.round(instance.config.y)}]`;
  }

  return ` * @node ${instance.id} ${instance.nodeType}${parent}${labelAttr}${portOrderAttr}${portLabelAttr}${exprAttr}${pullExecutionAttr}${minimizedAttr}${colorAttr}${iconAttr}${tagsAttr}${sizeAttr}${positionAttr}`;
}

/**
 * Generate a TypeScript function signature from a node type definition.
 * Handles three modes: stub (declare function), expression (pure function), normal (execute/onSuccess/onFailure).
 */
export function generateFunctionSignature(nodeType: TNodeTypeAST): string[] {
  const lines: string[] = [];
  const isStub = nodeType.variant === 'STUB';
  const isExpression = isStub || nodeType.expression;

  if (isExpression) {
    const params: string[] = [];
    Object.entries(nodeType.inputs).forEach(([name, port]) => {
      if (isExecutePort(name)) return;
      const optional = port.optional ? "?" : "";
      params.push(`${name}${optional}: ${mapToTypeScript(port.dataType as TDataType)}`);
    });

    const returns: string[] = [];
    Object.entries(nodeType.outputs).forEach(([name, port]) => {
      if (isSuccessPort(name) || isFailurePort(name)) return;
      returns.push(`${name}: ${mapToTypeScript(port.dataType as TDataType)}`);
    });

    const returnType = returns.length === 1
      ? mapToTypeScript((Object.entries(nodeType.outputs).find(([n]) => !isSuccessPort(n) && !isFailurePort(n))?.[1].dataType || 'ANY') as TDataType)
      : `{ ${returns.join("; ")} }`;

    if (isStub) {
      lines.push(`declare function ${nodeType.functionName}(${params.join(", ")}): ${returnType};`);
    } else {
      lines.push(`function ${nodeType.functionName}(${params.join(", ")}): ${returnType} {`);
      lines.push(`  // TODO: implement`);
      lines.push(`  throw new Error('Not implemented');`);
      lines.push(`}`);
    }
  } else {
    const params: string[] = ["execute: boolean"];
    Object.entries(nodeType.inputs).forEach(([name, port]) => {
      if (isExecutePort(name)) return;
      const optional = port.optional ? "?" : "";
      const defaultVal = port.default !== undefined ? ` = ${JSON.stringify(port.default)}` : "";
      params.push(`${name}${optional}: ${mapToTypeScript(port.dataType as TDataType)}${defaultVal}`);
    });

    const returns: string[] = ["onSuccess: boolean", "onFailure: boolean"];
    Object.entries(nodeType.outputs).forEach(([name, port]) => {
      if (isSuccessPort(name) || isFailurePort(name)) return;
      returns.push(`${name}: ${mapToTypeScript(port.dataType as TDataType)}`);
    });

    lines.push(`function ${nodeType.functionName}(${params.join(", ")}) {`);
    lines.push(`  if (!execute) return { onSuccess: false, onFailure: false };`);
    lines.push(`  return { onSuccess: true, onFailure: false };`);
    lines.push(`}`);
  }
  return lines;
}

export const annotationGenerator = new AnnotationGenerator();
