import { describe, it, expect } from "vitest";
import {
  serializeAST,
  deserializeAST,
  astToString,
  validateASTStructure,
} from "../../../src/ast/serialization.js";
import type { TWorkflowAST } from "../../../src/ast/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function minimalWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    type: "Workflow",
    name: "test",
    functionName: "test",
    sourceFile: "test.ts",
    nodeTypes: [],
    instances: [],
    connections: [],
    startPorts: {},
    exitPorts: {},
    imports: [],
    ...overrides,
  };
}

function workflowWithNodes(): TWorkflowAST {
  return minimalWorkflow({
    name: "addNumbers",
    functionName: "addNumbers",
    sourceFile: "math.ts",
    description: "Adds two numbers together",
    nodeTypes: [
      {
        type: "NodeType",
        name: "Add",
        functionName: "add",
        inputs: {
          execute: { dataType: "STEP", isControlFlow: true },
          a: { dataType: "NUMBER" },
          b: { dataType: "NUMBER" },
        },
        outputs: {
          onSuccess: { dataType: "STEP", isControlFlow: true },
          result: { dataType: "NUMBER" },
        },
        hasSuccessPort: true,
        hasFailurePort: false,
        executeWhen: "CONJUNCTION",
        isAsync: false,
      },
      {
        type: "NodeType",
        name: "Validate",
        functionName: "validate",
        inputs: {
          execute: { dataType: "STEP", isControlFlow: true },
          value: { dataType: "ANY" },
        },
        outputs: {
          onSuccess: { dataType: "STEP", isControlFlow: true },
          onFailure: { dataType: "STEP", isControlFlow: true },
        },
        hasSuccessPort: true,
        hasFailurePort: true,
        executeWhen: "CONJUNCTION",
        isAsync: false,
      },
    ],
    instances: [
      { type: "NodeInstance", id: "add1", nodeType: "Add" },
      { type: "NodeInstance", id: "validate1", nodeType: "Validate" },
    ],
    connections: [
      {
        type: "Connection",
        from: { node: "Start", port: "execute" },
        to: { node: "validate1", port: "execute" },
      },
      {
        type: "Connection",
        from: { node: "validate1", port: "onSuccess" },
        to: { node: "add1", port: "execute" },
      },
      {
        type: "Connection",
        from: { node: "add1", port: "result" },
        to: { node: "Exit", port: "result" },
      },
    ],
    imports: [
      {
        type: "Import",
        specifiers: [
          { imported: "add", local: "add", kind: "named" },
          { imported: "validate", local: "validate", kind: "named" },
        ],
        source: "./math-utils",
        importKind: "value",
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// serializeAST
// ---------------------------------------------------------------------------

describe("serializeAST", () => {
  it("produces valid JSON that round-trips through JSON.parse", () => {
    const wf = minimalWorkflow();
    const json = serializeAST(wf);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("Workflow");
    expect(parsed.name).toBe("test");
  });

  it("pretty-prints with 2-space indentation by default", () => {
    const wf = minimalWorkflow();
    const json = serializeAST(wf);
    // Pretty JSON has newlines; a compact one would not.
    expect(json).toContain("\n");
    // Check indentation: second line should start with two spaces.
    const lines = json.split("\n");
    expect(lines[1]).toMatch(/^ {2}/);
  });

  it("produces compact JSON when pretty=false", () => {
    const wf = minimalWorkflow();
    const json = serializeAST(wf, false);
    expect(json).not.toContain("\n");
  });

  it("preserves all top-level fields", () => {
    const wf = workflowWithNodes();
    const json = serializeAST(wf);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe("addNumbers");
    expect(parsed.functionName).toBe("addNumbers");
    expect(parsed.description).toBe("Adds two numbers together");
    expect(parsed.sourceFile).toBe("math.ts");
    expect(parsed.nodeTypes).toHaveLength(2);
    expect(parsed.instances).toHaveLength(2);
    expect(parsed.connections).toHaveLength(3);
    expect(parsed.imports).toHaveLength(1);
  });

  it("preserves nested node type details", () => {
    const wf = workflowWithNodes();
    const parsed = JSON.parse(serializeAST(wf));
    const addNode = parsed.nodeTypes[0];
    expect(addNode.name).toBe("Add");
    expect(addNode.inputs.a.dataType).toBe("NUMBER");
    expect(addNode.outputs.result.dataType).toBe("NUMBER");
    expect(addNode.hasSuccessPort).toBe(true);
    expect(addNode.hasFailurePort).toBe(false);
  });

  it("handles workflows with optional fields omitted", () => {
    const wf = minimalWorkflow();
    const json = serializeAST(wf);
    const parsed = JSON.parse(json);
    expect(parsed.description).toBeUndefined();
    expect(parsed.scopes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deserializeAST
// ---------------------------------------------------------------------------

describe("deserializeAST", () => {
  it("round-trips a minimal workflow through serialize/deserialize", () => {
    const original = minimalWorkflow();
    const json = serializeAST(original);
    const restored = deserializeAST(json);
    expect(restored).toEqual(original);
  });

  it("round-trips a complex workflow with nodes and connections", () => {
    const original = workflowWithNodes();
    const json = serializeAST(original);
    const restored = deserializeAST(json);
    expect(restored).toEqual(original);
  });

  it("deserializes compact JSON", () => {
    const original = minimalWorkflow();
    const compact = serializeAST(original, false);
    const restored = deserializeAST(compact);
    expect(restored.type).toBe("Workflow");
    expect(restored.name).toBe("test");
  });

  it("throws when root type is not Workflow", () => {
    const notWorkflow = JSON.stringify({ type: "NodeType", name: "foo" });
    expect(() => deserializeAST(notWorkflow)).toThrow(
      'Invalid AST: root node must be of type "Workflow"',
    );
  });

  it("throws when type field is missing entirely", () => {
    const noType = JSON.stringify({ name: "test" });
    expect(() => deserializeAST(noType)).toThrow(
      'Invalid AST: root node must be of type "Workflow"',
    );
  });

  it("throws on invalid JSON", () => {
    expect(() => deserializeAST("{not valid json")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => deserializeAST("")).toThrow();
  });

  it("throws when JSON is a primitive", () => {
    // JSON.parse("42") succeeds, but 42.type is undefined !== "Workflow"
    expect(() => deserializeAST("42")).toThrow(
      'Invalid AST: root node must be of type "Workflow"',
    );
  });

  it("throws when JSON is an array", () => {
    expect(() => deserializeAST("[1,2,3]")).toThrow(
      'Invalid AST: root node must be of type "Workflow"',
    );
  });

  it("accepts any valid JSON object with type=Workflow", () => {
    // deserializeAST only checks the type field, so extra/missing fields pass.
    const sparse = JSON.stringify({ type: "Workflow" });
    const result = deserializeAST(sparse);
    expect(result.type).toBe("Workflow");
  });
});

// ---------------------------------------------------------------------------
// astToString
// ---------------------------------------------------------------------------

describe("astToString", () => {
  it("includes workflow name and export function name", () => {
    const wf = minimalWorkflow({ name: "myFlow", functionName: "myFlowFn" });
    const text = astToString(wf);
    expect(text).toContain("Workflow: myFlow (export: myFlowFn)");
  });

  it("includes description when present", () => {
    const wf = minimalWorkflow({ description: "Does something useful" });
    const text = astToString(wf);
    expect(text).toContain("Description: Does something useful");
  });

  it("omits description line when not present", () => {
    const wf = minimalWorkflow();
    const text = astToString(wf);
    expect(text).not.toContain("Description:");
  });

  it("includes source file", () => {
    const wf = minimalWorkflow({ sourceFile: "path/to/file.ts" });
    const text = astToString(wf);
    expect(text).toContain("Source: path/to/file.ts");
  });

  it("lists imports when present", () => {
    const wf = minimalWorkflow({
      imports: [
        {
          type: "Import",
          specifiers: [
            { imported: "foo", local: "foo", kind: "named" },
            { imported: "bar", local: "bar", kind: "named" },
          ],
          source: "./utils",
          importKind: "value",
        },
      ],
    });
    const text = astToString(wf);
    expect(text).toContain("Imports:");
    expect(text).toContain("foo, bar from './utils'");
  });

  it("omits imports section when imports array is empty", () => {
    const wf = minimalWorkflow();
    const text = astToString(wf);
    expect(text).not.toContain("Imports:");
  });

  it("shows node type count and details", () => {
    const wf = workflowWithNodes();
    const text = astToString(wf);
    expect(text).toContain("Node Types (2):");
    expect(text).toContain("Add (add)");
    expect(text).toContain("Validate (validate)");
  });

  it("shows input/output counts for each node type", () => {
    const wf = workflowWithNodes();
    const text = astToString(wf);
    // Add has 3 inputs (execute, a, b) and 2 outputs (onSuccess, result)
    expect(text).toContain("Inputs: 3, Outputs: 2");
  });

  it("shows control flow ports (onSuccess, onFailure)", () => {
    const wf = workflowWithNodes();
    const text = astToString(wf);
    // Validate has both success and failure ports
    expect(text).toContain("Control flow: onSuccess, onFailure");
    // Add has only success port
    expect(text).toContain("Control flow: onSuccess");
  });

  it("omits control flow line for nodes without success/failure ports", () => {
    const wf = minimalWorkflow({
      nodeTypes: [
        {
          type: "NodeType",
          name: "Pure",
          functionName: "pure",
          inputs: { x: { dataType: "NUMBER" } },
          outputs: { y: { dataType: "NUMBER" } },
          hasSuccessPort: false,
          hasFailurePort: false,
          executeWhen: "CONJUNCTION",
          isAsync: false,
        },
      ],
    });
    const text = astToString(wf);
    expect(text).toContain("Pure (pure)");
    expect(text).not.toContain("Control flow:");
  });

  it("shows connection count and details", () => {
    const wf = workflowWithNodes();
    const text = astToString(wf);
    expect(text).toContain("Connections (3):");
    expect(text).toContain("Start.execute");
    expect(text).toContain("add1.result");
    expect(text).toContain("Exit.result");
  });

  it("uses arrow notation for connections", () => {
    const wf = workflowWithNodes();
    const text = astToString(wf);
    // Check at least one connection has the arrow format
    const connLines = text
      .split("\n")
      .filter((l) => l.includes("\u2192"));
    expect(connLines.length).toBeGreaterThan(0);
  });

  it("handles a workflow with zero node types and zero connections", () => {
    const wf = minimalWorkflow();
    const text = astToString(wf);
    expect(text).toContain("Node Types (0):");
    expect(text).toContain("Connections (0):");
  });
});

// ---------------------------------------------------------------------------
// validateASTStructure
// ---------------------------------------------------------------------------

describe("validateASTStructure", () => {
  describe("valid workflows", () => {
    it("returns valid=true for a minimal correct workflow", () => {
      const wf = minimalWorkflow();
      const result = validateASTStructure(wf);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("returns valid=true for a workflow with properly typed nodes and connections", () => {
      // validateASTStructure checks instances for type "Node" (not "NodeInstance")
      // and connections for type "Connection", so we build fixtures that match.
      const wf = {
        type: "Workflow",
        name: "addNumbers",
        functionName: "addNumbers",
        sourceFile: "math.ts",
        instances: [
          { type: "Node", name: "add1", functionName: "add" },
          { type: "Node", name: "validate1", functionName: "validate" },
        ],
        connections: [
          {
            type: "Connection",
            from: { node: "Start", port: "execute" },
            to: { node: "validate1", port: "execute" },
          },
        ],
        imports: [],
      };
      const result = validateASTStructure(wf);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("root-level validation", () => {
    it("rejects a non-Workflow root type", () => {
      const result = validateASTStructure({
        type: "NodeType",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: [],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Root node must be of type "Workflow"');
    });

    it("rejects when type field is missing", () => {
      const result = validateASTStructure({
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: [],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Root node must be of type "Workflow"');
    });

    it("rejects when name is missing", () => {
      const result = validateASTStructure({
        type: "Workflow",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: [],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Workflow must have a name");
    });

    it("rejects when functionName is missing", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: [],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Workflow must have a functionName");
    });

    it("rejects when sourceFile is missing", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        instances: [],
        connections: [],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Workflow must have a sourceFile");
    });

    it("rejects when instances is not an array", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: "not-array",
        connections: [],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Workflow must have instances array");
    });

    it("rejects when connections is not an array", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: null,
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Workflow must have connections array");
    });

    it("rejects when imports is not an array", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: [],
        imports: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Workflow must have imports array");
    });

    it("collects multiple root-level errors at once", () => {
      const result = validateASTStructure({});
      expect(result.valid).toBe(false);
      // Should have errors for type, name, functionName, sourceFile, instances, connections, imports
      expect(result.errors.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe("node instance validation", () => {
    it("rejects instances with wrong type", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [{ type: "Wrong", name: "foo", functionName: "foo" }],
        connections: [],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Node 0 must be of type "Node"');
    });

    it("rejects instances without a name", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [{ type: "Node", functionName: "foo" }],
        connections: [],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Node 0 must have a name");
    });

    it("rejects instances without a functionName", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [{ type: "Node", name: "foo" }],
        connections: [],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Node 0 must have a functionName");
    });

    it("validates multiple nodes and reports errors with correct indices", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [
          { type: "Node", name: "good", functionName: "good" },
          { type: "Wrong", name: "bad" },
          { type: "Node" },
        ],
        connections: [],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Node 1 must be of type "Node"');
      expect(result.errors).toContain("Node 1 must have a functionName");
      expect(result.errors).toContain("Node 2 must have a name");
      expect(result.errors).toContain("Node 2 must have a functionName");
    });
  });

  describe("connection validation", () => {
    it("rejects connections with wrong type", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: [
          {
            type: "Link",
            from: { node: "a", port: "x" },
            to: { node: "b", port: "y" },
          },
        ],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Connection 0 must be of type "Connection"');
    });

    it("rejects connections without a valid from reference", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: [
          {
            type: "Connection",
            from: { node: "a" },
            to: { node: "b", port: "y" },
          },
        ],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Connection 0 must have valid 'from' reference",
      );
    });

    it("rejects connections without a valid to reference", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: [
          {
            type: "Connection",
            from: { node: "a", port: "x" },
            to: {},
          },
        ],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Connection 0 must have valid 'to' reference",
      );
    });

    it("rejects connections with missing from entirely", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: [
          {
            type: "Connection",
            to: { node: "b", port: "y" },
          },
        ],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Connection 0 must have valid 'from' reference",
      );
    });

    it("rejects connections with missing to entirely", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: [
          {
            type: "Connection",
            from: { node: "a", port: "x" },
          },
        ],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Connection 0 must have valid 'to' reference",
      );
    });

    it("validates multiple connections with correct indices", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: [
          {
            type: "Connection",
            from: { node: "a", port: "x" },
            to: { node: "b", port: "y" },
          },
          {
            type: "Bad",
            from: { node: "c", port: "z" },
            to: { node: "d", port: "w" },
          },
        ],
        imports: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Connection 1 must be of type "Connection"');
      // Connection 0 should not generate errors
      expect(result.errors).not.toContain('Connection 0 must be of type "Connection"');
    });
  });

  describe("edge cases", () => {
    it("throws on null input (no null guard in implementation)", () => {
      expect(() => validateASTStructure(null)).toThrow(TypeError);
    });

    it("throws on undefined input (no null guard in implementation)", () => {
      expect(() => validateASTStructure(undefined)).toThrow(TypeError);
    });

    it("handles empty object", () => {
      const result = validateASTStructure({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("handles a string input", () => {
      const result = validateASTStructure("not an object");
      expect(result.valid).toBe(false);
    });

    it("skips node validation when instances is not an array", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: "bad",
        connections: [],
        imports: [],
      });
      // Should have the "must have instances array" error but no Node-specific errors
      expect(result.errors).toContain("Workflow must have instances array");
      const nodeErrors = result.errors.filter((e) => e.startsWith("Node "));
      expect(nodeErrors).toEqual([]);
    });

    it("skips connection validation when connections is not an array", () => {
      const result = validateASTStructure({
        type: "Workflow",
        name: "test",
        functionName: "test",
        sourceFile: "test.ts",
        instances: [],
        connections: 42,
        imports: [],
      });
      expect(result.errors).toContain("Workflow must have connections array");
      const connErrors = result.errors.filter((e) => e.startsWith("Connection "));
      expect(connErrors).toEqual([]);
    });
  });
});
