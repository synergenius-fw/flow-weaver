/**
 * Node-type extraction and inference.
 *
 * extractNodeTypes walks a source file's @flowWeaver-annotated (and inferable)
 * functions into TNodeTypeAST[]. The infer* functions derive node types from
 * bare function signatures (expression mode), and hasFlowWeaverAnnotation detects
 * the annotation. The tag-handler registry used by extractNodeTypes is passed
 * in explicitly.
 */

import { type SourceFile, type JSDoc } from 'ts-morph';
import { type FunctionLike, extractFunctionLikes } from './function-like';
import { jsdocParser } from './jsdoc-parser';
import type {
  TNodeTypeAST,
  TExecuteWhen,
  TPortDefinition,
  TNodeTypeDefaultConfig,
  TSerializableValue,
} from '../ast/types';
import { RESERVED_PORT_NAMES, EXECUTION_STRATEGIES } from '../constants';
import { assignImplicitPortOrders } from '../utils/port-ordering';
import { inferDataTypeFromTS, stripOptionalUndefined } from '../types/type-mappings';
import { BUILT_IN_NODE_TYPES } from '../built-in-nodes/generated-registry';
import type { TagHandlerRegistry } from './tag-registry';
import { capitalize } from './port-inference';
import {
  analyzeDurableEffectContract,
  durableGateKind,
  hasJsDocTag,
} from './durable-effect-contract';

/**
 * Whether calling the function yields a Promise, so the generated call needs
 * `await`. The `async` keyword is one way to say so; a plain function declared
 * to return `Promise<...>` (a `declare function` in a .d.ts, or one that
 * returns a promise it built itself) is the other.
 */
export function returnsPromise(fn: FunctionLike): boolean {
  return fn.isAsync() || fn.getReturnType().getText().startsWith('Promise<');
}

export function extractNodeTypes(
  sourceFile: SourceFile,
  warnings: string[],
  tagRegistry: TagHandlerRegistry,
): TNodeTypeAST[] {
  const nodeTypes: TNodeTypeAST[] = [];
  extractFunctionLikes(sourceFile).forEach((fn: FunctionLike) => {
    // Parse JSDoc comments
    const config = jsdocParser.parseNodeType(fn, warnings, tagRegistry);
    if (!config) {
      const jsdocText = fn.getJsDocs().map((d) => d.getFullText()).join('');
      if (jsdocText.includes('@flowWeaver nodeType')) {
        warnings.push(
          `Function "${fn.getName() || 'anonymous'}" has @flowWeaver annotation but could not be parsed. ` +
          `Check for special characters (---) or malformed JSDoc syntax.`
        );
      }
      return;
    }

    const functionName = fn.getName() || 'anonymous';
    const nodeTypeName = config.name || functionName;
    const durableGate = durableGateKind(fn);
    const durableEffect = hasJsDocTag(fn, 'durableEffect');
    const durablePure = hasJsDocTag(fn, 'durablePure');

    const inputs: Record<string, TPortDefinition> = {};
    if (config.inputs) {
      for (const [portName, portDef] of Object.entries(config.inputs)) {
        inputs[portName] = {
          dataType: portDef.type,
          default: portDef.defaultValue as TSerializableValue,
          optional: portDef.optional,
          label: portDef.label,
          expression: portDef.expression,
          ...(portDef.scope && { scope: portDef.scope }),
          ...(portDef.hidden && { hidden: portDef.hidden }),
          ...(portDef.metadata && { metadata: portDef.metadata }),
          ...(portDef.tsType && { tsType: portDef.tsType }),
          // The fan-in strategy is what lets the validator accept several
          // connections into this port and tells the generator how to combine
          // them. Dropping it here silently turned every strategy into FIRST.
          ...(portDef.mergeStrategy && { mergeStrategy: portDef.mergeStrategy }),
        };
      }
    }

    const outputs: Record<string, TPortDefinition> = {};
    if (config.outputs) {
      for (const [portName, portDef] of Object.entries(config.outputs)) {
        outputs[portName] = {
          dataType: portDef.type,
          label: portDef.label,
          ...(portDef.scope && { scope: portDef.scope }),
          ...(portDef.hidden && { hidden: portDef.hidden }),
          ...(portDef.metadata && { metadata: portDef.metadata }),
          ...(portDef.tsType && { tsType: portDef.tsType }),
        };
      }
    }

    // Ambient declarations (declare function) are stub nodes: interface only, no implementation.
    // Force expression mode so ports are inferred from the TypeScript signature.
    const isStub = fn.isAmbient?.() ?? false;
    if (isStub) {
      config.expression = true;
    }

    // For @expression nodes the signature is the interface and annotations
    // refine it. Infer the data ports from the signature, then decide per
    // direction how the explicit ports relate to them:
    //   - none explicit           -> the inferred ports
    //   - explicit ⊂ inferred     -> a partial annotation: the inferred ports,
    //                                with each explicit one overlaid (label,
    //                                order, strategy, optional, default, and a
    //                                specific dataType wins over an inferred
    //                                one, ANY does not)
    //   - explicit covers every inferred port, or names one the signature
    //     lacks              -> the author is stating the interface (a full
    //                                list, a rename, a virtual port), and the
    //                                explicit list stands as written
    // Treating one annotated port as "the author listed the ports" used to
    // drop every other parameter and return field, and the first symptom was
    // a workflow-level UNKNOWN_TARGET_PORT on a port the function plainly has.
    if (config.expression) {
      const inferred = inferNodeTypeFromFunction(
        fn,
        nodeTypeName,
        fn.getSourceFile().getFilePath()
      );
      const reconcile = (
        explicit: Record<string, TPortDefinition>,
        inferredPorts: Record<string, TPortDefinition>,
        isControl: (name: string) => boolean,
      ): Record<string, TPortDefinition> => {
        const explicitData = Object.entries(explicit).filter(([name]) => !isControl(name));
        const inferredData = Object.entries(inferredPorts).filter(([name]) => !isControl(name));
        if (explicitData.length === 0) return Object.fromEntries(inferredData);
        const inferredNames = new Set(inferredData.map(([name]) => name));
        const isPartial =
          explicitData.length < inferredData.length &&
          explicitData.every(([name]) => inferredNames.has(name));
        // A copy: the caller clears and refills the original record.
        if (!isPartial) return Object.fromEntries(explicitData);
        const explicitByName = new Map(explicitData);
        return Object.fromEntries(
          inferredData.map(([name, port]) => {
            const override = explicitByName.get(name);
            if (!override) return [name, port];
            const refined: TPortDefinition = { ...port };
            for (const [key, value] of Object.entries(override) as Array<[keyof TPortDefinition, unknown]>) {
              if (value === undefined) continue;
              if (key === 'dataType' && value === 'ANY') continue;
              if (key === 'label' && typeof value === 'string' && value.length === 0) continue;
              (refined as Record<string, unknown>)[key] = value;
            }
            return [name, refined];
          }),
        );
      };
      const reconciledInputs = reconcile(inputs, inferred.inputs, (n) => n === 'execute');
      const reconciledOutputs = reconcile(outputs, inferred.outputs, (n) => n === 'onSuccess' || n === 'onFailure');
      for (const key of Object.keys(inputs)) if (key !== 'execute') delete inputs[key];
      for (const key of Object.keys(outputs)) if (key !== 'onSuccess' && key !== 'onFailure') delete outputs[key];
      Object.assign(inputs, reconciledInputs);
      Object.assign(outputs, reconciledOutputs);
    }

    // ALL nodes must have execute input and onSuccess/onFailure outputs
    // Execute port is visible by default so users can connect execution flow
    // Merge user-defined ports with mandatory defaults to preserve special properties
    inputs.execute = {
      label: 'Execute', // Default label
      ...inputs.execute, // User can override label
      dataType: 'STEP', // But dataType is mandatory
    };
    outputs.onSuccess = {
      label: 'On Success', // Default label
      ...outputs.onSuccess, // User can override label
      dataType: 'STEP', // But dataType is mandatory
      isControlFlow: true, // Always a control flow port
    };
    outputs.onFailure = {
      label: 'On Failure', // Default label
      ...outputs.onFailure, // User can override label
      dataType: 'STEP', // But dataType is mandatory
      failure: true, // Always a failure port
      isControlFlow: true, // Always a control flow port
    };

    // Assign implicit port orders with mandatory port precedence
    assignImplicitPortOrders(inputs);
    assignImplicitPortOrders(outputs);

    // Get function text (JSDoc comment + function). Stubs have no body to capture.
    const jsDocs = fn.getJsDocs();
    const jsDocText = jsDocs.map((doc: JSDoc) => doc.getText()).join('\n');
    const functionText = isStub ? undefined : (jsDocText ? `${jsDocText}\n${fn.getText()}` : fn.getText());
    const durableEffectContract = durableEffect
      ? analyzeDurableEffectContract(fn, inputs, outputs)
      : undefined;

    const isAsync = returnsPromise(fn);

    // Convert defaultConfig
    let defaultConfig: TNodeTypeDefaultConfig | undefined = undefined;
    if (config.defaultConfig) {
      defaultConfig = {
        label: config.defaultConfig.label,
        description: config.defaultConfig.description,
        pullExecution: config.defaultConfig.pullExecution,
      };
    }

    // Extract unique scope names from ports (per-port scoped architecture)
    const portScopes = new Set<string>();
    Object.values(inputs).forEach((port) => {
      if (port.scope) portScopes.add(port.scope);
    });
    Object.values(outputs).forEach((port) => {
      if (port.scope) portScopes.add(port.scope);
    });

    // Determine scopes array:
    // - If node has node-level scope: use that (old architecture)
    // - Otherwise if ports have scopes: use unique port scopes ordered by function parameter position
    // - Otherwise: undefined (no scopes)
    let scopes: string[] | undefined;
    if (config.scope) {
      scopes = [config.scope];
    } else if (portScopes.size > 0) {
      // Order scopes by function parameter position (callback params whose name matches a scope)
      const orderedScopes: string[] = [];
      try {
        const params = fn.getParameters();
        for (const param of params) {
          const paramName = param.getName();
          if (portScopes.has(paramName)) {
            orderedScopes.push(paramName);
          }
        }
      } catch {
        // Fall back to Set order if parameter extraction fails
      }
      // Add any scopes not found as params (e.g. from JSDoc-only scope declarations)
      for (const scope of portScopes) {
        if (!orderedScopes.includes(scope)) {
          orderedScopes.push(scope);
        }
      }
      scopes = orderedScopes;
    }

    nodeTypes.push({
      type: 'NodeType',
      name: nodeTypeName,
      functionName,
      variant: isStub ? 'STUB' : 'FUNCTION',
      inputs,
      outputs,
      hasSuccessPort: RESERVED_PORT_NAMES.ON_SUCCESS in outputs,
      hasFailurePort: RESERVED_PORT_NAMES.ON_FAILURE in outputs,
      isAsync,
      functionText,
      ...(durableGate && { durableGate }),
      ...(durableEffect && { durableEffect: true }),
      ...(durableEffectContract && { durableEffectContract }),
      ...(durablePure && { durablePure: true }),
      ...(config.resilience && { resilience: config.resilience }),
      executeWhen: (config.executeWhen as TExecuteWhen) || EXECUTION_STRATEGIES.CONJUNCTION,
      defaultConfig,
      scope: config.scope,
      scopes,
      ...(config.expression && { expression: true }),
      ...(fn.getDeclarationKind?.() && { declarationKind: fn.getDeclarationKind!() }),
      label: config.label,
      description: config.description,
      visuals:
        config.color || config.icon || config.tags
          ? {
              color: config.color,
              icon: config.icon,
              tags: config.tags,
            }
          : undefined,
      ...(config.deploy && { deploy: config.deploy }),
      sourceLocation: {
        file: sourceFile.getFilePath(),
        line: fn.getStartLineNumber(false),
        column: 0,
      },
    });
  });
  return nodeTypes;
}

/**
 * Infer a node type from a bare function signature (expression mode), without
 * an explicit @flowWeaver nodeType annotation.
 */
export function inferNodeTypeFromFunction(
  fn: FunctionLike,
  name: string,
  filePath: string
): TNodeTypeAST {
  const durableGate = durableGateKind(fn);
  const durableEffect = hasJsDocTag(fn, 'durableEffect');
  const durablePure = hasJsDocTag(fn, 'durablePure');

  // Infer inputs from parameters
  const inputs: Record<string, TPortDefinition> = {};
  const params = fn.getParameters();
  const firstParamIsExecute = params.length > 0 && params[0].getName() === 'execute';
  const authoredInputParams = durableEffect ? params.slice(0, -1) : params;
  for (const param of authoredInputParams) {
    const paramName = param.getName();
    const optional = param.isOptional() || param.hasInitializer();
    const rawTsType = param.getType().getText(param);
    const tsType = optional ? stripOptionalUndefined(rawTsType) : rawTsType;
    const dataType = inferDataTypeFromTS(tsType);
    inputs[paramName] = {
      dataType,
      optional: optional || undefined,
      label: capitalize(paramName),
      tsType,
    };
  }

  // Infer outputs from return type
  const outputs: Record<string, TPortDefinition> = {};
  let returnType = fn.getReturnType();
  const returnTypeText = returnType.getText();

  // Unwrap Promise<T>
  if (returnTypeText.startsWith('Promise<')) {
    const typeArgs = returnType.getTypeArguments();
    if (typeArgs && typeArgs.length > 0) {
      returnType = typeArgs[0];
    }
  }

  if (durableEffect) {
    const effectResult = returnType.getProperty('result');
    if (effectResult) {
      returnType = effectResult.getTypeAtLocation(fn.getTypeResolutionNode());
    }
  }

  const unwrappedText = returnType.getText();

  if (unwrappedText !== 'void' && unwrappedText !== 'undefined') {
    const primitiveTypes = new Set(['string', 'number', 'boolean', 'any', 'unknown', 'never']);
    const isPrimitive = primitiveTypes.has(unwrappedText);
    const isArray = unwrappedText.endsWith('[]') || unwrappedText.startsWith('Array<');

    const properties = returnType.getProperties();
    const isObjectLike =
      !isPrimitive && !isArray && returnType.isObject() && properties.length > 0;

    if (isObjectLike) {
      for (const prop of properties) {
        const propName = prop.getName();
        if (propName === 'onSuccess' || propName === 'onFailure') continue;
        const propType = prop.getTypeAtLocation(fn.getTypeResolutionNode());
        const propTypeText = propType.getText();
        const dataType = inferDataTypeFromTS(propTypeText);
        outputs[propName] = {
          dataType,
          label: capitalize(propName),
          tsType: propTypeText,
        };
      }
    } else {
      const dataType = inferDataTypeFromTS(unwrappedText);
      outputs.result = {
        dataType,
        label: 'Result',
        tsType: unwrappedText,
      };
    }
  }

  // Add mandatory ports
  inputs.execute = { dataType: 'STEP', label: 'Execute' };
  outputs.onSuccess = { dataType: 'STEP', label: 'On Success', isControlFlow: true };
  outputs.onFailure = {
    dataType: 'STEP',
    label: 'On Failure',
    failure: true,
    isControlFlow: true,
  };

  // Assign implicit port orders
  assignImplicitPortOrders(inputs);
  assignImplicitPortOrders(outputs);

  // Build TNodeTypeAST
  const jsDocs = fn.getJsDocs();
  const jsDocText = jsDocs.map((doc: JSDoc) => doc.getText()).join('\n');
  const functionText = jsDocText ? `${jsDocText}\n${fn.getText()}` : fn.getText();
  const durableEffectContract = durableEffect
    ? analyzeDurableEffectContract(fn, inputs, outputs)
    : undefined;

  return {
    type: 'NodeType',
    name,
    functionName: name,
    variant: 'FUNCTION',
    inputs,
    outputs,
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: returnsPromise(fn),
    executeWhen: EXECUTION_STRATEGIES.CONJUNCTION as TExecuteWhen,
    expression: !firstParamIsExecute, // Expression only if original function lacks execute as first param
    inferred: true,
    functionText,
    ...(durableGate && { durableGate }),
    ...(durableEffect && { durableEffect: true }),
    ...(durableEffectContract && { durableEffectContract }),
    ...(durablePure && { durablePure: true }),
    ...(fn.getDeclarationKind?.() && {
      declarationKind: fn.getDeclarationKind!(),
    }),
    sourceLocation: {
      file: filePath,
      line: fn.getStartLineNumber(false),
      column: 0,
    },
  };
}

/**
 * Pre-infer ALL unannotated functions from a source file.
 * Used for imported files so the named-import filter can scope them.
 */
export function inferAllUnannotatedFunctions(
  sourceFile: SourceFile,
  existingNodeTypes: TNodeTypeAST[]
): TNodeTypeAST[] {
  const allFunctions = extractFunctionLikes(sourceFile);
  const existingNames = new Set<string>();
  for (const nt of existingNodeTypes) {
    existingNames.add(nt.name);
    existingNames.add(nt.functionName);
  }

  const inferred: TNodeTypeAST[] = [];
  for (const fn of allFunctions) {
    const fnName = fn.getName();
    if (!fnName) continue;

    // Skip if already known (annotated or from another source)
    if (existingNames.has(fnName)) continue;

    // Must NOT have a valid @flowWeaver annotation
    if (hasFlowWeaverAnnotation(fn)) continue;

    inferred.push(inferNodeTypeFromFunction(fn, fnName, sourceFile.getFilePath()));
    existingNames.add(fnName);
  }

  return inferred;
}

/**
 * Auto-infer node types from unannotated functions referenced by @node.
 *
 * When a workflow references a function via @node that has no @flowWeaver
 * nodeType annotation, we infer an expression node type from its TypeScript
 * signature. Phase 1: same-file functions only.
 */
export function inferNodeTypesFromUnannotated(
  sourceFile: SourceFile,
  existingNodeTypes: TNodeTypeAST[],
  localNodeTypes: TNodeTypeAST[],
  warnings: string[]
): TNodeTypeAST[] {
  const allFunctions = extractFunctionLikes(sourceFile);

  // 1. Pre-scan workflows for @node references to collect referenced type names
  const referencedTypes = new Set<string>();
  for (const fn of allFunctions) {
    const config = jsdocParser.parseWorkflow(fn, []);
    if (!config) continue;
    for (const inst of config.instances || []) {
      referencedTypes.add(inst.type);
    }
  }

  // 2. Find unresolved types: referenced but not in existingNodeTypes
  const existingNames = new Set<string>();
  for (const nt of existingNodeTypes) {
    existingNames.add(nt.name);
    existingNames.add(nt.functionName);
  }
  const unresolvedTypes = new Set<string>();
  for (const typeName of referencedTypes) {
    if (!existingNames.has(typeName)) {
      unresolvedTypes.add(typeName);
    }
  }

  if (unresolvedTypes.size === 0) return [];

  // 3. Match unresolved types to unannotated functions OR built-in nodes
  const inferredNodeTypes: TNodeTypeAST[] = [];
  const alreadyInferred = new Set<string>();
  const builtInByName = new Map(BUILT_IN_NODE_TYPES.map((nt) => [nt.name, nt]));
  const annotatedNames = new Set(localNodeTypes.map((nt) => nt.functionName));

  for (const unresolvedType of unresolvedTypes) {
    if (alreadyInferred.has(unresolvedType)) continue;

    // 3a. Check built-in nodes first
    const builtIn = builtInByName.get(unresolvedType);
    if (builtIn) {
      inferredNodeTypes.push(builtIn);
      alreadyInferred.add(unresolvedType);

      // Warn if a local unannotated function has the same name (it will be shadowed)
      if (!annotatedNames.has(unresolvedType)) {
        const shadowFn = allFunctions.find((fn) => fn.getName() === unresolvedType && !hasFlowWeaverAnnotation(fn));
        if (shadowFn) {
          warnings.push(
            `Function '${unresolvedType}' exists in this file but is not annotated with @flowWeaver nodeType. ` +
            `The built-in '${unresolvedType}' will be used instead. Add @flowWeaver nodeType to use your version.`
          );
        }
      }
      continue;
    }

    // 3b. Match unannotated local function
    const matchedFn = allFunctions.find((fn) => {
      if (fn.getName() !== unresolvedType) return false;
      return !hasFlowWeaverAnnotation(fn);
    });

    if (!matchedFn) continue;

    inferredNodeTypes.push(
      inferNodeTypeFromFunction(matchedFn, unresolvedType, sourceFile.getFilePath())
    );
    alreadyInferred.add(unresolvedType);
  }

  return inferredNodeTypes;
}

/**
 * Detect whether a function carries a valid @flowWeaver annotation
 * (nodeType, its `node` shorthand, or workflow). Avoids false positives from
 * file-level JSDoc that merely mentions @flowWeaver in description text.
 */
export function hasFlowWeaverAnnotation(fn: FunctionLike): boolean {
  const validTypes = new Set(['nodeType', 'node', 'workflow']);
  return fn.getJsDocs().some((doc) =>
    doc.getTags().some((t) => {
      if (t.getTagName() !== 'flowWeaver') return false;
      const comment = t.getCommentText?.()?.trim() || '';
      return validTypes.has(comment.split(/\s/)[0]);
    })
  );
}
