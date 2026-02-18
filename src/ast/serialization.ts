import type { TWorkflowAST } from "./types";
import { RESERVED_PORT_NAMES } from "../constants";

// ============================================================================
// BROWSER-SAFE FUNCTIONS (no Node.js dependencies)
// ============================================================================

/**
 * Serializes a workflow AST to a JSON string.
 *
 * @param ast - The workflow AST to serialize.
 * @param pretty - If true, formats the JSON with 2-space indentation. Defaults to true.
 * @returns The JSON string representation of the AST.
 */
export function serializeAST(ast: TWorkflowAST, pretty: boolean = true): string {
  return pretty ? JSON.stringify(ast, null, 2) : JSON.stringify(ast);
}

/**
 * Deserializes a JSON string into a workflow AST.
 * Validates that the root node type is "Workflow" before returning.
 *
 * @param json - The JSON string to parse.
 * @returns The parsed workflow AST.
 * @throws {Error} If the parsed object's type is not "Workflow".
 */
export function deserializeAST(json: string): TWorkflowAST {
  const ast = JSON.parse(json);
  if (ast.type !== "Workflow") {
    throw new Error('Invalid AST: root node must be of type "Workflow"');
  }
  return ast as TWorkflowAST;
}

/**
 * Converts a workflow AST into a human-readable text summary.
 * Includes workflow metadata, imports, node types with their port counts
 * and control flow ports, and all connections.
 *
 * @param ast - The workflow AST to convert.
 * @returns A multi-line string describing the workflow structure.
 */
export function astToString(ast: TWorkflowAST): string {
  const lines: string[] = [];
  lines.push(`Workflow: ${ast.name} (export: ${ast.functionName})`);
  if (ast.description) {
    lines.push(`Description: ${ast.description}`);
  }
  lines.push(`Source: ${ast.sourceFile}`);
  lines.push("");
  if (ast.imports.length > 0) {
    lines.push("Imports:");
    ast.imports.forEach((imp) => {
      const specifiers = imp.specifiers.map((s) => s.local).join(", ");
      lines.push(`  ${specifiers} from '${imp.source}'`);
    });
    lines.push("");
  }
  lines.push(`Node Types (${ast.nodeTypes.length}):`);
  ast.nodeTypes.forEach((node) => {
    lines.push(`  ${node.name} (${node.functionName})`);
    const inputCount = Object.keys(node.inputs).length;
    const outputCount = Object.keys(node.outputs).length;
    lines.push(`    Inputs: ${inputCount}, Outputs: ${outputCount}`);
    if (node.hasSuccessPort || node.hasFailurePort) {
      const ports = [];
      if (node.hasSuccessPort) ports.push(RESERVED_PORT_NAMES.ON_SUCCESS);
      if (node.hasFailurePort) ports.push(RESERVED_PORT_NAMES.ON_FAILURE);
      lines.push(`    Control flow: ${ports.join(", ")}`);
    }
  });
  lines.push("");
  lines.push(`Connections (${ast.connections.length}):`);
  ast.connections.forEach((conn) => {
    lines.push(
      `  ${conn.from.node}.${conn.from.port} → ${conn.to.node}.${conn.to.port}`,
    );
  });
  return lines.join("\n");
}

interface ASTValidationResult {
  valid: boolean;
  errors: string[];
}

interface PartialASTNode {
  type?: string;
  name?: string;
  functionName?: string;
}

interface PartialConnection {
  type?: string;
  from?: { node?: string; port?: string };
  to?: { node?: string; port?: string };
}

interface PartialAST {
  type?: string;
  name?: string;
  functionName?: string;
  sourceFile?: string;
  instances?: PartialASTNode[];
  connections?: PartialConnection[];
  imports?: unknown[];
}

/**
 * Validates the structural integrity of a workflow AST object.
 * Checks that the root is a "Workflow" type with required fields (name, functionName,
 * sourceFile, instances, connections, imports), and validates each node and connection
 * within the AST.
 *
 * @param ast - The unknown value to validate as a workflow AST.
 * @returns A validation result containing a `valid` boolean and an array of error messages.
 */
export function validateASTStructure(ast: unknown): ASTValidationResult {
  const errors: string[] = [];
  const astObj = ast as PartialAST;

  if (astObj.type !== "Workflow") {
    errors.push('Root node must be of type "Workflow"');
  }
  if (!astObj.name) errors.push("Workflow must have a name");
  if (!astObj.functionName) errors.push("Workflow must have a functionName");
  if (!astObj.sourceFile) errors.push("Workflow must have a sourceFile");
  if (!Array.isArray(astObj.instances)) errors.push("Workflow must have instances array");
  if (!Array.isArray(astObj.connections))
    errors.push("Workflow must have connections array");
  if (!Array.isArray(astObj.imports))
    errors.push("Workflow must have imports array");
  if (Array.isArray(astObj.instances)) {
    astObj.instances.forEach((node: PartialASTNode, idx: number) => {
      if (node.type !== "Node") {
        errors.push(`Node ${idx} must be of type "Node"`);
      }
      if (!node.name) {
        errors.push(`Node ${idx} must have a name`);
      }
      if (!node.functionName) {
        errors.push(`Node ${idx} must have a functionName`);
      }
    });
  }
  if (Array.isArray(astObj.connections)) {
    astObj.connections.forEach((conn: PartialConnection, idx: number) => {
      if (conn.type !== "Connection") {
        errors.push(`Connection ${idx} must be of type "Connection"`);
      }
      if (!conn.from || !conn.from.node || !conn.from.port) {
        errors.push(`Connection ${idx} must have valid 'from' reference`);
      }
      if (!conn.to || !conn.to.node || !conn.to.port) {
        errors.push(`Connection ${idx} must have valid 'to' reference`);
      }
    });
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}
