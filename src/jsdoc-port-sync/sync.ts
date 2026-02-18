/**
 * @module jsdoc-port-sync/sync
 *
 * Bidirectional sync between JSDoc annotations and TypeScript signatures.
 * - syncSignatureToJSDoc: Code → JSDoc (regenerate tags from signature)
 * - syncJSDocToSignature: JSDoc → Code (add params/fields to signature)
 */

import type { TPortDefinition, TSerializableValue } from "../ast/types";
import { SCOPED_PORT_NAMES } from "../constants";
import {
  JSDOC_BLOCK_REGEX,
  SCOPE_TAG_REGEX,
  RESERVED_PARAMS,
  findBalancedClose,
  splitParams,
} from "./constants";
import {
  parseFunctionSignature,
  parseReturnFields,
  parseReturnBodyFieldsWithTypes,
  parseReturnTypeFields,
  parseInputTypeFields,
  tsTypeToPortType,
  portTypeToTsType,
  parseCallbackType,
  buildCallbackType,
  callbackHasAllPorts,
} from "./signature-parser";
import {
  parsePortsFromFunctionText,
  updatePortsInFunctionText,
  hasOrphanPortLines,
  getIncompletePortNames,
} from "./port-parser";
import { isReservedPortName } from "../constants";

// =============================================================================
// Sync: Signature → JSDoc
// =============================================================================

/**
 * Sync function signature to JSDoc (Code → JSDoc).
 *
 * **What it does:**
 * - Adds `@input` tags for params in signature but not in JSDoc
 * - Adds `@output` tags for return fields not in JSDoc
 * - Removes orphan `@input`/`@output` tags (port deleted from signature)
 * - Preserves existing JSDoc content (description, `@label`, etc.)
 *
 * **When to call:** Only on explicit format (Ctrl+P), NOT every keystroke.
 */
export function syncSignatureToJSDoc(functionText: string): string {
  // Check for orphan lines - skip sync if user is editing port names
  const orphanLines = hasOrphanPortLines(functionText);
  if (orphanLines.inputs || orphanLines.outputs) {
    return functionText;
  }

  const { inputs: existingInputs, outputs: existingOutputs } =
    parsePortsFromFunctionText(functionText);
  const { params } = parseFunctionSignature(functionText);

  // Determine return fields source
  const hasReturnTypeAnnotation = /\)\s*:\s*\{[^}]+\}\s*(?:\{|=>)/.test(functionText);
  const returnTypeFields = parseReturnTypeFields(functionText);
  const returnBodyFields = parseReturnFields(functionText);
  const returnBodyFieldTypes = parseReturnBodyFieldsWithTypes(functionText);
  const returnFields = hasReturnTypeAnnotation ? returnTypeFields : returnBodyFields;

  const incompletePortNames = getIncompletePortNames(functionText);

  // Get non-callback param names
  const signatureParamNames = new Set(
    params
      .filter((p) => !RESERVED_PARAMS.includes(p.name) && !p.tsType?.includes("=>"))
      .map((p) => p.name)
  );

  // Also get input fields from TFlowWeaverNodeType type annotation
  const inputTypeFields = parseInputTypeFields(functionText);
  for (const field of inputTypeFields) {
    signatureParamNames.add(field.name);
  }

  const returnFieldNames = new Set(returnFields);

  // Build merged inputs
  const mergedInputs: Record<string, TPortDefinition> = { ...existingInputs };
  for (const param of params) {
    if (RESERVED_PARAMS.includes(param.name)) continue;
    if (incompletePortNames.inputs.has(param.name)) continue;

    const signatureType = tsTypeToPortType(param.tsType);

    if (!mergedInputs[param.name]) {
      mergedInputs[param.name] = {
        dataType: signatureType,
        ...(param.optional && { optional: true }),
        ...(param.defaultValue && { default: parseDefaultValue(param.defaultValue) }),
      };
    } else if (signatureType !== "ANY" && mergedInputs[param.name].dataType !== signatureType) {
      const existingType = mergedInputs[param.name].dataType;
      if (!(existingType === "STEP" && signatureType === "BOOLEAN")) {
        mergedInputs[param.name] = {
          ...mergedInputs[param.name],
          dataType: signatureType,
        };
      }
    }
  }

  // Add inputs from TFlowWeaverNodeType type annotation
  for (const field of inputTypeFields) {
    if (!mergedInputs[field.name] && !incompletePortNames.inputs.has(field.name)) {
      mergedInputs[field.name] = { dataType: tsTypeToPortType(field.tsType) };
    }
  }

  // Build merged outputs
  const mergedOutputs: Record<string, TPortDefinition> = { ...existingOutputs };
  for (const field of returnFields) {
    if (!mergedOutputs[field] && !incompletePortNames.outputs.has(field)) {
      const inferredType = returnBodyFieldTypes.get(field);
      const dataType = inferredType ? tsTypeToPortType(inferredType) : "ANY";
      mergedOutputs[field] = { dataType, ...(inferredType && { tsType: inferredType }) };
    }
  }

  // Get raw signature for additional checks
  const sigMatch = functionText.match(/function\s+\w+\s*\(([^)]*)/s) ||
                   functionText.match(/=\s*\(([^)]*)\)\s*(?:=>|:)/s);
  const rawSigText = sigMatch?.[1] || "";

  // Parse callback info for scoped port detection
  const callbackInfo = new Map<string, { hasReturnFields: boolean; returnFieldNames: Set<string> }>();
  for (const param of params) {
    if (param.tsType?.includes("=>")) {
      const parsed = parseCallbackType(param.tsType);
      const fieldNames = new Set(parsed.returnFields.map(f => f.name));
      callbackInfo.set(param.name, {
        hasReturnFields: fieldNames.size > 0,
        returnFieldNames: fieldNames,
      });
    }
  }

  // Auto-remove orphan inputs
  const finalInputs: Record<string, TPortDefinition> = {};
  for (const [name, port] of Object.entries(mergedInputs)) {
    const hasUserMetadata = port.metadata?.order !== undefined || port.label !== undefined;
    const existsInRawSig = new RegExp(`\\b${name}\\b`).test(rawSigText);

    const isScopedInput = port.scope !== undefined;
    let keepScopedInput = false;
    if (isScopedInput && port.scope) {
      const scopeCallback = callbackInfo.get(port.scope);
      if (scopeCallback) {
        if (scopeCallback.hasReturnFields) {
          keepScopedInput = scopeCallback.returnFieldNames.has(name);
        } else {
          keepScopedInput = true;
        }
      }
    }

    if (signatureParamNames.has(name) || keepScopedInput || incompletePortNames.inputs.has(name) || (hasUserMetadata && existsInRawSig)) {
      finalInputs[name] = port;
    }
  }

  // Auto-remove orphan outputs
  const finalOutputs: Record<string, TPortDefinition> = {};
  for (const [name, port] of Object.entries(mergedOutputs)) {
    if (returnFieldNames.has(name) || port.scope || isReservedPortName(name) || incompletePortNames.outputs.has(name)) {
      finalOutputs[name] = port;
    }
  }

  // Build signature input order
  const rawParamMatches = rawSigText.matchAll(/^\s*(\w+)\s*[?:]|,\s*(\w+)\s*[?:]/gm);
  const rawParamOrder: string[] = [];
  for (const match of rawParamMatches) {
    const name = match[1] || match[2];
    if (name && !RESERVED_PARAMS.includes(name) && !rawParamOrder.includes(name)) {
      const afterName = rawSigText.substring(rawSigText.indexOf(name + ":") + name.length + 1);
      if (!afterName.trim().startsWith("(")) {
        rawParamOrder.push(name);
      }
    }
  }

  const parsedOrder = params
    .filter((p) => !RESERVED_PARAMS.includes(p.name) && !p.tsType?.includes("=>"))
    .map((p) => p.name);

  const signatureInputOrder = rawParamOrder.length >= parsedOrder.length ? rawParamOrder : parsedOrder;

  // ==========================================================================
  // Auto-generate mandatory scoped ports for declared @scope tags
  // ==========================================================================
  const jsdocMatch = functionText.match(JSDOC_BLOCK_REGEX);
  if (jsdocMatch) {
    const jsdoc = jsdocMatch[0];
    const declaredScopes = new Set<string>();
    SCOPE_TAG_REGEX.lastIndex = 0;
    let scopeMatch;
    while ((scopeMatch = SCOPE_TAG_REGEX.exec(jsdoc)) != null) {
      declaredScopes.add(scopeMatch[1]);
    }

    // For each declared scope, ensure mandatory ports exist
    for (const scopeName of declaredScopes) {
      // Mandatory OUTPUT: start (STEP)
      if (!finalOutputs[SCOPED_PORT_NAMES.START] || finalOutputs[SCOPED_PORT_NAMES.START].scope !== scopeName) {
        // Check if 'start' exists with this scope
        const hasStart = Object.entries(finalOutputs).some(
          ([name, port]) => name === SCOPED_PORT_NAMES.START && port.scope === scopeName
        );
        if (!hasStart) {
          finalOutputs[SCOPED_PORT_NAMES.START] = {
            dataType: "STEP",
            scope: scopeName,
          };
        }
      }

      // Mandatory INPUT: success (STEP)
      const hasSuccess = Object.entries(finalInputs).some(
        ([name, port]) => name === SCOPED_PORT_NAMES.SUCCESS && port.scope === scopeName
      );
      if (!hasSuccess) {
        finalInputs[SCOPED_PORT_NAMES.SUCCESS] = {
          dataType: "STEP",
          scope: scopeName,
        };
      }

      // Mandatory INPUT: failure (STEP)
      const hasFailure = Object.entries(finalInputs).some(
        ([name, port]) => name === SCOPED_PORT_NAMES.FAILURE && port.scope === scopeName
      );
      if (!hasFailure) {
        finalInputs[SCOPED_PORT_NAMES.FAILURE] = {
          dataType: "STEP",
          scope: scopeName,
        };
      }
    }
  }

  return updatePortsInFunctionText(functionText, finalInputs, finalOutputs, signatureInputOrder);
}

// =============================================================================
// Sync: JSDoc → Signature
// =============================================================================

/**
 * Sync JSDoc to function signature (JSDoc → Code).
 *
 * **What it does:**
 * - Adds missing params from `@input` tags to function signature
 * - Updates return type with fields from `@output` tags
 * - Ensures `execute: boolean` is first param
 * - Builds/updates callback types for scoped ports
 *
 * **When to call:** On every keystroke during editing.
 */
export function syncJSDocToSignature(
  functionText: string,
  authoritativePorts?: { inputs?: Record<string, TPortDefinition>; outputs?: Record<string, TPortDefinition> }
): string {
  const { inputs: parsedInputs, outputs: parsedOutputs } = parsePortsFromFunctionText(functionText);

  const returnBodyFieldTypes = parseReturnBodyFieldsWithTypes(functionText);

  // Use authoritative ports if provided
  const inputs: Record<string, TPortDefinition> = {};
  for (const [name, port] of Object.entries(parsedInputs)) {
    inputs[name] = authoritativePorts?.inputs?.[name] ?? port;
  }
  const outputs: Record<string, TPortDefinition> = {};
  for (const [name, port] of Object.entries(parsedOutputs)) {
    const authoritative = authoritativePorts?.outputs?.[name];
    if (authoritative) {
      outputs[name] = authoritative;
    } else {
      const inferredTsType = returnBodyFieldTypes.get(name);
      if (inferredTsType && !port.tsType) {
        outputs[name] = { ...port, tsType: inferredTsType };
      } else {
        outputs[name] = port;
      }
    }
  }

  const { params, functionType } = parseFunctionSignature(functionText);

  // Helper to safely get order from metadata (metadata is Record<string, unknown>)
  const getOrder = (port: TPortDefinition): number => {
    const order = port.metadata?.order;
    return typeof order === "number" ? order : Infinity;
  };

  // Build ordered list of NON-SCOPED ports only
  const orderedInputs = Object.entries(inputs)
    .filter(([_, port]) => !port.scope)
    .map(([name, port]) => ({ name, port, order: getOrder(port) }))
    .sort((a, b) => a.order - b.order);

  // Get existing param names
  const existingParamNames = new Set(params.map((p) => p.name));

  // Also extract from raw signature
  const sigMatch = functionText.match(/function\s+\w+\s*\(([^)]*)/s) ||
                   functionText.match(/=\s*\(([^)]*)\)\s*(?:=>|:)/s);
  const rawSigText = sigMatch?.[1] || "";
  const rawParamMatches = rawSigText.matchAll(/\b(\w+)\s*[?:]/g);
  for (const match of rawParamMatches) {
    existingParamNames.add(match[1]);
  }

  // Find params to add
  const paramsToAdd = orderedInputs.filter(
    ({ name }) => !existingParamNames.has(name) && !RESERVED_PARAMS.includes(name)
  );

  // IMPORTANT: Do NOT remove params from signature that don't have @input tags
  // The signature is the source of truth for param existence
  // JSDoc is only for metadata (labels, order, scope, etc.)
  // Removing params would break user workflow of adding params to signature first
  const paramsToRemove: typeof params = [];

  // Filter out scoped outputs
  const nonScopedOutputs = Object.fromEntries(
    Object.entries(outputs).filter(([_, port]) => !port.scope)
  );

  // Check for scoped ports
  const scopedInputs = Object.entries(inputs).filter(([_, port]) => port.scope);
  const scopedOutputs = Object.entries(outputs).filter(([_, port]) => port.scope);
  const hasScopedPorts = scopedInputs.length > 0 || scopedOutputs.length > 0;

  const hasSyncableOutputs = Object.keys(nonScopedOutputs).length > 0;
  const hasExecuteParam = existingParamNames.has("execute");

  // Check for outputs to remove
  const existingReturnFields = parseReturnTypeFields(functionText);
  const jsDocOutputNames = new Set(Object.keys(nonScopedOutputs));
  const MANDATORY_RETURN_FIELDS = new Set(["onSuccess", "onFailure"]);
  const hasOutputsToRemove = existingReturnFields.some(
    (field) => !jsDocOutputNames.has(field) && !MANDATORY_RETURN_FIELDS.has(field)
  );

  if (paramsToAdd.length === 0 && paramsToRemove.length === 0 && !hasScopedPorts && !hasSyncableOutputs && !hasOutputsToRemove && hasExecuteParam) {
    return functionText;
  }

  let result = functionText;

  // Remove params not in JSDoc
  for (const param of paramsToRemove) {
    const paramRegex = new RegExp(
      `(,\\s*)?\\b${param.name}\\s*\\??\\s*:\\s*[^,)]+`,
      "g"
    );
    result = result.replace(paramRegex, "");
    result = result.replace(/\(\s*,\s*/g, "(");
    result = result.replace(/,\s*,/g, ",");
    result = result.replace(/,\s*\)/g, ")");
  }

  // Ensure execute: boolean is first
  if (!hasExecuteParam) {
    if (functionType === "declaration") {
      const funcMatch = result.match(/function\s+\w+\s*\(/);
      if (funcMatch && funcMatch.index !== undefined) {
        const openParen = funcMatch.index + funcMatch[0].length - 1;
        const closeParen = findBalancedClose(result, openParen);
        if (closeParen !== -1) {
          const existingParams = result.substring(openParen + 1, closeParen).trim();
          const sep = existingParams ? ", " : "";
          result =
            result.substring(0, openParen + 1) +
            "execute: boolean" +
            sep +
            result.substring(openParen + 1);
        }
      }
    } else if (functionType === "arrow") {
      const arrowMatch = result.match(/(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/);
      if (arrowMatch && arrowMatch.index !== undefined) {
        const openParen = arrowMatch.index + arrowMatch[0].length - 1;
        const closeParen = findBalancedClose(result, openParen);
        if (closeParen !== -1) {
          const existingParams = result.substring(openParen + 1, closeParen).trim();
          const sep = existingParams ? ", " : "";
          result =
            result.substring(0, openParen + 1) +
            "execute: boolean" +
            sep +
            result.substring(openParen + 1);
        }
      }
    }
  }

  // Add missing params
  if (paramsToAdd.length > 0) {
    const newParamStrings = paramsToAdd.map(({ name, port }) => {
      const tsType = portTypeToTsType(port.dataType);
      if (port.optional && port.default !== undefined) {
        return `${name}: ${tsType} = ${JSON.stringify(port.default)}`;
      } else if (port.optional) {
        return `${name}?: ${tsType}`;
      }
      return `${name}: ${tsType}`;
    });

    if (functionType === "declaration") {
      const funcMatch = result.match(/function\s+\w+\s*\(/);
      if (funcMatch && funcMatch.index !== undefined) {
        const openParen = funcMatch.index + funcMatch[0].length - 1;
        const closeParen = findBalancedClose(result, openParen);
        if (closeParen !== -1) {
          let existingParams = result.substring(openParen + 1, closeParen);
          const endsWithComma = /,\s*$/.test(existingParams);
          const isMultiline = existingParams.includes("\n");
          let sep: string;
          if (!existingParams.trim()) {
            sep = "";
          } else if (endsWithComma) {
            existingParams = existingParams.replace(/,\s*$/, ",");
            sep = "\n  ";
          } else if (isMultiline) {
            existingParams = existingParams.trimEnd();
            sep = ",\n  ";
          } else {
            sep = ", ";
          }
          result =
            result.substring(0, openParen + 1) +
            existingParams +
            sep +
            newParamStrings.join(", ") +
            "\n" +
            result.substring(closeParen);
        }
      }
    } else if (functionType === "arrow") {
      const arrowMatch = result.match(/(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/);
      if (arrowMatch && arrowMatch.index !== undefined) {
        const openParen = arrowMatch.index + arrowMatch[0].length - 1;
        const closeParen = findBalancedClose(result, openParen);
        if (closeParen !== -1) {
          let existingParams = result.substring(openParen + 1, closeParen);
          const endsWithComma = /,\s*$/.test(existingParams);
          const isMultiline = existingParams.includes("\n");
          let sep: string;
          if (!existingParams.trim()) {
            sep = "";
          } else if (endsWithComma) {
            existingParams = existingParams.replace(/,\s*$/, ",");
            sep = "\n  ";
          } else if (isMultiline) {
            existingParams = existingParams.trimEnd();
            sep = ",\n  ";
          } else {
            sep = ", ";
          }
          result =
            result.substring(0, openParen + 1) +
            existingParams +
            sep +
            newParamStrings.join(", ") +
            "\n" +
            result.substring(closeParen);
        }
      }
    }
  }

  // Handle scoped ports → callback signatures
  if (hasScopedPorts) {
    const scopeNames = new Set([
      ...scopedInputs.map(([_, port]) => port.scope!),
      ...scopedOutputs.map(([_, port]) => port.scope!),
    ]);

    for (const scopeName of scopeNames) {
      const callbackParams = scopedOutputs.filter(
        ([name, port]) => port.scope === scopeName && port.dataType !== "FUNCTION" && name !== scopeName
      );
      const callbackReturns = scopedInputs.filter(([_, port]) => port.scope === scopeName);

      if (callbackParams.length > 0 || callbackReturns.length > 0) {
        result = updateCallbackInSignature(
          result,
          scopeName,
          callbackParams,
          callbackReturns,
          functionType,
        );
      }
    }
  }

  // Handle return type annotation
  const syncableOutputs = Object.entries(nonScopedOutputs).filter(
    ([_, port]) => !port.scope
  );

  const existingReturnTypeMatch = result.match(/\)\s*:\s*\{([^}]*)\}/);
  const existingFields: Map<string, string> = new Map();
  if (existingReturnTypeMatch) {
    const existingContent = existingReturnTypeMatch[1];
    const fieldMatches = existingContent.matchAll(/(\w+)\s*:\s*([^;}\s][^;}]*)?/g);
    for (const match of fieldMatches) {
      const fieldName = match[1];
      const fieldType = match[2]?.trim() || "";
      existingFields.set(fieldName, fieldType);
    }
  }

  // Ensure mandatory fields
  if (!existingFields.has("onSuccess")) {
    existingFields.set("onSuccess", "boolean");
  }
  if (!existingFields.has("onFailure")) {
    existingFields.set("onFailure", "boolean");
  }

  // Add fields from JSDoc
  for (const [name, port] of syncableOutputs) {
    if (name === "onSuccess" || name === "onFailure") continue;
    const existingType = existingFields.get(name);
    if (!existingType) {
      const typeStr = port.tsType || portTypeToTsType(port.dataType);
      existingFields.set(name, typeStr);
    }
  }

  // Build final fields list
  const allFields: string[] = [];
  allFields.push(`onSuccess: ${existingFields.get("onSuccess")}`);
  allFields.push(`onFailure: ${existingFields.get("onFailure")}`);
  for (const [name, type] of existingFields) {
    if (name === "onSuccess" || name === "onFailure") continue;
    allFields.push(type ? `${name}: ${type}` : `${name}:`);
  }

  if (allFields.length > 0) {
    const returnType = `{ ${allFields.join("; ")} }`;

    if (functionType === "declaration") {
      const funcMatch = result.match(/function\s+\w+\s*\(/);
      if (funcMatch && funcMatch.index !== undefined) {
        const openParen = funcMatch.index + funcMatch[0].length - 1;
        const closeParen = findBalancedClose(result, openParen);
        if (closeParen !== -1) {
          const afterParen = result.substring(closeParen + 1);
          const existingReturnMatch = afterParen.match(/^\s*:\s*\{[^}]*\}/);
          if (existingReturnMatch) {
            result =
              result.substring(0, closeParen + 1) +
              ": " +
              returnType +
              afterParen.substring(existingReturnMatch[0].length);
          } else {
            const beforeBody = afterParen.match(/^\s*/);
            const whitespace = beforeBody ? beforeBody[0] : " ";
            result =
              result.substring(0, closeParen + 1) +
              ": " +
              returnType +
              whitespace +
              afterParen.substring(whitespace.length);
          }
        }
      }
    } else if (functionType === "arrow") {
      const arrowMatch = result.match(/(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/);
      if (arrowMatch && arrowMatch.index !== undefined) {
        const openParen = arrowMatch.index + arrowMatch[0].length - 1;
        const closeParen = findBalancedClose(result, openParen);
        if (closeParen !== -1) {
          const afterParen = result.substring(closeParen + 1);
          const existingReturnMatch = afterParen.match(/^\s*:\s*\{[^}]*\}/);
          if (existingReturnMatch) {
            result =
              result.substring(0, closeParen + 1) +
              ": " +
              returnType +
              afterParen.substring(existingReturnMatch[0].length);
          } else {
            const beforeArrow = afterParen.match(/^\s*/);
            const whitespace = beforeArrow ? beforeArrow[0] : " ";
            result =
              result.substring(0, closeParen + 1) +
              ": " +
              returnType +
              whitespace +
              afterParen.substring(whitespace.length);
          }
        }
      }
    }
  }

  return result;
}

// =============================================================================
// Callback Signature Update
// =============================================================================

/**
 * Update or add callback parameter for a scope.
 */
function updateCallbackInSignature(
  functionText: string,
  scopeName: string,
  callbackParams: Array<[string, TPortDefinition]>,
  callbackReturns: Array<[string, TPortDefinition]>,
  functionType: "declaration" | "arrow" | "expression",
): string {
  if (functionType === "declaration") {
    const funcMatch = functionText.match(/((?:async\s+)?function\s+)(\w+)\s*\(/);
    if (!funcMatch || funcMatch.index === undefined) return functionText;

    const openParenIndex = funcMatch.index + funcMatch[0].length - 1;
    const closeParenIndex = findBalancedClose(functionText, openParenIndex);
    if (closeParenIndex === -1) return functionText;

    const paramsStr = functionText.substring(openParenIndex + 1, closeParenIndex);
    const paramTokens = splitParams(paramsStr);
    const callbackIndex = paramTokens.findIndex((p) => p.includes("=>"));

    if (callbackIndex >= 0) {
      const callbackParam = paramTokens[callbackIndex].trim();
      const colonIndex = callbackParam.indexOf(":");
      const existingType = callbackParam.substring(colonIndex + 1).trim();

      if (callbackHasAllPorts(existingType, callbackParams, callbackReturns)) {
        return functionText;
      }
    }

    const beforeFunc = functionText.substring(0, funcMatch.index);
    const funcKeyword = funcMatch[1];
    const funcName = funcMatch[2];
    const suffix = functionText.substring(closeParenIndex + 1);
    const isMultiline = paramsStr.includes("\n");

    if (callbackIndex >= 0) {
      const callbackParam = paramTokens[callbackIndex].trim();
      const colonIndex = callbackParam.indexOf(":");
      const paramName = callbackParam.substring(0, colonIndex).trim();
      const existingType = callbackParam.substring(colonIndex + 1).trim();
      const callbackType = buildCallbackType(callbackParams, callbackReturns, existingType);
      paramTokens[callbackIndex] = `${paramName}: ${callbackType}`;
    } else {
      const callbackType = buildCallbackType(callbackParams, callbackReturns);
      paramTokens.push(`${scopeName}: ${callbackType}`);
    }

    if (isMultiline) {
      let result = paramsStr;
      const callbackToken = paramTokens[callbackIndex];
      const callbackStartRegex = new RegExp(`(${scopeName}\\s*:\\s*)\\([^)]*\\)\\s*=>\\s*\\{[^}]*\\}`, 's');
      const match = result.match(callbackStartRegex);
      if (match) {
        result = result.replace(callbackStartRegex, callbackToken);
      }
      return `${beforeFunc}${funcKeyword}${funcName}(${result})${suffix}`;
    } else {
      const trimmedTokens = paramTokens.map((p) => p.trim());
      return `${beforeFunc}${funcKeyword}${funcName}(${trimmedTokens.join(", ")})${suffix}`;
    }
  } else if (functionType === "arrow") {
    const arrowMatch = functionText.match(/((?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?)\(/);
    if (!arrowMatch || arrowMatch.index === undefined) return functionText;

    const openParenIndex = arrowMatch.index + arrowMatch[0].length - 1;
    const closeParenIndex = findBalancedClose(functionText, openParenIndex);
    if (closeParenIndex === -1) return functionText;

    const paramsStr = functionText.substring(openParenIndex + 1, closeParenIndex);
    const paramTokens = splitParams(paramsStr);
    const callbackIndex = paramTokens.findIndex((p) => p.includes("=>"));

    if (callbackIndex >= 0) {
      const callbackParam = paramTokens[callbackIndex].trim();
      const colonIndex = callbackParam.indexOf(":");
      const existingType = callbackParam.substring(colonIndex + 1).trim();

      if (callbackHasAllPorts(existingType, callbackParams, callbackReturns)) {
        return functionText;
      }
    }

    const beforeArrow = functionText.substring(0, arrowMatch.index);
    const prefix = arrowMatch[1];
    const afterParams = functionText.substring(closeParenIndex + 1);
    const arrowIndex = afterParams.indexOf("=>");
    if (arrowIndex === -1) return functionText;
    const suffix = afterParams.substring(arrowIndex);
    const isMultiline = paramsStr.includes("\n");

    if (callbackIndex >= 0) {
      const callbackParam = paramTokens[callbackIndex].trim();
      const colonIndex = callbackParam.indexOf(":");
      const paramName = callbackParam.substring(0, colonIndex).trim();
      const existingType = callbackParam.substring(colonIndex + 1).trim();
      const callbackType = buildCallbackType(callbackParams, callbackReturns, existingType);
      paramTokens[callbackIndex] = `${paramName}: ${callbackType}`;
    } else {
      const callbackType = buildCallbackType(callbackParams, callbackReturns);
      paramTokens.push(`${scopeName}: ${callbackType}`);
    }

    if (isMultiline) {
      let result = paramsStr;
      const callbackToken = paramTokens[callbackIndex];
      const callbackStartRegex = new RegExp(`(${scopeName}\\s*:\\s*)\\([^)]*\\)\\s*=>\\s*\\{[^}]*\\}`, 's');
      const match = result.match(callbackStartRegex);
      if (match) {
        result = result.replace(callbackStartRegex, callbackToken);
      }
      return `${beforeArrow}${prefix}(${result}) ${suffix}`;
    } else {
      const trimmedTokens = paramTokens.map((p) => p.trim());
      return `${beforeArrow}${prefix}(${trimmedTokens.join(", ")}) ${suffix}`;
    }
  }

  return functionText;
}

// =============================================================================
// Helpers
// =============================================================================

function parseDefaultValue(value: string): TSerializableValue {
  try {
    return JSON.parse(value) as TSerializableValue;
  } catch {
    return value;
  }
}
