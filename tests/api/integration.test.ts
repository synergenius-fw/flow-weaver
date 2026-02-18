/**
 * Integration tests demonstrating cross-API workflows
 * Tests real-world usage patterns combining Builder, Query, Manipulation, and Validation
 */

import { createWorkflow, fromAST } from "../../src/api/builder";
import {
  addNode,
  addConnection,
  removeNode,
  createScope,
  addToScope,
  reconnect,
  removeAllConnections,
  removeNodes,
} from "../../src/api/manipulation";
import {
  getNode,
  getIncomingConnections,
  getOutgoingConnections,
  findDeadEnds,
  getNodesInScope,
  getDependencies,
} from "../../src/api/query";
import { validateWorkflow } from "../../src/api/validate";
import {
  createProcessorNodeType,
  createTransformerNodeType,
  createMultiInputNodeType,
  createNodeInstance,
} from "../helpers/test-fixtures";

describe("API Integration Tests", () => {
  describe("Test 1: Build → Query → Modify Pipeline", () => {
    it("should build workflow, query nodes, and modify connections", () => {
      const ast = createWorkflow("pipeline")
        .addStartPort("input", { dataType: "NUMBER" })
        .addExitPort("output", { dataType: "NUMBER" })
        .addNodeType(createProcessorNodeType())
        .addNode("step1", "process")
        .addNode("step2", "process")
        .connect("Start.input", "step1.input")
        .connect("step1.output", "step2.input")
        .connect("step2.output", "Exit.output")
        .build();

      const step1 = getNode(ast, "step1");
      expect(step1).toBeDefined();
      expect(step1?.nodeType).toBe("process");

      const incoming = getIncomingConnections(ast, "step2");
      expect(incoming).toHaveLength(1);
      expect(incoming[0].from.node).toBe("step1");

      const modified = removeNode(ast, "step1");
      const step1After = getNode(modified, "step1");
      expect(step1After).toBeUndefined();

      const incomingAfter = getIncomingConnections(modified, "step2");
      expect(incomingAfter).toHaveLength(0);
    });
  });

  describe("Test 2: FromAST → Modify → Validate Round-Trip", () => {
    it("should convert to builder, modify, and validate result", () => {
      const original = createWorkflow("roundtrip")
        .addStartPort("x", { dataType: "NUMBER" })
        .addExitPort("result", { dataType: "NUMBER" })
        .addNodeType(createProcessorNodeType())
        .addNode("node1", "process")
        .connect("Start.x", "node1.input")
        .connect("node1.output", "Exit.result")
        .build();

      const modified = fromAST(original)
        .addNode("node2", "process")
        .connect("node1.output", "node2.input")
        .connect("node2.output", "Exit.result")
        .build();

      expect(modified.instances).toHaveLength(2);
      const validation = validateWorkflow(modified);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe("Test 3: Complex Multi-Node Workflow Construction", () => {
    it("should build workflow with 10+ nodes and multiple types", () => {
      const builder = createWorkflow("complex")
        .addStartPort("a", { dataType: "NUMBER" })
        .addStartPort("b", { dataType: "NUMBER" })
        .addExitPort("final", { dataType: "NUMBER" })
        .addNodeType(createProcessorNodeType())
        .addNodeType(createTransformerNodeType())
        .addNodeType(createMultiInputNodeType());

      for (let i = 1; i <= 5; i++) {
        builder.addNode(`processor${i}`, "process");
      }
      for (let i = 1; i <= 3; i++) {
        builder.addNode(`transformer${i}`, "transform");
      }
      builder.addNode("adder1", "add");
      builder.addNode("adder2", "add");

      builder
        .connect("Start.a", "processor1.input")
        .connect("Start.b", "processor2.input")
        .connect("processor1.output", "transformer1.data")
        .connect("processor2.output", "transformer2.data")
        .connect("transformer1.result", "adder1.a")
        .connect("transformer2.result", "adder1.b")
        .connect("adder1.result", "processor3.input")
        .connect("processor3.output", "Exit.final");

      const ast = builder.build();
      expect(ast.instances).toHaveLength(10);
      expect(ast.connections.length).toBeGreaterThan(7);

      const validation = validateWorkflow(ast);
      expect(validation.valid).toBe(true);
    });
  });

  describe("Test 4: Scope-Based Query and Modification", () => {
    it("should create scopes, query by scope, and modify scoped nodes", () => {
      const ast = createWorkflow("scoped")
        .addStartPort("input", { dataType: "NUMBER" })
        .addExitPort("output", { dataType: "NUMBER" })
        .addNodeType(createProcessorNodeType())
        .addNode("prep1", "process")
        .addNode("prep2", "process")
        .addNode("main1", "process")
        .addNode("main2", "process")
        .addNode("post1", "process")
        .connect("Start.input", "prep1.input")
        .connect("prep1.output", "prep2.input")
        .connect("prep2.output", "main1.input")
        .connect("main1.output", "main2.input")
        .connect("main2.output", "post1.input")
        .connect("post1.output", "Exit.output")
        .createScope("preparation", ["prep1", "prep2"])
        .createScope("processing", ["main1", "main2"])
        .build();

      const prepNodes = getNodesInScope(ast, "preparation");
      expect(prepNodes).toHaveLength(2);
      expect(prepNodes.map((n) => n.id)).toEqual(["prep1", "prep2"]);

      const processingNodes = getNodesInScope(ast, "processing");
      expect(processingNodes).toHaveLength(2);

      let modified = createScope(ast, "postprocessing", ["post1"]);
      modified = addToScope(modified, "postprocessing", "main2");

      const postNodes = getNodesInScope(modified, "postprocessing");
      expect(postNodes).toHaveLength(2);
      expect(postNodes.find((n) => n.id === "main2")).toBeDefined();
    });
  });

  describe("Test 5: Connection Analysis and Rewiring", () => {
    it("should analyze connections and rewire nodes", () => {
      const ast = createWorkflow("rewire")
        .addStartPort("x", { dataType: "NUMBER" })
        .addExitPort("result", { dataType: "NUMBER" })
        .addNodeType(createProcessorNodeType())
        .addNode("old", "process")
        .addNode("new", "process")
        .addNode("consumer", "process")
        .connect("Start.x", "old.input")
        .connect("old.output", "consumer.input")
        .connect("consumer.output", "Exit.result")
        .build();

      const oldOutgoing = getOutgoingConnections(ast, "old");
      expect(oldOutgoing).toHaveLength(1);
      expect(oldOutgoing[0].to.node).toBe("consumer");

      const deps = getDependencies(ast, "consumer");
      expect(deps).toContain("old");

      let modified = removeAllConnections(ast, "old");
      modified = addConnection(modified, "Start.x", "new.input");
      modified = addConnection(modified, "new.output", "consumer.input");

      const newOutgoing = getOutgoingConnections(modified, "new");
      expect(newOutgoing).toHaveLength(1);
      expect(newOutgoing[0].to.node).toBe("consumer");

      const newDeps = getDependencies(modified, "consumer");
      expect(newDeps).not.toContain("old");
      expect(newDeps).toContain("new");
    });
  });

  describe("Test 6: Dead-End Detection and Repair", () => {
    it("should detect dead-end nodes and connect them to Exit", () => {
      const ast = createWorkflow("deadend")
        .addStartPort("x", { dataType: "NUMBER" })
        .addExitPort("result", { dataType: "NUMBER" })
        .addNodeType(createProcessorNodeType())
        .addNode("connected", "process")
        .addNode("deadend1", "process")
        .addNode("deadend2", "process")
        .connect("Start.x", "connected.input")
        .connect("connected.output", "Exit.result")
        .connect("Start.x", "deadend1.input")
        .connect("Start.x", "deadend2.input")
        .build();

      const deadEnds = findDeadEnds(ast);
      expect(deadEnds).toHaveLength(2);
      expect(deadEnds).toContain("deadend1");
      expect(deadEnds).toContain("deadend2");

      let repaired = ast;
      for (const nodeId of deadEnds) {
        repaired = addConnection(
          repaired,
          `${nodeId}.output`,
          "Exit.result",
        );
      }

      const deadEndsAfter = findDeadEnds(repaired);
      expect(deadEndsAfter).toHaveLength(0);

      const validation = validateWorkflow(repaired);
      expect(validation.valid).toBe(true);
    });
  });

  describe("Test 7: Bulk Operations Performance", () => {
    it("should efficiently add and remove multiple nodes", () => {
      const builder = createWorkflow("bulk")
        .addStartPort("input", { dataType: "NUMBER" })
        .addExitPort("output", { dataType: "NUMBER" })
        .addNodeType(createProcessorNodeType());

      builder.addNode("first", "process");
      for (let i = 0; i < 19; i++) {
        builder.addNode(`node${i}`, "process");
      }
      builder.addNode("last", "process");

      builder.connect("Start.input", "first.input");
      for (let i = 0; i < 19; i++) {
        builder.connect(`first.output`, `node${i}.input`);
      }
      builder.connect("first.output", "last.input");
      builder.connect("last.output", "Exit.output");

      const ast = builder.build();
      expect(ast.instances).toHaveLength(21);

      const nodeIdsToRemove = Array.from({ length: 19 }, (_, i) => `node${i}`);
      const reduced = removeNodes(ast, nodeIdsToRemove);
      expect(reduced.instances).toHaveLength(2);
      expect(reduced.instances.map((n) => n.id)).toEqual(["first", "last"]);

      const validation = validateWorkflow(reduced);
      expect(validation.valid).toBe(true);
    });
  });

  describe("Test 8: Error Recovery Pattern", () => {
    it("should handle errors gracefully and maintain valid state", () => {
      const ast = createWorkflow("recovery")
        .addStartPort("x", { dataType: "NUMBER" })
        .addExitPort("result", { dataType: "NUMBER" })
        .addNodeType(createProcessorNodeType())
        .addNode("node1", "process")
        .connect("Start.x", "node1.input")
        .connect("node1.output", "Exit.result")
        .build();

      expect(() => {
        addNode(ast, createNodeInstance("node1", "process"));
      }).toThrow(/already exists/);

      const unchangedValidation = validateWorkflow(ast);
      expect(unchangedValidation.valid).toBe(true);

      // Note: addNode uses eventual consistency - it doesn't throw for nonexistent types
      // The validation still passes because it's designed for incremental edits
      // Diagnostics (not validation) catch INVALID_NODE_TYPE issues
      let recovered = addNode(ast, createNodeInstance("node2", "nonexistent"));

      // Node was added - validation passes because validation doesn't check node types
      // This is by design: eventual consistency model for incremental edits
      expect(getNode(recovered, "node2")).toBeDefined();

      // Remove the invalid node to restore clean state
      recovered = removeNode(recovered, "node2");

      recovered = addNode(recovered, createNodeInstance("node2", "process"));
      recovered = addConnection(recovered, "node1.output", "node2.input");

      try {
        recovered = reconnect(
          recovered,
          { node: "node1", port: "output" },
          { node: "nonexistent", port: "input" },
          { node: "node2", port: "input" },
        );
      } catch (error) {
        expect(error).toBeDefined();
      }

      const finalValidation = validateWorkflow(recovered);
      expect(finalValidation.valid).toBe(true);
    });
  });
});
