/**
 * Round-trip tests: Parse → AST → Generate → Parse → AST
 * Verifies workflows can be regenerated from AST without loss
 * Includes: basic round-trips, port switching, and transformation preservation
 */

import { parser } from "../../src/parser";
import { annotationGenerator } from "../../src/annotation-generator";
import { swapPortOrder, swapNodeInstancePortOrder } from "../../src/api/manipulation";
import { TWorkflowAST, TNodeTypeAST, TConnectionAST } from "../../src/ast/types";
import * as path from "path";
import * as fs from "fs";

describe("Round-trip Tests", () => {
  const tempDir = path.join(__dirname, "../../.tmp");

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  /**
   * Normalize AST for comparison (remove generated metadata)
   */
  function normalizeAST(ast: TWorkflowAST): TWorkflowAST {
    const normalized = JSON.parse(JSON.stringify(ast));

    // Remove generated metadata that won't match
    if (normalized.metadata) {
      delete normalized.metadata.generatedAt;
      delete normalized.metadata.layout;
      delete normalized.metadata.sourceLocation;
    }
    delete normalized.sourceFile;

    // Remove macros — @path sugar is semantically equivalent to explicit connections
    delete normalized.macros;

    // Remove functionText, metadata, and path from nodes
    // Path changes when file is written to new location, which is expected
    normalized.nodeTypes.forEach((node: TNodeTypeAST) => {
      delete node.functionText;
      delete node.sourceLocation;
      delete node.metadata;
      delete (node as any).path;

      // Sort port keys alphabetically for consistent comparison
      if (node.inputs) {
        const sortedInputs: Record<string, any> = {};
        Object.keys(node.inputs).sort().forEach(key => {
          const port = node.inputs[key];
          delete port.metadata;
          delete port.tsSchema; // Remove generated schema (varies based on parser context)
          // For IMPORTED_WORKFLOW, tsType can change (any -> unknown), so normalize or remove
          if (node.variant === 'IMPORTED_WORKFLOW') {
            delete port.tsType;
          }
          sortedInputs[key] = port;
        });
        node.inputs = sortedInputs;
      }

      if (node.outputs) {
        const sortedOutputs: Record<string, any> = {};
        Object.keys(node.outputs).sort().forEach(key => {
          const port = node.outputs[key];
          delete port.metadata;
          delete port.tsSchema; // Remove generated schema (varies based on parser context)
          // For IMPORTED_WORKFLOW, tsType gets added on re-parse
          if (node.variant === 'IMPORTED_WORKFLOW') {
            delete port.tsType;
          }
          sortedOutputs[key] = port;
        });
        node.outputs = sortedOutputs;
      }
    });

    // Remove connection metadata and source locations, then sort for stable ordering
    // (annotation generator may reorder connections when @path sugar is auto-detected)
    normalized.connections.forEach((conn: any) => {
      delete conn.metadata;
      delete conn.sourceLocation;
    });
    normalized.connections.sort((a: TConnectionAST, b: TConnectionAST) => {
      const keyA = `${a.from.node}.${a.from.port}->${a.to.node}.${a.to.port}`;
      const keyB = `${b.from.node}.${b.from.port}->${b.to.node}.${b.to.port}`;
      return keyA.localeCompare(keyB);
    });

    // Remove instance metadata and source locations
    normalized.instances.forEach((inst: any) => {
      delete inst.metadata;
      delete inst.sourceLocation;
      // portConfigs direction is not preserved in annotations (direction-agnostic format)
      if (inst.config?.portConfigs) {
        inst.config.portConfigs.forEach((pc: any) => {
          delete pc.direction;
        });
      }
    });

    // Helper to sort object keys for consistent comparison
    const sortObjectKeys = (obj: Record<string, any>): Record<string, any> => {
      const sorted: Record<string, any> = {};
      Object.keys(obj).sort().forEach(key => {
        sorted[key] = obj[key];
      });
      return sorted;
    };

    // Normalize startPorts - remove tsSchema, normalize tsType (any -> unknown), and sort keys
    if (normalized.startPorts) {
      const sortedStartPorts: Record<string, any> = {};
      Object.keys(normalized.startPorts).sort().forEach(key => {
        const port = { ...normalized.startPorts[key] };
        delete port.tsSchema;
        // Normalize 'any' to 'unknown' since parser may change this
        if (port.tsType === 'any') {
          port.tsType = 'unknown';
        }
        sortedStartPorts[key] = sortObjectKeys(port);
      });
      normalized.startPorts = sortedStartPorts;
    }

    // Normalize exitPorts - remove tsSchema, tsType and sort keys
    // tsType gets added on re-parse from function signature
    if (normalized.exitPorts) {
      const sortedExitPorts: Record<string, any> = {};
      Object.keys(normalized.exitPorts).sort().forEach(key => {
        const port = { ...normalized.exitPorts[key] };
        delete port.tsSchema;
        delete port.tsType; // Added on re-parse from return type
        sortedExitPorts[key] = sortObjectKeys(port);
      });
      normalized.exitPorts = sortedExitPorts;
    }

    return normalized;
  }

  /**
   * Deep comparison of two ASTs
   */
  function compareASTs(
    ast1: TWorkflowAST,
    ast2: TWorkflowAST,
  ): { match: boolean; diff?: string } {
    const normalized1 = normalizeAST(ast1);
    const normalized2 = normalizeAST(ast2);

    const json1 = JSON.stringify(normalized1, null, 2);
    const json2 = JSON.stringify(normalized2, null, 2);

    if (json1 === json2) {
      return { match: true };
    }

    return {
      match: false,
      diff: `ASTs don't match:\n\nOriginal:\n${json1}\n\nRegenerated:\n${json2}`,
    };
  }

  // ========================================
  // BASIC ROUND-TRIP TESTS
  // ========================================
  describe("Basic Round-Trip", () => {
    test("should round-trip a simple workflow", async () => {
      const inputPath = path.join(
        __dirname,
        "../../fixtures/basic/example.ts",
      );
      const parsed1 = parser.parse(inputPath);
      const ast1 = parsed1.workflows.find(w => w.functionName === "calculate")!;

      const generated = annotationGenerator.generate(ast1, {
        includeComments: true,
        includeMetadata: true,
      });

      const tempFile = path.join(tempDir, "example-round-trip.ts");
      fs.writeFileSync(tempFile, generated, "utf-8");

      const parsed2 = parser.parse(tempFile);
      const ast2 = parsed2.workflows.find(w => w.functionName === "calculate")!;

      const comparison = compareASTs(ast1, ast2);
      if (!comparison.match) {
        console.error(comparison.diff);
      }
      expect(comparison.match).toBe(true);
    });

    test("should round-trip a workflow with expressions", async () => {
      const inputPath = path.join(
        __dirname,
        "../../fixtures/basic/example-expressions.ts",
      );
      const parsed1 = parser.parse(inputPath);
      const ast1 = parsed1.workflows.find(w => w.functionName === "expressionsWorkflow")!;

      const generated = annotationGenerator.generate(ast1);
      const tempFile = path.join(tempDir, "example-expressions-round-trip.ts");
      fs.writeFileSync(tempFile, generated, "utf-8");

      const parsed2 = parser.parse(tempFile);
      const ast2 = parsed2.workflows.find(w => w.functionName === "expressionsWorkflow")!;

      const comparison = compareASTs(ast1, ast2);
      if (!comparison.match) {
        console.error(comparison.diff);
      }
      expect(comparison.match).toBe(true);
    });

    test("should round-trip a workflow with branching", async () => {
      const inputPath = path.join(
        __dirname,
        "../../fixtures/basic/example-branching.ts",
      );
      const parsed1 = parser.parse(inputPath);
      const ast1 = parsed1.workflows.find(w => w.functionName === "validateAndProcess")!;

      const generated = annotationGenerator.generate(ast1);
      const tempFile = path.join(tempDir, "example-branching-round-trip.ts");
      fs.writeFileSync(tempFile, generated, "utf-8");

      const parsed2 = parser.parse(tempFile);
      const ast2 = parsed2.workflows.find(w => w.functionName === "validateAndProcess")!;

      const comparison = compareASTs(ast1, ast2);
      if (!comparison.match) {
        console.error(comparison.diff);
      }
      expect(comparison.match).toBe(true);
    });
  });

  // ========================================
  // PRESERVATION TESTS
  // ========================================
  describe("Component Preservation", () => {
    test("should preserve port configurations in round-trip", async () => {
      const inputPath = path.join(
        __dirname,
        "../../fixtures/basic/example.ts",
      );
      const parsed1 = parser.parse(inputPath);
      const ast1 = parsed1.workflows.find(w => w.functionName === "calculate")!;

      const generated = annotationGenerator.generate(ast1);
      const tempFile = path.join(tempDir, "port-config-round-trip.ts");
      fs.writeFileSync(tempFile, generated, "utf-8");
      const parsed2 = parser.parse(tempFile);
      const ast2 = parsed2.workflows.find(w => w.functionName === "calculate")!;

      // Check that all port configurations are preserved
      ast1.nodeTypes.forEach((node1: TNodeTypeAST, index: number) => {
        const node2 = ast2.nodeTypes[index];

        // Compare input ports
        Object.keys(node1.inputs).forEach((portName) => {
          expect(node2.inputs[portName]).toBeDefined();
          expect(node2.inputs[portName].dataType).toBe(
            node1.inputs[portName].dataType,
          );
          expect(node2.inputs[portName].optional).toBe(
            node1.inputs[portName].optional,
          );
        });

        // Compare output ports
        Object.keys(node1.outputs).forEach((portName) => {
          expect(node2.outputs[portName]).toBeDefined();
          expect(node2.outputs[portName].dataType).toBe(
            node1.outputs[portName].dataType,
          );
        });
      });
    });

    test("should preserve connections in round-trip", async () => {
      const inputPath = path.join(
        __dirname,
        "../../fixtures/basic/example.ts",
      );
      const parsed1 = parser.parse(inputPath);
      const ast1 = parsed1.workflows.find(w => w.functionName === "calculate")!;

      const generated = annotationGenerator.generate(ast1);
      const tempFile = path.join(tempDir, "connections-round-trip.ts");
      fs.writeFileSync(tempFile, generated, "utf-8");
      const parsed2 = parser.parse(tempFile);
      const ast2 = parsed2.workflows.find(w => w.functionName === "calculate")!;

      expect(ast2.connections.length).toBe(ast1.connections.length);

      ast1.connections.forEach((conn1: TConnectionAST, index: number) => {
        const conn2 = ast2.connections[index];
        expect(conn2.from.node).toBe(conn1.from.node);
        expect(conn2.from.port).toBe(conn1.from.port);
        expect(conn2.to.node).toBe(conn1.to.node);
        expect(conn2.to.port).toBe(conn1.to.port);
      });
    });

    test("should preserve workflow metadata in round-trip", async () => {
      const inputPath = path.join(
        __dirname,
        "../../fixtures/basic/example.ts",
      );
      const parsed1 = parser.parse(inputPath);
      const ast1 = parsed1.workflows.find(w => w.functionName === "calculate")!;

      const generated = annotationGenerator.generate(ast1);
      const tempFile = path.join(tempDir, "metadata-round-trip.ts");
      fs.writeFileSync(tempFile, generated, "utf-8");
      const parsed2 = parser.parse(tempFile);
      const ast2 = parsed2.workflows.find(w => w.functionName === "calculate")!;

      expect(ast2.functionName).toBe(ast1.functionName);
      expect(ast2.name).toBe(ast1.name);

      // Check startPorts and exitPorts are preserved
      if (ast1.startPorts) {
        expect(ast2.startPorts).toBeDefined();
        Object.keys(ast1.startPorts).forEach((portName) => {
          expect(ast2.startPorts![portName]).toBeDefined();
          expect(ast2.startPorts![portName].dataType).toBe(
            ast1.startPorts![portName].dataType,
          );
        });
      }

      if (ast1.exitPorts) {
        expect(ast2.exitPorts).toBeDefined();
        Object.keys(ast1.exitPorts).forEach((portName) => {
          expect(ast2.exitPorts![portName]).toBeDefined();
          expect(ast2.exitPorts![portName].dataType).toBe(
            ast1.exitPorts![portName].dataType,
          );
        });
      }
    });
  });

  // ========================================
  // PORT SWITCHING ROUND-TRIP (in-memory parsing for speed)
  // ========================================
  describe("Port Switching Round-Trip", () => {
    test("should round-trip after switching instance input ports", () => {
      const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input value
 * @input multiplier
 * @output result
 */
function double(execute: boolean, params: { value: number; multiplier: number }): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: params.value * params.multiplier };
}

/**
 * @flowWeaver workflow
 * @node doubler double
 * @connect Start.value -> doubler.value
 * @connect Start.multiplier -> doubler.multiplier
 * @connect doubler.result -> Exit.result
 */
export async function testWorkflow(
  execute: boolean = true,
  params: { value: number; multiplier: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
`;

      const parseResult = parser.parseFromString(sourceCode);
      const originalWorkflow = parseResult.workflows[0];

      const modifiedWorkflow = swapNodeInstancePortOrder(originalWorkflow, 'doubler', 'value', 'multiplier');

      const generatedCode = annotationGenerator.generate(modifiedWorkflow, {
        includeComments: true,
        includeMetadata: true
      });

      const reparsedResult = parser.parseFromString(generatedCode);
      const reparsedWorkflow = reparsedResult.workflows[0];

      const comparison = compareASTs(modifiedWorkflow, reparsedWorkflow);
      if (!comparison.match) {
        console.error(comparison.diff);
      }

      expect(comparison.match).toBe(true);
    });

    test("should round-trip after switching Start ports", () => {
      const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input input
 * @output output
 */
function process(execute: boolean, params: { input: number }): { onSuccess: boolean; onFailure: boolean; output: number } {
  if (!execute) return { onSuccess: false, onFailure: false, output: 0 };
  return { onSuccess: true, onFailure: false, output: params.input * 2 };
}

/**
 * @flowWeaver workflow
 * @node proc process
 * @connect Start.a -> proc.input
 * @connect proc.output -> Exit.result
 */
export async function testWorkflow(
  execute: boolean = true,
  params: { a: number; b: number; c: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
`;

      const parseResult = parser.parseFromString(sourceCode);
      const originalWorkflow = parseResult.workflows[0];

      const modifiedWorkflow = swapPortOrder(originalWorkflow, 'Start', 'a', 'c');

      const generatedCode = annotationGenerator.generate(modifiedWorkflow, {
        includeComments: true,
        includeMetadata: true
      });

      const reparsedResult = parser.parseFromString(generatedCode);
      const reparsedWorkflow = reparsedResult.workflows[0];

      const comparison = compareASTs(modifiedWorkflow, reparsedWorkflow);
      if (!comparison.match) {
        console.error(comparison.diff);
      }

      expect(comparison.match).toBe(true);
    });

    test("should round-trip after switching Exit ports", () => {
      const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input input
 * @output x
 * @output y
 * @output z
 */
function process(execute: boolean, params: { input: number }): { onSuccess: boolean; onFailure: boolean; x: number; y: number; z: number } {
  if (!execute) return { onSuccess: false, onFailure: false, x: 0, y: 0, z: 0 };
  return { onSuccess: true, onFailure: false, x: params.input, y: params.input * 2, z: params.input * 3 };
}

/**
 * @flowWeaver workflow
 * @node proc process
 * @connect Start.input -> proc.input
 * @connect proc.x -> Exit.x
 * @connect proc.y -> Exit.y
 * @connect proc.z -> Exit.z
 */
export async function testWorkflow(
  execute: boolean = true,
  params: { input: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; x: number; y: number; z: number }> {
  throw new Error('Not implemented');
}
`;

      const parseResult = parser.parseFromString(sourceCode);
      const originalWorkflow = parseResult.workflows[0];

      const modifiedWorkflow = swapPortOrder(originalWorkflow, 'Exit', 'x', 'z');

      const generatedCode = annotationGenerator.generate(modifiedWorkflow, {
        includeComments: true,
        includeMetadata: true
      });

      const reparsedResult = parser.parseFromString(generatedCode);
      const reparsedWorkflow = reparsedResult.workflows[0];

      const comparison = compareASTs(modifiedWorkflow, reparsedWorkflow);
      if (!comparison.match) {
        console.error(comparison.diff);
      }

      expect(comparison.match).toBe(true);
    });
  });

});
