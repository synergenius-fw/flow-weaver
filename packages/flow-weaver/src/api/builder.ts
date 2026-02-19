/**
 * Builder API for fluent workflow construction
 * Provides chainable methods for creating workflows programmatically
 */

import { produce } from "immer";
import type {
  TWorkflowAST,
  TNodeTypeAST,
  TNodeInstanceAST,
  TConnectionAST,
  TPortDefinition,
  TPortReference,
} from "../ast/types";
import { validateWorkflow } from "./validate";
import { validatePortReference } from "./helpers";

/**
 * Fluent builder for constructing workflows programmatically
 *
 * @example
 * ```typescript
 * const workflow = new WorkflowBuilder('myWorkflow')
 *   .addStartPort('input', { dataType: 'NUMBER' })
 *   .addExitPort('output', { dataType: 'NUMBER' })
 *   .addNodeType({
 *     type: 'NodeType',
 *     name: 'double',
 *     functionName: 'double',
 *     inputs: { x: { dataType: 'NUMBER' } },
 *     outputs: { result: { dataType: 'NUMBER' } },
 *     hasSuccessPort: true,
 *     hasFailurePort: true,
 *     executeWhen: 'CONJUNCTION'
 *   })
 *   .addNode('doubler', 'double')
 *   .connect('Start.input', 'doubler.x')
 *   .connect('doubler.result', 'Exit.output')
 *   .build();
 * ```
 */
export class WorkflowBuilder {
  private ast: TWorkflowAST;

  /**
   * Create a new workflow builder
   *
   * @param name - Workflow name (also used as functionName)
   * @param sourceFile - Optional source file path
   */
  constructor(name: string, sourceFile: string = `${name}.ts`) {
    this.ast = {
      type: "Workflow",
      name,
      functionName: name,
      sourceFile,
      nodeTypes: [],
      instances: [],
      connections: [],
      scopes: {},
      startPorts: {},
      exitPorts: {},
      imports: [],
    };
  }

  /**
   * Add a Start port to the workflow
   *
   * @param name - Port name
   * @param definition - Port definition
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.addStartPort('userId', { dataType: 'STRING' });
   * ```
   */
  addStartPort(name: string, definition: TPortDefinition): this {
    // Use simplified type to avoid excessive type instantiation
    this.ast = produce(this.ast, (draft: { startPorts: Record<string, TPortDefinition> }) => {
      draft.startPorts[name] = definition;
    }) as TWorkflowAST;
    return this;
  }

  /**
   * Add an Exit port to the workflow
   *
   * @param name - Port name
   * @param definition - Port definition
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.addExitPort('result', { dataType: 'NUMBER' });
   * ```
   */
  addExitPort(name: string, definition: TPortDefinition): this {
    // Use simplified type to avoid excessive type instantiation
    this.ast = produce(this.ast, (draft: { exitPorts: Record<string, TPortDefinition> }) => {
      draft.exitPorts[name] = definition;
    }) as TWorkflowAST;
    return this;
  }

  /**
   * Add a node type definition
   *
   * @param nodeType - Complete node type definition
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.addNodeType({
   *   type: 'NodeType',
   *   name: 'processor',
   *   functionName: 'process',
   *   inputs: { data: { dataType: 'ANY' } },
   *   outputs: { result: { dataType: 'ANY' } },
   *   hasSuccessPort: true,
   *   hasFailurePort: true,
   *   executeWhen: 'CONJUNCTION'
   * });
   * ```
   */
  addNodeType(nodeType: TNodeTypeAST): this {
    // Validate before produce to avoid type instantiation issues
    if (this.ast.nodeTypes.some((nt) => nt.name === nodeType.name)) {
      throw new Error(`Node type "${nodeType.name}" already exists`);
    }
    // Use simplified type to avoid excessive type instantiation
    this.ast = produce(this.ast, (draft: { nodeTypes: TNodeTypeAST[] }) => {
      draft.nodeTypes.push(nodeType);
    }) as TWorkflowAST;
    return this;
  }

  /**
   * Add a node instance
   *
   * @param id - Node instance ID
   * @param nodeType - Node type (functionName)
   * @param config - Optional node configuration
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.addNode('processor1', 'process');
   * builder.addNode('processor2', 'process', { x: 100, y: 200, label: 'Main' });
   * ```
   */
  addNode(
    id: string,
    nodeType: string,
    config?: TNodeInstanceAST["config"],
  ): this {
    // Validate before produce to avoid type instantiation issues
    if (this.ast.instances.some((n) => n.id === id)) {
      throw new Error(`Node "${id}" already exists`);
    }

    if (!this.ast.nodeTypes.some((nt) => nt.name === nodeType || nt.functionName === nodeType)) {
      throw new Error(
        `Node type "${nodeType}" not found. Available types: ${this.ast.nodeTypes.map((nt) => nt.name || nt.functionName).join(", ")}`,
      );
    }

    const node: TNodeInstanceAST = {
      type: "NodeInstance",
      id,
      nodeType,
    };

    if (config) {
      node.config = config;
    }

    // Use simplified type to avoid excessive type instantiation
    this.ast = produce(this.ast, (draft: { instances: TNodeInstanceAST[] }) => {
      draft.instances.push(node);
    }) as TWorkflowAST;
    return this;
  }

  /**
   * Connect two ports
   *
   * Supports multiple formats:
   * - String format: "node1.port1", "node2.port2"
   * - Object format: { node: "node1", port: "port1" }
   *
   * @param from - Source port reference
   * @param to - Target port reference
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.connect('Start.input', 'processor1.data');
   * builder.connect({ node: 'processor1', port: 'result' }, 'Exit.output');
   * ```
   */
  connect(from: string | TPortReference, to: string | TPortReference): this {
    const fromRef = validatePortReference(from);
    const toRef = validatePortReference(to);

    const connection: TConnectionAST = {
      type: "Connection",
      from: fromRef,
      to: toRef,
    };

    // Use simplified type to avoid excessive type instantiation
    this.ast = produce(this.ast, (draft: { connections: TConnectionAST[] }) => {
      draft.connections.push(connection);
    }) as TWorkflowAST;
    return this;
  }

  /**
   * Create a scope and add nodes to it
   *
   * @param scopeName - Name of the scope
   * @param nodeIds - Array of node IDs to include
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.createScope('mainLoop', ['processor1', 'processor2']);
   * ```
   */
  createScope(scopeName: string, nodeIds: string[]): this {
    // Validate before produce
    if (this.ast.scopes && this.ast.scopes[scopeName]) {
      throw new Error(`Scope "${scopeName}" already exists`);
    }

    // scopeName format is "parentNodeId.scopeName"
    const dotIndex = scopeName.indexOf('.');
    const parentNodeName = dotIndex > 0 ? scopeName.substring(0, dotIndex) : scopeName;
    const scope = dotIndex > 0 ? scopeName.substring(dotIndex + 1) : '';

    // Use simplified type to avoid excessive type instantiation
    this.ast = produce(this.ast, (draft: { scopes?: Record<string, string[]>; instances: TNodeInstanceAST[] }) => {
      if (!draft.scopes) {
        draft.scopes = {};
      }

      draft.scopes[scopeName] = nodeIds;

      nodeIds.forEach((nodeId) => {
        const node = draft.instances.find((n) => n.id === nodeId);
        if (node) {
          node.parent = { id: parentNodeName, scope };
        }
      });
    }) as TWorkflowAST;
    return this;
  }

  /**
   * Set workflow description
   *
   * @param description - Workflow description
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.setDescription('Processes user data and generates reports');
   * ```
   */
  setDescription(description: string): this {
    // Use simplified type to avoid excessive type instantiation
    this.ast = produce(this.ast, (draft: { description?: string }) => {
      draft.description = description;
    }) as TWorkflowAST;
    return this;
  }

  /**
   * Validate the current workflow state
   *
   * @returns Validation result
   *
   * @example
   * ```typescript
   * const validation = builder.validate();
   * if (!validation.valid) {
   *   console.error('Errors:', validation.errors);
   * }
   * ```
   */
  validate() {
    return validateWorkflow(this.ast);
  }

  /**
   * Build and return the final workflow
   *
   * Validates the workflow before returning. Throws if invalid.
   *
   * @returns Complete workflow AST
   * @throws {Error} If workflow validation fails
   *
   * @example
   * ```typescript
   * const workflow = builder.build();
   * ```
   */
  build(): TWorkflowAST {
    const validation = this.validate();

    if (!validation.valid) {
      const errorDetails = validation.errors
        .slice(0, 3)
        .map((e) => `  - ${e.message}`)
        .join("\n");

      throw new Error(
        `Cannot build workflow: validation failed\n${errorDetails}${validation.errors.length > 3 ? `\n  ... and ${validation.errors.length - 3} more errors` : ""}`,
      );
    }

    return this.ast;
  }

  /**
   * Get the current workflow state without validation
   *
   * Use this to inspect the workflow during construction.
   *
   * @returns Current workflow AST
   *
   * @example
   * ```typescript
   * const current = builder.getWorkflow();
   * console.log(`Nodes: ${current.instances.length}`);
   * ```
   */
  getWorkflow(): TWorkflowAST {
    return this.ast;
  }
}

/**
 * Create a new workflow builder
 *
 * Convenience function for creating a builder instance.
 *
 * @param name - Workflow name
 * @param sourceFile - Optional source file path
 * @returns New WorkflowBuilder instance
 *
 * @example
 * ```typescript
 * const workflow = createWorkflow('myWorkflow')
 *   .addStartPort('input', { dataType: 'NUMBER' })
 *   .addExitPort('output', { dataType: 'NUMBER' })
 *   .build();
 * ```
 */
export function createWorkflow(
  name: string,
  sourceFile?: string,
): WorkflowBuilder {
  return new WorkflowBuilder(name, sourceFile);
}

/**
 * Create a builder from an existing workflow AST
 *
 * Allows modifying existing workflows using the builder API.
 *
 * @param ast - Existing workflow AST
 * @returns WorkflowBuilder initialized with the AST
 *
 * @example
 * ```typescript
 * const existingWorkflow = parseWorkflow(source);
 * const modified = fromAST(existingWorkflow)
 *   .addNode('newNode', 'process')
 *   .connect('Start.input', 'newNode.data')
 *   .build();
 * ```
 */
export function fromAST(ast: TWorkflowAST): WorkflowBuilder {
  const builder = new WorkflowBuilder(ast.name, ast.sourceFile);
  // Access private field through bracket notation to avoid exposing internal state
  (builder as unknown as { ast: TWorkflowAST }).ast = ast;
  return builder;
}
