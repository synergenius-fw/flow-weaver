/**
 * @module jsdoc-port-sync/callback-signature
 *
 * Writes scoped ports into the node function's callback parameters: for each
 * scope, its scoped outputs become the callback's parameters and its scoped
 * inputs the fields of the callback's return type.
 */

import type { TPortDefinition } from "../ast/types";
import { findBalancedClose, splitParams } from "./constants";
import { buildCallbackType, callbackHasAllPorts } from "./signature-parser";

type PortEntry = [string, TPortDefinition];
type FunctionType = "declaration" | "arrow" | "expression";

/**
 * Update the callback of every scope that has ports. A scope's own name is not
 * a callback parameter, and FUNCTION outputs are not either.
 */
export function syncScopeCallbacks(
  functionText: string,
  scopedInputs: PortEntry[],
  scopedOutputs: PortEntry[],
  functionType: FunctionType
): string {
  const scopeNames = new Set([
    ...scopedInputs.map(([_, port]) => port.scope!),
    ...scopedOutputs.map(([_, port]) => port.scope!),
  ]);

  let result = functionText;
  for (const scopeName of scopeNames) {
    const callbackParams = scopedOutputs.filter(
      ([name, port]) => port.scope === scopeName && port.dataType !== "FUNCTION" && name !== scopeName
    );
    const callbackReturns = scopedInputs.filter(([_, port]) => port.scope === scopeName);

    if (callbackParams.length > 0 || callbackReturns.length > 0) {
      result = updateCallbackInSignature(result, scopeName, callbackParams, callbackReturns, functionType);
    }
  }
  return result;
}

/**
 * Where the parameter list sits and how to put it back: the text before the
 * opening parenthesis (`head`), the parameters, and what follows the closing
 * one (`tail`, starting with the `)`). An arrow function with no `=>` after its
 * parameters has no tail and cannot be rewritten.
 */
interface ParamListSite {
  head: string;
  paramsStr: string;
  tail: string | null;
}

/**
 * Split the function around its parameter list. A declaration is rebuilt as
 * `[async] function name(`; an arrow keeps everything up to `(` and resumes at
 * its `=>`, so anything between `)` and `=>` is dropped. Returns null when the
 * list cannot be found.
 */
function locateParamListSite(text: string, functionType: FunctionType): ParamListSite | null {
  if (functionType === "declaration") {
    const funcMatch = text.match(/((?:async\s+)?function\s+)(\w+)\s*\(/);
    if (!funcMatch || funcMatch.index === undefined) return null;
    const openParenIndex = funcMatch.index + funcMatch[0].length - 1;
    const closeParenIndex = findBalancedClose(text, openParenIndex);
    if (closeParenIndex === -1) return null;
    return {
      head: `${text.substring(0, funcMatch.index)}${funcMatch[1]}${funcMatch[2]}`,
      paramsStr: text.substring(openParenIndex + 1, closeParenIndex),
      tail: `)${text.substring(closeParenIndex + 1)}`,
    };
  }
  if (functionType === "arrow") {
    const arrowMatch = text.match(/((?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?)\(/);
    if (!arrowMatch || arrowMatch.index === undefined) return null;
    const openParenIndex = arrowMatch.index + arrowMatch[0].length - 1;
    const closeParenIndex = findBalancedClose(text, openParenIndex);
    if (closeParenIndex === -1) return null;
    const afterParams = text.substring(closeParenIndex + 1);
    const arrowIndex = afterParams.indexOf("=>");
    return {
      head: `${text.substring(0, arrowMatch.index)}${arrowMatch[1]}`,
      paramsStr: text.substring(openParenIndex + 1, closeParenIndex),
      tail: arrowIndex === -1 ? null : `) ${afterParams.substring(arrowIndex)}`,
    };
  }
  return null;
}

/** Split a `name: type` parameter token into its name and type. */
function splitParamToken(token: string): { paramName: string; existingType: string } {
  const callbackParam = token.trim();
  const colonIndex = callbackParam.indexOf(":");
  return {
    paramName: callbackParam.substring(0, colonIndex).trim(),
    existingType: callbackParam.substring(colonIndex + 1).trim(),
  };
}

/**
 * Update or add the callback parameter for a scope. The first parameter whose
 * type is a function is the scope's callback; when it already has every port it
 * is left alone, otherwise its type is rebuilt keeping its other parameters and
 * return fields. With no callback a new `scopeName: (...) => {...}` is
 * appended. A multi-line parameter list keeps its layout.
 */
function updateCallbackInSignature(
  functionText: string,
  scopeName: string,
  callbackParams: PortEntry[],
  callbackReturns: PortEntry[],
  functionType: FunctionType,
): string {
  const site = locateParamListSite(functionText, functionType);
  if (!site) return functionText;

  const { paramsStr } = site;
  const paramTokens = splitParams(paramsStr);
  const callbackIndex = paramTokens.findIndex((p) => p.includes("=>"));

  if (callbackIndex >= 0) {
    const { existingType } = splitParamToken(paramTokens[callbackIndex]);
    if (callbackHasAllPorts(existingType, callbackParams, callbackReturns)) {
      return functionText;
    }
  }
  const { head, tail } = site;
  if (tail === null) return functionText;

  if (callbackIndex >= 0) {
    const { paramName, existingType } = splitParamToken(paramTokens[callbackIndex]);
    const callbackType = buildCallbackType(callbackParams, callbackReturns, existingType);
    paramTokens[callbackIndex] = `${paramName}: ${callbackType}`;
  } else {
    const callbackType = buildCallbackType(callbackParams, callbackReturns);
    paramTokens.push(`${scopeName}: ${callbackType}`);
  }

  if (paramsStr.includes("\n")) {
    let result = paramsStr;
    const callbackToken = paramTokens[callbackIndex];
    const callbackStartRegex = new RegExp(`(${scopeName}\\s*:\\s*)\\([^)]*\\)\\s*=>\\s*\\{[^}]*\\}`, 's');
    const match = result.match(callbackStartRegex);
    if (match) {
      result = result.replace(callbackStartRegex, callbackToken);
    }
    return `${head}(${result}${tail}`;
  }
  const trimmedTokens = paramTokens.map((p) => p.trim());
  return `${head}(${trimmedTokens.join(", ")}${tail}`;
}
