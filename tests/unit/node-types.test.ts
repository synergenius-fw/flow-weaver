/**
 * Test Node Types Generation
 * Verifies that @flowWeaver nodeType annotations are converted to Flow Weaver TNodeType format
 */

import * as fs from "fs";
import * as path from "path";
import { parser } from "../../src/parser";
import { nodeTypesGenerator } from "../../src/node-types-generator";

describe("Node Types Generation", () => {
  const inputPath = path.join(__dirname, "../../fixtures/basic/example.ts");
  const outputPath = path.join(
    global.testHelpers.outputDir,
    "example.node-types.ts",
  );
  let nodeTypes: any[];
  let moduleCode: string;

  beforeAll(async () => {
    // Parse annotations
    const parsed = parser.parse(inputPath);

    // Generate node types
    nodeTypes = nodeTypesGenerator.generateAllNodeTypes(
      parsed.nodeTypes,
      inputPath,
      path.resolve(__dirname, "../../../.."),
    );

    // Generate node types module
    moduleCode = nodeTypesGenerator.generateNodeTypesModule(
      parsed.nodeTypes,
      inputPath,
      path.resolve(__dirname, "../../../.."),
    );

    fs.writeFileSync(outputPath, moduleCode);
  });

  afterAll(() => {
    global.testHelpers.cleanupOutput("example.node-types.ts");
  });

  it("should generate node types for all nodes", () => {
    expect(nodeTypes.length).toBeGreaterThan(0);
  });

  it("should assign LOCAL_FUNCTION variant to all nodes", () => {
    const allLocalFunction = nodeTypes.every(
      (nt) => nt.variant === "LOCAL_FUNCTION",
    );
    expect(allLocalFunction).toBe(true);
  });

  it("should have required ports (execute, onSuccess, onFailure) for all nodes", () => {
    nodeTypes.forEach((nodeType) => {
      const hasExecute = nodeType.ports.some((p: any) => p.name === "execute");
      const hasOnSuccess = nodeType.ports.some(
        (p: any) => p.name === "onSuccess",
      );
      const hasOnFailure = nodeType.ports.some(
        (p: any) => p.name === "onFailure",
      );

      expect(hasExecute).toBe(true);
      expect(hasOnSuccess).toBe(true);
      expect(hasOnFailure).toBe(true);
    });
  });

  it("should have correct input ports for add node", () => {
    const addNode = nodeTypes.find((nt) => nt.name === "add");

    expect(addNode).toBeDefined();
    const hasInputA = addNode.ports.some(
      (p: any) => p.name === "a" && p.direction === "INPUT",
    );
    const hasInputB = addNode.ports.some(
      (p: any) => p.name === "b" && p.direction === "INPUT",
    );
    expect(hasInputA).toBe(true);
    expect(hasInputB).toBe(true);
  });

  it("should have correct output port for add node", () => {
    const addNode = nodeTypes.find((nt) => nt.name === "add");

    expect(addNode).toBeDefined();
    const hasOutputSum = addNode.ports.some(
      (p: any) => p.name === "sum" && p.direction === "OUTPUT",
    );
    expect(hasOutputSum).toBe(true);
  });

  it("should extract parameters for add node", () => {
    const addNode = nodeTypes.find((nt) => nt.name === "add");

    expect(addNode).toBeDefined();
    // STEP Port Architecture: execute is first parameter, then a and b
    expect(addNode.parameters.length).toBe(3);
  });

  it("should generate valid node types module code", () => {
    expect(moduleCode).toContain("export const nodeTypes");
    expect(moduleCode).toContain("TLocalFunctionNodeType");
  });

  it("should not populate scope field on ports without scope: attribute", () => {
    // Parse a scoped node type using OLD @scope annotation (no longer supported for per-port scope)
    const testFile = path.join(__dirname, "../../fixtures/advanced/example-scoped.ts");
    const parsed = parser.parse(testFile);

    // Generate node types
    const scopedNodeTypes = nodeTypesGenerator.generateAllNodeTypes(
      parsed.nodeTypes,
      testFile,
      path.resolve(__dirname, "../../../..")
    );

    // Find the container node type
    const containerNode = scopedNodeTypes.find(nt => nt.name === "container");
    expect(containerNode).toBeDefined();
    // Node type still has scopes array (for backwards compat tracking)
    expect(containerNode!.scopes).toEqual(["scope"]);

    // IMPORTANT: Ports should NOT have scope unless they use scope: attribute
    // The old @scope annotation at node type level is NOT used for per-port scope
    const valuePorts = containerNode!.ports.filter(p => p.name === "value");
    expect(valuePorts.length).toBeGreaterThan(0);

    valuePorts.forEach(port => {
      // Should be undefined because the port doesn't have scope: attribute
      expect(port.scope).toBeUndefined();
    });

    // Verify nodes without scope annotation also have undefined scope on ports
    const addTenNode = scopedNodeTypes.find(nt => nt.name === "addTen");
    if (addTenNode) {
      const nonReservedPorts = addTenNode.ports.filter(
        p => p.name !== "execute" && p.name !== "onSuccess" && p.name !== "onFailure"
      );
      nonReservedPorts.forEach(port => {
        expect(port.scope).toBeUndefined();
      });
    }
  });
});
