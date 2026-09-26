/**
 * Node type JSDoc text.
 *
 * Decides the `@flowWeaver nodeType` comment written above a node type
 * function: which tags a node type's AST turns into, in which order, and
 * which ports are left out because a re-parse infers them anyway.
 */

import type { TDataType, TNodeTypeAST, TPortDefinition } from '../../ast/types';
import { isExecutePort, isFailurePort, isSuccessPort } from '../../constants';
import {
  assignPortOrders,
  formatJSDocDescription,
  generateJSDocPortTag,
  planPortTags,
} from '../../generator/annotation-generator';

/**
 * Generate JSDoc comment for node type function
 */
export function generateNodeTypeJSDoc(nodeType: TNodeTypeAST): string {
  const lines: string[] = [];

  lines.push('/**');

  // Add description
  if (nodeType.description) {
    lines.push(...formatJSDocDescription(nodeType.description));
    lines.push(` *`);
  }

  // @flowWeaver marker
  lines.push(' * @flowWeaver nodeType');

  // Add @expression tag for expression nodes
  if (nodeType.expression) {
    lines.push(' * @expression');
  }

  // Add @name tag when name differs from functionName (preserves stable identity across renames)
  if (nodeType.name && nodeType.name !== nodeType.functionName) {
    lines.push(` * @name ${nodeType.name}`);
  }

  // Add label if present
  if (nodeType.label) {
    lines.push(` * @label ${nodeType.label}`);
  }

  // Add scope if present
  if (nodeType.scope) {
    lines.push(` * @scope ${nodeType.scope}`);
  }

  // Add pullExecution if present
  if (nodeType.defaultConfig?.pullExecution) {
    lines.push(` * @pullExecution ${nodeType.defaultConfig.pullExecution.triggerPort}`);
  }

  if (nodeType.resilience) {
    const retries = nodeType.resilience.retries
      ? ` retries=${nodeType.resilience.retries}`
      : '';
    const fallback = nodeType.resilience.fallback
      ? ` fallback="${nodeType.resilience.fallback.replace(/"/g, '\\"')}"`
      : '';
    lines.push(` * @resilience${retries}${fallback}`);
  }

  // Durable classification round-trips like any other authored tag.
  lines.push(...durableClassificationLines(nodeType));

  // Add visual annotations
  if (nodeType.visuals) {
    if (nodeType.visuals.color) {
      lines.push(` * @color ${nodeType.visuals.color}`);
    }
    if (nodeType.visuals.icon) {
      lines.push(` * @icon ${nodeType.visuals.icon}`);
    }
    if (nodeType.visuals.tags && nodeType.visuals.tags.length > 0) {
      for (const tag of nodeType.visuals.tags) {
        if (tag.tooltip) {
          lines.push(` * @tag ${tag.label} "${tag.tooltip}"`);
        } else {
          lines.push(` * @tag ${tag.label}`);
        }
      }
    }
  }

  // Handle both formats: inputs/outputs dictionaries OR ports array
  let inputEntries: [string, TPortDefinition][] = [];
  let outputEntries: [string, TPortDefinition][] = [];

  if (nodeType.inputs && Object.keys(nodeType.inputs).length > 0) {
    // Use native inputs/outputs format. Mandatory control-flow ports at their
    // defaults and implicit orders are left to planPortTags below: the parser
    // adds them back on re-parse, so writing them only lengthens the file.
    inputEntries = assignPortOrders(Object.entries(nodeType.inputs), 'input');
    outputEntries = assignPortOrders(Object.entries(nodeType.outputs || {}), 'output');
  } else if (nodeType.ports && nodeType.ports.length > 0) {
    // Convert from ports array format (UI format)
    const inputs: [string, TPortDefinition][] = [];
    const outputs: [string, TPortDefinition][] = [];

    for (const port of nodeType.ports) {
      // Skip mandatory control flow ports - they're implicit
      if (isExecutePort(port.name) || isSuccessPort(port.name) || isFailurePort(port.name)) {
        continue;
      }

      const portDef: TPortDefinition = {
        dataType: (port.type || port.dataType || 'ANY') as TDataType,
        label: port.defaultLabel || port.name,
        scope: port.scope,
        metadata: { order: port.defaultOrder },
      };

      if (port.direction === 'INPUT') {
        inputs.push([port.name, portDef]);
      } else {
        outputs.push([port.name, portDef]);
      }
    }

    inputEntries = assignPortOrders(inputs, 'input');
    outputEntries = assignPortOrders(outputs, 'output');
  }

  // Add input ports: only what a re-parse would not infer on its own
  for (const { name, port, writeOrder } of planPortTags(inputEntries)) {
    lines.push(` * ${generateJSDocPortTag(name, port, 'input', undefined, { writeOrder })}`);
  }

  // Add output ports
  for (const { name, port, writeOrder } of planPortTags(outputEntries)) {
    lines.push(` * ${generateJSDocPortTag(name, port, 'output', undefined, { writeOrder })}`);
  }

  lines.push(' */');

  return lines.join('\n');
}

/**
 * JSDoc lines for a node type's durable classification (`@durableGate <kind>`,
 * `@durableEffect`, `@durablePure`). Each flag is emitted independently so the
 * authored state round-trips exactly; a doubled classification is a validation
 * error, not something the generator silently repairs.
 */
export function durableClassificationLines(
  nodeType: Pick<TNodeTypeAST, 'durableGate' | 'durableEffect' | 'durablePure'>
): string[] {
  const lines: string[] = [];
  if (nodeType.durableGate) {
    lines.push(` * @durableGate ${nodeType.durableGate}`);
  }
  if (nodeType.durableEffect) {
    lines.push(' * @durableEffect');
  }
  if (nodeType.durablePure) {
    lines.push(' * @durablePure');
  }
  return lines;
}
