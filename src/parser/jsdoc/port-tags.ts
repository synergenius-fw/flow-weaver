/**
 * How a port tag becomes a port.
 *
 * Node types declare ports with `@input`, `@output` and `@step`; workflows
 * with `@param` and `@returns`. Each line goes through the port grammar, then
 * this decides the port's type (reserved control ports are always STEP, the
 * rest come from the signature, see signature-types), its label or
 * `Expression:` description, optional flag, default value (JSON when it
 * parses, the raw text otherwise), scope, merge strategy, visibility and
 * order metadata. A second declaration of the same port is a warning and
 * overwrites the first.
 */
import type { JSDocTag } from 'ts-morph';
import type { FunctionLike } from '../function-like';
import type { TDataType, TMergeStrategy, TSerializableValue } from '../../ast/types';
import { isExecutePort, isSuccessPort, isFailurePort, isScopedMandatoryPort } from '../../constants';
import { inferDataTypeFromTS, stripOptionalUndefined } from '../../types/type-mappings';
import { parsePortLine } from '../../chevrotain-parser';
import type { JSDocNodeTypeConfig, JSDocWorkflowConfig } from './config-types';
import {
  unwrapPromise,
  getPropertyType,
  typeScopedPort,
  applyDeclaredType,
  objectFieldPattern,
} from './signature-types';

/**
 * Recover the default expression TypeScript deliberately omits from a
 * JSDocParameterTag's public name/comment fields.
 *
 * For `@param {string} [month=""]`, ts-morph reports the name (`month`) and
 * that it was bracketed, but the `=""` portion is only present in the tag's
 * source text. Flow Weaver needs that expression because it is part of the
 * workflow's public input contract, not merely documentation.
 */
function workflowParameterDefault(tagText: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = tagText.match(new RegExp(`\\[\\s*${escaped}\\s*=\\s*([^\\]\\r\\n]*)\\]`, 'u'));
  return match?.[1]?.trim();
}

/**
 * Parse default value from string
 */
function parseDefaultValue(value: string): TSerializableValue {
  // Try to parse as JSON
  try {
    return JSON.parse(value) as TSerializableValue;
  } catch {
    // Return as string if not valid JSON
    return value;
  }
}

/**
 * Parse @input tag using Chevrotain parser.
 * Supports: @input name, @input [name], @input [name=default]
 * With optional: scope:scopeName, [order:N], [placement:TOP/BOTTOM], - description
 */
export function parseInputTag(
  tag: JSDocTag,
  config: JSDocNodeTypeConfig,
  func: FunctionLike,
  warnings: string[]
): void {
  const comment = tag.getCommentText() || '';

  const result = parsePortLine(`@input ${comment}`, warnings);
  if (!result) {
    return;
  }

  const { name, defaultValue, isOptional, scope, order, mergeStrategy, hidden, description, customMetadata } = result;

  // Infer type from signature or scope callback return type
  let type: TDataType;
  let tsType: string | undefined;
  // Check for STEP ports: execute OR scoped mandatory ports (success, failure with scope)
  const isScopedStepInput = scope && isScopedMandatoryPort(name);
  if (isExecutePort(name) || isScopedStepInput) {
    // E: Warn if user explicitly specified a non-STEP type on a reserved port
    if (result.dataType && result.dataType !== 'STEP') {
      warnings.push(`Port "${name}" is a reserved control port. Its type will always be STEP.`);
    }
    type = 'STEP';
  } else if (scope) {
    ({ type, tsType } = typeScopedPort('INPUT', name, scope, func, warnings));
  } else {
    const param = func.getParameters().find((p) => {
      const pName = p.getName();
      return pName === name || pName === `_${name}`;
    });
    if (param) {
      const rawTsType = param.getType().getText(param);
      tsType =
        param.isOptional() || param.hasInitializer()
          ? stripOptionalUndefined(rawTsType)
          : rawTsType;
      type = inferDataTypeFromTS(tsType);
    } else {
      type = 'ANY';
    }
    type = applyDeclaredType('input', name, result.dataType, type, tsType, func, warnings);
  }

  // Check if description contains an expression
  let label: string | undefined = description?.trim();
  let expression: string | undefined = undefined;

  if (label && label.startsWith('Expression:')) {
    expression = label.substring('Expression:'.length).trim();
    label = undefined;
  }

  // B: Duplicate port detection
  if (Object.prototype.hasOwnProperty.call(config.inputs!, name)) {
    warnings.push(`Duplicate @input "${name}". The second declaration will overwrite the first.`);
  }

  config.inputs![name] = {
    type,
    defaultValue: defaultValue === undefined ? undefined : parseDefaultValue(defaultValue),
    ...(isOptional && { optional: true }),
    label,
    ...(expression && { expression }),
    ...(scope && { scope }),
    ...(mergeStrategy && { mergeStrategy: mergeStrategy as TMergeStrategy }),
    ...(hidden && { hidden }),
    ...((order !== undefined || customMetadata) && {
      metadata: { ...(order !== undefined && { order }), ...customMetadata },
    }),
    ...(tsType && { tsType }),
  };
}

/**
 * Parse @output tag using Chevrotain parser.
 * Supports: @output name, scope:scopeName, [order:N], - description
 */
export function parseOutputTag(
  tag: JSDocTag,
  config: JSDocNodeTypeConfig,
  func: FunctionLike,
  warnings: string[]
): void {
  const comment = tag.getCommentText() || '';

  const result = parsePortLine(`@output ${comment}`, warnings);
  if (!result) {
    return;
  }

  const { name, scope, order, hidden, description, customMetadata } = result;

  // Infer type from return type or scope callback parameter
  let type: TDataType;
  let tsType: string | undefined;
  // Check for STEP ports: onSuccess/onFailure OR scoped mandatory ports (start with scope)
  const isScopedStepOutput = scope && isScopedMandatoryPort(name);
  if (isSuccessPort(name) || isFailurePort(name) || isScopedStepOutput) {
    // E: Warn if user explicitly specified a non-STEP type on a reserved port
    if (result.dataType && result.dataType !== 'STEP') {
      warnings.push(`Port "${name}" is a reserved control port. Its type will always be STEP.`);
    }
    type = 'STEP';
  } else if (scope) {
    ({ type, tsType } = typeScopedPort('OUTPUT', name, scope, func, warnings));
  } else {
    // An async node type returns Promise<{...}>; its outputs are the fields
    // of the resolved value.
    const returnType = unwrapPromise(func.getReturnType());
    // Use ts-morph API to extract property type (handles generics with commas correctly)
    const property = returnType.getProperty(name);
    if (property) {
      const propertyType = getPropertyType(property, returnType);
      if (propertyType) {
        tsType = propertyType.getText(undefined, 0);
        type = inferDataTypeFromTS(tsType);
      } else {
        type = 'ANY';
      }
    } else {
      type = 'ANY';
    }
    type = applyDeclaredType('output', name, result.dataType, type, tsType, func, warnings);
  }

  // B: Duplicate port detection
  if (Object.prototype.hasOwnProperty.call(config.outputs!, name)) {
    warnings.push(`Duplicate @output "${name}". The second declaration will overwrite the first.`);
  }

  config.outputs![name] = {
    type,
    label: description?.trim(),
    ...(scope && { scope }),
    ...(hidden && { hidden }),
    ...((order !== undefined || customMetadata) && {
      metadata: { ...(order !== undefined && { order }), ...customMetadata },
    }),
    ...(tsType && { tsType }),
  };
}

/**
 * Parse @step tag using Chevrotain parser.
 * Used for explicit STEP/control-flow ports that are not reserved.
 */
export function parseStepTag(
  tag: JSDocTag,
  config: JSDocNodeTypeConfig,
  func: FunctionLike,
  warnings: string[]
): void {
  const comment = tag.getCommentText() || '';

  // Use Chevrotain to parse the port content
  const result = parsePortLine(`@step ${comment}`, warnings);
  if (!result) {
    return;
  }

  const { name, description } = result;

  // @step ports are control flow - determine if input or output from signature
  const param = func.getParameters().find((p) => p.getName() === name);

  if (param) {
    // It's an input STEP port
    config.inputs![name] = {
      type: 'STEP',
      label: description?.trim(),
    };
  } else {
    // It's an output STEP port (check return type or assume output)
    config.outputs![name] = {
      type: 'STEP',
      label: description?.trim(),
    };
  }
}

/**
 * Parse @return/@returns tag for workflow functions using Chevrotain.
 * Format: @returns name [order:N] - Description (type inferred from signature)
 */
export function parseReturnTag(
  tag: JSDocTag,
  config: JSDocWorkflowConfig,
  func: FunctionLike | undefined,
  warnings: string[]
): void {
  const comment = tag.getCommentText() || '';

  // Reuse port-parser: @output has same format as @returns
  const result = parsePortLine(`@output ${comment}`, warnings);
  if (!result) {
    return;
  }

  const { name, order, description, customMetadata } = result;

  // Infer type from return type signature
  let type: TDataType = 'ANY';
  if (isSuccessPort(name) || isFailurePort(name)) {
    type = 'STEP';
  } else if (func) {
    const returnType = func.getReturnType();
    const returnTypeText = returnType.getText();
    const fieldMatch = returnTypeText.match(objectFieldPattern(name));
    if (fieldMatch) {
      type = inferDataTypeFromTS(fieldMatch[1].trim());
    } else {
      // G: Type inference fallback to ANY
      warnings.push(`Could not infer type for @returns "${name}", defaulting to ANY.`);
    }
  }

  config.returnPorts = config.returnPorts || {};

  // B: Duplicate port detection
  if (Object.prototype.hasOwnProperty.call(config.returnPorts, name)) {
    warnings.push(`Duplicate @returns "${name}". The second declaration will overwrite the first.`);
  }

  config.returnPorts[name] = {
    dataType: type,
    label: description?.trim(),
    ...((order !== undefined || customMetadata) && {
      metadata: { ...(order !== undefined && { order }), ...customMetadata },
    }),
  };
}

/**
 * Parse @param tag for workflow functions using Chevrotain.
 * Format: @param name [order:N] - Description (type inferred from signature)
 */
export function parseParamTag(
  tag: JSDocTag,
  config: JSDocWorkflowConfig,
  func: FunctionLike | undefined,
  warnings: string[]
): void {
  // For @param tags, ts-morph parses the name separately from the comment
  // The tag's compilerNode may have a name property that we need to extract
  interface JSDocParamTagNode {
    name?: { getText?: () => string };
    isBracketed?: boolean;
  }
  interface JSDocTagWithGetName {
    getName?: () => string;
  }
  const compilerNode = tag.compilerNode as unknown as JSDocParamTagNode;
  const tagWithGetName = tag as unknown as JSDocTagWithGetName;
  const name =
    compilerNode.name?.getText?.() || (tagWithGetName.getName && tagWithGetName.getName());

  if (!name) {
    return;
  }

  // Comment contains: [order:N] - Description (name parsed separately by ts-morph)
  // Prepend name to reuse port-parser
  const comment = tag.getCommentText() || '';
  const result = parsePortLine(`@input ${name} ${comment}`, warnings);

  const order = result?.order;
  const description = result?.description;
  const optional = compilerNode.isBracketed === true;
  const defaultSource = workflowParameterDefault(tag.getText(), name);

  // Infer type from function parameter signature
  let type: TDataType = 'ANY';
  if (isExecutePort(name)) {
    type = 'STEP';
  } else if (func) {
    const params = func.getParameters();
    const paramsParam = params.find((p) => p.getName() === 'params');
    if (paramsParam) {
      const paramType = paramsParam.getType();
      const paramTypeText = paramType.getText();
      // Skip field-matching for catch-all Record types — @param annotations are intentional metadata
      const isCatchAllRecord = (
        /^Record<string,\s*(never|any|unknown)>$/.test(paramTypeText) ||
        paramTypeText === '{}' ||
        /^\{\s*\[[\w]+:\s*string\]:\s*(never|any|unknown);\s*\}$/.test(paramTypeText)
      );
      if (!isCatchAllRecord) {
        const fieldMatch = paramTypeText.match(objectFieldPattern(name));
        if (fieldMatch) {
          type = inferDataTypeFromTS(fieldMatch[1].trim());
        } else {
          // F: @param doesn't match any field in the params object
          // G: Type inference fallback to ANY
          warnings.push(`@param "${name}" does not match any field in the params object. Type defaults to ANY.`);
        }
      }
    }
  }

  config.startPorts = config.startPorts || {};

  // B: Duplicate port detection
  if (Object.prototype.hasOwnProperty.call(config.startPorts, name)) {
    warnings.push(`Duplicate @param "${name}". The second declaration will overwrite the first.`);
  }

  config.startPorts[name] = {
    dataType: type,
    label: description?.trim(),
    ...(optional && { optional: true }),
    ...(defaultSource === undefined ? {} : { default: parseDefaultValue(defaultSource) }),
    ...(order !== undefined && { metadata: { order } }),
  };
}
