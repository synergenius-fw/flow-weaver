/**
 * @module jsdoc-port-sync/sync
 *
 * Bidirectional sync between JSDoc annotations and TypeScript signatures.
 * - syncSignatureToJSDoc: Code → JSDoc (regenerate tags from signature)
 * - syncJSDocToSignature: JSDoc → Code (add params/fields to signature)
 *
 * The steps of each direction live in signature-to-jsdoc / scoped-ports and
 * jsdoc-to-signature / callback-signature; this module only sequences them.
 */

import type { TPortDefinition } from "../ast/types";
import { syncScopeCallbacks } from "./callback-signature";
import { hasOrphanPortLines } from "./incomplete-lines";
import {
  appendParams,
  ensureExecuteParam,
  planSignatureSync,
  resolveSyncPorts,
  syncReturnType,
} from "./jsdoc-to-signature";
import { parsePortsFromFunctionText, updatePortsInFunctionText } from "./port-parser";
import { addMandatoryScopedPorts, collectDeclaredScopes } from "./scoped-ports";
import {
  keepLiveInputs,
  keepLiveOutputs,
  mergeSignatureInputs,
  mergeSignatureOutputs,
  readSignatureShape,
  signatureInputOrder,
} from "./signature-to-jsdoc";

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
  const shape = readSignatureShape(functionText);

  const inputs = keepLiveInputs(mergeSignatureInputs(existingInputs, shape), shape);
  const outputs = keepLiveOutputs(mergeSignatureOutputs(existingOutputs, shape), shape);
  const inputOrder = signatureInputOrder(shape);

  const scopes = collectDeclaredScopes(functionText, inputs, outputs, shape.callbacks);
  addMandatoryScopedPorts(inputs, outputs, scopes);

  return updatePortsInFunctionText(functionText, inputs, outputs, inputOrder);
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
  const { inputs, outputs } = resolveSyncPorts(functionText, authoritativePorts);
  const plan = planSignatureSync(functionText, inputs, outputs);
  if (plan.upToDate) {
    return functionText;
  }

  let result = functionText;
  if (!plan.hasExecuteParam) {
    result = ensureExecuteParam(result, plan.functionType);
  }
  if (plan.paramsToAdd.length > 0) {
    result = appendParams(result, plan.functionType, plan.paramsToAdd);
  }
  if (plan.scopedInputs.length > 0 || plan.scopedOutputs.length > 0) {
    result = syncScopeCallbacks(result, plan.scopedInputs, plan.scopedOutputs, plan.functionType);
  }
  return syncReturnType(result, plan.functionType, plan.nonScopedOutputs);
}
