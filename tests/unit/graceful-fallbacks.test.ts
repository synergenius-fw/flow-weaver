import { generateCode } from "../../src/api/generate";
import { createWorkflow, fromAST } from "../../src/api/builder";
import type { TWorkflowAST } from "../../src/ast/types";

describe("Graceful Code Generation Fallbacks", () => {
  describe("Orphaned Connection Source Node", () => {
    it("should generate undefined fallback for single connection with non-existent source", () => {
      // Create a workflow with a connection from a non-existent node
      // We need to manually add an orphaned connection after building
      const base = createWorkflow("orphanedSource")
        .addStartPort("input", { dataType: "NUMBER" })
        .addExitPort("output", { dataType: "NUMBER" })
        .addNodeType({
          type: "NodeType",
          name: "process",
          functionName: "process",
          inputs: { value: { dataType: "NUMBER" } },
          outputs: { result: { dataType: "NUMBER" } },
          hasSuccessPort: true,
          hasFailurePort: true,
          isAsync: false,
          executeWhen: "CONJUNCTION",
        })
        .addNode("A", "process")
        .connect("Start.input", "A.value")
        .connect("A.result", "Exit.output")
        .getWorkflow();

      // Manually create an orphaned connection (from non-existent node)
      const ast: TWorkflowAST = {
        ...base,
        connections: [
          // Replace Start.input -> A.value with nonExistent.result -> A.value
          { type: "Connection", from: { node: "nonExistent", port: "result" }, to: { node: "A", port: "value" } },
          { type: "Connection", from: { node: "A", port: "result" }, to: { node: "Exit", port: "output" } },
        ],
      };

      const code = generateCode(ast, { production: false });

      // Should contain undefined fallback with comment
      expect(code).toContain("undefined");
      expect(code).toContain("Source node 'nonExistent' not found");

      // Should NOT contain reference to nonExistentIdx (which would be undeclared)
      expect(code).not.toContain("nonExistentIdx");
    });

    it("should generate undefined fallback when all sources in multiple connections are orphaned", () => {
      const base = createWorkflow("allOrphaned")
        .addStartPort("input", { dataType: "NUMBER" })
        .addExitPort("output", { dataType: "NUMBER" })
        .addNodeType({
          type: "NodeType",
          name: "merge",
          functionName: "merge",
          inputs: { value: { dataType: "NUMBER" } },
          outputs: { result: { dataType: "NUMBER" } },
          hasSuccessPort: true,
          hasFailurePort: true,
          isAsync: false,
          executeWhen: "CONJUNCTION",
        })
        .addNode("M", "merge")
        .connect("Start.input", "M.value")
        .connect("M.result", "Exit.output")
        .getWorkflow();

      // Multiple connections from non-existent nodes to M.value
      const ast: TWorkflowAST = {
        ...base,
        connections: [
          { type: "Connection", from: { node: "ghost1", port: "result" }, to: { node: "M", port: "value" } },
          { type: "Connection", from: { node: "ghost2", port: "result" }, to: { node: "M", port: "value" } },
          { type: "Connection", from: { node: "M", port: "result" }, to: { node: "Exit", port: "output" } },
        ],
      };

      const code = generateCode(ast, { production: false });

      // Should contain undefined fallback
      expect(code).toContain("undefined");
      expect(code).toContain("All source nodes not found");

      // Should NOT contain references to ghost nodes
      expect(code).not.toContain("ghost1Idx");
      expect(code).not.toContain("ghost2Idx");
    });

    it("should filter out orphaned connections when some sources exist", () => {
      const base = createWorkflow("mixedConnections")
        .addStartPort("input", { dataType: "NUMBER" })
        .addExitPort("output", { dataType: "NUMBER" })
        .addNodeType({
          type: "NodeType",
          name: "producer",
          functionName: "producer",
          inputs: { input: { dataType: "NUMBER" } },
          outputs: { result: { dataType: "NUMBER" } },
          hasSuccessPort: true,
          hasFailurePort: true,
          isAsync: false,
          executeWhen: "CONJUNCTION",
        })
        .addNodeType({
          type: "NodeType",
          name: "merge",
          functionName: "merge",
          inputs: { value: { dataType: "NUMBER" } },
          outputs: { result: { dataType: "NUMBER" } },
          hasSuccessPort: true,
          hasFailurePort: true,
          isAsync: false,
          executeWhen: "CONJUNCTION",
        })
        .addNode("P", "producer")
        .addNode("M", "merge")
        .connect("Start.input", "P.input")
        .connect("P.result", "M.value")
        .connect("M.result", "Exit.output")
        .getWorkflow();

      // Add an orphaned connection alongside the valid one
      const ast: TWorkflowAST = {
        ...base,
        connections: [
          { type: "Connection", from: { node: "Start", port: "input" }, to: { node: "P", port: "input" } },
          { type: "Connection", from: { node: "P", port: "result" }, to: { node: "M", port: "value" } },
          { type: "Connection", from: { node: "ghost", port: "result" }, to: { node: "M", port: "value" } },
          { type: "Connection", from: { node: "M", port: "result" }, to: { node: "Exit", port: "output" } },
        ],
      };

      const code = generateCode(ast, { production: false });

      // Should contain reference to valid source (P)
      expect(code).toContain("PIdx");

      // Should NOT contain reference to orphaned source
      expect(code).not.toContain("ghostIdx");
    });

    it("should handle Start node connections normally", () => {
      const ast = createWorkflow("startConnection")
        .addStartPort("input", { dataType: "NUMBER" })
        .addExitPort("output", { dataType: "NUMBER" })
        .addNodeType({
          type: "NodeType",
          name: "process",
          functionName: "process",
          inputs: { value: { dataType: "NUMBER" } },
          outputs: { result: { dataType: "NUMBER" } },
          hasSuccessPort: true,
          hasFailurePort: true,
          isAsync: false,
          executeWhen: "CONJUNCTION",
        })
        .addNode("A", "process")
        .connect("Start.input", "A.value")
        .connect("A.result", "Exit.output")
        .getWorkflow();

      const code = generateCode(ast, { production: false });

      // Should use startIdx for Start node connections
      expect(code).toContain("startIdx");

      // Should NOT have orphaned fallback for Start
      expect(code).not.toContain("Source node 'Start' not found");
    });
  });

  describe("Required Port Without Connection", () => {
    it("should generate undefined fallback for required port with no connection", () => {
      const base = createWorkflow("missingConnection")
        .addStartPort("input", { dataType: "NUMBER" })
        .addExitPort("output", { dataType: "NUMBER" })
        .addNodeType({
          type: "NodeType",
          name: "adder",
          functionName: "adder",
          inputs: {
            x: { dataType: "NUMBER" },
            y: { dataType: "NUMBER" },  // Required port - no connection
          },
          outputs: { sum: { dataType: "NUMBER" } },
          hasSuccessPort: true,
          hasFailurePort: true,
          isAsync: false,
          executeWhen: "CONJUNCTION",
        })
        .addNode("A", "adder")
        .connect("Start.input", "A.x")
        // Note: No connection to A.y
        .connect("A.sum", "Exit.output")
        .getWorkflow();

      const code = generateCode(base, { production: false });

      // Should contain undefined fallback for y port
      expect(code).toContain("let A_y!:");
      expect(code).toContain("Required port 'y' has no connection");
    });
  });

  describe("Missing Node Type", () => {
    it("should generate comment for node with missing type", () => {
      // Create workflow with an instance whose type doesn't exist
      const base = createWorkflow("missingType")
        .addStartPort("input", { dataType: "NUMBER" })
        .addExitPort("output", { dataType: "NUMBER" })
        .addNodeType({
          type: "NodeType",
          name: "validType",
          functionName: "validType",
          inputs: { input: { dataType: "NUMBER" } },
          outputs: { result: { dataType: "NUMBER" } },
          hasSuccessPort: true,
          hasFailurePort: true,
          isAsync: false,
          executeWhen: "CONJUNCTION",
        })
        .addNode("A", "validType")
        .connect("Start.input", "A.input")
        .connect("A.result", "Exit.output")
        .getWorkflow();

      // Manually add instance with non-existent type
      const ast: TWorkflowAST = {
        ...base,
        instances: [
          ...base.instances,
          { type: "NodeInstance", id: "B", nodeType: "nonExistentType" },
        ],
      };

      const code = generateCode(ast, { production: false });

      // Should contain comment about skipped node
      expect(code).toContain("Node 'B' skipped: type 'nonExistentType' not found");
    });
  });

  describe("TypeScript Compilation Safety", () => {
    it("should generate code that does not reference undeclared variables", () => {
      // Create a workflow with multiple fallback scenarios
      const base = createWorkflow("compileTest")
        .addStartPort("input", { dataType: "NUMBER" })
        .addExitPort("output", { dataType: "NUMBER" })
        .addNodeType({
          type: "NodeType",
          name: "process",
          functionName: "process",
          inputs: {
            a: { dataType: "NUMBER" },
            b: { dataType: "NUMBER" },
          },
          outputs: { result: { dataType: "NUMBER" } },
          hasSuccessPort: true,
          hasFailurePort: true,
          isAsync: false,
          executeWhen: "CONJUNCTION",
        })
        .addNode("P", "process")
        .connect("P.result", "Exit.output")
        .getWorkflow();

      // Connection from orphaned node and no connection to P.b
      const ast: TWorkflowAST = {
        ...base,
        connections: [
          { type: "Connection", from: { node: "ghost", port: "result" }, to: { node: "P", port: "a" } },
          // No connection to P.b
          { type: "Connection", from: { node: "P", port: "result" }, to: { node: "Exit", port: "output" } },
        ],
      };

      const code = generateCode(ast, { production: false });

      // The code should have fallbacks, not references to undeclared variables
      expect(code).toContain("P_a = undefined");  // Fallback for orphaned connection
      expect(code).toContain("let P_b!:");  // Fallback for missing connection

      // Should NOT reference undeclared variables
      expect(code).not.toContain("ghostIdx");
    });
  });
});
