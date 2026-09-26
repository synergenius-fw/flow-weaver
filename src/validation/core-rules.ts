/**
 * Core validation rules for WorkflowValidator.
 *
 * Each rule is a free function taking a ValidationContext (the mutable
 * errors/warnings arrays + mode flags) plus the workflow and any precomputed
 * maps. WorkflowValidator.validate() builds the context and invokes these in
 * a fixed order; the cascading-error filter there depends on that order.
 *
 * This module is the index of the rules. The short ones live here; the
 * larger ones have a module of their own under ./rules/ and are re-exported:
 *
 * - rules/connections.ts: known endpoints, duplicates, one value per input
 * - rules/type-compatibility.ts: data types and coercions across connections
 * - rules/data-flow.ts: unused outputs, Exit ports, @http route params
 * - rules/cycles.ts: loops within each scope layer
 * - rules/scope-topology.ts: the inner graph of nodes with scoped ports
 */

import type {
  TNodeTypeAST,
  TWorkflowAST,
} from '../ast/types';
import {
  RESERVED_NODE_NAMES,
  isStartNode,
  isExitNode,
  isExecutePort,
  isReservedNodeName,
  VALID_NODE_COLORS,
  EXECUTION_STRATEGIES,
} from '../constants';
import * as ts from 'typescript';
import { findClosestMatches } from '../utils/string-distance.js';
import { parseFunctionSignature } from '../jsdoc-port-sync/signature-parser.js';
import { isValidPortType } from '../types/type-mappings.js';
import { VALID_NODE_ICONS } from '../diagram/theme.js';
import { MATERIAL_SYMBOLS, isMaterialSymbol } from '../diagram/material-symbols.js';
import {
  getInstanceLocation as getInstanceLocationHelper,
  normalizeTypeString as normalizeTypeStringHelper,
} from './validator-helpers.js';
import type { ValidationContext } from './rules/context.js';

export type { ValidationContext } from './rules/context.js';
export {
  validateConnections,
  validateDuplicateConnections,
  validateMultipleInputConnections,
} from './rules/connections.js';
export { validateTypeCompatibility } from './rules/type-compatibility.js';
export { validateDataFlow } from './rules/data-flow.js';
export { validateCycles } from './rules/cycles.js';
export { validateScopeTopology } from './rules/scope-topology.js';

export function validateStructure(ctx: ValidationContext, workflow: TWorkflowAST): void {
  if (!workflow.name) {
    ctx.errors.push({
      type: 'error',
      code: 'MISSING_WORKFLOW_NAME',
      message: 'Workflow must have a name',
    });
  }
  if (!workflow.functionName) {
    ctx.errors.push({
      type: 'error',
      code: 'MISSING_FUNCTION_NAME',
      message: 'Workflow must have a functionName',
    });
  }
}

export function validateDuplicateNodeNames(ctx: ValidationContext, workflow: TWorkflowAST): void {
  const nodeNames = new Set<string>();
  workflow.nodeTypes.forEach((nodeType) => {
    if (nodeNames.has(nodeType.functionName)) {
      ctx.errors.push({
        type: 'error',
        code: 'DUPLICATE_NODE_NAME',
        message: `Duplicate node type name: "${nodeType.functionName}"`,
        node: nodeType.functionName,
        location: nodeType.sourceLocation,
      });
    }
    nodeNames.add(nodeType.functionName);
  });
}

export function validateMutableBindings(ctx: ValidationContext, workflow: TWorkflowAST): void {
  workflow.nodeTypes.forEach((nodeType) => {
    if (nodeType.declarationKind && nodeType.declarationKind !== 'const') {
      ctx.warnings.push({
        type: 'warning',
        code: 'MUTABLE_NODE_TYPE_BINDING',
        message: `Node type "${nodeType.functionName}" is declared with "${nodeType.declarationKind}" instead of "const". Use "const" to prevent accidental reassignment.`,
        node: nodeType.functionName,
        location: nodeType.sourceLocation,
      });
    }
  });
}

export function validateReservedNames(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  nodeTypeMap: Map<string, TNodeTypeAST>
): void {
  // Check for node types with reserved names (Start, Exit)
  // Note: Port name validation is done during parsing
  nodeTypeMap.forEach((nodeType, nodeName) => {
    if (isReservedNodeName(nodeName)) {
      ctx.errors.push({
        type: 'error',
        code: 'RESERVED_NODE_NAME',
        message: `Node type name "${nodeName}" is reserved. Reserved node names: ${Object.values(RESERVED_NODE_NAMES).join(', ')}`,
        node: nodeName,
        location: nodeType.sourceLocation,
      });
    }
  });

  // Check for instances with reserved IDs
  workflow.instances.forEach((instance) => {
    if (isReservedNodeName(instance.id)) {
      ctx.errors.push({
        type: 'error',
        code: 'RESERVED_INSTANCE_ID',
        message: `Instance ID "${instance.id}" is reserved. Reserved names: ${Object.values(RESERVED_NODE_NAMES).join(', ')}`,
        node: instance.id,
        location: instance.sourceLocation,
      });
    }
  });
}

/**
 * Scope names become identifiers in generated code (`l_<scope>_scopeFn`), so
 * a `scope:my-scope` port would compile into a syntax error.
 */
export function validateScopeNames(ctx: ValidationContext, workflow: TWorkflowAST): void {
  const identifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
  for (const nodeType of workflow.nodeTypes) {
    const ports = [...Object.entries(nodeType.inputs), ...Object.entries(nodeType.outputs)];
    for (const [portName, portDef] of ports) {
      if (portDef.scope === undefined || identifier.test(portDef.scope)) continue;
      ctx.errors.push({
        type: 'error',
        code: 'INVALID_SCOPE_NAME',
        message: `Port "${portName}" on node type "${nodeType.functionName}" has invalid scope name "${portDef.scope}". Scope names must be valid JavaScript identifiers (letters, numbers, underscore, dollar sign, and cannot start with a number).`,
        node: nodeType.functionName,
        location: nodeType.sourceLocation,
      });
    }
  }
}

export function validateRequiredInputs(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  instanceMap: Map<string, TNodeTypeAST>
): void {
  instanceMap.forEach((nodeType, instanceId) => {
    // Find the instance to check for port-level constant expressions
    const instance = workflow.instances.find((inst) => inst.id === instanceId);

    // A scoped child's inputs are checked by validateScopeTopology
    // (SCOPE_MISSING_REQUIRED_INPUT), which knows the scope it lives in.
    if (instance?.parent) return;

    Object.entries(nodeType.inputs).forEach(([portName, portConfig]) => {
      if (isExecutePort(portName)) return;
      // Skip scoped INPUT ports - they're provided by scope function execution, not external connections
      if (portConfig.scope) return;

      // Check if instance has an expression for this port
      const instancePortConfig = instance?.config?.portConfigs?.find(
        (pc) => pc.portName === portName && (pc.direction == null || pc.direction === 'INPUT')
      );
      const hasInstanceExpression = instancePortConfig?.expression !== undefined;

      const isRequired =
        !portConfig.optional &&
        portConfig.default === undefined &&
        !portConfig.expression &&
        !hasInstanceExpression;

      if (isRequired) {
        const isConnected = workflow.connections.some((conn) => {
          return conn.to.node === instanceId && conn.to.port === portName;
        });
        if (!isConnected) {
          ctx.errors.push({
            type: 'error',
            code: 'MISSING_REQUIRED_INPUT',
            message: `Node "${instanceId}" has unconnected required input port "${portName}". Connect a value to it, or mark it optional with @input [${portName}].`,
            node: instanceId,
            location: instance?.sourceLocation,
          });
        }
      }
    });
  });
}
export function detectUnusedNodes(ctx: ValidationContext, workflow: TWorkflowAST, instanceMap: Map<string, TNodeTypeAST>): void {
  const usedNodes = new Set<string>();
  workflow.connections.forEach((conn) => {
    const fromNode = conn.from.node;
    const toNode = conn.to.node;
    if (!isStartNode(fromNode) && !isExitNode(fromNode)) {
      usedNodes.add(fromNode);
    }
    if (!isStartNode(toNode) && !isExitNode(toNode)) {
      usedNodes.add(toNode);
    }
  });
  instanceMap.forEach((_nodeType, instanceId) => {
    if (!usedNodes.has(instanceId)) {
      ctx.warnings.push({
        type: 'warning',
        code: 'UNUSED_NODE',
        message: `Node "${instanceId}" is defined but never used in workflow`,
        node: instanceId,
        location: getInstanceLocationHelper(workflow, instanceId),
      });
    }
  });
}
export function validateStartAndExit(ctx: ValidationContext, workflow: TWorkflowAST): void {
  const hasStartConnections = workflow.connections.some((conn) => {
    return isStartNode(conn.from.node);
  });
  if (!hasStartConnections) {
    ctx.warnings.push({
      type: 'warning',
      code: 'NO_START_CONNECTIONS',
      message: 'Workflow has no connections from Start node',
    });
  }
  const hasExitConnections = workflow.connections.some((conn) => {
    return isExitNode(conn.to.node);
  });
  if (!hasExitConnections) {
    ctx.warnings.push({
      type: 'warning',
      code: 'NO_EXIT_CONNECTIONS',
      message: 'Workflow has no connections to Exit node (no return value)',
    });
  }

  // Validate that onSuccess and onFailure exit ports are STEP type
  if (workflow.exitPorts.onSuccess) {
    if (workflow.exitPorts.onSuccess.dataType !== 'STEP') {
      ctx.errors.push({
        type: 'error',
        code: 'INVALID_EXIT_PORT_TYPE',
        message:
          "Exit port 'onSuccess' must be of type STEP (control flow), found: " +
          workflow.exitPorts.onSuccess.dataType,
      });
    }
  }
  if (workflow.exitPorts.onFailure) {
    if (workflow.exitPorts.onFailure.dataType !== 'STEP') {
      ctx.errors.push({
        type: 'error',
        code: 'INVALID_EXIT_PORT_TYPE',
        message:
          "Exit port 'onFailure' must be of type STEP (control flow), found: " +
          workflow.exitPorts.onFailure.dataType,
      });
    }
  }
}

/**
 * Cross-check @input annotations against TypeScript function signatures.
 * Warns on optionality and type mismatches between annotations and actual code.
 */
export function validateAnnotationSignatureConsistency(ctx: ValidationContext, workflow: TWorkflowAST): void {
  for (const nodeType of workflow.nodeTypes) {
    if (!nodeType.functionText) continue;

    let sigParams: ReturnType<typeof parseFunctionSignature>['params'];
    try {
      const sig = parseFunctionSignature(nodeType.functionText);
      sigParams = sig.params;
    } catch {
      continue; // Can't parse signature, skip
    }

    // Skip the first param (execute: boolean) - it's a control flow param
    const sigParamMap = new Map<string, (typeof sigParams)[0]>();
    for (const p of sigParams.slice(1)) {
      sigParamMap.set(p.name, p);
    }

    for (const [portName, portDef] of Object.entries(nodeType.inputs)) {
      if (portName === 'execute') continue; // Skip control flow port

      const sigParam = sigParamMap.get(portName);
      if (!sigParam) continue; // Port not in signature (may be added by framework)

      // Check optionality mismatch: annotation says required but sig says optional
      if (!portDef.optional && sigParam.optional) {
        ctx.warnings.push({
          type: 'warning',
          code: 'ANNOTATION_SIGNATURE_MISMATCH',
          message: `Port "${portName}" in node type "${nodeType.functionName}" is optional in signature but required in annotation. Consider using @input [${portName}] to mark it optional.`,
          node: nodeType.functionName,
          location: nodeType.sourceLocation,
        });
      }

      // Check type mismatch: annotation specifies a type that differs from signature
      if (portDef.tsType && sigParam.tsType) {
        const annotationType = normalizeTypeStringHelper(portDef.tsType);
        const signatureType = normalizeTypeStringHelper(sigParam.tsType);

        // Skip if no real type info (untyped JS)
        if (!signatureType || signatureType === 'any') continue;

        if (annotationType !== signatureType) {
          ctx.warnings.push({
            type: 'warning',
            code: 'ANNOTATION_SIGNATURE_TYPE_MISMATCH',
            message: `Port "${portName}" in node type "${nodeType.functionName}" has type "${portDef.tsType}" in annotation but "${sigParam.tsType}" in function signature.`,
            node: nodeType.functionName,
            location: nodeType.sourceLocation,
          });
        }
      }
    }
  }
}

// ── H: Duplicate instance IDs ──────────────────────────────────────────

export function validateDuplicateInstanceIds(ctx: ValidationContext, workflow: TWorkflowAST): void {
  const seen = new Set<string>();
  for (const instance of workflow.instances) {
    if (seen.has(instance.id)) {
      ctx.errors.push({
        type: 'error',
        code: 'DUPLICATE_INSTANCE_ID',
        message: `Duplicate instance ID "${instance.id}" in workflow. Each @node must have a unique ID.`,
        node: instance.id,
        location: instance.sourceLocation,
      });
    }
    seen.add(instance.id);
  }
}

// ── J+K: Visual annotation validation ────────────────────────────────

export function validateVisualAnnotations(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  _instanceMap: Map<string, TNodeTypeAST>
): void {
  const validColors = VALID_NODE_COLORS as readonly string[];
  // An icon is any Material Symbol, in the font's snake_case or in camelCase:
  // that is what the console draws with. The SVG renderer's own path table
  // (`VALID_NODE_ICONS`) is a subset; an icon outside it is still valid and
  // is drawn as a dot in the SVG. Suggestions come from both.
  const validIcons = { includes: (icon: string) => isMaterialSymbol(icon) || VALID_NODE_ICONS.includes(icon) };
  const iconNames = [...VALID_NODE_ICONS, ...MATERIAL_SYMBOLS];

  // Check node type colors and icons (stored in visuals)
  for (const nodeType of workflow.nodeTypes) {
    const color = nodeType.visuals?.color;
    const icon = nodeType.visuals?.icon;
    if (color && !validColors.includes(color)) {
      const suggestions = findClosestMatches(color, [...validColors]);
      const hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
      ctx.warnings.push({
        type: 'warning',
        code: 'INVALID_COLOR',
        message: `Node type "${nodeType.functionName}" has invalid color "${color}".${hint} Valid colors: ${validColors.join(', ')}.`,
        node: nodeType.functionName,
        location: nodeType.sourceLocation,
      });
    }
    if (icon && !validIcons.includes(icon)) {
      const suggestions = findClosestMatches(icon, iconNames);
      const hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
      ctx.warnings.push({
        type: 'warning',
        code: 'INVALID_ICON',
        message: `Node type "${nodeType.functionName}" has invalid icon "${icon}".${hint} Icons are Material Symbols names, as flag or swap_horiz (swapHoriz works too).`,
        node: nodeType.functionName,
        location: nodeType.sourceLocation,
      });
    }
  }

  // Check instance-level color and icon overrides
  for (const instance of workflow.instances) {
    if (instance.config?.color && !validColors.includes(instance.config.color)) {
      const suggestions = findClosestMatches(instance.config.color, [...validColors]);
      const hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
      ctx.warnings.push({
        type: 'warning',
        code: 'INVALID_COLOR',
        message: `Instance "${instance.id}" has invalid color "${instance.config.color}".${hint} Valid colors: ${validColors.join(', ')}.`,
        node: instance.id,
        location: instance.sourceLocation,
      });
    }
    if (instance.config?.icon && !validIcons.includes(instance.config.icon)) {
      const suggestions = findClosestMatches(instance.config.icon, iconNames);
      const hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
      ctx.warnings.push({
        type: 'warning',
        code: 'INVALID_ICON',
        message: `Instance "${instance.id}" has invalid icon "${instance.config.icon}".${hint} Icons are Material Symbols names, as flag or swap_horiz (swapHoriz works too).`,
        node: instance.id,
        location: instance.sourceLocation,
      });
    }
  }
}

// ── L: Port type validation ──────────────────────────────────────────

export function validatePortTypes(ctx: ValidationContext, workflow: TWorkflowAST): void {
  for (const nodeType of workflow.nodeTypes) {
    for (const [portName, portDef] of Object.entries(nodeType.inputs)) {
      if (!isValidPortType(portDef.dataType)) {
        ctx.warnings.push({
          type: 'warning',
          code: 'INVALID_PORT_TYPE',
          message: `Port "${portName}" on node type "${nodeType.functionName}" has invalid type "${portDef.dataType}".`,
          node: nodeType.functionName,
          location: nodeType.sourceLocation,
        });
      }
    }
    for (const [portName, portDef] of Object.entries(nodeType.outputs)) {
      if (!isValidPortType(portDef.dataType)) {
        ctx.warnings.push({
          type: 'warning',
          code: 'INVALID_PORT_TYPE',
          message: `Port "${portName}" on node type "${nodeType.functionName}" has invalid type "${portDef.dataType}".`,
          node: nodeType.functionName,
          location: nodeType.sourceLocation,
        });
      }
    }
  }
}

// ── M: portOrder/portLabel reference validation ──────────────────────

export function validatePortConfigReferences(
  ctx: ValidationContext,
  workflow: TWorkflowAST,
  instanceMap: Map<string, TNodeTypeAST>
): void {
  for (const instance of workflow.instances) {
    const portConfigs = instance.config?.portConfigs;
    if (!portConfigs) continue;

    const nodeType = instanceMap.get(instance.id);
    if (!nodeType) continue;

    const allPorts = new Set([
      ...Object.keys(nodeType.inputs),
      ...Object.keys(nodeType.outputs),
    ]);

    for (const pc of portConfigs) {
      if (!allPorts.has(pc.portName)) {
        const suggestions = findClosestMatches(pc.portName, [...allPorts]);
        const hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
        ctx.warnings.push({
          type: 'warning',
          code: 'INVALID_PORT_CONFIG_REF',
          message: `Instance "${instance.id}" references port "${pc.portName}" in portConfig, but this port does not exist on node type "${instance.nodeType}".${hint}`,
          node: instance.id,
          location: instance.sourceLocation,
        });
      }
    }
  }
}

// ── M2: expression syntax ────────────────────────────────────────────

/**
 * Why an expression will not parse as JavaScript, or null when it does.
 *
 * An `[expr:]` binding is JavaScript that the generator pastes into the body
 * verbatim. One that does not parse -- `timeout="24h"` where the author meant
 * the string `'24h'` -- used to survive parse, validate and compile, and only
 * failed when the generated file was transpiled, on a line the author never
 * wrote. Checking it here puts the error on the annotation, with the fix.
 */
function expressionSyntaxProblem(expression: string): string | null {
  const text = expression.trim();
  if (text.length === 0) return null;
  const { diagnostics } = ts.transpileModule(`(${text});`, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext },
  });
  if (!diagnostics || diagnostics.length === 0) return null;
  const reason = ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ');
  // A bare word or a value-with-unit is almost always meant as text: say so,
  // with the exact attribute to write.
  const looksLikeText = /^[A-Za-z0-9][\w\s.,:%/-]*$/.test(text) && !/^[A-Za-z_$][\w$]*(\.[\w$]+)*$/.test(text);
  const hint = looksLikeText
    ? ` If you meant the text ${JSON.stringify(text)}, quote it inside the attribute: ="'${text}'".`
    : '';
  return `${reason}.${hint}`;
}

export function validateExpressionSyntax(ctx: ValidationContext, workflow: TWorkflowAST): void {
  for (const instance of workflow.instances) {
    for (const pc of instance.config?.portConfigs ?? []) {
      if (pc.expression === undefined) continue;
      const problem = expressionSyntaxProblem(pc.expression);
      if (!problem) continue;
      ctx.errors.push({
        type: 'error',
        code: 'EXPRESSION_SYNTAX',
        message: `The [expr:] binding for "${pc.portName}" on "${instance.id}" is not a JavaScript expression: ${pc.expression}. ${problem}`,
        node: instance.id,
        location: instance.sourceLocation,
      });
    }
  }
  for (const nodeType of workflow.nodeTypes) {
    for (const [portName, port] of Object.entries(nodeType.inputs)) {
      if (port.expression === undefined) continue;
      const problem = expressionSyntaxProblem(port.expression);
      if (!problem) continue;
      ctx.errors.push({
        type: 'error',
        code: 'EXPRESSION_SYNTAX',
        message: `The Expression: default of input "${portName}" on node type "${nodeType.functionName}" is not a JavaScript expression: ${port.expression}. ${problem}`,
        location: nodeType.sourceLocation,
      });
    }
  }
}

// ── N: @executeWhen value validation ─────────────────────────────────

export function validateExecuteWhen(ctx: ValidationContext, workflow: TWorkflowAST): void {
  const validStrategies = Object.values(EXECUTION_STRATEGIES) as string[];
  for (const nodeType of workflow.nodeTypes) {
    if (nodeType.executeWhen && !validStrategies.includes(nodeType.executeWhen)) {
      const suggestions = findClosestMatches(nodeType.executeWhen, validStrategies);
      const hint = suggestions.length > 0 ? ` Did you mean "${suggestions[0]}"?` : '';
      ctx.warnings.push({
        type: 'warning',
        code: 'INVALID_EXECUTE_WHEN',
        message: `Node type "${nodeType.functionName}" has invalid @executeWhen value "${nodeType.executeWhen}".${hint} Valid values: ${validStrategies.join(', ')}.`,
        node: nodeType.functionName,
        location: nodeType.sourceLocation,
      });
    }
  }
}
