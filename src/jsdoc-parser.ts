/**
 * JSDoc annotation parser for Flow Weaver
 *
 * Parses @flowWeaver annotations from JSDoc comments.
 */

import type { JSDocTag, Type, Symbol as TsMorphSymbol } from 'ts-morph';
import type { FunctionLike } from './function-like';
import type { TDataType, TPortConfig, TMergeStrategy, TNodeTagAST } from './ast/types';
import { isExecutePort, isSuccessPort, isFailurePort, isScopedMandatoryPort } from './constants';
import { inferDataTypeFromTS } from './type-mappings';
import {
  parsePortLine,
  parseNodeLine,
  parseConnectLine,
  parsePositionLine,
  parseScopeLine,
  parseMapLine,
  parsePathLine,
  parseFanOutLine,
  parseFanInLine,
  parseCoerceLine,
  parseTriggerLine,
  parseCancelOnLine,
  parseThrottleLine,
} from './chevrotain-parser';

/**
 * Extract the type of a field from a callback's return type using ts-morph Type API.
 *
 * For scoped INPUT ports, we need to find the return type of the callback and extract
 * the type of a specific field from that return type object.
 *
 * @param callbackType - The Type of the callback parameter
 * @param fieldName - The name of the field to extract from the return type
 * @returns The TypeScript type string, or undefined if extraction fails
 */
function extractCallbackReturnFieldType(callbackType: Type, fieldName: string): string | undefined {
  // Get call signatures from the callback type
  const callSignatures = callbackType.getCallSignatures();
  if (callSignatures.length === 0) {
    return undefined;
  }

  // Use the first call signature (callbacks typically have one)
  let returnType = callSignatures[0].getReturnType();

  // Unwrap Promise<T> to get T - async callbacks return Promise<{...}>
  const returnTypeText = returnType.getText();
  if (returnTypeText.startsWith('Promise<')) {
    const typeArgs = returnType.getTypeArguments();
    if (typeArgs.length > 0) {
      returnType = typeArgs[0];
    }
  }

  // Get the property from the return type
  const property = returnType.getProperty(fieldName);
  if (!property) {
    return undefined;
  }

  // Get the type of the property
  const propertyType = getPropertyType(property, returnType);
  if (!propertyType) {
    return undefined;
  }

  // Get the type text - use getText() which handles complex types properly
  // Pass undefined to avoid import path expansion
  return propertyType.getText(undefined, 0);
}

/**
 * Get the type of a property Symbol.
 */
function getPropertyType(property: TsMorphSymbol, containerType: Type): Type | undefined {
  // Try to get the type via getTypeAtLocation on the value declaration
  const valueDecl = property.getValueDeclaration();
  if (valueDecl) {
    return valueDecl.getType();
  }

  // Fallback: get the declared type from the container
  const declaredType = containerType.getPropertyOrThrow(property.getName());
  if (declaredType) {
    // This returns a Symbol, get its type via declarations
    const decls = declaredType.getDeclarations();
    if (decls.length > 0) {
      return decls[0].getType();
    }
  }

  return undefined;
}

/**
 * Extract the type of a parameter from a callback's parameter list using ts-morph Type API.
 *
 * For scoped OUTPUT ports, we need to find the parameters of the callback and extract
 * the type of a specific parameter by name.
 *
 * @param callbackType - The Type of the callback parameter
 * @param paramName - The name of the parameter to extract
 * @returns The TypeScript type string, or undefined if extraction fails
 */
function extractCallbackParamType(callbackType: Type, paramName: string): string | undefined {
  // Get call signatures from the callback type
  const callSignatures = callbackType.getCallSignatures();
  if (callSignatures.length === 0) {
    return undefined;
  }

  // Use the first call signature
  const parameters = callSignatures[0].getParameters();

  // Find the parameter by name
  for (const param of parameters) {
    if (param.getName() === paramName) {
      const valueDecl = param.getValueDeclaration();
      if (valueDecl) {
        const paramType = valueDecl.getType();
        return paramType.getText(undefined, 0);
      }
    }
  }

  return undefined;
}

export interface JSDocNodeTypeConfig {
  name?: string;
  label?: string;
  description?: string;
  color?: string;
  icon?: string;
  tags?: Array<{ label: string; tooltip?: string }>;
  executeWhen?: string;
  scope?: string;
  expression?: boolean;
  defaultConfig?: {
    pullExecution?: { triggerPort: string };
    label?: string;
    description?: string;
  };
  inputs?: Record<
    string,
    {
      type: TDataType;
      defaultValue?: unknown;
      optional?: boolean;
      label?: string;
      expression?: string;
      scope?: string;
      mergeStrategy?: TMergeStrategy;
      metadata?: { order?: number };
      tsType?: string;
    }
  >;
  outputs?: Record<
    string,
    {
      type: TDataType;
      label?: string;
      scope?: string;
      metadata?: { order?: number };
      tsType?: string;
    }
  >;
}

export interface JSDocWorkflowConfig {
  name?: string;
  description?: string;
  strictTypes?: boolean;
  /** NPM package imports - external node types persisted in JSDoc */
  imports?: Array<{
    name: string; // e.g., "npm/autoprefixer/autoprefixer"
    functionName: string; // e.g., "autoprefixer"
    importSource: string; // e.g., "autoprefixer"
  }>;
  instances?: Array<{
    id: string;
    type: string;
    parentScope?: string;
    label?: string;
    portConfigs?: TPortConfig[];
    pullExecution?: { triggerPort: string };
    minimized?: boolean;
    color?: string;
    icon?: string;
    tags?: TNodeTagAST[];
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    sourceLocation?: { line: number; column: number };
  }>;
  connections?: Array<{
    from: { node: string; port: string; scope?: string };
    to: { node: string; port: string; scope?: string };
    sourceLocation?: { line: number; column: number };
  }>;
  scopes?: Record<string, string[]>;
  layout?: Record<string, { x: number; y: number }>;
  startPorts?: Record<
    string,
    { dataType?: TDataType; label?: string; metadata?: { order?: number } }
  >;
  returnPorts?: Record<
    string,
    { dataType: TDataType; label?: string; metadata?: { order?: number } }
  >;
  positions?: Record<string, { x: number; y: number }>;
  /** When true, auto-wire linear connections between nodes in declaration order */
  autoConnect?: boolean;
  /** @map sugar macros that expand to full scope patterns */
  maps?: Array<{
    instanceId: string;
    childId: string;
    sourceNode: string;
    sourcePort: string;
    inputPort?: string;
    outputPort?: string;
  }>;
  /** @path sugar macros that expand to multi-step execution routes with scope walking */
  paths?: Array<{
    steps: Array<{ node: string; route?: 'ok' | 'fail' }>;
  }>;
  /** @fanOut macros that expand to 1-to-N connections */
  fanOuts?: Array<{
    source: { node: string; port: string };
    targets: Array<{ node: string; port?: string }>;
  }>;
  /** @fanIn macros that expand to N-to-1 connections */
  fanIns?: Array<{
    sources: Array<{ node: string; port?: string }>;
    target: { node: string; port: string };
  }>;
  /** @coerce macros that expand to synthetic coercion nodes + connections */
  coercions?: Array<{
    instanceId: string;
    source: { node: string; port: string };
    target: { node: string; port: string };
    targetType: 'string' | 'number' | 'boolean' | 'json' | 'object';
  }>;
  /** @trigger annotation — event name and/or cron schedule */
  trigger?: { event?: string; cron?: string };
  /** @cancelOn annotation — cancel on matching external event */
  cancelOn?: { event: string; match?: string; timeout?: string };
  /** @retries annotation — retry count */
  retries?: number;
  /** @timeout annotation — function-level timeout */
  timeout?: string;
  /** @throttle annotation — rate limiting */
  throttle?: { limit: number; period?: string };
}

export interface JSDocPatternConfig {
  name?: string;
  description?: string;
  instances?: Array<{ id: string; nodeType: string; config?: { x?: number; y?: number } }>;
  connections?: Array<{ from: { node: string; port: string }; to: { node: string; port: string } }>;
  ports?: Array<{ direction: 'IN' | 'OUT'; name: string; description?: string }>;
  positions?: Record<string, { x: number; y: number }>;
}

export class JSDocParser {
  /**
   * Parse @flowWeaver nodeType from JSDoc comments
   */
  parseNodeType(func: FunctionLike, warnings: string[]): JSDocNodeTypeConfig | null {
    const jsdocs = func.getJsDocs();
    if (jsdocs.length === 0) return null;

    // Find the JSDoc block that contains @flowWeaver nodeType
    let jsdoc = null;
    let flowWeaverTag = null;

    for (const doc of jsdocs) {
      const tags = doc.getTags();
      const tag = tags.find(
        (t) => t.getTagName() === 'flowWeaver' && t.getCommentText()?.trim() === 'nodeType'
      );
      if (tag) {
        jsdoc = doc;
        flowWeaverTag = tag;
        break;
      }
    }

    if (!jsdoc || !flowWeaverTag) return null;

    const tags = jsdoc.getTags();

    const config: JSDocNodeTypeConfig = {
      inputs: {},
      outputs: {},
    };

    // Extract description from JSDoc comment text (before tags)
    const descriptionText = jsdoc.getDescription();
    if (descriptionText && descriptionText.trim()) {
      config.description = descriptionText.trim();
    }

    // Parse tags
    tags.forEach((tag) => {
      const tagName = tag.getTagName();
      const comment = tag.getCommentText() || '';

      switch (tagName) {
        case 'name':
          config.name = comment.trim();
          break;

        case 'label':
          config.label = comment.trim();
          break;

        case 'description':
          config.description = comment.trim();
          break;

        case 'color':
          config.color = comment.trim();
          break;

        case 'icon':
          config.icon = comment.trim();
          break;

        case 'tag':
          config.tags = config.tags || [];
          const tagMatch = comment.match(/^(\S+)(?:\s+"([^"]+)")?$/);
          if (tagMatch) {
            config.tags.push({
              label: tagMatch[1],
              ...(tagMatch[2] && { tooltip: tagMatch[2] }),
            });
          }
          break;

        case 'executeWhen':
          config.executeWhen = comment.trim();
          break;

        case 'scope':
          config.scope = comment.trim();
          break;

        case 'expression':
          config.expression = true;
          break;

        case 'pullExecution':
          const pullValue = comment.trim();
          if (pullValue) {
            config.defaultConfig = config.defaultConfig || {};
            config.defaultConfig.pullExecution = { triggerPort: pullValue };
          }
          break;

        case 'input':
          this.parseInputTag(tag, config, func, warnings);
          break;

        case 'output':
          this.parseOutputTag(tag, config, func, warnings);
          break;

        case 'step':
          this.parseStepTag(tag, config, func, warnings);
          break;
      }
    });

    return config;
  }

  /**
   * Parse @flowWeaver workflow from JSDoc comments
   */
  parseWorkflow(func: FunctionLike, warnings: string[]): JSDocWorkflowConfig | null {
    const jsdocs = func.getJsDocs();
    if (jsdocs.length === 0) return null;

    // Find the JSDoc block that contains @flowWeaver workflow
    let jsdoc = null;
    let flowWeaverTag = null;

    for (const doc of jsdocs) {
      const tags = doc.getTags();
      const tag = tags.find(
        (t) => t.getTagName() === 'flowWeaver' && t.getCommentText()?.trim() === 'workflow'
      );
      if (tag) {
        jsdoc = doc;
        flowWeaverTag = tag;
        break;
      }
    }

    if (!jsdoc || !flowWeaverTag) return null;

    const tags = jsdoc.getTags();

    const config: JSDocWorkflowConfig = {
      imports: [],
      instances: [],
      connections: [],
      scopes: {},
      positions: {},
    };

    // Parse tags
    tags.forEach((tag) => {
      const tagName = tag.getTagName();
      const comment = tag.getCommentText() || '';

      switch (tagName) {
        case 'name':
          config.name = comment.trim();
          break;

        case 'fwImport':
          // Parse @fwImport nodeName functionName from "packageName"
          // Example: @fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"
          this.parseImportTag(tag, config, warnings);
          break;

        case 'description':
          config.description = comment.trim();
          break;

        case 'strictTypes':
          // @strictTypes with no value or any truthy value = true
          // @strictTypes false = false
          config.strictTypes = comment.trim().toLowerCase() !== 'false';
          break;

        case 'autoConnect':
          // @autoConnect enables automatic linear connection wiring
          // OPT-IN: only applies when present, without it behavior is unchanged
          config.autoConnect = true;
          break;

        case 'node':
          this.parseNodeTag(tag, config, warnings);
          break;

        case 'position':
          this.parsePositionTag(tag, config, warnings);
          break;

        case 'connect':
          this.parseConnectTag(tag, config, warnings);
          break;

        case 'scope':
          this.parseScopeTag(tag, config, warnings);
          break;

        case 'map':
          this.parseMapTag(tag, config, warnings);
          break;

        case 'path':
          this.parsePathTag(tag, config, warnings);
          break;

        case 'fanOut':
          this.parseFanOutTag(tag, config, warnings);
          break;

        case 'fanIn':
          this.parseFanInTag(tag, config, warnings);
          break;

        case 'coerce':
          this.parseCoerceTag(tag, config, warnings);
          break;

        case 'trigger':
          this.parseTriggerTag(tag, config, warnings);
          break;

        case 'cancelOn':
          this.parseCancelOnTag(tag, config, warnings);
          break;

        case 'retries': {
          const n = parseInt(comment.trim(), 10);
          if (!isNaN(n) && n >= 0) config.retries = n;
          else warnings.push(`Invalid @retries value: "${comment.trim()}". Expected non-negative integer.`);
          break;
        }

        case 'timeout': {
          const val = comment.trim().replace(/^["']|["']$/g, '');
          if (val) config.timeout = val;
          break;
        }

        case 'throttle':
          this.parseThrottleTag(tag, config, warnings);
          break;

        case 'param':
          this.parseParamTag(tag, config, func, warnings);
          break;

        case 'return':
        case 'returns':
          this.parseReturnTag(tag, config, func, warnings);
          break;
      }
    });

    return config;
  }

  /**
   * Parse @flowWeaver pattern from JSDoc comments
   */
  parsePattern(func: FunctionLike, warnings: string[]): JSDocPatternConfig | null {
    const jsdocs = func.getJsDocs();
    if (jsdocs.length === 0) return null;

    // Find the JSDoc block that contains @flowWeaver pattern
    let jsdoc = null;
    let flowWeaverTag = null;

    for (const doc of jsdocs) {
      const tags = doc.getTags();
      const tag = tags.find(
        (t) => t.getTagName() === 'flowWeaver' && t.getCommentText()?.trim() === 'pattern'
      );
      if (tag) {
        jsdoc = doc;
        flowWeaverTag = tag;
        break;
      }
    }

    if (!jsdoc || !flowWeaverTag) return null;

    const tags = jsdoc.getTags();

    const config: JSDocPatternConfig = {
      instances: [],
      connections: [],
      ports: [],
      positions: {},
    };

    // Parse tags
    tags.forEach((tag) => {
      const tagName = tag.getTagName();
      const comment = tag.getCommentText() || '';

      switch (tagName) {
        case 'name':
          config.name = comment.trim();
          break;

        case 'description':
          config.description = comment.trim();
          break;

        case 'node':
          this.parsePatternNodeTag(tag, config, warnings);
          break;

        case 'position':
          this.parsePatternPositionTag(tag, config, warnings);
          break;

        case 'connect':
          this.parsePatternConnectTag(tag, config, warnings);
          break;

        case 'port':
          this.parsePatternPortTag(tag, config, warnings);
          break;
      }
    });

    // Apply positions to instances
    if (config.positions && config.instances) {
      for (const instance of config.instances) {
        const pos = config.positions[instance.id];
        if (pos) {
          instance.config = instance.config || {};
          instance.config.x = pos.x;
          instance.config.y = pos.y;
        }
      }
    }

    return config;
  }

  /**
   * Parse @node tag for patterns.
   * Format: @node instanceId nodeType
   */
  private parsePatternNodeTag(tag: JSDocTag, config: JSDocPatternConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';

    const result = parseNodeLine(`@node ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @node tag format in pattern: ${comment}`);
      return;
    }

    const { instanceId, nodeType } = result;

    config.instances!.push({
      id: instanceId,
      nodeType: nodeType,
    });
  }

  /**
   * Parse @position tag for patterns.
   * Format: @position nodeId x y
   */
  private parsePatternPositionTag(
    tag: JSDocTag,
    config: JSDocPatternConfig,
    warnings: string[]
  ): void {
    const comment = tag.getCommentText() || '';

    const result = parsePositionLine(`@position ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @position tag format in pattern: ${comment}`);
      return;
    }

    const { nodeId, x, y } = result;
    config.positions![nodeId] = { x, y };
  }

  /**
   * Parse @connect tag for patterns.
   * Supports IN/OUT pseudo-nodes: IN.port -> node.port, node.port -> OUT.port
   */
  private parsePatternConnectTag(
    tag: JSDocTag,
    config: JSDocPatternConfig,
    warnings: string[]
  ): void {
    const comment = tag.getCommentText() || '';

    const result = parseConnectLine(`@connect ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @connect tag format in pattern: ${comment}`);
      return;
    }

    const { source, target } = result;

    config.connections!.push({
      from: { node: source.nodeId, port: source.portName },
      to: { node: target.nodeId, port: target.portName },
    });
  }

  /**
   * Parse @port tag for patterns.
   * Format: @port IN.name - description OR @port OUT.name - description
   */
  private parsePatternPortTag(tag: JSDocTag, config: JSDocPatternConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';

    // Parse format: IN.name - description OR OUT.name - description
    const match = comment.match(/^(IN|OUT)\.(\w+)\s*(?:-\s*(.*))?$/);
    if (!match) {
      warnings.push(`Invalid @port tag format in pattern: ${comment}`);
      return;
    }

    const [, direction, name, description] = match;

    config.ports!.push({
      direction: direction as 'IN' | 'OUT',
      name,
      description: description?.trim(),
    });
  }

  /**
   * Parse @input tag using Chevrotain parser.
   * Supports: @input name, @input [name], @input [name=default]
   * With optional: scope:scopeName, [order:N], [placement:TOP/BOTTOM], - description
   */
  private parseInputTag(
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

    const { name, defaultValue, isOptional, scope, order, mergeStrategy, description } = result;

    // Infer type from signature or scope callback return type
    let type: TDataType;
    let tsType: string | undefined;
    // Check for STEP ports: execute OR scoped mandatory ports (success, failure with scope)
    const isScopedStepInput = scope && isScopedMandatoryPort(name);
    if (isExecutePort(name) || isScopedStepInput) {
      type = 'STEP';
    } else if (scope) {
      // For scoped INPUT ports, look up type from the scope callback's return type
      // The scope name matches a function parameter that is a callback
      // Scoped INPUT ports become the callback's return values
      const scopeParam = func.getParameters().find((p) => p.getName() === scope);
      if (scopeParam) {
        const scopeParamType = scopeParam.getType();

        // Use ts-morph Type API to extract the return field type
        // This handles complex types (generics, nested objects) that regex can't
        const extractedType = extractCallbackReturnFieldType(scopeParamType, name);
        if (extractedType) {
          tsType = extractedType;
          type = inferDataTypeFromTS(tsType);
        } else {
          // Emit warning when type inference fails for a scoped INPUT port
          const nodeTypeName = func.getName() || 'unknown';
          warnings.push(
            `Cannot infer type for scoped INPUT port '${name}' in scope '${scope}' of node type '${nodeTypeName}'. ` +
              `The callback parameter '${scope}' should have a return type that includes '${name}'. ` +
              `Consider adding an explicit type annotation to the callback signature.`
          );
          type = 'ANY';
        }
      } else {
        // Scope callback parameter not found - emit warning
        const nodeTypeName = func.getName() || 'unknown';
        warnings.push(
          `Scoped INPUT port '${name}' references scope '${scope}', but no callback parameter named '${scope}' was found ` +
            `in node type '${nodeTypeName}'. Add a callback parameter: ${scope}: (...) => { ${name}: YourType }`
        );
        type = 'ANY';
      }
    } else {
      const param = func.getParameters().find((p) => {
        const pName = p.getName();
        return pName === name || pName === `_${name}`;
      });
      if (param) {
        tsType = param.getType().getText(param);
        type = inferDataTypeFromTS(tsType);
      } else {
        type = 'ANY';
      }
    }

    // Check if description contains an expression
    let label: string | undefined = description?.trim();
    let expression: string | undefined = undefined;

    if (label && label.startsWith('Expression:')) {
      expression = label.substring('Expression:'.length).trim();
      label = undefined;
    }

    config.inputs![name] = {
      type,
      defaultValue: defaultValue ? this.parseDefaultValue(defaultValue) : undefined,
      ...(isOptional && { optional: true }),
      label,
      ...(expression && { expression }),
      ...(scope && { scope }),
      ...(mergeStrategy && { mergeStrategy: mergeStrategy as TMergeStrategy }),
      ...(order !== undefined && { metadata: { order } }),
      ...(tsType && { tsType }),
    };
  }

  /**
   * Parse @output tag using Chevrotain parser.
   * Supports: @output name, scope:scopeName, [order:N], - description
   */
  private parseOutputTag(
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

    const { name, scope, order, description } = result;

    // Infer type from return type or scope callback parameter
    let type: TDataType;
    let tsType: string | undefined;
    // Check for STEP ports: onSuccess/onFailure OR scoped mandatory ports (start with scope)
    const isScopedStepOutput = scope && isScopedMandatoryPort(name);
    if (isSuccessPort(name) || isFailurePort(name) || isScopedStepOutput) {
      type = 'STEP';
    } else if (scope) {
      // For scoped OUTPUT ports, look up type from the scope callback parameter
      // The scope name matches a function parameter that is a callback
      // Scoped OUTPUT ports become the callback's parameters
      const scopeParam = func.getParameters().find((p) => p.getName() === scope);
      if (scopeParam) {
        const scopeParamType = scopeParam.getType();

        // Use ts-morph Type API to extract the callback parameter type
        const extractedType = extractCallbackParamType(scopeParamType, name);
        if (extractedType) {
          tsType = extractedType;
          type = inferDataTypeFromTS(tsType);
        } else {
          // Emit warning when type inference fails for a scoped OUTPUT port
          const nodeTypeName = func.getName() || 'unknown';
          warnings.push(
            `Cannot infer type for scoped OUTPUT port '${name}' in scope '${scope}' of node type '${nodeTypeName}'. ` +
              `The callback parameter '${scope}' should have a parameter named '${name}'. ` +
              `Consider adding an explicit type annotation to the callback signature.`
          );
          type = 'ANY';
        }
      } else {
        // Scope callback parameter not found - emit warning
        const nodeTypeName = func.getName() || 'unknown';
        warnings.push(
          `Scoped OUTPUT port '${name}' references scope '${scope}', but no callback parameter named '${scope}' was found ` +
            `in node type '${nodeTypeName}'. Add a callback parameter: ${scope}: (${name}: YourType, ...) => { ... }`
        );
        type = 'ANY';
      }
    } else {
      const returnType = func.getReturnType();
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
    }

    config.outputs![name] = {
      type,
      label: description?.trim(),
      ...(scope && { scope }),
      ...(order !== undefined && { metadata: { order } }),
      ...(tsType && { tsType }),
    };
  }

  /**
   * Parse @step tag using Chevrotain parser.
   * Used for explicit STEP/control-flow ports that are not reserved.
   */
  private parseStepTag(
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
  private parseReturnTag(
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

    const { name, order, description } = result;

    // Infer type from return type signature
    let type: TDataType = 'ANY';
    if (isSuccessPort(name) || isFailurePort(name)) {
      type = 'STEP';
    } else if (func) {
      const returnType = func.getReturnType();
      const returnTypeText = returnType.getText();
      const fieldMatch = returnTypeText.match(new RegExp(`${name}\\s*:\\s*([^;},]+)`));
      if (fieldMatch) {
        type = inferDataTypeFromTS(fieldMatch[1].trim());
      }
    }

    config.returnPorts = config.returnPorts || {};
    config.returnPorts[name] = {
      dataType: type,
      label: description?.trim(),
      ...(order !== undefined && { metadata: { order } }),
    };
  }

  /**
   * Parse @param tag for workflow functions using Chevrotain.
   * Format: @param name [order:N] - Description (type inferred from signature)
   */
  private parseParamTag(
    tag: JSDocTag,
    config: JSDocWorkflowConfig,
    func: FunctionLike | undefined,
    warnings: string[]
  ): void {
    // For @param tags, ts-morph parses the name separately from the comment
    // The tag's compilerNode may have a name property that we need to extract
    interface JSDocParamTagNode {
      name?: { getText?: () => string };
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
        const fieldMatch = paramTypeText.match(new RegExp(`${name}\\s*:\\s*([^;},]+)`));
        if (fieldMatch) {
          type = inferDataTypeFromTS(fieldMatch[1].trim());
        }
      }
    }

    config.startPorts = config.startPorts || {};
    config.startPorts[name] = {
      dataType: type,
      label: description?.trim(),
      ...(order !== undefined && { metadata: { order } }),
    };
  }

  /**
   * Parse @fwImport tag for npm package node types.
   * Format: @fwImport nodeName functionName from "packageName"
   * Examples:
   *   @fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"
   *   @fwImport npm/lodash/map map from "lodash"
   * Note: We use @fwImport instead of @import because TypeScript treats @import specially
   * and truncates the first word as a type annotation.
   */
  private parseImportTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText()?.trim() || '';

    // Parse format: nodeName functionName from "packageName"
    const match = comment.match(/^(\S+)\s+(\S+)\s+from\s+["']([^"']+)["']$/);

    if (match) {
      const [, name, functionName, importSource] = match;
      config.imports!.push({ name, functionName, importSource });
    } else {
      warnings.push(
        `Invalid @fwImport tag format: "${comment}". Expected: @fwImport nodeName functionName from "packageName"`
      );
    }
  }

  /**
   * Parse @node tag using Chevrotain parser.
   * Supports: @node instanceId nodeType [parentScope] [label: "..."] [portOrder: port=N] [portLabel: port="label"] [expr: port="val"] [minimized] [pullExecution: triggerPort]
   */
  private parseNodeTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';

    // Use Chevrotain to parse the node line
    const result = parseNodeLine(`@node ${comment}`, warnings);
    if (!result) {
      return;
    }

    const {
      instanceId,
      nodeType,
      parentScope,
      label,
      expressions,
      portOrder,
      portLabel,
      minimized,
      pullExecution,
      size,
      position,
      color,
      icon,
      tags,
    } = result;

    // Capture source location from tag
    const line = tag.getStartLineNumber();

    // Build portConfigs from portOrder, portLabel, and expressions
    let portConfigs: TPortConfig[] | undefined;

    if (portOrder) {
      portConfigs = Object.entries(portOrder).map(([portName, order]) => ({
        portName,
        order,
      }));
    }

    if (portLabel) {
      portConfigs = portConfigs || [];
      for (const [portName, labelVal] of Object.entries(portLabel)) {
        const existingIndex = portConfigs.findIndex((pc) => pc.portName === portName);
        if (existingIndex >= 0) {
          portConfigs[existingIndex] = { ...portConfigs[existingIndex], label: labelVal };
        } else {
          portConfigs.push({ portName, label: labelVal });
        }
      }
    }

    if (expressions) {
      portConfigs = portConfigs || [];
      for (const [portName, expression] of Object.entries(expressions)) {
        const existingIndex = portConfigs.findIndex((pc) => pc.portName === portName);
        if (existingIndex >= 0) {
          portConfigs[existingIndex] = { ...portConfigs[existingIndex], expression };
        } else {
          portConfigs.push({ portName, expression });
        }
      }
    }

    config.instances!.push({
      id: instanceId,
      type: nodeType,
      ...(parentScope && { parentScope }),
      ...(label && { label }),
      ...(portConfigs && portConfigs.length > 0 && { portConfigs }),
      ...(pullExecution && { pullExecution: { triggerPort: pullExecution } }),
      ...(minimized && { minimized }),
      ...(color && { color }),
      ...(icon && { icon }),
      ...(tags && tags.length > 0 && { tags }),
      ...(size && { width: size.width, height: size.height }),
      ...(position && { x: position.x, y: position.y }),
      sourceLocation: { line, column: 0 },
    });
  }

  /**
   * Parse @position tag using Chevrotain parser.
   * Supports: @position nodeId x y
   */
  private parsePositionTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';

    // Use Chevrotain to parse the position line
    const result = parsePositionLine(`@position ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @position tag format: ${comment}`);
      return;
    }

    const { nodeId, x, y } = result;
    config.positions![nodeId] = { x, y };

    // Emit deprecation warning for non-virtual nodes
    if (nodeId !== 'Start' && nodeId !== 'Exit') {
      warnings.push(
        `Deprecated: @position ${nodeId} — use [position: ${x} ${y}] on the @node declaration instead.`
      );
    }
  }

  /**
   * Parse @connect tag using Chevrotain parser.
   * Supports: node.port -> node.port and node.port:scope -> node.port:scope
   */
  private parseConnectTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';

    // Use Chevrotain to parse the connect line
    const result = parseConnectLine(`@connect ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @connect tag format: @connect ${comment}`);
      return;
    }

    const { source, target } = result;

    // Capture source location from tag
    const line = tag.getStartLineNumber();

    config.connections!.push({
      from: {
        node: source.nodeId,
        port: source.portName,
        ...(source.scope && { scope: source.scope }),
      },
      to: {
        node: target.nodeId,
        port: target.portName,
        ...(target.scope && { scope: target.scope }),
      },
      sourceLocation: { line, column: 0 },
    });
  }

  /**
   * Parse @scope tag using Chevrotain parser.
   * Format: @scope scopeName [child1, child2] or @scope container.scopeName [child1, child2]
   */
  private parseScopeTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';

    const result = parseScopeLine(`@scope ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @scope tag format: ${comment}`);
      return;
    }

    config.scopes![result.scopeName] = result.children;
  }

  /**
   * Parse @map tag using Chevrotain parser.
   * Format: @map instanceId childNode over source.port
   * Or:     @map instanceId childNode(inputPort -> outputPort) over source.port
   */
  private parseMapTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';

    const result = parseMapLine(`@map ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @map tag format: ${comment}`);
      return;
    }

    config.maps = config.maps || [];
    config.maps.push({
      instanceId: result.instanceId,
      childId: result.childId,
      sourceNode: result.sourceNode,
      sourcePort: result.sourcePort,
      ...(result.inputPort && { inputPort: result.inputPort }),
      ...(result.outputPort && { outputPort: result.outputPort }),
    });
  }

  /**
   * Parse @path tag using Chevrotain parser.
   * Format: @path Start -> validator:ok -> classifier -> urgencyRouter:fail -> escalate -> Exit
   */
  private parsePathTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';

    const result = parsePathLine(`@path ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @path tag format: ${comment}`);
      return;
    }

    config.paths = config.paths || [];
    config.paths.push({
      steps: result.steps,
    });
  }

  private parseFanOutTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';
    const result = parseFanOutLine(`@fanOut ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @fanOut tag format: ${comment}`);
      return;
    }
    if (!result.source.port) {
      warnings.push(`@fanOut source must specify a port: ${comment}`);
      return;
    }
    config.fanOuts = config.fanOuts || [];
    config.fanOuts.push({
      source: { node: result.source.node, port: result.source.port },
      targets: result.targets,
    });
  }

  private parseFanInTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';
    const result = parseFanInLine(`@fanIn ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @fanIn tag format: ${comment}`);
      return;
    }
    if (!result.target.port) {
      warnings.push(`@fanIn target must specify a port: ${comment}`);
      return;
    }
    config.fanIns = config.fanIns || [];
    config.fanIns.push({
      sources: result.sources,
      target: { node: result.target.node, port: result.target.port },
    });
  }

  private parseCoerceTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';
    const result = parseCoerceLine(`@coerce ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @coerce tag format: ${comment}`);
      return;
    }
    config.coercions = config.coercions || [];
    config.coercions.push({
      instanceId: result.instanceId,
      source: result.source,
      target: result.target,
      targetType: result.targetType,
    });
  }

  /**
   * Parse @trigger tag using Chevrotain parser.
   */
  private parseTriggerTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';
    const result = parseTriggerLine(`@trigger ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @trigger format: @trigger ${comment}`);
      return;
    }
    // Merge: multiple @trigger tags accumulate (event + cron can be separate tags)
    config.trigger = config.trigger || {};
    if (result.event) config.trigger.event = result.event;
    if (result.cron) config.trigger.cron = result.cron;
  }

  /**
   * Parse @cancelOn tag using Chevrotain parser.
   */
  private parseCancelOnTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';
    const result = parseCancelOnLine(`@cancelOn ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @cancelOn format: @cancelOn ${comment}`);
      return;
    }
    config.cancelOn = result;
  }

  /**
   * Parse @throttle tag using Chevrotain parser.
   */
  private parseThrottleTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
    const comment = tag.getCommentText() || '';
    const result = parseThrottleLine(`@throttle ${comment}`, warnings);
    if (!result) {
      warnings.push(`Invalid @throttle format: @throttle ${comment}`);
      return;
    }
    config.throttle = result;
  }

  /**
   * Parse default value from string
   */
  private parseDefaultValue(value: string): unknown {
    // Try to parse as JSON
    try {
      return JSON.parse(value) as unknown;
    } catch {
      // Return as string if not valid JSON
      return value;
    }
  }
}

export const jsdocParser = new JSDocParser();
