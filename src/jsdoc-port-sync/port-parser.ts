/**
 * @module jsdoc-port-sync/port-parser
 *
 * Parse and update @input/@output/@step annotations in JSDoc.
 * Uses Chevrotain for parsing, browser-compatible.
 */

import type { TPortDefinition, TDataType, TSerializableValue } from '../ast/types';
import { generateJSDocPortTag } from '../generator/annotation-generator';
import { isExecutePort, isSuccessPort, isFailurePort, isScopedMandatoryPort } from '../constants';
import { inferDataTypeFromTS } from '../types/type-mappings';
import { parsePortsFromJSDoc, type PortParseResult } from '../chevrotain-parser/port-parser';
import { JSDOC_BLOCK_REGEX } from './constants';
import { getIncompletePortNames } from './incomplete-lines';
import { fillOrphanLines, insertInputTags, insertOutputTags, scanPortLines } from './port-tag-placement';
import { parseFunctionSignature, parseReturnTypeFieldsWithTypes } from './signature-parser';

export { hasOrphanPortLines, getIncompletePortNames, isIncompletePortLine } from './incomplete-lines';

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
// Port Parsing
// =============================================================================

/** The signature facts a JSDoc port takes its type and optionality from. */
interface SignatureLookup {
  paramTypeMap: Map<string, string>;
  paramOptionalMap: Map<string, boolean>;
  returnTypeMap: Map<string, string>;
  /** Names of parameters typed as callbacks; each one is a scope. */
  callbackParamNames: Set<string>;
}

function readSignatureLookup(functionText: string): SignatureLookup {
  const { params } = parseFunctionSignature(functionText);
  const returnFields = parseReturnTypeFieldsWithTypes(functionText);

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

  const callbackParamNames = new Set(params.filter((p) => p.tsType?.includes('=>')).map((p) => p.name));
  return { paramTypeMap, paramOptionalMap, returnTypeMap, callbackParamNames };
}

/** `[order:N]` and `[placement:...]` as port metadata, or nothing when neither is set. */
function portMetadata(port: PortParseResult): { metadata: Record<string, unknown> } | undefined {
  const metadata: Record<string, unknown> = {};
  if (port.order !== undefined) metadata.order = port.order;
  if (port.placement) metadata.placement = port.placement;
  return Object.keys(metadata).length > 0 ? { metadata } : undefined;
}

/**
 * The type of a port: STEP for reserved control-flow ports (and for scoped
 * mandatory ports when the port is scoped), otherwise inferred from its
 * TypeScript type, or ANY when the signature has none.
 */
function portType(isStepPort: boolean, tsTypeOf: () => string | undefined): { dataType: TDataType; tsType?: string } {
  if (isStepPort) return { dataType: 'STEP' };
  const tsType = tsTypeOf();
  return { dataType: tsType ? inferDataTypeFromTS(tsType) : 'ANY', tsType };
}

/** Build an `@input` port: typed and made optional from the signature. */
function inputPortDefinition(
  port: PortParseResult,
  lookup: SignatureLookup,
  validatedScope: string | undefined
): TPortDefinition {
  const { name, description, defaultValue, isOptional } = port;
  // Reserved external STEP ports (execute) are always STEP
  // Scoped mandatory ports (success, failure) are STEP only when scoped
  const isStepPort = isExecutePort(name) || !!(validatedScope && isScopedMandatoryPort(name));
  const { dataType, tsType } = portType(isStepPort, () => lookup.paramTypeMap.get(name));

  // Optional if marked in JSDoc or in signature
  const signatureOptional = lookup.paramOptionalMap.get(name) || false;
  const portOptional = isOptional || signatureOptional;

  return {
    dataType,
    ...(tsType && { tsType }),
    ...(portOptional && { optional: true }),
    ...(defaultValue === undefined ? {} : { default: parseDefaultValue(defaultValue) }),
    ...(validatedScope && { scope: validatedScope }),
    ...(description && { label: description }),
    ...portMetadata(port),
  };
}

/** Build an `@output` port, typed from the return type annotation. */
function outputPortDefinition(
  port: PortParseResult,
  lookup: SignatureLookup,
  validatedScope: string | undefined
): TPortDefinition {
  const { name, description } = port;
  // Reserved external STEP ports (onSuccess, onFailure) are always STEP
  // Scoped mandatory ports (start, success, failure) are STEP only when scoped
  const isStepPort = isSuccessPort(name) || isFailurePort(name) || !!(validatedScope && isScopedMandatoryPort(name));
  const { dataType, tsType } = portType(isStepPort, () => lookup.returnTypeMap.get(name));

  return {
    dataType,
    ...(tsType && { tsType }),
    ...(validatedScope && { scope: validatedScope }),
    ...(description && { label: description }),
    ...portMetadata(port),
  };
}

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

  const lookup = readSignatureLookup(functionText);

  // A `scope:` attribute is only kept when the node has a scope at all, either
  // from an @scope tag or a callback parameter. Any scope name is then
  // accepted, since users may name the scope differently from the callback.
  const hasAnyScope = getScopeNames(functionText).length > 0 || lookup.callbackParamNames.size > 0;
  const validateScope = (scope: string | undefined): string | undefined =>
    scope && hasAnyScope ? scope : undefined;

  for (const port of parsePortsFromJSDoc(jsdocMatch[0])) {
    const { type, name, description } = port;

    if (type === 'step') {
      // @step ports are always STEP; an input when the signature has the
      // parameter, otherwise an output
      const portDef: TPortDefinition = {
        dataType: 'STEP',
        ...(description && { label: description }),
      };
      if (lookup.paramTypeMap.has(name)) {
        inputs[name] = portDef;
      } else {
        outputs[name] = portDef;
      }
      continue;
    }

    // First port wins - skip duplicates
    if (type === 'input' && !inputs[name]) {
      inputs[name] = inputPortDefinition(port, lookup, validateScope(port.scope));
    }
    if (type === 'output' && !outputs[name]) {
      outputs[name] = outputPortDefinition(port, lookup, validateScope(port.scope));
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

  // Keep the existing JSDoc's non-port content and the port lines that still apply
  const scan = scanPortLines(jsdocMatch[0].split('\n'), inputs, outputs);
  const newLines = [...scan.preservedLines];
  if (!scan.hasFlowWeaverTag) {
    newLines.splice(1, 0, ' * @flowWeaver nodeType');
  }

  // Ports not already in the JSDoc fill orphan lines first, then get new lines
  const inputsToAdd = Object.entries(inputs).filter(
    ([name]) => !scan.seenInputs.has(name) && !incompletePortNames.inputs.has(name)
  );
  const outputsToAdd = Object.entries(outputs).filter(
    ([name]) => !scan.seenOutputs.has(name) && !incompletePortNames.outputs.has(name)
  );
  const remainingInputsToAdd = fillOrphanLines(newLines, inputsToAdd, scan.orphanInputLines, 'input');
  const remainingOutputsToAdd = fillOrphanLines(newLines, outputsToAdd, scan.orphanOutputLines, 'output');

  insertOutputTags(newLines, remainingOutputsToAdd, scan);
  if (remainingInputsToAdd.length > 0) {
    insertInputTags(newLines, remainingInputsToAdd, scan, signatureInputOrder);
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
export function parseDefaultValue(value: string): TSerializableValue {
  try {
    return JSON.parse(value) as TSerializableValue;
  } catch {
    return value;
  }
}
