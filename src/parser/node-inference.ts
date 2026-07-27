/**
 * Node-type extraction and inference, extracted from AnnotationParser (debt #5 / PR-A).
 *
 * extractNodeTypes walks a source file's @flowWeaver-annotated (and inferable)
 * functions into TNodeTypeAST[]; the infer* functions derive node types from
 * bare function signatures (expression mode); hasFlowWeaverAnnotation detects
 * the annotation. These form a closed, near-stateless group: they call only each
 * other, and the sole instance dependency (the tag-handler registry, used by
 * extractNodeTypes) is now passed as an explicit parameter. Extracting them as
 * free functions is behavior-neutral and further shrinks the parser god-class.
 */

import { type SourceFile, type JSDoc } from 'ts-morph';
import { type FunctionLike, extractFunctionLikes } from '../function-like';
import { jsdocParser } from '../jsdoc-parser';
import type {
  TNodeTypeAST,
  TDataType,
  TExecuteWhen,
  TPortDefinition,
  TNodeTypeDefaultConfig,
  TSerializableValue,
} from '../ast/types';
import { RESERVED_PORT_NAMES, EXECUTION_STRATEGIES } from '../constants';
import { assignImplicitPortOrders } from '../utils/port-ordering';
import { inferDataTypeFromTS, stripOptionalUndefined } from '../type-mappings';
import { BUILT_IN_NODE_TYPES } from '../built-in-nodes/generated-registry';
import type { TagHandlerRegistry } from './tag-registry';
import { capitalize } from './port-inference';

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

    // Ambient declarations (declare function) are stub nodes — interface only, no implementation.
    // Force expression mode so ports are inferred from the TypeScript signature.
    const isStub = fn.isAmbient?.() ?? false;
    if (isStub) {
      config.expression = true;
    }

    // Auto-infer ports for @expression nodes when @input/@output are missing.
    // If the function has @expression but no explicit port annotations, infer
    // data ports from the TypeScript function signature (same logic as unannotated functions).
    if (config.expression) {
      const hasExplicitDataInputs = Object.keys(inputs).some((k) => k !== 'execute');
      const hasExplicitDataOutputs = Object.keys(outputs).some(
        (k) => k !== 'onSuccess' && k !== 'onFailure'
      );

      if (!hasExplicitDataInputs || !hasExplicitDataOutputs) {
        const inferred = inferNodeTypeFromFunction(
          fn,
          nodeTypeName,
          fn.getSourceFile().getFilePath()
        );
        if (!hasExplicitDataInputs) {
          // Copy inferred data inputs (skip control flow ports)
          for (const [portName, portDef] of Object.entries(inferred.inputs)) {
            if (portName === 'execute') continue;
            inputs[portName] = portDef;
          }
        }
        if (!hasExplicitDataOutputs) {
          // Copy inferred data outputs (skip control flow ports)
          for (const [portName, portDef] of Object.entries(inferred.outputs)) {
            if (portName === 'onSuccess' || portName === 'onFailure') continue;
            outputs[portName] = portDef;
          }
        }
      }
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
    const durableGate = functionText?.match(
      /@durableGate\s+(approval|input|agent)\b/,
    )?.[1] as 'approval' | 'input' | 'agent' | undefined;
    const durableEffect = functionText?.includes('@durableEffect') === true;
    const durablePure = functionText?.includes('@durablePure') === true;

    // Detect async keyword on function declaration
    const isAsync = fn.isAsync();

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
      ...(durablePure && { durablePure: true }),
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
  // Infer inputs from parameters
  const inputs: Record<string, TPortDefinition> = {};
  const params = fn.getParameters();
  const firstParamIsExecute = params.length > 0 && params[0].getName() === 'execute';
  for (const param of params) {
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
  const durableGate = functionText.match(
    /@durableGate\s+(approval|input|agent)\b/,
  )?.[1] as 'approval' | 'input' | 'agent' | undefined;
  const durableEffect = functionText.includes('@durableEffect');
  const durablePure = functionText.includes('@durablePure');

  return {
    type: 'NodeType',
    name,
    functionName: name,
    variant: 'FUNCTION',
    inputs,
    outputs,
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: fn.isAsync() || returnTypeText.startsWith('Promise<'),
    executeWhen: EXECUTION_STRATEGIES.CONJUNCTION as TExecuteWhen,
    expression: !firstParamIsExecute, // Expression only if original function lacks execute as first param
    inferred: true,
    functionText,
    ...(durableGate && { durableGate }),
    ...(durableEffect && { durableEffect: true }),
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
 * (nodeType, workflow, or pattern). Avoids false positives from file-level
 * JSDoc that merely mentions @flowWeaver in description text.
 */
export function hasFlowWeaverAnnotation(fn: FunctionLike): boolean {
  const validTypes = new Set(['nodeType', 'workflow', 'pattern']);
  return fn.getJsDocs().some((doc) =>
    doc.getTags().some((t) => {
      if (t.getTagName() !== 'flowWeaver') return false;
      const comment = t.getCommentText?.()?.trim() || '';
      return validTypes.has(comment.split(/\s/)[0]);
    })
  );
}
