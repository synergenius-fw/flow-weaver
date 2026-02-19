/**
 * @module jsdoc-port-sync/port-parser
 *
 * Parse and update @input/@output/@step annotations in JSDoc.
 * Uses Chevrotain for parsing, browser-compatible.
 */

import type { TPortDefinition, TDataType, TSerializableValue } from '../ast/types';
import { generateJSDocPortTag } from '../annotation-generator';
import { isExecutePort, isSuccessPort, isFailurePort, isScopedMandatoryPort } from '../constants';
import { inferDataTypeFromTS } from '../type-mappings';
import {
  parsePortLine,
  parsePortsFromJSDoc,
  isValidPortLine as chevrotainIsValidPortLine,
} from '../chevrotain-parser/port-parser';
import { JSDOC_BLOCK_REGEX, PORT_TAG_REGEX, ORPHAN_PORT_LINE_REGEX } from './constants';
import { parseFunctionSignature, parseReturnTypeFieldsWithTypes } from './signature-parser';

// =============================================================================
// Scope Detection
// =============================================================================

/** Match @scope tags: @scope name */
const SCOPE_TAG_REGEX = /\*\s*@scope\s+(\w+)/g;

/**
 * Check if the code has any @scope declarations in JSDoc.
 * Used to automatically determine if the node should be in scoped mode.
 *
 * @param functionText - The function text containing JSDoc
 * @returns true if the code has @scope declarations, false otherwise
 */
export function hasScopes(functionText: string): boolean {
  const jsdocMatch = functionText.match(JSDOC_BLOCK_REGEX);
  if (!jsdocMatch) return false;

  SCOPE_TAG_REGEX.lastIndex = 0;
  return SCOPE_TAG_REGEX.test(jsdocMatch[0]);
}

/**
 * Get all scope names declared in the code via @scope tags.
 *
 * @param functionText - The function text containing JSDoc
 * @returns Array of scope names
 */
export function getScopeNames(functionText: string): string[] {
  const jsdocMatch = functionText.match(JSDOC_BLOCK_REGEX);
  if (!jsdocMatch) return [];

  const scopes: string[] = [];
  SCOPE_TAG_REGEX.lastIndex = 0;
  let match;
  while ((match = SCOPE_TAG_REGEX.exec(jsdocMatch[0])) != null) {
    scopes.push(match[1]);
  }
  return scopes;
}

// =============================================================================
// Orphan/Incomplete Port Detection
// =============================================================================

/**
 * Check if the code has any orphan port lines (type but no name).
 * Used to skip rename detection when user is editing port names.
 */
export function hasOrphanPortLines(functionText: string): { inputs: boolean; outputs: boolean } {
  const jsdocMatch = functionText.match(JSDOC_BLOCK_REGEX);
  if (!jsdocMatch) return { inputs: false, outputs: false };

  const lines = jsdocMatch[0].split('\n');
  let hasOrphanInputs = false;
  let hasOrphanOutputs = false;

  for (const line of lines) {
    const orphanMatch = line.match(ORPHAN_PORT_LINE_REGEX);
    if (orphanMatch) {
      const [, tagType] = orphanMatch;
      if (tagType === 'input') hasOrphanInputs = true;
      else hasOrphanOutputs = true;
    }
  }

  return { inputs: hasOrphanInputs, outputs: hasOrphanOutputs };
}

/**
 * Extract port names from incomplete JSDoc lines.
 * These are lines where the user is still typing.
 * Used to prevent generating duplicate tags for ports being edited.
 */
export function getIncompletePortNames(functionText: string): {
  inputs: Set<string>;
  outputs: Set<string>;
  steps: Set<string>;
} {
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  const steps = new Set<string>();

  const jsdocMatch = functionText.match(JSDOC_BLOCK_REGEX);
  if (!jsdocMatch) return { inputs, outputs, steps };

  const lines = jsdocMatch[0].split('\n');

  for (const line of lines) {
    // Check if it looks like a port line but doesn't parse
    if (!PORT_TAG_REGEX.test(line)) continue;
    if (chevrotainIsValidPortLine(line)) continue;

    // Try to extract partial port name from incomplete line
    const partialMatch = line.match(/\*\s*@(input|output|step)\s+\[?(\w+)/);
    if (partialMatch) {
      const [, tagType, portName] = partialMatch;
      if (tagType === 'input') {
        inputs.add(portName);
      } else if (tagType === 'output') {
        outputs.add(portName);
      } else if (tagType === 'step') {
        steps.add(portName);
      }
    }
  }

  return { inputs, outputs, steps };
}

/**
 * Check if a line is incomplete (port tag but not fully valid).
 * Also detects "incomplete description" patterns like "@input name -" (dash but no text).
 */
export function isIncompletePortLine(line: string): boolean {
  if (!PORT_TAG_REGEX.test(line)) return false;

  // Check if Chevrotain considers it invalid
  if (!chevrotainIsValidPortLine(line)) return true;

  // Also treat trailing dash (user typing description) as incomplete
  const cleanLine = line.replace(/^\s*\*\s*/, '').trim();
  if (/\s-\s*$/.test(cleanLine)) return true;

  return false;
}

// =============================================================================
// Port Parsing
// =============================================================================

/**
 * Parse @input/@output/@step annotations from function text.
 * Uses Chevrotain for parsing, browser-compatible.
 *
 * Types are derived from signature, not JSDoc:
 * - JSDoc provides metadata: name, optional, default, scope, label, order, placement
 * - Types are inferred from function signature using inferDataTypeFromTS()
 * - @step annotation marks explicit STEP/control-flow ports
 * - Reserved ports (execute, onSuccess, onFailure) auto-detect as STEP
 */
export function parsePortsFromFunctionText(functionText: string): {
  inputs: Record<string, TPortDefinition>;
  outputs: Record<string, TPortDefinition>;
} {
  const inputs: Record<string, TPortDefinition> = {};
  const outputs: Record<string, TPortDefinition> = {};

  const jsdocMatch = functionText.match(JSDOC_BLOCK_REGEX);
  if (!jsdocMatch) {
    return { inputs, outputs };
  }

  const jsdoc = jsdocMatch[0];

  // Parse function signature to get types
  const { params } = parseFunctionSignature(functionText);
  const returnFields = parseReturnTypeFieldsWithTypes(functionText);

  // Build lookup maps for signature types and optionality
  const paramTypeMap = new Map<string, string>();
  const paramOptionalMap = new Map<string, boolean>();
  for (const param of params) {
    if (param.tsType) {
      paramTypeMap.set(param.name, param.tsType);
    }
    if (param.optional) {
      paramOptionalMap.set(param.name, true);
    }
  }
  const returnTypeMap = new Map<string, string>();
  for (const field of returnFields) {
    returnTypeMap.set(field.name, field.tsType);
  }

  // Parse @scope declarations from JSDoc
  const declaredScopes = new Set<string>();
  SCOPE_TAG_REGEX.lastIndex = 0;
  let scopeMatch;
  while ((scopeMatch = SCOPE_TAG_REGEX.exec(jsdoc)) != null) {
    declaredScopes.add(scopeMatch[1]);
  }

  // Get valid scope names from @scope tags
  // Also infer from callback parameters as fallback
  const inferredScopes = new Set(params.filter((p) => p.tsType?.includes('=>')).map((p) => p.name));

  // Combine declared @scope tags with inferred callback scopes
  const allKnownScopes = new Set([...declaredScopes, ...inferredScopes]);

  // If any scope is declared/known, accept any scope: attribute value
  // This allows @scope processItem with scope:iteration - user knows what they're doing
  const hasAnyScope = allKnownScopes.size > 0;

  const validateScope = (scope: string | undefined): string | undefined => {
    if (!scope) return undefined;
    // If we have any declared/inferred scopes, accept any scope attribute
    // (user may use different naming convention)
    if (hasAnyScope) return scope;
    return undefined;
  };

  // Parse ports using Chevrotain
  const portResults = parsePortsFromJSDoc(jsdoc);

  for (const port of portResults) {
    const { type, name, scope, order, placement, description, defaultValue, isOptional } = port;

    if (type === 'step') {
      // @step ports are always STEP type
      const portDef: TPortDefinition = {
        dataType: 'STEP',
        ...(description && { label: description }),
      };

      // Determine if input or output from signature
      const isInput = paramTypeMap.has(name);
      const isOutput = returnTypeMap.has(name);

      if (isInput) {
        inputs[name] = portDef;
      } else if (isOutput) {
        outputs[name] = portDef;
      } else {
        // Default to output for custom STEP ports
        outputs[name] = portDef;
      }
      continue;
    }

    if (type === 'input') {
      // First port wins - skip duplicates
      if (inputs[name]) continue;

      const validatedScope = validateScope(scope);

      // Determine type from signature or default to ANY
      let dataType: TDataType;
      let tsType: string | undefined;

      // Reserved external STEP ports (execute) are always STEP
      // Scoped mandatory ports (success, failure) are STEP only when scoped
      const isExternalStepPort = isExecutePort(name);
      const isScopedStepPort = validatedScope && isScopedMandatoryPort(name);

      if (isExternalStepPort || isScopedStepPort) {
        dataType = 'STEP';
      } else {
        tsType = paramTypeMap.get(name);
        dataType = tsType ? inferDataTypeFromTS(tsType) : 'ANY';
      }

      // Optional if marked in JSDoc or in signature
      const signatureOptional = paramOptionalMap.get(name) || false;
      const portOptional = isOptional || signatureOptional;

      const metadata: Record<string, unknown> = {};
      if (order !== undefined) metadata.order = order;
      if (placement) metadata.placement = placement;

      inputs[name] = {
        dataType,
        ...(tsType && { tsType }),
        ...(portOptional && { optional: true }),
        ...(defaultValue && { default: parseDefaultValue(defaultValue) }),
        ...(validatedScope && { scope: validatedScope }),
        ...(description && { label: description }),
        ...(Object.keys(metadata).length > 0 && { metadata }),
      };
    }

    if (type === 'output') {
      // First port wins - skip duplicates
      if (outputs[name]) continue;

      const validatedScope = validateScope(scope);

      // Determine type from signature or default to ANY
      let dataType: TDataType;
      let tsType: string | undefined;

      // Reserved external STEP ports (onSuccess, onFailure) are always STEP
      // Scoped mandatory ports (start, success, failure) are STEP only when scoped
      const isExternalStepPort = isSuccessPort(name) || isFailurePort(name);
      const isScopedStepPort = validatedScope && isScopedMandatoryPort(name);

      if (isExternalStepPort || isScopedStepPort) {
        dataType = 'STEP';
      } else {
        tsType = returnTypeMap.get(name);
        dataType = tsType ? inferDataTypeFromTS(tsType) : 'ANY';
      }

      const metadata: Record<string, unknown> = {};
      if (order !== undefined) metadata.order = order;
      if (placement) metadata.placement = placement;

      outputs[name] = {
        dataType,
        ...(tsType && { tsType }),
        ...(validatedScope && { scope: validatedScope }),
        ...(description && { label: description }),
        ...(Object.keys(metadata).length > 0 && { metadata }),
      };
    }
  }

  return { inputs, outputs };
}

// =============================================================================
// Port Update
// =============================================================================

/**
 * Update @input/@output annotations in function text.
 * Preserves other JSDoc content (description, @label, @scope, etc.).
 *
 * @param signatureInputOrder - Optional array of input names in signature order.
 *        When provided, new inputs are inserted at the correct position based on signature.
 */
export function updatePortsInFunctionText(
  functionText: string,
  inputs: Record<string, TPortDefinition>,
  outputs: Record<string, TPortDefinition>,
  signatureInputOrder?: string[]
): string {
  const jsdocMatch = functionText.match(JSDOC_BLOCK_REGEX);

  // Get port names from incomplete JSDoc lines (user still typing)
  const incompletePortNames = getIncompletePortNames(functionText);

  // Generate new port tags (skip ports with incomplete lines)
  const inputTags = Object.entries(inputs)
    .filter(([name]) => !incompletePortNames.inputs.has(name))
    .map(([name, port]) => ` * ${generateJSDocPortTag(name, port, 'input')}`);
  const outputTags = Object.entries(outputs)
    .filter(([name]) => !incompletePortNames.outputs.has(name))
    .map(([name, port]) => ` * ${generateJSDocPortTag(name, port, 'output')}`);

  if (!jsdocMatch) {
    // No existing JSDoc - create new one
    const newJsDoc = ['/**', ' * @flowWeaver nodeType', ...inputTags, ...outputTags, ' */'].join(
      '\n'
    );
    return newJsDoc + '\n' + functionText;
  }

  // Parse existing JSDoc to preserve non-port content
  const existingJsDoc = jsdocMatch[0];
  const lines = existingJsDoc.split('\n');

  const preservedLines: string[] = [];
  let hasFlowWeaverTag = false;

  // Track which ports we've seen in the existing JSDoc
  const seenInputs = new Set<string>();
  const seenOutputs = new Set<string>();

  // Track orphan incomplete lines
  const orphanInputLines: Array<{ index: number; type: string }> = [];
  const orphanOutputLines: Array<{ index: number; type: string }> = [];

  // Track last input/output line indices for proper insertion ordering
  let lastInputLineIndex = -1;
  let lastOutputLineIndex = -1;

  for (const line of lines) {
    // Always preserve opening and closing
    if (line.trim() === '/**' || line.trim() === '*/') {
      preservedLines.push(line);
      continue;
    }

    // Check if this is a port line
    if (PORT_TAG_REGEX.test(line)) {
      // Check if this is an orphan line (just tag, no name)
      const orphanMatch = line.match(ORPHAN_PORT_LINE_REGEX);
      if (orphanMatch) {
        const [, tagType] = orphanMatch;
        const lineIndex = preservedLines.length;
        preservedLines.push(line);
        if (tagType === 'input') {
          orphanInputLines.push({ index: lineIndex, type: 'ANY' });
          lastInputLineIndex = lineIndex;
        } else if (tagType === 'output' || tagType === 'step') {
          orphanOutputLines.push({ index: lineIndex, type: 'ANY' });
          lastOutputLineIndex = lineIndex;
        }
        continue;
      }

      // Preserve incomplete port lines (user still typing)
      if (isIncompletePortLine(line)) {
        const lineIndex = preservedLines.length;
        preservedLines.push(line);
        const partialMatch = line.match(/\*\s*@(input|output|step)\s+\[?(\w+)/);
        if (partialMatch) {
          const [, tagType, portName] = partialMatch;
          if (tagType === 'input') {
            seenInputs.add(portName);
            lastInputLineIndex = lineIndex;
          } else if (tagType === 'output') {
            seenOutputs.add(portName);
            lastOutputLineIndex = lineIndex;
          } else if (tagType === 'step') {
            seenInputs.add(portName);
            seenOutputs.add(portName);
          }
        }
        continue;
      }

      // Parse the port line using Chevrotain
      const cleanLine = line.replace(/^\s*\*\s*/, '').trim();
      const parsed = parsePortLine(cleanLine, []);

      if (parsed) {
        const lineIndex = preservedLines.length;

        if (parsed.type === 'input') {
          if (!inputs[parsed.name]) continue; // Port removed
          preservedLines.push(line.trimEnd());
          seenInputs.add(parsed.name);
          lastInputLineIndex = lineIndex;
        } else if (parsed.type === 'output') {
          if (!outputs[parsed.name]) continue; // Port removed
          preservedLines.push(line.trimEnd());
          seenOutputs.add(parsed.name);
          lastOutputLineIndex = lineIndex;
        } else if (parsed.type === 'step') {
          const isInput = inputs[parsed.name] !== undefined;
          const isOutput = outputs[parsed.name] !== undefined;
          if (!isInput && !isOutput) continue; // Port removed
          preservedLines.push(line.trimEnd());
          if (isInput) {
            seenInputs.add(parsed.name);
            lastInputLineIndex = lineIndex;
          }
          if (isOutput) {
            seenOutputs.add(parsed.name);
            lastOutputLineIndex = lineIndex;
          }
        }
        continue;
      }

      // Port tag but doesn't parse - preserve it
      preservedLines.push(line);
      continue;
    }

    // Track if we have @flowWeaver tag
    if (line.includes('@flowWeaver')) {
      hasFlowWeaverTag = true;
    }

    // Preserve all other lines
    preservedLines.push(line);
  }

  // Build new JSDoc
  const newLines = [...preservedLines];

  // If no @flowWeaver tag, add it
  if (!hasFlowWeaverTag) {
    newLines.splice(1, 0, ' * @flowWeaver nodeType');
  }

  // Find ports that need to be added (not already in JSDoc)
  const inputsToAdd = Object.entries(inputs).filter(
    ([name]) => !seenInputs.has(name) && !incompletePortNames.inputs.has(name)
  );
  const outputsToAdd = Object.entries(outputs).filter(
    ([name]) => !seenOutputs.has(name) && !incompletePortNames.outputs.has(name)
  );

  // Fill in orphan lines first
  const remainingInputsToAdd: Array<[string, TPortDefinition]> = [];
  for (const [name, port] of inputsToAdd) {
    const orphanIndex = orphanInputLines.findIndex((o) => o.type === port.dataType);
    if (orphanIndex !== -1) {
      const orphan = orphanInputLines[orphanIndex];
      newLines[orphan.index] = ` * ${generateJSDocPortTag(name, port, 'input')}`;
      orphanInputLines.splice(orphanIndex, 1);
    } else if (orphanInputLines.length > 0) {
      const orphan = orphanInputLines.shift()!;
      newLines[orphan.index] = ` * ${generateJSDocPortTag(name, port, 'input')}`;
    } else {
      remainingInputsToAdd.push([name, port]);
    }
  }

  const remainingOutputsToAdd: Array<[string, TPortDefinition]> = [];
  for (const [name, port] of outputsToAdd) {
    const orphanIndex = orphanOutputLines.findIndex((o) => o.type === port.dataType);
    if (orphanIndex !== -1) {
      const orphan = orphanOutputLines[orphanIndex];
      newLines[orphan.index] = ` * ${generateJSDocPortTag(name, port, 'output')}`;
      orphanOutputLines.splice(orphanIndex, 1);
    } else if (orphanOutputLines.length > 0) {
      const orphan = orphanOutputLines.shift()!;
      newLines[orphan.index] = ` * ${generateJSDocPortTag(name, port, 'output')}`;
    } else {
      remainingOutputsToAdd.push([name, port]);
    }
  }

  // Generate tags for remaining ports
  const newOutputTags = remainingOutputsToAdd.map(
    ([name, port]) => ` * ${generateJSDocPortTag(name, port, 'output')}`
  );

  // Insert NEW port tags at proper positions
  const closingIndex = newLines.findIndex((l) => l.trim() === '*/');

  if (newOutputTags.length > 0) {
    const outputInsertIndex =
      lastOutputLineIndex >= 0
        ? lastOutputLineIndex + 1
        : lastInputLineIndex >= 0
          ? lastInputLineIndex + 1
          : closingIndex;
    newLines.splice(outputInsertIndex, 0, ...newOutputTags);
  }

  if (remainingInputsToAdd.length > 0) {
    const flowWeaverIndex = newLines.findIndex((l) => l.includes('@flowWeaver'));

    // Separate scoped inputs from non-scoped inputs
    const scopedInputsToAdd = remainingInputsToAdd.filter(([_, port]) => port.scope);
    const nonScopedInputsToAdd = remainingInputsToAdd.filter(([_, port]) => !port.scope);

    if (signatureInputOrder && signatureInputOrder.length > 0 && nonScopedInputsToAdd.length > 0) {
      // Build a map of existing input names to their line indices
      const existingInputLineIndices: Record<string, number> = {};
      for (let i = 0; i < newLines.length; i++) {
        const line = newLines[i];
        const cleanLine = line.replace(/^\s*\*\s*/, '').trim();
        const parsed = parsePortLine(cleanLine, []);
        if (parsed && parsed.type === 'input') {
          existingInputLineIndices[parsed.name] = i;
        }
      }

      // Insert each new non-scoped input at the correct position
      const sortedInputsToAdd = nonScopedInputsToAdd
        .map(([name, port]) => ({
          name,
          port,
          sigIndex: signatureInputOrder.indexOf(name),
        }))
        .filter((item) => item.sigIndex !== -1)
        .sort((a, b) => b.sigIndex - a.sigIndex);

      for (const { name, port, sigIndex } of sortedInputsToAdd) {
        const newTag = ` * ${generateJSDocPortTag(name, port, 'input')}`;

        let insertIndex = -1;
        for (let i = sigIndex + 1; i < signatureInputOrder.length; i++) {
          const nextName = signatureInputOrder[i];
          if (existingInputLineIndices[nextName] !== undefined) {
            insertIndex = existingInputLineIndices[nextName];
            break;
          }
        }

        if (insertIndex !== -1) {
          newLines.splice(insertIndex, 0, newTag);
          for (const [portName, idx] of Object.entries(existingInputLineIndices)) {
            if (idx >= insertIndex) {
              existingInputLineIndices[portName] = idx + 1;
            }
          }
          existingInputLineIndices[name] = insertIndex;
        } else {
          for (let i = sigIndex - 1; i >= 0; i--) {
            const prevName = signatureInputOrder[i];
            if (existingInputLineIndices[prevName] !== undefined) {
              insertIndex = existingInputLineIndices[prevName] + 1;
              break;
            }
          }
          if (insertIndex === -1) {
            insertIndex = flowWeaverIndex >= 0 ? flowWeaverIndex + 1 : 1;
          }
          newLines.splice(insertIndex, 0, newTag);
          for (const [portName, idx] of Object.entries(existingInputLineIndices)) {
            if (idx >= insertIndex) {
              existingInputLineIndices[portName] = idx + 1;
            }
          }
          existingInputLineIndices[name] = insertIndex;
        }
      }
    } else if (nonScopedInputsToAdd.length > 0) {
      const nonScopedInputTags = nonScopedInputsToAdd.map(
        ([name, port]) => ` * ${generateJSDocPortTag(name, port, 'input')}`
      );
      const inputInsertIndex =
        lastInputLineIndex >= 0
          ? lastInputLineIndex + 1
          : flowWeaverIndex >= 0
            ? flowWeaverIndex + 1
            : 1;
      newLines.splice(inputInsertIndex, 0, ...nonScopedInputTags);
    }

    // Insert scoped inputs after outputs (standard port order: inputs, scoped outputs, scoped inputs, outputs)
    if (scopedInputsToAdd.length > 0) {
      const scopedInputTags = scopedInputsToAdd.map(
        ([name, port]) => ` * ${generateJSDocPortTag(name, port, 'input')}`
      );
      // Insert after the last output line, or after inputs if no outputs
      const closingIdx = newLines.findIndex((l) => l.trim() === '*/');
      const insertIdx =
        lastOutputLineIndex >= 0
          ? lastOutputLineIndex + 1
          : closingIdx >= 0
            ? closingIdx
            : newLines.length - 1;
      newLines.splice(insertIdx, 0, ...scopedInputTags);
    }
  }

  const newJsDoc = newLines.join('\n');

  return functionText.replace(JSDOC_BLOCK_REGEX, newJsDoc);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse default value from string.
 */
function parseDefaultValue(value: string): TSerializableValue {
  try {
    return JSON.parse(value) as TSerializableValue;
  } catch {
    return value;
  }
}
