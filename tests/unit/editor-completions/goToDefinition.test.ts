import { getDefinitionLocation, WorkflowContext } from "../../../src/editor-completions";

describe("getDefinitionLocation", () => {
  const context: WorkflowContext = {
    nodeTypes: {
      MyAdder: {
        name: "MyAdder",
        category: "Math",
        description: "Adds two numbers",
        ports: [
          { name: "execute", direction: "INPUT", dataType: "STEP" },
          { name: "a", direction: "INPUT", dataType: "Number" },
          { name: "result", direction: "OUTPUT", dataType: "Number" },
        ],
        filePath: "/src/nodes/math.ts",
        line: 42,
      },
      Logger: {
        name: "Logger",
        category: "Utility",
        ports: [{ name: "message", direction: "INPUT", dataType: "String" }],
        filePath: "/src/nodes/utility.ts",
        line: 10,
      },
    },
    instances: [
      { id: "adder1", nodeType: "MyAdder" },
      { id: "logger1", nodeType: "Logger" },
    ],
  };

  describe("nodeType definitions", () => {
    it("should find nodeType definition in @node declaration", () => {
      const result = getDefinitionLocation(" * @node add1 MyAdder", 18, context);
      expect(result).toEqual({
        type: "nodeType",
        name: "MyAdder",
        filePath: "/src/nodes/math.ts",
        line: 42,
      });
    });

    it("should return null for unknown nodeType", () => {
      const result = getDefinitionLocation(" * @node add1 UnknownType", 18, context);
      expect(result).toBeNull();
    });
  });

  describe("nodeId definitions", () => {
    it("should find node instance definition in @connect", () => {
      const result = getDefinitionLocation(" * @connect adder1.result", 12, context);
      expect(result).toEqual({
        type: "node",
        name: "adder1",
        filePath: "/src/nodes/math.ts",
        line: 42,
      });
    });

    it("should return null for unknown nodeId", () => {
      const result = getDefinitionLocation(" * @connect unknown.port", 12, context);
      expect(result).toBeNull();
    });
  });

  describe("port definitions", () => {
    it("should find port definition after nodeId.", () => {
      const result = getDefinitionLocation(" * @connect adder1.result", 19, context);
      expect(result).toEqual({
        type: "port",
        name: "result",
        filePath: "/src/nodes/math.ts",
        line: 42,
      });
    });

    it("should return null for unknown port", () => {
      const result = getDefinitionLocation(" * @connect adder1.unknownPort", 19, context);
      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should return null when clicking on whitespace", () => {
      const result = getDefinitionLocation(" * @connect ", 11, context);
      expect(result).toBeNull();
    });

    it("should return null for annotation keywords", () => {
      const result = getDefinitionLocation(" * @connect", 5, context);
      expect(result).toBeNull();
    });
  });
});
