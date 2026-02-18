import type {
  TBranchingStrategy,
  TConnectionAST,
  TDataType,
  TExecuteWhen,
  TImportDeclaration,
  TImportSpecifier,
  TNodeTypeAST,
  TNodeInstanceAST,
  TPortDefinition,
  TPortReference,
  TSerializableValue,
  TWorkflowAST,
} from "./types";
import { EXECUTION_STRATEGIES } from "../constants";

/**
 * Fluent builder for constructing TWorkflowAST programmatically
 *
 * @example
 * ```typescript
 * const workflow = new WorkflowBuilder('myWorkflow', 'myWorkflow', './workflow.ts')
 *   .description('My workflow description')
 *   .addNodeType(nodeType)
 *   .addNodeInstance(instance)
 *   .addConnection(connection)
 *   .build();
 * ```
 */
export class WorkflowBuilder {
  private ast: TWorkflowAST;

  /**
   * Create a new workflow builder
   * @param name - Internal workflow name
   * @param functionName - Exported function name
   * @param sourceFile - Source file path
   */
  constructor(name: string, functionName: string, sourceFile: string) {
    this.ast = {
      type: "Workflow",
      sourceFile,
      name,
      functionName,
      nodeTypes: [],
      instances: [],
      connections: [],
      startPorts: {},
      exitPorts: {},
      imports: [],
    };
  }
  description(desc: string): this {
    this.ast.description = desc;
    return this;
  }
  generatedFile(path: string): this {
    this.ast.generatedFile = path;
    return this;
  }
  addNodeType(nodeType: TNodeTypeAST): this {
    this.ast.nodeTypes.push(nodeType);
    return this;
  }
  addNodeInstance(instance: TNodeInstanceAST): this {
    this.ast.instances.push(instance);
    return this;
  }
  addConnection(connection: TConnectionAST): this {
    this.ast.connections.push(connection);
    return this;
  }
  addScope(scopeName: string, instanceIds: string[]): this {
    if (!this.ast.scopes) {
      this.ast.scopes = {};
    }
    this.ast.scopes[scopeName] = instanceIds;
    return this;
  }
  addImport(importDecl: TImportDeclaration): this {
    this.ast.imports.push(importDecl);
    return this;
  }
  metadata(key: string, value: unknown): this {
    if (!this.ast.metadata) {
      this.ast.metadata = {};
    }
    this.ast.metadata[key] = value;
    return this;
  }
  /** Build and return the final TWorkflowAST */
  build(): TWorkflowAST {
    return this.ast;
  }
}

/**
 * Fluent builder for constructing TNodeTypeAST programmatically
 *
 * NodeTypes are templates that can be instantiated multiple times in a workflow.
 *
 * @example
 * ```typescript
 * const addNode = new NodeTypeBuilder('Add', 'add')
 *   .label('Add Numbers')
 *   .input('a', { dataType: 'NUMBER' })
 *   .input('b', { dataType: 'NUMBER' })
 *   .output('sum', { dataType: 'NUMBER' })
 *   .successPort(true)
 *   .build();
 * ```
 */
export class NodeTypeBuilder {
  private nodeType: TNodeTypeAST;

  /**
   * Create a new node type builder
   * @param name - Unique node type name
   * @param functionName - Name of the implementing function
   */
  constructor(name: string, functionName: string) {
    this.nodeType = {
      type: "NodeType",
      name,
      functionName,
      inputs: {},
      outputs: {},
      hasSuccessPort: false,
      hasFailurePort: false,
      executeWhen: EXECUTION_STRATEGIES.CONJUNCTION,
      isAsync: false,
    };
  }
  label(label: string): this {
    this.nodeType.label = label;
    return this;
  }
  description(desc: string): this {
    this.nodeType.description = desc;
    return this;
  }
  scope(scopeName: string): this {
    this.nodeType.scope = scopeName;
    return this;
  }
  input(name: string, definition: TPortDefinition): this {
    this.nodeType.inputs[name] = definition;
    return this;
  }
  output(name: string, definition: TPortDefinition): this {
    this.nodeType.outputs[name] = definition;
    return this;
  }
  successPort(enabled: boolean = true): this {
    this.nodeType.hasSuccessPort = enabled;
    return this;
  }
  failurePort(enabled: boolean = true): this {
    this.nodeType.hasFailurePort = enabled;
    return this;
  }
  executeWhen(when: TExecuteWhen): this {
    this.nodeType.executeWhen = when;
    return this;
  }
  branchingStrategy(strategy: TBranchingStrategy, field?: string): this {
    this.nodeType.branchingStrategy = strategy;
    if (field) {
      this.nodeType.branchField = field;
    }
    return this;
  }
  defaultConfig(config: import("./types").TNodeTypeDefaultConfig): this {
    this.nodeType.defaultConfig = config;
    return this;
  }
  metadata(key: string, value: unknown): this {
    if (!this.nodeType.metadata) {
      this.nodeType.metadata = {};
    }
    this.nodeType.metadata[key] = value;
    return this;
  }
  /** Build and return the final TNodeTypeAST */
  build(): TNodeTypeAST {
    return this.nodeType;
  }
}

/**
 * Fluent builder for constructing TNodeInstanceAST programmatically
 *
 * NodeInstances are the actual nodes placed in a workflow, referencing a NodeType template.
 *
 * @example
 * ```typescript
 * const adder1 = new NodeInstanceBuilder('adder1', 'Add')
 *   .config({ pullExecution: true })
 *   .build();
 * ```
 */
export class NodeInstanceBuilder {
  private instance: TNodeInstanceAST;

  /**
   * Create a new node instance builder
   * @param id - Unique instance ID within the workflow
   * @param nodeType - Name of the NodeType this instance references
   */
  constructor(id: string, nodeType: string) {
    this.instance = {
      type: "NodeInstance",
      id,
      nodeType,
    };
  }
  config(configData: import("./types").TNodeInstanceConfig): this {
    this.instance.config = configData;
    return this;
  }
  parentScope(scope: string): this {
    // scope format is "parentNodeId.scopeName"
    const dotIndex = scope.indexOf('.');
    const parentNodeName = dotIndex > 0 ? scope.substring(0, dotIndex) : scope;
    const scopeName = dotIndex > 0 ? scope.substring(dotIndex + 1) : '';
    this.instance.parent = { id: parentNodeName, scope: scopeName };
    return this;
  }
  metadata(key: string, value: unknown): this {
    if (!this.instance.metadata) {
      this.instance.metadata = {};
    }
    this.instance.metadata[key] = value;
    return this;
  }
  /** Build and return the final TNodeInstanceAST */
  build(): TNodeInstanceAST {
    return this.instance;
  }
}

/**
 * Fluent builder for constructing TConnectionAST programmatically
 *
 * @example
 * ```typescript
 * const conn = new ConnectionBuilder(
 *   { node: 'Start', port: 'x' },
 *   { node: 'adder1', port: 'a' }
 * )
 *   .dataFlow(true)
 *   .build();
 * ```
 */
export class ConnectionBuilder {
  private connection: TConnectionAST;

  /**
   * Create a new connection builder
   * @param from - Source port reference
   * @param to - Target port reference
   */
  constructor(from: TPortReference, to: TPortReference) {
    this.connection = {
      type: "Connection",
      from,
      to,
    };
  }
  controlFlow(isControlFlow: boolean = true): this {
    if (!this.connection.metadata) {
      this.connection.metadata = {};
    }
    this.connection.metadata.isControlFlow = isControlFlow;
    return this;
  }
  dataFlow(isDataFlow: boolean = true): this {
    if (!this.connection.metadata) {
      this.connection.metadata = {};
    }
    this.connection.metadata.isDataFlow = isDataFlow;
    return this;
  }
  metadata(key: string, value: unknown): this {
    if (!this.connection.metadata) {
      this.connection.metadata = {};
    }
    this.connection.metadata[key] = value;
    return this;
  }

  /** Build and return the final TConnectionAST */
  build(): TConnectionAST {
    return this.connection;
  }
}

/**
 * Helper function to create a PortReference
 * @param node - Node ID
 * @param port - Port name
 * @returns TPortReference object
 */
export function portRef(node: string, port: string): TPortReference {
  return { node, port };
}

/**
 * Helper function to create a PortDefinition
 * @param dataType - The data type of the port
 * @param options - Optional port configuration
 * @returns TPortDefinition object
 */
export function port(
  dataType: TDataType,
  options?: {
    optional?: boolean;
    default?: TSerializableValue;
    label?: string;
    description?: string;
  },
): TPortDefinition {
  return {
    dataType,
    ...options,
  };
}

/**
 * Helper function to create an ImportDeclaration
 * @param specifiers - Import specifiers (named, default, or namespace)
 * @param source - Module path to import from
 * @param importKind - Whether this is a value or type import
 * @returns TImportDeclaration object
 */
export function importDecl(
  specifiers: TImportSpecifier[],
  source: string,
  importKind: "value" | "type" = "value",
): TImportDeclaration {
  return {
    type: "Import",
    specifiers,
    source,
    importKind,
  };
}

/**
 * Helper function to create a named import specifier
 * @param name - Name of the imported symbol
 * @param alias - Optional local alias
 * @returns TImportSpecifier for named import
 */
export function namedImport(name: string, alias?: string): TImportSpecifier {
  return {
    imported: name,
    local: alias || name,
    kind: "named",
  };
}

/**
 * Helper function to create a default import specifier
 * @param name - Local name for the default import
 * @returns TImportSpecifier for default import
 */
export function defaultImport(name: string): TImportSpecifier {
  return {
    imported: "default",
    local: name,
    kind: "default",
  };
}

/**
 * Helper function to create a namespace import specifier
 * @param name - Local name for the namespace
 * @returns TImportSpecifier for namespace import
 */
export function namespaceImport(name: string): TImportSpecifier {
  return {
    imported: "*",
    local: name,
    kind: "namespace",
  };
}

/**
 * Helper function to create a WorkflowBuilder
 * @param name - Internal workflow name
 * @param functionName - Exported function name
 * @param sourceFile - Source file path
 * @returns New WorkflowBuilder instance
 */
export function workflow(
  name: string,
  functionName: string,
  sourceFile: string,
): WorkflowBuilder {
  return new WorkflowBuilder(name, functionName, sourceFile);
}

/**
 * Helper function to create a NodeTypeBuilder
 * @param name - Node type name
 * @param functionName - Implementing function name
 * @returns New NodeTypeBuilder instance
 */
export function nodeType(name: string, functionName: string): NodeTypeBuilder {
  return new NodeTypeBuilder(name, functionName);
}

/**
 * Helper function to create a NodeInstanceBuilder
 * @param id - Unique instance ID
 * @param nodeTypeName - Name of the NodeType to instantiate
 * @returns New NodeInstanceBuilder instance
 */
export function nodeInstance(id: string, nodeTypeName: string): NodeInstanceBuilder {
  return new NodeInstanceBuilder(id, nodeTypeName);
}

/**
 * Helper function to create a ConnectionBuilder
 * @param from - Source port reference
 * @param to - Target port reference
 * @returns New ConnectionBuilder instance
 */
export function connection(
  from: TPortReference,
  to: TPortReference,
): ConnectionBuilder {
  return new ConnectionBuilder(from, to);
}

/**
 * Convenience function to create a TConnectionAST directly
 * @param fromNode - Source node ID
 * @param fromPort - Source port name
 * @param toNode - Target node ID
 * @param toPort - Target port name
 * @returns Built ConnectionAST
 */
export function connect(
  fromNode: string,
  fromPort: string,
  toNode: string,
  toPort: string,
): TConnectionAST {
  return connection(
    portRef(fromNode, fromPort),
    portRef(toNode, toPort),
  ).build();
}
