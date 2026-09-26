/**
 * @module jsdoc-port-sync/jsdoc-to-signature
 *
 * The JSDoc → Code steps of `syncJSDocToSignature`: decides which ports the
 * signature is missing, and edits the parameter list and return type annotation
 * to add them. It never removes a parameter: the signature is the source of
 * truth for which ports exist, and JSDoc only carries their metadata, so users
 * can add a parameter first and tag it later.
 */

import type { TPortDefinition } from "../ast/types";
import { RESERVED_PARAMS, findBalancedClose } from "./constants";
import { parsePortsFromFunctionText } from "./port-parser";
import {
  parseFunctionSignature,
  parseReturnBodyFieldsWithTypes,
  parseReturnTypeFields,
  portTypeToTsType,
  rawParamListText,
} from "./signature-parser";

type PortRecord = Record<string, TPortDefinition>;
type PortEntry = [string, TPortDefinition];
type FunctionType = "declaration" | "arrow" | "expression";

/** Ports supplied by the caller that override what the JSDoc says. */
export interface AuthoritativePorts {
  inputs?: PortRecord;
  outputs?: PortRecord;
}

/**
 * The ports to sync from: those tagged in JSDoc, each replaced by the caller's
 * authoritative definition when one is given. An output without one picks up
 * the type inferred from its returned value when its tag has no type.
 */
export function resolveSyncPorts(
  functionText: string,
  authoritativePorts?: AuthoritativePorts
): { inputs: PortRecord; outputs: PortRecord } {
  const { inputs: parsedInputs, outputs: parsedOutputs } = parsePortsFromFunctionText(functionText);
  const returnBodyFieldTypes = parseReturnBodyFieldsWithTypes(functionText);

  const inputs: PortRecord = {};
  for (const [name, port] of Object.entries(parsedInputs)) {
    inputs[name] = authoritativePorts?.inputs?.[name] ?? port;
  }
  const outputs: PortRecord = {};
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
  return { inputs, outputs };
}

/** What the JSDoc → Code sync will change. */
export interface SignatureSyncPlan {
  functionType: FunctionType;
  hasExecuteParam: boolean;
  /** Non-scoped inputs with no parameter yet, in `[order:N]` order. */
  paramsToAdd: Array<{ name: string; port: TPortDefinition }>;
  nonScopedOutputs: PortRecord;
  scopedInputs: PortEntry[];
  scopedOutputs: PortEntry[];
  /** True when nothing needs to change and the text can be returned as is. */
  upToDate: boolean;
}

const MANDATORY_RETURN_FIELDS = new Set(["onSuccess", "onFailure"]);

/** The `[order:N]` of a port, or Infinity when it has none. */
function portOrder(port: TPortDefinition): number {
  const order = port.metadata?.order;
  return typeof order === "number" ? order : Infinity;
}

/**
 * Compare the ports with the signature and decide what to change: which
 * parameters to add, whether `execute` is missing, which outputs and scoped
 * ports must be written into the signature, and whether the text is already
 * up to date.
 */
export function planSignatureSync(functionText: string, inputs: PortRecord, outputs: PortRecord): SignatureSyncPlan {
  const { params, functionType } = parseFunctionSignature(functionText);

  const orderedInputs = Object.entries(inputs)
    .filter(([_, port]) => !port.scope)
    .map(([name, port]) => ({ name, port, order: portOrder(port) }))
    .sort((a, b) => a.order - b.order);

  // Parameter names the parser found, plus any the raw text shows
  const existingParamNames = new Set(params.map((p) => p.name));
  for (const match of rawParamListText(functionText).matchAll(/\b(\w+)\s*[?:]/g)) {
    existingParamNames.add(match[1]);
  }

  const paramsToAdd = orderedInputs.filter(
    ({ name }) => !existingParamNames.has(name) && !RESERVED_PARAMS.includes(name)
  );

  const nonScopedOutputs = Object.fromEntries(
    Object.entries(outputs).filter(([_, port]) => !port.scope)
  );
  const scopedInputs = Object.entries(inputs).filter(([_, port]) => port.scope);
  const scopedOutputs = Object.entries(outputs).filter(([_, port]) => port.scope);
  const hasScopedPorts = scopedInputs.length > 0 || scopedOutputs.length > 0;

  const hasSyncableOutputs = Object.keys(nonScopedOutputs).length > 0;
  const hasExecuteParam = existingParamNames.has("execute");

  const jsDocOutputNames = new Set(Object.keys(nonScopedOutputs));
  const hasOutputsToRemove = parseReturnTypeFields(functionText).some(
    (field) => !jsDocOutputNames.has(field) && !MANDATORY_RETURN_FIELDS.has(field)
  );

  return {
    functionType,
    hasExecuteParam,
    paramsToAdd,
    nonScopedOutputs,
    scopedInputs,
    scopedOutputs,
    upToDate: paramsToAdd.length === 0 && !hasScopedPorts && !hasSyncableOutputs && !hasOutputsToRemove && hasExecuteParam,
  };
}

/**
 * Find the parentheses of the node function's own parameter list.
 * Returns null for function expressions or when the list is unbalanced.
 */
function locateParamList(text: string, functionType: FunctionType): { open: number; close: number } | null {
  let match: RegExpMatchArray | null = null;
  if (functionType === "declaration") {
    match = text.match(/function\s+\w+\s*\(/);
  } else if (functionType === "arrow") {
    match = text.match(/(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/);
  }
  if (!match || match.index === undefined) return null;
  const open = match.index + match[0].length - 1;
  const close = findBalancedClose(text, open);
  return close === -1 ? null : { open, close };
}

/** Insert `execute: boolean` as the first parameter. */
export function ensureExecuteParam(text: string, functionType: FunctionType): string {
  const list = locateParamList(text, functionType);
  if (!list) return text;
  const existingParams = text.substring(list.open + 1, list.close).trim();
  const sep = existingParams ? ", " : "";
  return (
    text.substring(0, list.open + 1) +
    "execute: boolean" +
    sep +
    text.substring(list.open + 1)
  );
}

/** Render a port as a parameter: `name: T`, `name?: T`, or `name: T = default` when optional with a default. */
function formatParam({ name, port }: { name: string; port: TPortDefinition }): string {
  const tsType = portTypeToTsType(port.dataType);
  if (port.optional && port.default !== undefined) {
    return `${name}: ${tsType} = ${JSON.stringify(port.default)}`;
  } else if (port.optional) {
    return `${name}?: ${tsType}`;
  }
  return `${name}: ${tsType}`;
}

/**
 * Append parameters to the end of the list, following its layout: a list with
 * a trailing comma or spanning several lines gets the new ones on a new line.
 */
export function appendParams(
  text: string,
  functionType: FunctionType,
  paramsToAdd: Array<{ name: string; port: TPortDefinition }>
): string {
  const newParamStrings = paramsToAdd.map(formatParam);
  const list = locateParamList(text, functionType);
  if (!list) return text;

  let existingParams = text.substring(list.open + 1, list.close);
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
  return (
    text.substring(0, list.open + 1) +
    existingParams +
    sep +
    newParamStrings.join(", ") +
    "\n" +
    text.substring(list.close)
  );
}

/**
 * The return type fields to write: the existing annotation's fields with
 * `onSuccess` and `onFailure` first (added as boolean when missing), then any
 * output not yet listed, typed from its tsType or port type. Existing field
 * types are kept.
 */
function returnTypeFieldList(text: string, nonScopedOutputs: PortRecord): string[] {
  const existingFields: Map<string, string> = new Map();
  const existingReturnTypeMatch = text.match(/\)\s*:\s*\{([^}]*)\}/);
  if (existingReturnTypeMatch) {
    for (const match of existingReturnTypeMatch[1].matchAll(/(\w+)\s*:\s*([^;}\s][^;}]*)?/g)) {
      existingFields.set(match[1], match[2]?.trim() || "");
    }
  }

  if (!existingFields.has("onSuccess")) {
    existingFields.set("onSuccess", "boolean");
  }
  if (!existingFields.has("onFailure")) {
    existingFields.set("onFailure", "boolean");
  }

  for (const [name, port] of Object.entries(nonScopedOutputs)) {
    if (name === "onSuccess" || name === "onFailure") continue;
    if (!existingFields.get(name)) {
      existingFields.set(name, port.tsType || portTypeToTsType(port.dataType));
    }
  }

  const allFields: string[] = [];
  allFields.push(`onSuccess: ${existingFields.get("onSuccess")}`);
  allFields.push(`onFailure: ${existingFields.get("onFailure")}`);
  for (const [name, type] of existingFields) {
    if (name === "onSuccess" || name === "onFailure") continue;
    allFields.push(type ? `${name}: ${type}` : `${name}:`);
  }
  return allFields;
}

/**
 * Write the return type annotation `{ onSuccess; onFailure; ...outputs }` after
 * the parameter list, replacing an existing object annotation there.
 */
export function syncReturnType(text: string, functionType: FunctionType, nonScopedOutputs: PortRecord): string {
  const returnType = `{ ${returnTypeFieldList(text, nonScopedOutputs).join("; ")} }`;

  const list = locateParamList(text, functionType);
  if (!list) return text;

  const afterParen = text.substring(list.close + 1);
  const existingReturnMatch = afterParen.match(/^\s*:\s*\{[^}]*\}/);
  if (existingReturnMatch) {
    return (
      text.substring(0, list.close + 1) +
      ": " +
      returnType +
      afterParen.substring(existingReturnMatch[0].length)
    );
  }
  const leading = afterParen.match(/^\s*/);
  const whitespace = leading ? leading[0] : " ";
  return (
    text.substring(0, list.close + 1) +
    ": " +
    returnType +
    whitespace +
    afterParen.substring(whitespace.length)
  );
}
