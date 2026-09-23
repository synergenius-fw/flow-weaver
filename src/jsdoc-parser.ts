/**
 * JSDoc annotation parser for Flow Weaver
 *
 * Parses @flowWeaver annotations from JSDoc comments.
 */

import type { JSDocTag, Type, Symbol as TsMorphSymbol } from 'ts-morph';
import type { FunctionLike } from './function-like';
import type {
  TDataType,
  TPortConfig,
  TMergeStrategy,
  TNodeTagAST,
  TSerializableValue,
  THttpRoute,
} from './ast/types';
import {
  isExecutePort, isSuccessPort, isFailurePort, isScopedMandatoryPort,
  KNOWN_NODETYPE_TAGS, STANDARD_JSDOC_TAGS,
  getKnownWorkflowTags,
} from './constants';
import { inferDataTypeFromTS, stripOptionalUndefined } from './type-mappings';
import { findClosestMatches } from './utils/string-distance';
import type { TagHandlerRegistry } from './parser/tag-registry';
import {
  parsePortLine,
  parseNodeLine,
  parseConnectLine,
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
/**
 * Get a callback type's call signatures deterministically.
 *
 * ts-morph 28 / TypeScript 6 lazily initializes the type checker. On a "cold"
 * checker (the first complex inference after a fresh/reset ts-morph Project),
 * `Type.getCallSignatures()` for a function-typed parameter NON-DETERMINISTICALLY
 * returns an empty array even though the type genuinely has a call signature.
 * That made scoped-port inference (which reads the callback's signature to derive
 * port types) flake: the port came out with no `tsType`. A test-only checker
 * warmup masked it unreliably. This is the real fix.
 *
 * Force the checker to materialize the signatures: if the direct call returns
 * none, retry via the APPARENT type (`getApparentType()` drives the checker to
 * resolve the type's structure), then via the type's symbol declaration's type
 * (re-resolving from the declaration forces a full type computation). Returns the
 * first non-empty signature list, or an empty array only when the type truly has
 * no call signature.
 */
function resolveCallSignatures(callbackType: Type): ReturnType<Type['getCallSignatures']> {
  let sigs = callbackType.getCallSignatures();
  if (sigs.length > 0) return sigs;

  // Retry 1: apparent type forces the checker to resolve the type's structure.
  try {
    sigs = callbackType.getApparentType().getCallSignatures();
    if (sigs.length > 0) return sigs;
  } catch {
    // getApparentType can throw on exotic types. Fall through to the next retry.
  }

  // Retry 2: re-resolve the type from its symbol's declaration. Reading the
  // declaration's type recomputes it through the (now-touched) checker, which
  // reliably materializes call signatures the cold first pass missed.
  try {
    const symbol = callbackType.getSymbol() ?? callbackType.getAliasSymbol();
    const decl = symbol?.getDeclarations()?.[0];
    if (decl) {
      sigs = decl.getType().getCallSignatures();
      if (sigs.length > 0) return sigs;
    }
  } catch {
    // Best-effort. Fall through.
  }

  return sigs;
}

function extractCallbackReturnFieldType(callbackType: Type, fieldName: string): string | undefined {
  // Get call signatures from the callback type (cold-checker-safe).
  const callSignatures = resolveCallSignatures(callbackType);
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
  // Get call signatures from the callback type (cold-checker-safe).
  const callSignatures = resolveCallSignatures(callbackType);
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
  /** Retry/fallback behavior implemented inside the node adapter. */
  resilience?: { retries?: number; fallback?: string };
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
      hidden?: boolean;
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
      hidden?: boolean;
      metadata?: { order?: number };
      tsType?: string;
    }
  >;
  /** Per-target deploy config from @deploy annotations on nodeType */
  deploy?: Record<string, Record<string, unknown>>;
}

/**
 * `position: x y` as it was written on @node lines: a bracket of its own,
 * or first, last or between other attributes in a shared bracket.
 */
/** The methods an `@http` route may declare. */
const HTTP_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const POSITION_ATTR = /\s*\[position:\s*-?\d+\s+-?\d+\]|,\s*position:\s*-?\d+\s+-?\d+(?=\s*[,\]])|(?<=\[)\s*position:\s*-?\d+\s+-?\d+\s*,\s*/g;
const positionGone = (where: string): string =>
  `${where}: node positions are no longer part of the grammar and this was ignored. Remove it, or run \`fw compile\` / \`fw migrate\` to rewrite the block without it.`;

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
    /** Generic `[key: "value"]` bracket attributes, kept for packs to read. */
    attributes?: Record<string, string>;
    suppressWarnings?: string[];
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
    {
      dataType?: TDataType;
      label?: string;
      optional?: boolean;
      default?: TSerializableValue;
      metadata?: { order?: number };
    }
  >;
  returnPorts?: Record<
    string,
    { dataType: TDataType; label?: string; metadata?: { order?: number } }
  >;
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
  /** @trigger annotation: event name and/or cron schedule */
  trigger?: { event?: string; cron?: string };
  /** @http annotations: the routes the workflow is served on */
  http?: THttpRoute[];
  /** @cancelOn annotation: cancel on matching external event */
  cancelOn?: { event: string; match?: string; timeout?: string };
  /** @retries annotation: retry count */
  retries?: number;
  /** @timeout annotation: function-level timeout */
  timeout?: string;
  /** @throttle annotation: rate limiting */
  throttle?: { limit: number; period?: string };

  // ── Per-target deployment config from @deploy annotations ──────
  /** @deploy target key=value pairs */
  deploy?: Record<string, Record<string, unknown>>;
}


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

export class JSDocParser {
  /**
   * Parse @flowWeaver nodeType from JSDoc comments.
   * When a TagHandlerRegistry is provided, unknown tags are checked against it
   * before being reported as warnings.
   */
  parseNodeType(func: FunctionLike, warnings: string[], tagRegistry?: TagHandlerRegistry): JSDocNodeTypeConfig | null {
    const jsdocs = func.getJsDocs();
    if (jsdocs.length === 0) return null;

    // Find the JSDoc block that contains @flowWeaver nodeType (or @flowWeaver node shorthand)
    let jsdoc = null;
    let flowWeaverTag = null;
    let isNodeShorthand = false;

    for (const doc of jsdocs) {
      const tags = doc.getTags();
      const tag = tags.find(
        (t) => {
          if (t.getTagName() !== 'flowWeaver') return false;
          const comment = t.getCommentText()?.trim();
          return comment === 'nodeType' || comment === 'node';
        }
      );
      if (tag) {
        jsdoc = doc;
        flowWeaverTag = tag;
        isNodeShorthand = flowWeaverTag.getCommentText()?.trim() === 'node';
        break;
      }
    }

    if (!jsdoc || !flowWeaverTag) return null;

    const tags = jsdoc.getTags();

    const config: JSDocNodeTypeConfig = {
      inputs: {},
      outputs: {},
    };

    // @flowWeaver node implies expression mode (auto-detect from signature)
    if (isNodeShorthand) {
      config.expression = true;
    }

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
          config.color = comment.trim().replace(/^["']|["']$/g, '');
          break;

        case 'icon':
          config.icon = comment.trim().replace(/^["']|["']$/g, '');
          break;

        case 'tag': {
          config.tags = config.tags || [];
          const tagMatch = comment.match(/^(\S+)(?:\s+"([^"]+)")?$/);
          if (tagMatch) {
            config.tags.push({
              label: tagMatch[1],
              ...(tagMatch[2] && { tooltip: tagMatch[2] }),
            });
          }
          break;
        }

        case 'executeWhen':
          config.executeWhen = comment.trim();
          break;

        case 'scope':
          config.scope = comment.trim();
          break;

        case 'expression':
          config.expression = true;
          break;

        case 'pullExecution': {
          const pullValue = comment.trim();
          if (pullValue) {
            config.defaultConfig = config.defaultConfig || {};
            config.defaultConfig.pullExecution = { triggerPort: pullValue };
          }
          break;
        }

        case 'resilience': {
          const resilience: { retries?: number; fallback?: string } = {};
          const attributes = comment.matchAll(/(\w+)=(?:"([^"]*)"|'([^']*)'|(\S+))/g);
          for (const match of attributes) {
            const key = match[1];
            const value = match[2] ?? match[3] ?? match[4];
            if (key === 'retries') {
              const retries = Number(value);
              if (Number.isInteger(retries) && retries > 0) {
                resilience.retries = retries;
              } else {
                warnings.push('@resilience retries must be a positive integer.');
              }
            } else if (key === 'fallback') {
              if (value.trim()) resilience.fallback = value.trim();
            } else {
              warnings.push(`Unknown @resilience option "${key}". Supported options: retries, fallback.`);
            }
          }
          if (resilience.retries !== undefined || resilience.fallback !== undefined) {
            config.resilience = resilience;
          } else {
            warnings.push('@resilience requires retries=N and/or fallback="provider".');
          }
          break;
        }

        case 'input':
          this.parseInputTag(tag, config, func, warnings);
          break;

        case 'output':
          this.parseOutputTag(tag, config, func, warnings);
          break;

        case 'step':
          this.parseStepTag(tag, config, func, warnings);
          break;

        case 'deploy':
          config.deploy = config.deploy || {};
          this.parseDeployTag(tag, config.deploy);
          break;

        default: {
          // D: Context validation - tags that belong to other block types
          if (tagName === 'param' || tagName === 'returns' || tagName === 'return') {
            warnings.push(`@${tagName} is for workflows, not node types. Use @input/@output instead.`);
          } else if (tagRegistry && tagRegistry.has(tagName)) {
            // Delegate to pack-contributed tag handler
            if (!config.deploy) config.deploy = {};
            tagRegistry.handle(tagName, comment, 'nodeType', config.deploy, warnings);
          } else if (!KNOWN_NODETYPE_TAGS.has(tagName) && !STANDARD_JSDOC_TAGS.has(tagName)) {
            // C: Unknown tag detection with suggestions
            const suggestions = findClosestMatches(tagName, [...KNOWN_NODETYPE_TAGS]);
            const hint = suggestions.length > 0 ? ` Did you mean @${suggestions[0]}?` : '';
            warnings.push(`Unknown annotation @${tagName} in nodeType block.${hint}`);
          }
          break;
        }
      }
    });

    return config;
  }

  /**
   * Parse @flowWeaver workflow from JSDoc comments.
   * When a TagHandlerRegistry is provided, unknown tags are checked against it
   * before being reported as warnings.
   */
  parseWorkflow(func: FunctionLike, warnings: string[], tagRegistry?: TagHandlerRegistry): JSDocWorkflowConfig | null {
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
    };

    // The free text above the tags is the workflow's description, exactly as
    // it is for a node type. It has to be captured here because in-place
    // compilation regenerates this JSDoc block from the AST: whatever is not
    // in the AST is deleted on the next compile. An explicit @description tag
    // below still overrides it.
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
          // Positions left the grammar; a file that still carries the line parses, minus the line.
          warnings.push(positionGone(`@position ${comment.trim()}`));
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
          this.parseTriggerTag(tag, config, warnings, tagRegistry);
          break;

        case 'http':
          this.parseHttpTag(tag, config, warnings);
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

        case 'deploy':
          config.deploy = config.deploy || {};
          this.parseDeployTag(tag, config.deploy);
          break;

        case 'param':
          this.parseParamTag(tag, config, func, warnings);
          break;

        case 'return':
        case 'returns':
          this.parseReturnTag(tag, config, func, warnings);
          break;

        default: {
          // D: Context validation - tags that belong to other block types
          if (tagName === 'color' || tagName === 'icon' || tagName === 'tag') {
            warnings.push(`@${tagName} is for node types, not workflows. Use it on @flowWeaver nodeType instead.`);
          } else if (tagName === 'input' || tagName === 'output' || tagName === 'step') {
            warnings.push(`@${tagName} is for node types, not workflows. Use @param/@returns for workflows.`);
          } else if (tagRegistry && tagRegistry.has(tagName)) {
            // Delegate to pack-contributed tag handler
            if (!config.deploy) config.deploy = {};
            tagRegistry.handle(tagName, comment, 'workflow', config.deploy, warnings);
          } else {
            const knownTags = getKnownWorkflowTags(tagRegistry?.getRegisteredTags());
            if (!knownTags.has(tagName) && !STANDARD_JSDOC_TAGS.has(tagName)) {
              // C: Unknown tag detection with suggestions
              const suggestions = findClosestMatches(tagName, [...knownTags]);
              const hint = suggestions.length > 0 ? ` Did you mean @${suggestions[0]}?` : '';
              warnings.push(`Unknown annotation @${tagName} in workflow block.${hint}`);
            }
          }
          break;
        }
      }
    });

    return config;
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
        const rawTsType = param.getType().getText(param);
        tsType =
          param.isOptional() || param.hasInitializer()
            ? stripOptionalUndefined(rawTsType)
            : rawTsType;
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

    // B: Duplicate port detection
    if (Object.prototype.hasOwnProperty.call(config.inputs!, name)) {
      warnings.push(`Duplicate @input "${name}". The second declaration will overwrite the first.`);
    }

    config.inputs![name] = {
      type,
      defaultValue: defaultValue === undefined ? undefined : this.parseDefaultValue(defaultValue),
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

    const { name, order, description, customMetadata } = result;

    // Infer type from return type signature
    let type: TDataType = 'ANY';
    if (isSuccessPort(name) || isFailurePort(name)) {
      type = 'STEP';
    } else if (func) {
      const returnType = func.getReturnType();
      const returnTypeText = returnType.getText();
      const fieldMatch = returnTypeText.match(new RegExp(`${name}\\??\\s*:\\s*([^;},]+)`));
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
          const fieldMatch = paramTypeText.match(new RegExp(`${name}\\??\\s*:\\s*([^;},]+)`));
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
      ...(defaultSource === undefined ? {} : { default: this.parseDefaultValue(defaultSource) }),
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
    let comment = tag.getCommentText() || '';

    // Positions left the grammar. A file that still carries `[position: x y]`
    // parses as if it were not there, and says so once per line.
    if (POSITION_ATTR.test(comment)) {
      POSITION_ATTR.lastIndex = 0;
      comment = comment.replace(POSITION_ATTR, '');
      warnings.push(positionGone(`@node ${comment.trim().split(/\s+/)[0]} [position:]`));
    }
    POSITION_ATTR.lastIndex = 0;

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
      color,
      icon,
      tags,
      attributes,
      suppress,
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
      ...(attributes && Object.keys(attributes).length > 0 && { attributes }),
      ...(suppress && suppress.length > 0 && { suppressWarnings: suppress }),
      sourceLocation: { line, column: 0 },
    });
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

    const { source, target, coerce } = result;

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
      ...(coerce && { coerce }),
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

    const results = parsePathLine(`@path ${comment}`, warnings);
    if (!results) {
      warnings.push(`Invalid @path tag format: ${comment}`);
      return;
    }

    config.paths = config.paths || [];
    for (const result of results) {
      config.paths.push({
        steps: result.steps,
      });
    }
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
   *
   * Core parses the built-in `event=` / `cron=` forms. Any other form is a
   * pack's to interpret: a pack registers a `_trigger` handler and core hands
   * the line to it. Core itself knows nothing about the domains a pack adds.
   */
  private parseTriggerTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[], tagRegistry?: TagHandlerRegistry): void {
    const comment = (tag.getCommentText() || '').trim();

    // Core FW trigger parsing (event= and/or cron=)
    const result = parseTriggerLine(`@trigger ${comment}`, warnings);
    if (result) {
      // Merge: multiple @trigger tags accumulate (event + cron can be separate tags)
      config.trigger = config.trigger || {};
      if (result.event) config.trigger.event = result.event;
      if (result.cron) config.trigger.cron = result.cron;
      return;
    }

    // Not a core trigger form: delegate to a pack's trigger handler if one is
    // registered. The pack writes into its own deploy namespace.
    if (tagRegistry && tagRegistry.has('_trigger')) {
      if (!config.deploy) config.deploy = {};
      tagRegistry.handle('_trigger', comment, 'workflow', config.deploy, warnings);
      return;
    }

    warnings.push(`Invalid @trigger format: @trigger ${comment}`);
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
   * Parse @http tag: the route a workflow is served on.
   * Format: @http METHOD /path [mode=sync|async] [auth=bearer|none] [callback]
   *
   * Examples:
   *   @http POST /reviews
   *   @http GET /reviews/:path
   *   @http POST /reviews mode=async callback
   *
   * Several @http tags give several routes. A bad line is a warning and the
   * route is dropped; the workflow still parses.
   */
  private parseHttpTag(tag: JSDocTag, config: { http?: THttpRoute[] }, warnings: string[]): void {
    const text = (tag.getCommentText() || '').trim();
    const parts = text.split(/\s+/).filter(Boolean);
    const fail = (why: string) => { warnings.push(`Invalid @http: "${text}". ${why} Format: @http METHOD /path [mode=sync|async] [auth=bearer|none] [callback]`); };
    if (parts.length < 2) return fail('Give a method and a path.');
    const method = parts[0].toUpperCase();
    if (!HTTP_METHODS.has(method)) return fail(`"${parts[0]}" is not one of GET, POST, PUT, PATCH, DELETE.`);
    const routePath = parts[1];
    if (!/^\/(?:[A-Za-z0-9_\-.~%]+|:[A-Za-z_][A-Za-z0-9_]*)(?:\/(?:[A-Za-z0-9_\-.~%]+|:[A-Za-z_][A-Za-z0-9_]*))*\/?$|^\/$/.test(routePath)) {
      return fail(`"${routePath}" is not a path: it starts with / and its segments are words or :params.`);
    }
    const route: THttpRoute = { method: method as THttpRoute['method'], path: routePath.length > 1 ? routePath.replace(/\/$/, '') : routePath };
    for (const opt of parts.slice(2)) {
      const [key, raw] = opt.includes('=') ? opt.split('=', 2) : [opt, undefined];
      const value = raw?.replace(/^["']|["']$/g, '');
      if (key === 'mode' && (value === 'sync' || value === 'async')) { if (value === 'async') route.mode = 'async'; }
      else if (key === 'auth' && (value === 'bearer' || value === 'none')) { if (value === 'none') route.auth = 'none'; }
      else if (key === 'callback' && (value === undefined || value === 'true' || value === 'false')) { if (value !== 'false') route.callback = true; }
      else return fail(`"${opt}" is not an option.`);
    }
    config.http = config.http || [];
    if (config.http.some((r) => r.method === route.method && r.path === route.path)) {
      warnings.push(`Duplicate @http route ${route.method} ${route.path}. The first one stands.`);
      return;
    }
    config.http.push(route);
  }

  /**
   * Parse @deploy tag.
   * Format: @deploy <target> key=value key2="value with spaces" key3=123 key4=true
   *
   * Examples:
   *   @deploy github-actions action="actions/checkout@v4"
   *   @deploy my-target durableSteps=true framework="next" retries=3
   *   @deploy another-target memory=256 timeout=30
   *
   * Values are auto-coerced: "true"/"false" → boolean, numeric strings → number.
   */
  private parseDeployTag(tag: JSDocTag, deployMap: Record<string, Record<string, unknown>>): void {
    const text = (tag.getCommentText() || '').trim();
    if (!text) return;

    // Split target name from remaining key=value pairs
    const spaceIdx = text.indexOf(' ');
    const targetName = spaceIdx === -1 ? text : text.substring(0, spaceIdx);
    const rest = spaceIdx === -1 ? '' : text.substring(spaceIdx + 1);

    if (!targetName) return;

    if (!deployMap[targetName]) deployMap[targetName] = {};

    if (!rest) return;

    // Parse key=value and key="value with spaces" pairs
    // The quoted value pattern handles escaped quotes: "echo \"hello\""
    const kvRegex = /(\w[\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([\S]+))/g;
    let match: RegExpExecArray | null;
    while ((match = kvRegex.exec(rest)) !== null) {
      const key = match[1];
      const quotedVal = match[2]; // captured from "..."
      const bareVal = match[3];   // captured from unquoted

      if (quotedVal !== undefined) {
        // Quoted values: check if comma-separated list → string[]
        if (quotedVal.includes(',')) {
          deployMap[targetName][key] = quotedVal.split(',').map(v => v.trim());
        } else {
          deployMap[targetName][key] = quotedVal;
        }
      } else if (bareVal !== undefined) {
        // Bare values: auto-coerce boolean and number
        if (bareVal === 'true') {
          deployMap[targetName][key] = true;
        } else if (bareVal === 'false') {
          deployMap[targetName][key] = false;
        } else {
          const num = Number(bareVal);
          deployMap[targetName][key] = isNaN(num) ? bareVal : num;
        }
      }
    }
  }

  /**
   * Parse default value from string
   */
  private parseDefaultValue(value: string): TSerializableValue {
    // Try to parse as JSON
    try {
      return JSON.parse(value) as TSerializableValue;
    } catch {
      // Return as string if not valid JSON
      return value;
    }
  }
}

export const jsdocParser = new JSDocParser();
