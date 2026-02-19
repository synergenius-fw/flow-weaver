/**
 * @module jsdoc-port-sync/rename
 *
 * Port renaming and code rename synchronization.
 */

import { isReservedPortName } from "../constants";
import {
  parsePortsFromFunctionText,
  hasOrphanPortLines,
} from "./port-parser";
import {
  parseFunctionSignature,
  parseReturnTypeFields,
} from "./signature-parser";

// =============================================================================
// Port Renaming
// =============================================================================

/**
 * Rename a port in both JSDoc and function signature.
 * For input ports: renames @input tag and function parameter
 * For output ports: renames @output tag and return type field
 * For scoped ports: also updates callback parameter/return names
 */
export function renamePortInCode(
  code: string,
  oldPortName: string,
  newPortName: string,
  portType: "input" | "output",
): string {
  const reservedNames = ["execute", "onSuccess", "onFailure"];
  if (reservedNames.includes(oldPortName) || reservedNames.includes(newPortName)) {
    return code;
  }

  const { inputs, outputs } = parsePortsFromFunctionText(code);
  const allPorts = { ...inputs, ...outputs };

  const ports = portType === "input" ? inputs : outputs;
  if (!ports[oldPortName]) {
    return code;
  }

  if (allPorts[newPortName]) {
    return code;
  }

  let result = code;
  const portDef = ports[oldPortName];
  const isScoped = !!portDef.scope;

  // 1. Rename in JSDoc
  const tagType = portType === "input" ? "@input" : "@output";
  const jsDocPattern = new RegExp(
    `(${tagType}\\s+)(\\[?)${oldPortName}(\\]?)`,
    "g",
  );
  result = result.replace(jsDocPattern, `$1$2${newPortName}$3`);

  // 2. Rename in function signature
  if (portType === "input") {
    if (isScoped) {
      result = renameFieldInReturnType(result, oldPortName, newPortName, true);
    } else {
      result = renameParameterInSignature(result, oldPortName, newPortName);
    }
  } else {
    if (isScoped) {
      result = renameCallbackParameter(result, oldPortName, newPortName);
    } else {
      result = renameFieldInReturnType(result, oldPortName, newPortName, false);
    }
  }

  return result;
}

/**
 * Rename a parameter in the function signature
 */
function renameParameterInSignature(
  code: string,
  oldName: string,
  newName: string,
): string {
  const paramPattern = new RegExp(
    `([(,]\\s*)${oldName}(\\s*[?:]|\\s*=)`,
    "g",
  );
  return code.replace(paramPattern, `$1${newName}$2`);
}

/**
 * Remove a parameter from the function signature
 */
function removeParameterFromSignature(code: string, paramName: string): string {
  const middleOrLastPattern = new RegExp(
    `,\\s*${paramName}\\s*[?]?\\s*:\\s*[^,)]+`,
    "g",
  );
  let result = code.replace(middleOrLastPattern, "");

  const firstWithCommaPattern = new RegExp(
    `([(])\\s*${paramName}\\s*[?]?\\s*:\\s*[^,)]+,\\s*`,
    "g",
  );
  result = result.replace(firstWithCommaPattern, "$1");

  const onlyParamPattern = new RegExp(
    `([(])\\s*${paramName}\\s*[?]?\\s*:\\s*[^,)]+\\s*([)])`,
    "g",
  );
  result = result.replace(onlyParamPattern, "$1$2");

  return result;
}

/**
 * Remove a field from the return type annotation
 */
function removeFieldFromReturnType(code: string, fieldName: string): string {
  const middleOrLastPattern = new RegExp(
    `[;,]\\s*${fieldName}\\s*:\\s*[^;,}]+`,
    "g",
  );
  let result = code.replace(middleOrLastPattern, "");

  const firstWithSemiPattern = new RegExp(
    `(\\{\\s*)${fieldName}\\s*:\\s*[^;,}]+[;,]\\s*`,
    "g",
  );
  result = result.replace(firstWithSemiPattern, "$1");

  const onlyFieldPattern = new RegExp(
    `(\\{\\s*)${fieldName}\\s*:\\s*[^;,}]+\\s*(\\})`,
    "g",
  );
  result = result.replace(onlyFieldPattern, "$1$2");

  return result;
}

/**
 * Rename a field in return type: { fieldName: type }
 */
function renameFieldInReturnType(
  code: string,
  oldName: string,
  newName: string,
  isCallback: boolean,
): string {
  if (isCallback) {
    const callbackPattern = new RegExp(
      `(=>\\s*\\{[^}]*?)\\b${oldName}(\\s*:)`,
      "g",
    );
    return code.replace(callbackPattern, `$1${newName}$2`);
  } else {
    const returnPattern = new RegExp(
      `(\\)\\s*:\\s*\\{[^}]*?)\\b${oldName}(\\s*:)`,
      "g",
    );
    return code.replace(returnPattern, `$1${newName}$2`);
  }
}

/**
 * Rename a parameter in a callback signature
 */
function renameCallbackParameter(
  code: string,
  oldName: string,
  newName: string,
): string {
  const callbackParamPattern = new RegExp(
    `(:\\s*\\([^)]*?)\\b${oldName}(\\s*:)`,
    "g",
  );
  return code.replace(callbackParamPattern, `$1${newName}$2`);
}

// =============================================================================
// Helpers for Code Rename Sync
// =============================================================================

function getSyncableInputNames(code: string): string[] {
  const { inputs } = parsePortsFromFunctionText(code);
  return Object.entries(inputs)
    .filter(([name, port]) => !port.scope && !isReservedPortName(name))
    .map(([name]) => name);
}

function getSyncableOutputNames(code: string): string[] {
  const { outputs } = parsePortsFromFunctionText(code);
  return Object.entries(outputs)
    .filter(([name, port]) => !port.scope && !isReservedPortName(name))
    .map(([name]) => name);
}

function getSyncableParamNames(code: string): string[] {
  const { params } = parseFunctionSignature(code);
  return params
    .filter(p => !isReservedPortName(p.name) && !p.tsType?.includes("=>"))
    .map(p => p.name);
}

function getSyncableReturnFieldNames(code: string): string[] {
  const returnTypeFields = parseReturnTypeFields(code);
  return returnTypeFields.filter(f => !isReservedPortName(f));
}

/**
 * Rename a port in JSDoc
 */
function renamePortInJSDoc(
  code: string,
  oldName: string,
  newName: string,
  type: "input" | "output"
): string {
  const tag = type === "input" ? "@input" : "@output";
  const pattern = new RegExp(
    `(${tag}\\s+)${oldName}(\\b)`,
    "g"
  );
  return code.replace(pattern, `$1${newName}$2`);
}

// =============================================================================
// Code Rename Sync
// =============================================================================

/**
 * Sync renames between JSDoc ports and function signature using before/after diff.
 *
 * @param previousCode - The code before the edit
 * @param currentCode - The code after the edit
 * @returns The synchronized code
 */
export function syncCodeRenames(previousCode: string, currentCode: string): string {
  if (!previousCode.trim()) {
    return currentCode;
  }

  const prevOrphanLines = hasOrphanPortLines(previousCode);
  const currOrphanLines = hasOrphanPortLines(currentCode);

  let result = currentCode;

  // === INPUT PORTS ===
  if (currOrphanLines.inputs) {
    const prevJSDocInputs = getSyncableInputNames(previousCode);
    const currJSDocInputs = getSyncableInputNames(currentCode);
    const currSigParams = getSyncableParamNames(currentCode);

    for (const prevName of prevJSDocInputs) {
      if (!currJSDocInputs.includes(prevName) && currSigParams.includes(prevName)) {
        result = removeParameterFromSignature(result, prevName);
      }
    }
  } else if (prevOrphanLines.inputs) {
    // Skip rename detection
  } else {
    const prevJSDocInputs = getSyncableInputNames(previousCode);
    const currJSDocInputs = getSyncableInputNames(currentCode);
    const prevSigParams = getSyncableParamNames(previousCode);
    const currSigParams = getSyncableParamNames(currentCode);

    const prevJSDocSet = new Set(prevJSDocInputs);
    const currJSDocSet = new Set(currJSDocInputs);
    const prevSigSet = new Set(prevSigParams);
    const currSigSet = new Set(currSigParams);

    const sigMatch = currentCode.match(/function\s+\w+\s*\(([^)]*)/s) ||
                     currentCode.match(/=\s*\(([^)]*)\)\s*(?:=>|:)/s);
    const rawSigText = sigMatch?.[1] || "";

    const jsDocPortsInRawButNotParsed = currJSDocInputs.some(name =>
      new RegExp(`\\b${name}\\b`).test(rawSigText) && !currSigSet.has(name)
    );

    if (!jsDocPortsInRawButNotParsed) {
      for (let i = 0; i < Math.min(currJSDocInputs.length, currSigParams.length); i++) {
        const currJSDoc = currJSDocInputs[i];
        const currSig = currSigParams[i];

        if (currJSDoc === currSig) continue;

        const jsDocChanged = prevJSDocInputs[i] !== currJSDoc;
        const sigChanged = prevSigParams[i] !== currSig;

        if (jsDocChanged && !sigChanged) {
          const oldJSDoc = prevJSDocInputs[i];
          if (oldJSDoc && !currJSDocSet.has(oldJSDoc) && !prevJSDocSet.has(currJSDoc)) {
            result = renameParameterInSignature(result, currSig, currJSDoc);
          }
        } else if (sigChanged && !jsDocChanged) {
          const oldSig = prevSigParams[i];
          const oldNameInRawSig = new RegExp(`\\b${oldSig}\\b`).test(rawSigText);
          if (oldSig && !currSigSet.has(oldSig) && !prevSigSet.has(currSig) && !oldNameInRawSig) {
            result = renamePortInJSDoc(result, currJSDoc, currSig, "input");
          }
        }
      }
    }
  }

  // === OUTPUT PORTS ===
  if (currOrphanLines.outputs) {
    const prevJSDocOutputs = getSyncableOutputNames(previousCode);
    const currJSDocOutputs = getSyncableOutputNames(currentCode);
    const currReturnFields = getSyncableReturnFieldNames(currentCode);

    for (const prevName of prevJSDocOutputs) {
      if (!currJSDocOutputs.includes(prevName) && currReturnFields.includes(prevName)) {
        result = removeFieldFromReturnType(result, prevName);
      }
    }
  } else if (prevOrphanLines.outputs) {
    // Skip rename detection
  } else {
    const prevJSDocOutputs = getSyncableOutputNames(previousCode);
    const currJSDocOutputs = getSyncableOutputNames(currentCode);
    const prevReturnFields = getSyncableReturnFieldNames(previousCode);
    const currReturnFields = getSyncableReturnFieldNames(currentCode);

    const prevJSDocSet = new Set(prevJSDocOutputs);
    const currJSDocSet = new Set(currJSDocOutputs);
    const prevReturnSet = new Set(prevReturnFields);
    const currReturnSet = new Set(currReturnFields);

    for (let i = 0; i < Math.min(currJSDocOutputs.length, currReturnFields.length); i++) {
      const currJSDoc = currJSDocOutputs[i];
      const currReturn = currReturnFields[i];

      if (currJSDoc === currReturn) continue;

      const jsDocChanged = prevJSDocOutputs[i] !== currJSDoc;
      const returnChanged = prevReturnFields[i] !== currReturn;

      if (jsDocChanged && !returnChanged) {
        const oldJSDoc = prevJSDocOutputs[i];
        if (oldJSDoc && !currJSDocSet.has(oldJSDoc) && !prevJSDocSet.has(currJSDoc)) {
          result = renameFieldInReturnType(result, currReturn, currJSDoc, false);
        }
      } else if (returnChanged && !jsDocChanged) {
        const oldReturn = prevReturnFields[i];
        if (oldReturn && !currReturnSet.has(oldReturn) && !prevReturnSet.has(currReturn)) {
          result = renamePortInJSDoc(result, currJSDoc, currReturn, "output");
        }
      }
    }
  }

  return result;
}
