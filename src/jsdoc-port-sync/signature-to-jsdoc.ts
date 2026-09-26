/**
 * @module jsdoc-port-sync/signature-to-jsdoc
 *
 * The Code → JSDoc steps of `syncSignatureToJSDoc`: decides which ports
 * the TypeScript signature implies, merges them into the ports already tagged
 * in JSDoc, drops tags whose port no longer exists, and works out the order in
 * which the signature lists its inputs.
 */

import type { TPortDefinition } from "../ast/types";
import { isReservedPortName } from "../constants";
import { RESERVED_PARAMS } from "./constants";
import { getIncompletePortNames } from "./incomplete-lines";
import { parseDefaultValue } from "./port-parser";
import {
  type ParsedParam,
  parseFunctionSignature,
  parseReturnFields,
  parseReturnBodyFieldsWithTypes,
  parseReturnTypeFields,
  parseInputTypeFields,
  parseCallbackType,
  rawParamListText,
  tsTypeToPortType,
} from "./signature-parser";

type PortRecord = Record<string, TPortDefinition>;

/** What a callback parameter declares, used to decide which scoped inputs stay. */
export interface CallbackShape {
  hasReturnFields: boolean;
  returnFieldNames: Set<string>;
}

/** Everything the Code → JSDoc sync reads from the function text. */
export interface SignatureShape {
  params: ParsedParam[];
  /** Output field names: the return type annotation when present, else the return statements. */
  returnFields: string[];
  /** Types inferred from `return { ... }` values, keyed by field name. */
  returnBodyFieldTypes: Map<string, string>;
  /** Input fields from a `TFlowWeaverNodeType<{...}, {...}>` annotation. */
  inputTypeFields: Array<{ name: string; tsType: string }>;
  /** Port names on JSDoc lines the user is still typing. */
  incompletePortNames: { inputs: Set<string>; outputs: Set<string> };
  /** Names of the non-callback parameters plus the annotated input fields. */
  signatureParamNames: Set<string>;
  /** The raw text of the parameter list, for checks the parsed params miss. */
  rawSigText: string;
  /** Callback parameters (scopes) by parameter name. */
  callbacks: Map<string, CallbackShape>;
}

const isCallbackParam = (param: ParsedParam): boolean => param.tsType?.includes("=>") ?? false;

/**
 * Read the signature facts the Code → JSDoc sync decides on. When the function
 * has a return type annotation its fields win; otherwise the fields returned
 * from the body are used.
 */
export function readSignatureShape(functionText: string): SignatureShape {
  const { params } = parseFunctionSignature(functionText);

  const hasReturnTypeAnnotation = /\)\s*:\s*\{[^}]+\}\s*(?:\{|=>)/.test(functionText);
  const returnFields = hasReturnTypeAnnotation
    ? parseReturnTypeFields(functionText)
    : parseReturnFields(functionText);

  const signatureParamNames = new Set(
    params
      .filter((p) => !RESERVED_PARAMS.includes(p.name) && !isCallbackParam(p))
      .map((p) => p.name)
  );
  const inputTypeFields = parseInputTypeFields(functionText);
  for (const field of inputTypeFields) {
    signatureParamNames.add(field.name);
  }

  const callbacks = new Map<string, CallbackShape>();
  for (const param of params) {
    if (param.tsType?.includes("=>")) {
      const parsed = parseCallbackType(param.tsType);
      const fieldNames = new Set(parsed.returnFields.map((f) => f.name));
      callbacks.set(param.name, { hasReturnFields: fieldNames.size > 0, returnFieldNames: fieldNames });
    }
  }

  return {
    params,
    returnFields,
    returnBodyFieldTypes: parseReturnBodyFieldsWithTypes(functionText),
    inputTypeFields,
    incompletePortNames: getIncompletePortNames(functionText),
    signatureParamNames,
    rawSigText: rawParamListText(functionText),
    callbacks,
  };
}

/**
 * Merge the signature's parameters into the JSDoc inputs. A parameter without a
 * tag gets a new port typed from the signature; a tagged port takes the
 * signature's type when that type is concrete, except that a STEP port is never
 * downgraded to BOOLEAN. Names on lines still being typed are left alone.
 */
export function mergeSignatureInputs(existingInputs: PortRecord, shape: SignatureShape): PortRecord {
  const { params, inputTypeFields, incompletePortNames } = shape;
  const mergedInputs: PortRecord = { ...existingInputs };
  for (const param of params) {
    if (RESERVED_PARAMS.includes(param.name)) continue;
    if (incompletePortNames.inputs.has(param.name)) continue;

    const signatureType = tsTypeToPortType(param.tsType);

    if (!mergedInputs[param.name]) {
      mergedInputs[param.name] = {
        dataType: signatureType,
        ...(param.optional && { optional: true }),
        ...(param.defaultValue === undefined ? {} : { default: parseDefaultValue(param.defaultValue) }),
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

  for (const field of inputTypeFields) {
    if (!mergedInputs[field.name] && !incompletePortNames.inputs.has(field.name)) {
      mergedInputs[field.name] = { dataType: tsTypeToPortType(field.tsType) };
    }
  }

  return mergedInputs;
}

/**
 * Merge the signature's output fields into the JSDoc outputs. A field without a
 * tag gets a new port typed from its returned value when one can be inferred.
 */
export function mergeSignatureOutputs(existingOutputs: PortRecord, shape: SignatureShape): PortRecord {
  const { returnFields, returnBodyFieldTypes, incompletePortNames } = shape;
  const mergedOutputs: PortRecord = { ...existingOutputs };
  for (const field of returnFields) {
    if (!mergedOutputs[field] && !incompletePortNames.outputs.has(field)) {
      const inferredType = returnBodyFieldTypes.get(field);
      const dataType = inferredType ? tsTypeToPortType(inferredType) : "ANY";
      mergedOutputs[field] = { dataType, ...(inferredType && { tsType: inferredType }) };
    }
  }
  return mergedOutputs;
}

/**
 * Whether a scoped input still has a home: its scope's callback must exist, and
 * when that callback declares return fields the input must be one of them.
 */
function scopedInputIsLive(name: string, port: TPortDefinition, callbacks: Map<string, CallbackShape>): boolean {
  if (!port.scope) return false;
  const scopeCallback = callbacks.get(port.scope);
  if (!scopeCallback) return false;
  return scopeCallback.hasReturnFields ? scopeCallback.returnFieldNames.has(name) : true;
}

/**
 * Keep the inputs the signature still backs. An input survives when it is a
 * parameter, a live scoped input, on a line still being typed, or carries user
 * metadata (order or label) and its name still appears in the raw parameters.
 */
export function keepLiveInputs(mergedInputs: PortRecord, shape: SignatureShape): PortRecord {
  const { signatureParamNames, incompletePortNames, rawSigText, callbacks } = shape;
  const finalInputs: PortRecord = {};
  for (const [name, port] of Object.entries(mergedInputs)) {
    const hasUserMetadata = port.metadata?.order !== undefined || port.label !== undefined;
    const existsInRawSig = new RegExp(`\\b${name}\\b`).test(rawSigText);

    if (
      signatureParamNames.has(name) ||
      scopedInputIsLive(name, port, callbacks) ||
      incompletePortNames.inputs.has(name) ||
      (hasUserMetadata && existsInRawSig)
    ) {
      finalInputs[name] = port;
    }
  }
  return finalInputs;
}

/**
 * Keep the outputs the signature still backs: returned fields, scoped outputs,
 * reserved ports, and names on lines still being typed.
 */
export function keepLiveOutputs(mergedOutputs: PortRecord, shape: SignatureShape): PortRecord {
  const { incompletePortNames } = shape;
  const returnFieldNames = new Set(shape.returnFields);
  const finalOutputs: PortRecord = {};
  for (const [name, port] of Object.entries(mergedOutputs)) {
    if (returnFieldNames.has(name) || port.scope || isReservedPortName(name) || incompletePortNames.outputs.has(name)) {
      finalOutputs[name] = port;
    }
  }
  return finalOutputs;
}

/**
 * The order the signature lists its (non-callback) inputs in, used to place new
 * input tags. The raw parameter text is preferred because it also sees names the
 * parser skipped; the parsed params win when they found more.
 */
export function signatureInputOrder(shape: SignatureShape): string[] {
  const { params, rawSigText } = shape;
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
    .filter((p) => !RESERVED_PARAMS.includes(p.name) && !isCallbackParam(p))
    .map((p) => p.name);

  return rawParamOrder.length >= parsedOrder.length ? rawParamOrder : parsedOrder;
}
