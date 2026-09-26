/**
 * How a source file's `@flowWeaver workflow` functions become workflow ASTs.
 *
 * Decides the two passes over a file: a signature pass (name, Start and Exit
 * ports, async-ness) that lets workflows in the same file call each other as
 * node types, and the full pass that turns a workflow's JSDoc config into
 * instances and connections, expands its macros (`@autoConnect`, `@map`,
 * `@path`, `@fanOut`, `@fanIn`, `@coerce`, `[expr: ...]` references), picks
 * the node types the workflow carries (with `@fwImport` types and their stub
 * fallbacks), and builds its options. Resolving an `@fwImport` is delegated to
 * the caller, which owns the import state.
 */
import type { SourceFile } from 'ts-morph';
import { type FunctionLike, extractFunctionLikes } from './function-like';
import { jsdocParser } from './jsdoc-parser';
import type {
  TNodeTypeAST,
  TWorkflowAST,
  TConnectionAST,
  TNodeInstanceAST,
  TWorkflowMacro,
} from '../ast/types';
import { EXECUTION_STRATEGIES } from '../constants';
import { COERCION_NODE_TYPES } from '../built-in-nodes/coercion-types';
import type { TagHandlerRegistry } from './tag-registry';
import {
  expandMapMacro,
  expandPathMacros,
  expandFanOutMacros,
  expandFanInMacros,
  expandCoerceMacros,
  generateAutoConnections,
} from './macro-expansion';
import { expandExpressionReferences, collectModuleBindings } from './expression-references';
import { parseStartPorts, parseExitPorts } from './port-inference';
import { isImportStub } from './import-stub';

/** Resolves one `@fwImport` annotation of the workflow in `currentFilePath` to a node type. */
export type ImportAnnotationResolver = (
  imp: { name: string; functionName: string; importSource: string },
  currentFilePath: string,
  warnings: string[],
) => TNodeTypeAST;

/**
 * Core option keys that must never be shadowed by a pack deploy namespace when
 * promoting `deploy[namespace]` to a top-level `options.<namespace>` mirror.
 */
const RESERVED_OPTION_KEYS = new Set([
  'strictTypes', 'autoConnect', 'trigger', 'http', 'cancelOn', 'retries', 'timeout',
  'throttle', 'deploy',
]);

/**
 * Promote each pack deploy namespace to a top-level `options.<namespace>`
 * convenience mirror (e.g. `deploy['<pack>']` -> `options.<pack>`). Packs type these
 * fields via module augmentation of TWorkflowOptions, while core stays namespace-
 * agnostic. Returns a partial options object to spread. Reserved core keys are
 * skipped so a namespace can never clobber a built-in option.
 */
function promoteDeployNamespaces(
  deploy: Record<string, Record<string, unknown>> | undefined,
): Record<string, unknown> {
  if (!deploy) return {};
  const promoted: Record<string, unknown> = {};
  for (const [namespace, data] of Object.entries(deploy)) {
    if (RESERVED_OPTION_KEYS.has(namespace)) continue;
    if (data && typeof data === 'object') promoted[namespace] = data;
  }
  return promoted;
}

/**
 * First pass: each workflow's name, Start and Exit ports and async-ness, with
 * no instances or connections, so same-file workflows can be offered as node
 * types before the full pass.
 */
export function extractWorkflowSignatures(
  sourceFile: SourceFile,
  filePath: string,
  warnings: string[],
  tagRegistry: TagHandlerRegistry,
): TWorkflowAST[] {
  const workflows: TWorkflowAST[] = [];
  extractFunctionLikes(sourceFile).forEach((fn: FunctionLike) => {
    const config = jsdocParser.parseWorkflow(fn, warnings, tagRegistry);
    if (!config) return;

    const functionName = fn.getName() || 'anonymous';
    const startPorts = parseStartPorts(fn, config);
    const exitPorts = parseExitPorts(fn, config, warnings);
    const userSpecifiedAsync = fn.isAsync();

    workflows.push({
      type: 'Workflow',
      sourceFile: filePath,
      name: config.name || functionName,
      functionName,
      nodeTypes: [],
      instances: [],
      connections: [],
      startPorts,
      exitPorts,
      imports: [],
      description: config.description,
      userSpecifiedAsync,
    });
  });
  return workflows;
}

/**
 * Convert a workflow to a node type.
 * This allows workflows to be used as nodes in other workflows.
 */
export function workflowToNodeType(workflow: TWorkflowAST): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: workflow.name,
    functionName: workflow.functionName,
    variant: 'IMPORTED_WORKFLOW',
    path: workflow.sourceFile,
    inputs: { ...workflow.startPorts },
    outputs: { ...workflow.exitPorts },
    hasSuccessPort: 'onSuccess' in workflow.exitPorts,
    hasFailurePort: 'onFailure' in workflow.exitPorts,
    isAsync: workflow.userSpecifiedAsync || false,
    executeWhen: EXECUTION_STRATEGIES.CONJUNCTION,
    description: workflow.description,
    sourceLocation: {
      file: workflow.sourceFile,
      line: 0,
      column: 0,
    },
  };
}

/**
 * Full pass: build the AST of every `@flowWeaver workflow` function in
 * `sourceFile` against `availableNodeTypes`. Problems go to `errors` and
 * `warnings`; each `@fwImport` is resolved through `resolveImport`.
 */
export function extractWorkflows(
  sourceFile: SourceFile,
  availableNodeTypes: TNodeTypeAST[],
  filePath: string,
  errors: string[],
  warnings: string[],
  tagRegistry: TagHandlerRegistry,
  resolveImport: ImportAnnotationResolver,
): TWorkflowAST[] {
  const workflows: TWorkflowAST[] = [];
  const allFunctions = extractFunctionLikes(sourceFile);
  // Collect all function names in the file for unannotated-function hints in validator
  const allFunctionNames = allFunctions
    .map((fn: FunctionLike) => fn.getName())
    .filter((name): name is string => !!name);
  allFunctions.forEach((fn: FunctionLike) => {
    // Parse JSDoc comments
    const config = jsdocParser.parseWorkflow(fn, warnings, tagRegistry);
    if (!config) {
      const jsdocText = fn.getJsDocs().map((d) => d.getFullText()).join('');
      if (jsdocText.includes('@flowWeaver workflow')) {
        warnings.push(
          `Function "${fn.getName() || 'anonymous'}" has @flowWeaver annotation but could not be parsed. ` +
          `Check for special characters (---) or malformed JSDoc syntax.`
        );
      }
      return;
    }

    const functionName = fn.getName() || 'anonymous';

    // "IN" and "OUT" are not real nodes; a workflow's boundaries are "Start"
    // and "Exit".
    if (config.connections) {
      for (const conn of config.connections) {
        if (conn.from.node === 'IN' || conn.from.node === 'OUT') {
          errors.push(
            `Workflow "${functionName}" uses "${conn.from.node}", which is not a node. Use "Start" or "Exit" instead.`
          );
        }
        if (conn.to.node === 'IN' || conn.to.node === 'OUT') {
          errors.push(
            `Workflow "${functionName}" uses "${conn.to.node}", which is not a node. Use "Start" or "Exit" instead.`
          );
        }
      }
    }

    // Detect async keyword on workflow function declaration
    const userSpecifiedAsync = fn.isAsync();
    const startPorts = parseStartPorts(fn, config);
    const exitPorts = parseExitPorts(fn, config, warnings);

    // Convert @fwImport annotations to properly inferred node types
    // These are persisted in JSDoc so they survive file re-parsing
    // Uses the same inference logic as TS imports for consistency
    const importedNpmNodeTypes: TNodeTypeAST[] = (config.imports || []).map((imp) =>
      resolveImport(imp, filePath, warnings)
    );

    // Post-resolution check: warn when inferred node type has zero data ports
    // (excluding control-flow ports). This usually means the .d.ts inference
    // couldn't extract meaningful port info and a local wrapper is needed.
    for (const nt of importedNpmNodeTypes) {
      const dataInputs = Object.keys(nt.inputs).filter((p) => p !== 'execute');
      const nonControlOutputs = Object.keys(nt.outputs).filter(
        (p) => p !== 'onSuccess' && p !== 'onFailure'
      );
      // Stub fallback has only result: ANY — if that's all we have with zero
      // data inputs, inference likely failed
      const isStubOnly =
        nonControlOutputs.length === 1 &&
        nonControlOutputs[0] === 'result' &&
        nt.outputs.result?.dataType === 'ANY';

      if (dataInputs.length === 0 && isStubOnly) {
        warnings.push(
          `Could not infer ports for "${nt.functionName}" from "${nt.importSource}". ` +
          `Wrap it in a local function with @flowWeaver nodeType annotations instead.`
        );
      }
    }

    // Combine available node types with imported npm types for validation
    const allAvailableNodeTypes = [...availableNodeTypes, ...importedNpmNodeTypes];

    // Convert instances to NodeInstanceAST. An instance whose node type does
    // not exist is kept as written: the validator reports it once, as
    // UNKNOWN_NODE_TYPE, with a hint about the closest name.
    const instances: TNodeInstanceAST[] = (config.instances || []).map((inst) => {
      // Convert parentScope string "nodeName.scope" to parent object
      let parent: { id: string; scope: string } | undefined;
      if (inst.parentScope) {
        const dotIndex = inst.parentScope.indexOf('.');
        if (dotIndex > 0) {
          parent = {
            id: inst.parentScope.substring(0, dotIndex),
            scope: inst.parentScope.substring(dotIndex + 1),
          };
        }
      }

      // portConfigs are direction-agnostic (annotations don't carry direction info).
      // Matching code handles undefined direction by matching any direction.
      const portConfigs = inst.portConfigs;

      return {
        type: 'NodeInstance',
        id: inst.id,
        nodeType: inst.type,
        ...(parent && { parent }),
        config: {
          ...(inst.label && { label: inst.label }),
          ...(portConfigs && portConfigs.length > 0 && { portConfigs }),
          ...(inst.pullExecution && { pullExecution: inst.pullExecution }),
          ...(inst.minimized && { minimized: inst.minimized }),
          ...(inst.color && { color: inst.color }),
          ...(inst.icon && { icon: inst.icon }),
          ...(inst.tags && inst.tags.length > 0 && { tags: inst.tags }),
          ...(inst.width && { width: inst.width }),
          ...(inst.height && { height: inst.height }),
          ...(inst.suppressWarnings?.length && { suppressWarnings: inst.suppressWarnings }),
        },
        ...(inst.sourceLocation && {
          sourceLocation: { file: filePath, ...inst.sourceLocation },
        }),
        ...(inst.attributes && { attributes: inst.attributes }),
      };
    });

    // Convert connections to ConnectionAST
    const connections: TConnectionAST[] = (config.connections || []).map((conn) => ({
      type: 'Connection',
      from: conn.from,
      to: conn.to,
      ...(conn.sourceLocation && { sourceLocation: { file: filePath, ...conn.sourceLocation } }),
      ...(conn.coerce && { coerce: conn.coerce }),
    }));

    // Auto-connect: when @autoConnect is set and no explicit @connect annotations exist,
    // auto-wire linear connections between nodes in declaration order
    if (config.autoConnect && connections.length === 0 && instances.length > 0) {
      const autoConnections = generateAutoConnections(
        instances,
        allAvailableNodeTypes,
        startPorts,
        exitPorts
      );
      connections.push(...autoConnections);
    }

    // Expand @map macros into synthetic node types, instances, connections, and scopes
    const scopes = config.scopes || {};
    const macros: TWorkflowMacro[] = [];
    if (config.maps && config.maps.length > 0) {
      for (const mapConfig of config.maps) {
        expandMapMacro(
          mapConfig,
          instances,
          connections,
          scopes,
          allAvailableNodeTypes,
          macros,
          errors,
          warnings
        );
      }
    }

    // Expand @path macros into multi-step execution routes with scope walking
    if (config.paths && config.paths.length > 0) {
      expandPathMacros(
        config.paths,
        instances,
        connections,
        allAvailableNodeTypes,
        startPorts,
        exitPorts,
        macros,
        errors,
        warnings,
      );
    }

    // Expand @fanOut macros into 1-to-N connections
    if (config.fanOuts && config.fanOuts.length > 0) {
      expandFanOutMacros(config.fanOuts, instances, connections, startPorts, exitPorts, macros, errors);
    }

    // Expand @fanIn macros into N-to-1 connections
    if (config.fanIns && config.fanIns.length > 0) {
      expandFanInMacros(config.fanIns, instances, connections, startPorts, exitPorts, macros, errors);
    }

    // Expand @coerce macros into synthetic coercion nodes + connections
    if (config.coercions && config.coercions.length > 0) {
      expandCoerceMacros(config.coercions, instances, connections, startPorts, exitPorts, macros, errors);
    }

    // Upstream references inside [expr: ...] bindings become derived data
    // connections. Runs after every macro expansion so synthetic instances
    // are referenceable, and before validation so ordering, cycle detection
    // and the durable graph all see the edges.
    if (instances.some((inst) => inst.config?.portConfigs?.some((pc) => pc.expression !== undefined))) {
      expandExpressionReferences({
        instances,
        connections,
        findNodeType: (name) =>
          allAvailableNodeTypes.find((nt) => nt.name === name || nt.functionName === name),
        startPorts,
        moduleBindings: collectModuleBindings(
          sourceFile,
          new Set(allAvailableNodeTypes.map((nt) => nt.functionName)),
        ),
        errors,
      });
    }

    // Include ALL available nodeTypes in the workflow AST, plus imported npm types.
    // Previously this filtered to only nodeTypes used by instances, but that caused
    // a bug: when creating a new nodeType and then adding its first instance,
    // the second operation would re-parse the file, see no instances using the
    // nodeType yet, filter it out, and then removeOrphanedNodeTypeFunctions would
    // delete the nodeType function that was just written.
    // NPM types come from @import annotations in JSDoc (persisted to survive re-parsing).
    // Deduplicate: @fwImport types take precedence over external/runtime types with the same name.
    // Without this, each parse+generate cycle adds one more duplicate @fwImport entry.
    //
    // EXCEPTION (offline-device): when an `@fwImport` package cannot be
    // resolved on disk (a Console install dir has no `node_modules` to
    // read the package `.d.ts` from), `resolveImportAnnotation` returns a
    // port-less STUB (`inputs: {}`, `outputs: { result }`). A stub must
    // NOT shadow a real same-named type the caller supplied via
    // `externalNodeTypes` (resolved from the install's wire manifest):
    // that real type carries the actual ports, and letting the stub win
    // makes every `@connect` to the node fail validation with "does not
    // have port ...". So for a stub import, if a real same-named type is
    // available, drop the stub and keep the real type (preserving its
    // `importSource` so `@fwImport` re-emission still writes the import).
    const realNameToType = new Map<string, TNodeTypeAST>();
    for (const nt of allAvailableNodeTypes) {
      if (!isImportStub(nt) && !importedNpmNodeTypes.includes(nt)) {
        realNameToType.set(nt.name, nt);
      }
    }
    const resolvedImportedTypes: TNodeTypeAST[] = importedNpmNodeTypes.map((imp) => {
      if (isImportStub(imp)) {
        const real = realNameToType.get(imp.name);
        if (real) {
          const merged: TNodeTypeAST = { ...real };
          const impSource = (imp as { importSource?: string }).importSource;
          if (impSource) (merged as { importSource?: string }).importSource = impSource;
          return merged;
        }
      }
      return imp;
    });
    const importedNames = new Set(resolvedImportedTypes.map((nt) => nt.name));
    // Use allAvailableNodeTypes (includes synthetic MAP_ITERATOR types from @map macros)
    const dedupedAvailableTypes = allAvailableNodeTypes.filter((nt) => !importedNames.has(nt.name));
    const workflowNodeTypes = [...dedupedAvailableTypes, ...resolvedImportedTypes];

    // Inject synthetic coercion node types for any __fw_ instances
    for (const inst of instances) {
      if (inst.nodeType.startsWith('__fw_') && COERCION_NODE_TYPES[inst.nodeType]) {
        if (!workflowNodeTypes.some(nt => nt.functionName === inst.nodeType)) {
          workflowNodeTypes.push(COERCION_NODE_TYPES[inst.nodeType]);
        }
      }
    }

    workflows.push({
      type: 'Workflow',
      sourceFile: filePath,
      name: config.name || functionName,
      functionName: functionName,
      nodeTypes: workflowNodeTypes,
      instances,
      connections,
      scopes,
      startPorts,
      exitPorts,
      imports: [],
      description: config.description,
      userSpecifiedAsync,
      availableFunctionNames: allFunctionNames,
      ...(macros.length > 0 && { macros }),
      ...((config.strictTypes !== undefined || config.autoConnect ||
           config.trigger || config.http || config.cancelOn || config.retries !== undefined ||
           config.timeout || config.throttle || config.deploy) && {
        options: {
          ...(config.strictTypes !== undefined && { strictTypes: config.strictTypes }),
          ...(config.autoConnect && { autoConnect: true }),
          ...(config.trigger && { trigger: config.trigger }),
          ...(config.http && config.http.length > 0 && { http: config.http }),
          ...(config.cancelOn && { cancelOn: config.cancelOn }),
          ...(config.retries !== undefined && { retries: config.retries }),
          ...(config.timeout && { timeout: config.timeout }),
          ...(config.throttle && { throttle: config.throttle }),
          // Surface each pack deploy namespace as a top-level options.<namespace>
          // convenience mirror (e.g. options.<pack> from deploy['<pack>']). Packs
          // type these fields via module augmentation of TWorkflowOptions; core
          // stays namespace-agnostic and keeps no vendor vocabulary.
          ...promoteDeployNamespaces(config.deploy),
          // Per-target deployment config
          ...(config.deploy && { deploy: config.deploy }),
        },
      }),
    });
  });
  return workflows;
}
