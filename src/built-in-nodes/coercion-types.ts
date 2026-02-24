/**
 * Synthetic node type definitions for explicit type coercion.
 *
 * These are compiler-internal node types created by @coerce macros.
 * They generate inline JavaScript coercion expressions instead of function calls.
 */

import type { TNodeTypeAST, TCoerceTargetType, TDataType } from '../ast/types';

/** Maps coercion target type keyword to the synthetic node type name */
export const COERCE_TYPE_MAP: Record<TCoerceTargetType, string> = {
  string: '__fw_toString',
  number: '__fw_toNumber',
  boolean: '__fw_toBoolean',
  json: '__fw_toJSON',
  object: '__fw_parseJSON',
};

/** Maps synthetic node type name to the inline JS expression */
export const COERCE_EXPRESSIONS: Record<string, string> = {
  __fw_toString: 'String',
  __fw_toNumber: 'Number',
  __fw_toBoolean: 'Boolean',
  __fw_toJSON: 'JSON.stringify',
  __fw_parseJSON: 'JSON.parse',
};

function makeCoercionNodeType(
  name: string,
  outputType: TDataType,
  outputTsType: string,
): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    expression: true,
    isAsync: false,
    hasSuccessPort: true,
    hasFailurePort: true,
    executeWhen: 'CONJUNCTION',
    variant: 'COERCION',
    inputs: {
      execute: { dataType: 'STEP', label: 'Execute' },
      value: { dataType: 'ANY', label: 'Value', tsType: 'unknown' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP', label: 'On Success', isControlFlow: true },
      onFailure: { dataType: 'STEP', label: 'On Failure', failure: true, isControlFlow: true },
      result: { dataType: outputType, label: 'Result', tsType: outputTsType },
    },
    visuals: {
      color: '#0d9488',
      icon: 'transform',
      tags: [{ label: 'coerce' }],
    },
  };
}

export const COERCION_NODE_TYPES: Record<string, TNodeTypeAST> = {
  __fw_toString: makeCoercionNodeType('__fw_toString', 'STRING', 'string'),
  __fw_toNumber: makeCoercionNodeType('__fw_toNumber', 'NUMBER', 'number'),
  __fw_toBoolean: makeCoercionNodeType('__fw_toBoolean', 'BOOLEAN', 'boolean'),
  __fw_toJSON: makeCoercionNodeType('__fw_toJSON', 'STRING', 'string'),
  __fw_parseJSON: makeCoercionNodeType('__fw_parseJSON', 'OBJECT', 'object'),
};

/** Check if a function name is a coercion node type */
export function isCoercionNode(functionName: string): boolean {
  return functionName in COERCION_NODE_TYPES;
}
