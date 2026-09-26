/**
 * How a workflow block's graph tags are read.
 *
 * `@fwImport` (npm node types), `@node` (instances, with their port order,
 * labels and expressions folded into port configs and the tag's line kept as
 * the source location), `@connect`, `@scope`, and the sugar tags `@map`,
 * `@path`, `@fanOut`, `@fanIn` and `@coerce`, which are recorded here and
 * expanded later. Node positions are no longer part of the grammar: a leftover
 * `@position` line or `[position: x y]` attribute is dropped with a warning.
 * A line the grammar rejects is a warning and is skipped.
 */
import type { JSDocTag } from 'ts-morph';
import type { TPortConfig } from '../../ast/types';
import {
  parseNodeLine,
  parseConnectLine,
  parseScopeLine,
  parseMapLine,
  parsePathLine,
  parseFanOutLine,
  parseFanInLine,
  parseCoerceLine,
} from '../../chevrotain-parser';
import type { JSDocWorkflowConfig } from './config-types';
import { parseLineOnce } from './parse-line-once';

/**
 * `position: x y` as it was written on @node lines: a bracket of its own,
 * or first, last or between other attributes in a shared bracket.
 */
const POSITION_ATTR = /\s*\[position:\s*-?\d+\s+-?\d+\]|,\s*position:\s*-?\d+\s+-?\d+(?=\s*[,\]])|(?<=\[)\s*position:\s*-?\d+\s+-?\d+\s*,\s*/g;
export const positionGone = (where: string): string =>
  `${where}: node positions are no longer part of the grammar and this was ignored. Remove it, or run \`fw compile\` / \`fw migrate\` to rewrite the block without it.`;

/**
 * Parse @fwImport tag for npm package node types.
 * Format: @fwImport nodeName functionName from "packageName"
 * Examples:
 *   @fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"
 *   @fwImport npm/lodash/map map from "lodash"
 * Note: We use @fwImport instead of @import because TypeScript treats @import specially
 * and truncates the first word as a type annotation.
 */
export function parseImportTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  const comment = tag.getCommentText()?.trim() || '';

  // Parse format: nodeName functionName from "packageName"
  const match = comment.match(/^(\S+)\s+(\S+)\s+from\s+["']([^"']+)["']$/);

  if (match) {
    const [, name, functionName, importSource] = match;
    config.imports!.push({ name, functionName, importSource });
  } else {
    warnings.push(
      `Invalid @fwImport tag format: "${comment}". Expected: @fwImport nodeName functionName from "packageName"`
    );
  }
}

/**
 * Parse @node tag using Chevrotain parser.
 * Supports: @node instanceId nodeType [parentScope] [label: "..."] [portOrder: port=N] [portLabel: port="label"] [expr: port="val"] [minimized] [pullExecution: triggerPort]
 */
export function parseNodeTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  let comment = tag.getCommentText() || '';

  // Positions left the grammar. A file that still carries `[position: x y]`
  // parses as if it were not there, and says so once per line.
  if (POSITION_ATTR.test(comment)) {
    POSITION_ATTR.lastIndex = 0;
    comment = comment.replace(POSITION_ATTR, '');
    warnings.push(positionGone(`@node ${comment.trim().split(/\s+/)[0]} [position:]`));
  }
  POSITION_ATTR.lastIndex = 0;

  // Use Chevrotain to parse the node line
  const result = parseNodeLine(`@node ${comment}`, warnings);
  if (!result) {
    return;
  }

  const {
    instanceId,
    nodeType,
    parentScope,
    label,
    expressions,
    portOrder,
    portLabel,
    minimized,
    pullExecution,
    size,
    color,
    icon,
    tags,
    attributes,
    suppress,
  } = result;

  // Capture source location from tag
  const line = tag.getStartLineNumber();

  // Build portConfigs from portOrder, portLabel, and expressions
  let portConfigs: TPortConfig[] | undefined;

  if (portOrder) {
    portConfigs = Object.entries(portOrder).map(([portName, order]) => ({
      portName,
      order,
    }));
  }

  if (portLabel) {
    portConfigs = portConfigs || [];
    for (const [portName, labelVal] of Object.entries(portLabel)) {
      const existingIndex = portConfigs.findIndex((pc) => pc.portName === portName);
      if (existingIndex >= 0) {
        portConfigs[existingIndex] = { ...portConfigs[existingIndex], label: labelVal };
      } else {
        portConfigs.push({ portName, label: labelVal });
      }
    }
  }

  if (expressions) {
    portConfigs = portConfigs || [];
    for (const [portName, expression] of Object.entries(expressions)) {
      const existingIndex = portConfigs.findIndex((pc) => pc.portName === portName);
      if (existingIndex >= 0) {
        portConfigs[existingIndex] = { ...portConfigs[existingIndex], expression };
      } else {
        portConfigs.push({ portName, expression });
      }
    }
  }

  config.instances!.push({
    id: instanceId,
    type: nodeType,
    ...(parentScope && { parentScope }),
    ...(label && { label }),
    ...(portConfigs && portConfigs.length > 0 && { portConfigs }),
    ...(pullExecution && { pullExecution: { triggerPort: pullExecution } }),
    ...(minimized && { minimized }),
    ...(color && { color }),
    ...(icon && { icon }),
    ...(tags && tags.length > 0 && { tags }),
    ...(size && { width: size.width, height: size.height }),
    ...(attributes && Object.keys(attributes).length > 0 && { attributes }),
    ...(suppress && suppress.length > 0 && { suppressWarnings: suppress }),
    sourceLocation: { line, column: 0 },
  });
}

/**
 * Parse @connect tag using Chevrotain parser.
 * Supports: node.port -> node.port and node.port:scope -> node.port:scope
 */
export function parseConnectTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  const comment = tag.getCommentText() || '';

  // Use Chevrotain to parse the connect line
  const result = parseLineOnce(parseConnectLine, `@connect ${comment}`, warnings, `Invalid @connect tag format: @connect ${comment}`);
  if (!result) {
    return;
  }

  const { source, target, coerce } = result;

  // Capture source location from tag
  const line = tag.getStartLineNumber();

  config.connections!.push({
    from: {
      node: source.nodeId,
      port: source.portName,
      ...(source.scope && { scope: source.scope }),
    },
    to: {
      node: target.nodeId,
      port: target.portName,
      ...(target.scope && { scope: target.scope }),
    },
    sourceLocation: { line, column: 0 },
    ...(coerce && { coerce }),
  });
}

/**
 * Parse @scope tag using Chevrotain parser.
 * Format: @scope scopeName [child1, child2] or @scope container.scopeName [child1, child2]
 */
export function parseScopeTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  const comment = tag.getCommentText() || '';

  const result = parseLineOnce(parseScopeLine, `@scope ${comment}`, warnings, `Invalid @scope tag format: ${comment}`);
  if (!result) {
    return;
  }

  config.scopes![result.scopeName] = result.children;
}

/**
 * Parse @map tag using Chevrotain parser.
 * Format: @map instanceId childNode over source.port
 * Or:     @map instanceId childNode(inputPort -> outputPort) over source.port
 */
export function parseMapTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  const comment = tag.getCommentText() || '';

  const result = parseLineOnce(parseMapLine, `@map ${comment}`, warnings, `Invalid @map tag format: ${comment}`);
  if (!result) {
    return;
  }

  config.maps = config.maps || [];
  config.maps.push({
    instanceId: result.instanceId,
    childId: result.childId,
    sourceNode: result.sourceNode,
    sourcePort: result.sourcePort,
    ...(result.inputPort && { inputPort: result.inputPort }),
    ...(result.outputPort && { outputPort: result.outputPort }),
  });
}

/**
 * Parse @path tag using Chevrotain parser.
 * Format: @path Start -> validator:ok -> classifier -> urgencyRouter:fail -> escalate -> Exit
 */
export function parsePathTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  const comment = tag.getCommentText() || '';

  const results = parseLineOnce(parsePathLine, `@path ${comment}`, warnings, `Invalid @path tag format: ${comment}`);
  if (!results) {
    return;
  }

  config.paths = config.paths || [];
  for (const result of results) {
    config.paths.push({
      steps: result.steps,
    });
  }
}

export function parseFanOutTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  const comment = tag.getCommentText() || '';
  const result = parseLineOnce(parseFanOutLine, `@fanOut ${comment}`, warnings, `Invalid @fanOut tag format: ${comment}`);
  if (!result) {
    return;
  }
  if (!result.source.port) {
    warnings.push(`@fanOut source must specify a port: ${comment}`);
    return;
  }
  config.fanOuts = config.fanOuts || [];
  config.fanOuts.push({
    source: { node: result.source.node, port: result.source.port },
    targets: result.targets,
  });
}

export function parseFanInTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  const comment = tag.getCommentText() || '';
  const result = parseLineOnce(parseFanInLine, `@fanIn ${comment}`, warnings, `Invalid @fanIn tag format: ${comment}`);
  if (!result) {
    return;
  }
  if (!result.target.port) {
    warnings.push(`@fanIn target must specify a port: ${comment}`);
    return;
  }
  config.fanIns = config.fanIns || [];
  config.fanIns.push({
    sources: result.sources,
    target: { node: result.target.node, port: result.target.port },
  });
}

export function parseCoerceTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  const comment = tag.getCommentText() || '';
  const result = parseLineOnce(parseCoerceLine, `@coerce ${comment}`, warnings, `Invalid @coerce tag format: ${comment}`);
  if (!result) {
    return;
  }
  config.coercions = config.coercions || [];
  config.coercions.push({
    instanceId: result.instanceId,
    source: result.source,
    target: result.target,
    targetType: result.targetType,
  });
}
