/**
 * @module jsdoc-port-sync
 *
 * Browser-compatible bidirectional sync between JSDoc annotations and TypeScript
 * signatures. Uses regex only - no ts-morph dependency.
 *
 * ## Dual Source of Truth
 *
 * | Aspect         | Source        | Notes |
 * |----------------|---------------|-------|
 * | Port EXISTENCE | **Signature** | Params + return fields define what ports exist |
 * | Port TYPES     | **Signature** | Types inferred from TypeScript signature |
 * | Port METADATA  | **JSDoc**     | Labels, order, placement, scope |
 *
 * ## Sync Flow
 *
 * ```
 * Keystroke → syncJSDocToSignature (preserves signature, adds from JSDoc)
 *
 * Ctrl+P → syncSignatureToJSDoc (regenerates JSDoc) → syncJSDocToSignature
 * ```
 *
 * ## Key Functions
 *
 * - {@link parsePortsFromFunctionText} - Extract ports from JSDoc
 * - {@link syncJSDocToSignature} - JSDoc → Signature (add params/return fields)
 * - {@link syncSignatureToJSDoc} - Signature → JSDoc (regenerate tags)
 * - {@link syncCodeRenames} - Position-based rename detection
 * - {@link computePortsDiff} / {@link applyPortsDiffToCode} - Diff-based updates
 */

// Re-export types
export type { TPortDefinition, TDataType } from "../ast/types";
export type { ParsedParam } from "./signature-parser";
export type { TPortDiff } from "./diff";

// Constants (kept for JSDoc detection/validation - Chevrotain handles parsing)
export {
  JSDOC_BLOCK_REGEX,
  PORT_TAG_REGEX,
  ORPHAN_PORT_LINE_REGEX,
  SCOPE_TAG_REGEX,
  FUNC_DECL_START,
  ARROW_START,
  RETURN_OBJECT_REGEX,
  RESERVED_PARAMS,
  RESERVED_RETURN_FIELDS,
  isReservedStepPort,
  findBalancedClose,
  splitParams,
} from "./constants";

// Chevrotain-based port parsing (replaces regex patterns)
export { parsePortLine, isValidPortLine } from "../chevrotain-parser/port-parser";
export type { PortParseResult } from "../chevrotain-parser/port-parser";

// Signature parsing
export {
  parseFunctionSignature,
  parseReturnFields,
  parseReturnBodyFieldsWithTypes,
  parseReturnTypeFields,
  parseReturnTypeFieldsWithTypes,
  parseInputTypeFields,
  tsTypeToPortType,
  portTypeToTsType,
  parseCallbackType,
  buildCallbackType,
  callbackHasAllPorts,
} from "./signature-parser";

// Port parsing
export {
  hasScopes,
  getScopeNames,
  hasOrphanPortLines,
  getIncompletePortNames,
  parsePortsFromFunctionText,
  updatePortsInFunctionText,
} from "./port-parser";

// Sync functions
export {
  syncSignatureToJSDoc,
  syncJSDocToSignature,
} from "./sync";

// Rename functions
export {
  renamePortInCode,
  syncCodeRenames,
} from "./rename";

// Diff functions
export {
  computePortsDiff,
  formatPortsInFunctionText,
  applyPortsDiffToCode,
} from "./diff";
