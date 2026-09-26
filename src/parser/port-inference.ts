/**
 * Workflow port inference from TypeScript signatures.
 *
 * parseStartPorts / parseExitPorts derive a workflow's Start/Exit port
 * definitions from a function's signature and its parsed @flowWeaver config.
 * extractTypeSchema / isExpandableObjectType / inferPortType map ts-morph Types
 * to Flow Weaver data types, and capitalize is a shared label helper.
 */

import * as path from 'node:path';
import { type Type, type Symbol as TsSymbol } from 'ts-morph';
import type { FunctionLike } from './function-like';
import { jsdocParser } from './jsdoc-parser';
import type { TDataType, TPortDefinition } from '../ast/types';
import { assignImplicitPortOrders } from '../utils/port-ordering';
import { inferDataTypeFromTS, stripOptionalUndefined } from '../types/type-mappings';

export function parseStartPorts(
  fn: FunctionLike,
  config?: ReturnType<typeof jsdocParser.parseWorkflow>
): Record<string, TPortDefinition> {
  const ports: Record<string, TPortDefinition> = {};
  const params = fn.getParameters();

  // New architecture: first parameter should be execute: boolean
  // Second parameter is the params object with data
  if (params.length === 0) {
    // No parameters - just return execute port
    ports.execute = { dataType: 'STEP', label: 'Execute' };
    return ports;
  }

  // Check if first parameter is execute: boolean
  const firstParam = params[0];
  const firstParamName = firstParam.getName();
  const firstParamType = firstParam.getType();
  const firstParamTypeText = firstParamType.getText();

  // Accept "execute: any" (from compiled .js files where types are stripped)
  // when JSDoc @param confirms it as a step port.
  const isExecutePort = firstParamName === 'execute' &&
    (firstParamTypeText === 'boolean' || (firstParamTypeText === 'any' && config?.startPorts?.['execute']));

  if (isExecutePort) {
    // Correct new format: first param is execute
    // Check if JSDoc has explicit metadata override for execute port (from @param annotation)
    if (config?.startPorts && config.startPorts['execute']) {
      ports.execute = {
        dataType: 'STEP',
        tsType: 'boolean',
        ...config.startPorts['execute'],
      };
    } else {
      ports.execute = { dataType: 'STEP', tsType: 'boolean', label: 'Execute' };
    }

    // Extract data ports from parameters beyond execute
    if (params.length > 1) {
      // Filter engine-owned generated ABI parameters from user-visible ports.
      const dataParams = params.slice(1).filter(
        p =>
          p.getName() !== '__runtime__' &&
          !['AbortSignal', 'TDebugger'].includes(p.getType().getText(p))
      );

      // Multiple separate params: each becomes its own port
      // Single param with object type: expand its properties into ports
      const shouldExpandProperties =
        dataParams.length === 1 && isExpandableObjectType(dataParams[0].getType());
      // A single params object with no named properties declares no ports:
      // `Record<string, unknown>`, which compile writes into a workflow that
      // declared none, or `{}`. Read as one port named after the parameter, it
      // made a compiled workflow without params demand a "params" parameter.
      const declaresNoPorts =
        dataParams.length === 1 && isPropertylessObjectType(dataParams[0].getType());

      if (declaresNoPorts) {
        // Nothing to add beyond execute.
      } else if (shouldExpandProperties) {
        const dataParam = dataParams[0];
        const dataParamType = dataParam.getType();
        const properties = dataParamType.getProperties();
        properties.forEach((prop: TsSymbol) => {
          const propName = prop.getName();
          const propType = prop.getTypeAtLocation(dataParam);
          const portType = inferPortType(propType);
          const propTypeText = propType.getText();
          const tsSchema = portType === 'OBJECT' ? extractTypeSchema(propType) : undefined;
          const startPortConfig = config?.startPorts?.[propName];
          ports[propName] = {
            dataType: portType,
            label: startPortConfig?.label || capitalize(propName),
            ...(startPortConfig?.optional === true && { optional: true }),
            ...(startPortConfig !== undefined && Object.hasOwn(startPortConfig, 'default')
              ? { default: startPortConfig.default }
              : {}),
            ...(startPortConfig?.metadata && { metadata: startPortConfig.metadata }),
            ...(propTypeText && { tsType: propTypeText }),
            ...(tsSchema && Object.keys(tsSchema).length > 0 && { tsSchema }),
          };
        });
      } else {
        // Each parameter becomes its own port
        for (const param of dataParams) {
          const paramName = param.getName();
          const paramType = param.getType();
          const portType = inferPortType(paramType);
          const rawParamTypeText = paramType.getText(param);
          const paramTypeText =
            param.isOptional() || param.hasInitializer()
              ? stripOptionalUndefined(rawParamTypeText)
              : rawParamTypeText;
          const tsSchema = portType === 'OBJECT' ? extractTypeSchema(paramType) : undefined;
          const startPortConfig = config?.startPorts?.[paramName];
          ports[paramName] = {
            dataType: portType,
            label: startPortConfig?.label || capitalize(paramName),
            ...(startPortConfig?.optional === true && { optional: true }),
            ...(startPortConfig !== undefined && Object.hasOwn(startPortConfig, 'default')
              ? { default: startPortConfig.default }
              : {}),
            ...(startPortConfig?.metadata && { metadata: startPortConfig.metadata }),
            ...(paramTypeText && { tsType: paramTypeText }),
            ...(tsSchema && Object.keys(tsSchema).length > 0 && { tsSchema }),
          };
        }
      }
    }
  } else {
    // Old format detected - reject it
    throw new Error(
      `Invalid node type function signature for "${fn.getName()}". ` +
        `Expected first parameter to be "execute: boolean", but got "${firstParamName}: ${firstParamTypeText}". ` +
        `Correct format: function ${fn.getName()}(execute: boolean, data: {...}) { ... }`
    );
  }

  // Assign implicit port orders with mandatory port precedence
  assignImplicitPortOrders(ports);

  return ports;
}
export function parseExitPorts(
  fn: FunctionLike,
  config: ReturnType<typeof jsdocParser.parseWorkflow>,
  warnings?: string[]
): Record<string, TPortDefinition> {
  const ports: Record<string, TPortDefinition> = {};
  let returnType = fn.getReturnType();

  // If return type is a Promise, extract the type parameter
  const typeText = returnType?.getText();
  const sourceFile = fn.getSourceFile();
  const filePath = sourceFile?.getFilePath() || 'unknown file';
  const fileName = path.basename(filePath);

  if (!typeText || typeText === 'void') {
    warnings?.push(
      `Could not determine the return type of workflow "${fn.getName()}" in ${fileName}, so it has no Exit ports. ` +
        `Add an explicit return type like: Promise<{ onSuccess: boolean; onFailure: boolean }>`
    );
    return ports;
  }

  if (typeText.startsWith('Promise<')) {
    const typeArgs = returnType.getTypeArguments();
    if (typeArgs && typeArgs.length > 0) {
      returnType = typeArgs[0];
    }
  }

  const properties = returnType.getProperties();
  properties.forEach((prop: TsSymbol) => {
    const propName = prop.getName();
    // Always infer from TypeScript signature, use @returns annotation only for metadata
    // onSuccess/onFailure are always STEP ports regardless of annotations
    if (propName === 'onSuccess' || propName === 'onFailure') {
      const returnPortConfig = config?.returnPorts?.[propName];
      ports[propName] = {
        dataType: 'STEP',
        label: returnPortConfig?.label || (propName === 'onSuccess' ? 'On Success' : 'On Failure'),
        isControlFlow: true,
        ...(propName === 'onFailure' && { failure: true }),
        ...(returnPortConfig?.metadata && { metadata: returnPortConfig.metadata }),
      };
    } else {
      // Auto-infer type from TypeScript signature (more accurate than JSDoc regex)
      const propType = prop.getTypeAtLocation(fn.getTypeResolutionNode());
      const portType = inferPortType(propType);
      const propTypeText = propType.getText();
      // Extract schema for complex types (interfaces/objects)
      const tsSchema = portType === 'OBJECT' ? extractTypeSchema(propType) : undefined;
      const returnPortConfig = config?.returnPorts?.[propName];
      ports[propName] = {
        dataType: portType,
        label: returnPortConfig?.label || capitalize(propName),
        ...(returnPortConfig?.metadata && { metadata: returnPortConfig.metadata }),
        // Include original TS type for rich type display (e.g., "ResearchReport" instead of "object")
        ...(propTypeText && propTypeText !== portType.toLowerCase() && { tsType: propTypeText }),
        // Include schema breakdown for complex types
        ...(tsSchema && Object.keys(tsSchema).length > 0 && { tsSchema }),
      };
    }
  });

  // Assign implicit port orders with mandatory port precedence
  assignImplicitPortOrders(ports);

  return ports;
}
/**
 * Extract schema breakdown for complex types (interfaces/objects).
 * Returns a map of property names to their TypeScript type strings.
 */
function extractTypeSchema(tsType: Type): Record<string, string> | undefined {
  const schema: Record<string, string> = {};
  const properties = tsType.getProperties();

  if (!properties || properties.length === 0) {
    return undefined;
  }

  for (const prop of properties) {
    const propName = prop.getName();
    // Skip internal/private properties
    if (propName.startsWith('_')) continue;

    const propType = prop.getValueDeclaration()?.getType();
    if (propType) {
      schema[propName] = propType.getText();
    } else {
      // Fallback: try to get type from declarations
      const declarations = prop.getDeclarations();
      if (declarations && declarations.length > 0) {
        const decl = declarations[0];
        schema[propName] = decl.getType().getText();
      }
    }
  }

  return Object.keys(schema).length > 0 ? schema : undefined;
}

/**
 * Check if a type should be expanded into individual ports via getProperties().
 * Returns true for object literals and interfaces, false for primitives, arrays,
 * and built-in types whose properties are prototype methods (string, number, etc.).
 */
function isPropertylessObjectType(tsType: Type): boolean {
  return (
    tsType.isObject() &&
    !tsType.isArray() &&
    tsType.getCallSignatures().length === 0 &&
    tsType.getProperties().length === 0
  );
}

function isExpandableObjectType(tsType: Type): boolean {
  const typeText = tsType.getText();
  const primitiveTypes = new Set(['string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'Object']);
  if (primitiveTypes.has(typeText)) return false;
  if (typeText.endsWith('[]') || typeText.startsWith('Array<')) return false;
  return tsType.isObject() && tsType.getProperties().length > 0;
}

function inferPortType(tsType: Type): TDataType {
  const typeText = tsType.getText();
  // Delegate to inferDataTypeFromTS for consistent type mapping
  // This handles all cases: primitives, any, unknown, never, arrays, functions, etc.
  return inferDataTypeFromTS(typeText);
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
