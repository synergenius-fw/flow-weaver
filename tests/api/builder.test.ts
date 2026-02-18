/**
 * Comprehensive tests for Builder API
 * Tests the fluent WorkflowBuilder class and factory functions
 */

import {
  WorkflowBuilder,
  createWorkflow,
  fromAST,
} from "../../src/api/builder";
import type { TWorkflowAST } from "../../src/ast/types";
import { STANDARD_PROCESSOR_NODE_TYPE as sampleNodeType } from "../helpers/test-fixtures";

describe("Builder API - WorkflowBuilder", () => {
  describe("constructor", () => {
    it("should create minimal workflow with name", () => {
      const builder = new WorkflowBuilder("testWorkflow");

      const workflow = builder.getWorkflow();

      expect(workflow.name).toBe("testWorkflow");
      expect(workflow.functionName).toBe("testWorkflow");
      expect(workflow.sourceFile).toBe("testWorkflow.ts");
      expect(workflow.nodeTypes).toHaveLength(0);
      expect(workflow.instances).toHaveLength(0);
      expect(workflow.connections).toHaveLength(0);
    });

    it("should accept custom source file", () => {
      const builder = new WorkflowBuilder("test", "custom.ts");

      const workflow = builder.getWorkflow();

      expect(workflow.sourceFile).toBe("custom.ts");
    });
  });

  describe("addStartPort", () => {
    it("should add Start port", () => {
      const workflow = new WorkflowBuilder("test")
        .addStartPort("input", { dataType: "NUMBER" })
        .getWorkflow();

      expect(workflow.startPorts.input).toBeDefined();
      expect(workflow.startPorts.input.dataType).toBe("NUMBER");
    });

    it("should support multiple Start ports", () => {
      const workflow = new WorkflowBuilder("test")
        .addStartPort("input1", { dataType: "NUMBER" })
        .addStartPort("input2", { dataType: "STRING" })
        .getWorkflow();

      expect(Object.keys(workflow.startPorts)).toEqual(["input1", "input2"]);
    });

    it("should allow chaining", () => {
      const builder = new WorkflowBuilder("test").addStartPort("input", {
        dataType: "NUMBER",
      });

      expect(builder).toBeInstanceOf(WorkflowBuilder);
    });
  });

  describe("addExitPort", () => {
    it("should add Exit port", () => {
      const workflow = new WorkflowBuilder("test")
        .addExitPort("output", { dataType: "NUMBER" })
        .getWorkflow();

      expect(workflow.exitPorts.output).toBeDefined();
      expect(workflow.exitPorts.output.dataType).toBe("NUMBER");
    });

    it("should support multiple Exit ports", () => {
      const workflow = new WorkflowBuilder("test")
        .addExitPort("result", { dataType: "NUMBER" })
        .addExitPort("error", { dataType: "STRING" })
        .getWorkflow();

      expect(Object.keys(workflow.exitPorts)).toEqual(["result", "error"]);
    });
  });

  describe("addNodeType", () => {
    it("should add node type definition", () => {
      const workflow = new WorkflowBuilder("test")
        .addNodeType(sampleNodeType)
        .getWorkflow();

      expect(workflow.nodeTypes).toHaveLength(1);
      expect(workflow.nodeTypes[0].name).toBe("processor");
    });

    it("should throw on duplicate node type", () => {
      const builder = new WorkflowBuilder("test").addNodeType(sampleNodeType);

      expect(() => builder.addNodeType(sampleNodeType)).toThrow(
        /already exists/,
      );
    });

    it("should allow chaining", () => {
      const builder = new WorkflowBuilder("test").addNodeType(sampleNodeType);

      expect(builder).toBeInstanceOf(WorkflowBuilder);
    });
  });

  describe("addNode", () => {
    it("should add node instance", () => {
      const workflow = new WorkflowBuilder("test")
        .addNodeType(sampleNodeType)
        .addNode("node1", "process")
        .getWorkflow();

      expect(workflow.instances).toHaveLength(1);
      expect(workflow.instances[0].id).toBe("node1");
      expect(workflow.instances[0].nodeType).toBe("process");
    });

    it("should add node with config", () => {
      const workflow = new WorkflowBuilder("test")
        .addNodeType(sampleNodeType)
        .addNode("node1", "process", { x: 100, y: 200, label: "Main" })
        .getWorkflow();

      expect(workflow.instances[0].config?.x).toBe(100);
      expect(workflow.instances[0].config?.y).toBe(200);
      expect(workflow.instances[0].config?.label).toBe("Main");
    });

    it("should throw on duplicate node ID", () => {
      const builder = new WorkflowBuilder("test")
        .addNodeType(sampleNodeType)
        .addNode("node1", "process");

      expect(() => builder.addNode("node1", "process")).toThrow(
        /already exists/,
      );
    });

    it("should throw on non-existent node type", () => {
      const builder = new WorkflowBuilder("test");

      expect(() => builder.addNode("node1", "nonExistent")).toThrow(
        /not found/,
      );
    });
  });

  describe("connect", () => {
    it("should connect ports using string format", () => {
      const workflow = new WorkflowBuilder("test")
        .addStartPort("x", { dataType: "NUMBER" })
        .addExitPort("y", { dataType: "NUMBER" })
        .addNodeType(sampleNodeType)
        .addNode("node1", "process")
        .connect("Start.x", "node1.input")
        .connect("node1.output", "Exit.y")
        .getWorkflow();

      expect(workflow.connections).toHaveLength(2);
      expect(workflow.connections[0].from).toEqual({ node: "Start", port: "x" });
      expect(workflow.connections[0].to).toEqual({ node: "node1", port: "input" });
    });

    it("should connect ports using object format", () => {
      const workflow = new WorkflowBuilder("test")
        .addStartPort("x", { dataType: "NUMBER" })
        .addExitPort("y", { dataType: "NUMBER" })
        .addNodeType(sampleNodeType)
        .addNode("node1", "process")
        .connect({ node: "Start", port: "x" }, { node: "node1", port: "input" })
        .connect({ node: "node1", port: "output" }, { node: "Exit", port: "y" })
        .getWorkflow();

      expect(workflow.connections).toHaveLength(2);
    });

    it("should throw on invalid port reference format", () => {
      const builder = new WorkflowBuilder("test");

      expect(() => builder.connect("invalid", "node1.input")).toThrow(
        /Invalid port reference/,
      );
    });
  });

  describe("createScope", () => {
    it("should create scope with nodes", () => {
      const workflow = new WorkflowBuilder("test")
        .addNodeType(sampleNodeType)
        .addNode("node1", "process")
        .addNode("node2", "process")
        .createScope("mainScope", ["node1", "node2"])
        .getWorkflow();

      expect(workflow.scopes?.mainScope).toEqual(["node1", "node2"]);
      expect(workflow.instances[0].parent).toEqual({ id: "mainScope", scope: "" });
      expect(workflow.instances[1].parent).toEqual({ id: "mainScope", scope: "" });
    });

    it("should throw on duplicate scope name", () => {
      const builder = new WorkflowBuilder("test")
        .addNodeType(sampleNodeType)
        .addNode("node1", "process")
        .createScope("test", ["node1"]);

      expect(() => builder.createScope("test", [])).toThrow(/already exists/);
    });
  });

  describe("setDescription", () => {
    it("should set workflow description", () => {
      const workflow = new WorkflowBuilder("test")
        .setDescription("Test workflow description")
        .getWorkflow();

      expect(workflow.description).toBe("Test workflow description");
    });
  });

  describe("validate", () => {
    it("should return validation result", () => {
      const builder = new WorkflowBuilder("test")
        .addStartPort("x", { dataType: "NUMBER" })
        .addExitPort("y", { dataType: "NUMBER" })
        .addNodeType(sampleNodeType)
        .addNode("node1", "process")
        .connect("Start.x", "node1.input")
        .connect("node1.output", "Exit.y");

      const validation = builder.validate();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should detect invalid workflows", () => {
      // Workflow with connection to non-existent port triggers validation error
      const builder = new WorkflowBuilder("test")
        .addStartPort("x", { dataType: "NUMBER" })
        .addExitPort("y", { dataType: "NUMBER" })
        .addNodeType(sampleNodeType)
        .addNode("node1", "process")
        .connect("Start.x", "node1.nonexistentPort"); // Invalid port name

      const validation = builder.validate();

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe("build", () => {
    it("should build valid workflow", () => {
      const workflow = new WorkflowBuilder("test")
        .addStartPort("x", { dataType: "NUMBER" })
        .addExitPort("y", { dataType: "NUMBER" })
        .addNodeType(sampleNodeType)
        .addNode("node1", "process")
        .connect("Start.x", "node1.input")
        .connect("node1.output", "Exit.y")
        .build();

      expect(workflow).toBeDefined();
      expect(workflow.name).toBe("test");
      expect(workflow.instances).toHaveLength(1);
    });

    it("should throw on invalid workflow", () => {
      // Workflow with connection to non-existent port triggers validation error
      const builder = new WorkflowBuilder("test")
        .addStartPort("x", { dataType: "NUMBER" })
        .addExitPort("y", { dataType: "NUMBER" })
        .addNodeType(sampleNodeType)
        .addNode("node1", "process")
        .connect("Start.x", "node1.nonexistentPort"); // Invalid port name

      expect(() => builder.build()).toThrow(/validation failed/);
    });
  });

  describe("complex workflow construction", () => {
    it("should build multi-node workflow with chaining", () => {
      const workflow = new WorkflowBuilder("dataProcessor")
        .setDescription("Processes data through multiple stages")
        .addStartPort("input", { dataType: "NUMBER" })
        .addExitPort("result", { dataType: "NUMBER" })
        .addNodeType({
          type: "NodeType",
          name: "doubler",
          functionName: "double",
          inputs: { x: { dataType: "NUMBER", optional: true } },
          outputs: { result: { dataType: "NUMBER" } },
          hasSuccessPort: true,
          hasFailurePort: true,
          isAsync: false,
          executeWhen: "CONJUNCTION",
        })
        .addNodeType({
          type: "NodeType",
          name: "adder",
          functionName: "add",
          inputs: { a: { dataType: "NUMBER", optional: true }, b: { dataType: "NUMBER", optional: true } },
          outputs: { sum: { dataType: "NUMBER" } },
          hasSuccessPort: true,
          hasFailurePort: true,
          isAsync: false,
          executeWhen: "CONJUNCTION",
        })
        .addNode("double1", "double", { x: 100, y: 100 })
        .addNode("double2", "double", { x: 200, y: 100 })
        .addNode("adder1", "add", { x: 150, y: 200 })
        .connect("Start.input", "double1.x")
        .connect("Start.input", "double2.x")
        .connect("double1.result", "adder1.a")
        .connect("double2.result", "adder1.b")
        .connect("adder1.sum", "Exit.result")
        .build();

      expect(workflow.instances).toHaveLength(3);
      expect(workflow.connections).toHaveLength(5);
      expect(workflow.description).toBe("Processes data through multiple stages");
    });

    it("should build workflow with scopes", () => {
      const workflow = new WorkflowBuilder("scopedWorkflow")
        .addStartPort("x", { dataType: "NUMBER" })
        .addExitPort("y", { dataType: "NUMBER" })
        .addNodeType(sampleNodeType)
        .addNode("node1", "process")
        .addNode("node2", "process")
        .addNode("node3", "process")
        .createScope("processing", ["node1", "node2"])
        .createScope("output", ["node3"])
        .connect("Start.x", "node1.input")
        .connect("node1.output", "node2.input")
        .connect("node2.output", "node3.input")
        .connect("node3.output", "Exit.y")
        .build();

      expect(workflow.scopes?.processing).toEqual(["node1", "node2"]);
      expect(workflow.scopes?.output).toEqual(["node3"]);
    });
  });
});

describe("Builder API - Factory Functions", () => {
  describe("createWorkflow", () => {
    it("should create WorkflowBuilder instance", () => {
      const builder = createWorkflow("test");

      expect(builder).toBeInstanceOf(WorkflowBuilder);
      expect(builder.getWorkflow().name).toBe("test");
    });

    it("should accept custom source file", () => {
      const builder = createWorkflow("test", "custom.ts");

      expect(builder.getWorkflow().sourceFile).toBe("custom.ts");
    });

    it("should allow fluent workflow construction", () => {
      const workflow = createWorkflow("simple")
        .addStartPort("x", { dataType: "NUMBER" })
        .addExitPort("y", { dataType: "NUMBER" })
        .connect("Start.x", "Exit.y")
        .build();

      expect(workflow.name).toBe("simple");
      expect(workflow.connections).toHaveLength(1);
    });
  });

  describe("fromAST", () => {
    it("should create builder from existing workflow", () => {
      const existingWorkflow: TWorkflowAST = {
        type: "Workflow",
        name: "existing",
        functionName: "existing",
        sourceFile: "existing.ts",
        nodeTypes: [sampleNodeType],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: { x: { dataType: "NUMBER" } },
        exitPorts: { y: { dataType: "NUMBER" } },
        imports: [],
      };

      const builder = fromAST(existingWorkflow);

      expect(builder).toBeInstanceOf(WorkflowBuilder);
      expect(builder.getWorkflow().name).toBe("existing");
      expect(builder.getWorkflow().nodeTypes).toHaveLength(1);
    });

    it("should allow modifying existing workflow", () => {
      const existingWorkflow: TWorkflowAST = {
        type: "Workflow",
        name: "existing",
        functionName: "existing",
        sourceFile: "existing.ts",
        nodeTypes: [sampleNodeType],
        instances: [],
        connections: [],
        scopes: {},
        startPorts: { x: { dataType: "NUMBER" } },
        exitPorts: { y: { dataType: "NUMBER" } },
        imports: [],
      };

      const modified = fromAST(existingWorkflow)
        .addNode("newNode", "process")
        .connect("Start.x", "newNode.input")
        .connect("newNode.output", "Exit.y")
        .build();

      expect(modified.instances).toHaveLength(1);
      expect(modified.connections).toHaveLength(2);
    });
  });
});

describe("Builder API - Integration", () => {
  it("should build complete workflow end-to-end", () => {
    const workflow = createWorkflow("calculator")
      .setDescription("Simple calculator workflow")
      .addStartPort("a", { dataType: "NUMBER" })
      .addStartPort("b", { dataType: "NUMBER" })
      .addExitPort("sum", { dataType: "NUMBER" })
      .addExitPort("product", { dataType: "NUMBER" })
      .addNodeType({
        type: "NodeType",
        name: "adder",
        functionName: "add",
        inputs: { x: { dataType: "NUMBER", optional: true }, y: { dataType: "NUMBER", optional: true } },
        outputs: { result: { dataType: "NUMBER" } },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
          executeWhen: "CONJUNCTION",
      })
      .addNodeType({
        type: "NodeType",
        name: "multiplier",
        functionName: "multiply",
        inputs: { x: { dataType: "NUMBER", optional: true }, y: { dataType: "NUMBER", optional: true } },
        outputs: { result: { dataType: "NUMBER" } },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
          executeWhen: "CONJUNCTION",
      })
      .addNode("adder1", "add")
      .addNode("multiplier1", "multiply")
      .connect("Start.a", "adder1.x")
      .connect("Start.b", "adder1.y")
      .connect("Start.a", "multiplier1.x")
      .connect("Start.b", "multiplier1.y")
      .connect("adder1.result", "Exit.sum")
      .connect("multiplier1.result", "Exit.product")
      .build();

    expect(workflow.name).toBe("calculator");
    expect(workflow.description).toBe("Simple calculator workflow");
    expect(workflow.nodeTypes).toHaveLength(2);
    expect(workflow.instances).toHaveLength(2);
    expect(workflow.connections).toHaveLength(6);
    expect(Object.keys(workflow.startPorts)).toEqual(["a", "b"]);
    expect(Object.keys(workflow.exitPorts)).toEqual(["sum", "product"]);
  });
});
