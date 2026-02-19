import { parser } from "../../src/parser";
import { annotationGenerator } from "../../src/annotation-generator";
import path from "path";
import * as fs from "fs";
import * as os from "os";

describe("Scope Annotation Round-Trip", () => {
  it("should preserve scope annotations on ports during round-trip", () => {
    // Create a test file with per-port scoped node (forEach example)
    const testContent = `
/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items
 * @output start scope:iteration
 * @output item scope:iteration
 * @output processItem scope:iteration
 * @input success scope:iteration
 * @input failure scope:iteration
 * @input processed scope:iteration
 * @output results
 */
function forEach(
  execute: boolean,
  items: any[],
  onSuccess: boolean,
  onFailure: boolean,
  processed: any
) {
  if (!execute) return { execute: false, item: null, processItem: () => {}, onSuccess: false, onFailure: false, results: [] };
  return { execute: true, item: items[0], processItem: () => {}, onSuccess: true, onFailure: false, results: [] };
}

export { forEach };
    `.trim();

    const testFile = path.join(os.tmpdir(), `flow-weaver-scope-roundtrip-${process.pid}`, "test-scope-roundtrip.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, testContent);

    // Parse the file
    const result = parser.parse(testFile);
    const forEachNode = result.nodeTypes.find((nt) => nt.functionName === "forEach");

    expect(forEachNode).toBeDefined();
    expect(forEachNode?.scopes).toEqual(["iteration"]);

    // Verify ports have scope in AST
    expect(forEachNode?.outputs.start?.scope).toBe("iteration");
    expect(forEachNode?.outputs.item?.scope).toBe("iteration");
    expect(forEachNode?.outputs.processItem?.scope).toBe("iteration");
    expect(forEachNode?.inputs.success?.scope).toBe("iteration");
    expect(forEachNode?.inputs.failure?.scope).toBe("iteration");
    expect(forEachNode?.inputs.processed?.scope).toBe("iteration");

    // Create a minimal workflow AST with just this node type
    const workflowAST = {
      type: "Workflow" as const,
      sourceFile: testFile,
      generatedFile: "",
      name: "test",
      functionName: "test",
      description: undefined,
      instances: [],
      connections: [],
      nodeTypes: [forEachNode!],
      startPorts: {},
      exitPorts: {},
      imports: [],
      metadata: {},
    };

    // Generate annotations from AST
    const regeneratedAnnotations = annotationGenerator.generate(workflowAST, {
      includeComments: true,
      includeMetadata: true,
    });

    // Verify scope annotations are preserved in the regenerated JSDoc
    expect(regeneratedAnnotations).toContain("@output start scope:iteration");
    expect(regeneratedAnnotations).toContain("@output item scope:iteration");
    expect(regeneratedAnnotations).toContain("@output processItem scope:iteration");
    expect(regeneratedAnnotations).toContain("@input success scope:iteration");
    expect(regeneratedAnnotations).toContain("@input failure scope:iteration");
    expect(regeneratedAnnotations).toContain("@input processed scope:iteration");

    // Cleanup
    fs.rmSync(testFile, { force: true });
  });

  it("should not add scope annotation when port has no scope", () => {
    const testContent = `
/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 * @output sum
 */
function Add(execute: boolean, x: number, y: number) {
  return { onSuccess: true, onFailure: false, sum: x + y };
}

export { Add };
    `.trim();

    const fs = require("fs");
    const testFile = path.join(os.tmpdir(), `flow-weaver-scope-roundtrip-${process.pid}`, "test-no-scope-roundtrip.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, testContent);

    const result = parser.parse(testFile);
    const addNode = result.nodeTypes.find((nt) => nt.functionName === "Add");

    expect(addNode).toBeDefined();
    expect(addNode?.inputs.x?.scope).toBeUndefined();
    expect(addNode?.outputs.sum?.scope).toBeUndefined();

    const workflowAST = {
      type: "Workflow" as const,
      sourceFile: testFile,
      generatedFile: "",
      name: "test",
      functionName: "test",
      description: undefined,
      instances: [],
      connections: [],
      nodeTypes: [addNode!],
      startPorts: {},
      exitPorts: {},
      imports: [],
      metadata: {},
    };

    const regeneratedAnnotations = annotationGenerator.generate(workflowAST);

    // Should NOT contain scope annotations
    expect(regeneratedAnnotations).not.toContain("scope:");

    // Cleanup
    fs.rmSync(testFile, { force: true });
  });

  it("should generate @name tag when name differs from functionName", () => {
    const testContent = `
/**
 * @flowWeaver nodeType
 * @label My Custom Node
 * @name customDisplayName
 * @input value
 * @output result
 */
function generatedId_abc123(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

export { generatedId_abc123 };
    `.trim();

    const fs = require("fs");
    const testFile = path.join(os.tmpdir(), `flow-weaver-scope-roundtrip-${process.pid}`, "test-name-annotation.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, testContent);

    // Parse the file
    const result = parser.parse(testFile);
    const nodeType = result.nodeTypes.find((nt) => nt.functionName === "generatedId_abc123");

    expect(nodeType).toBeDefined();
    expect(nodeType?.name).toBe("customDisplayName");
    expect(nodeType?.functionName).toBe("generatedId_abc123");
    expect(nodeType?.label).toBe("My Custom Node");

    // Create a workflow AST with this node type
    const workflowAST = {
      type: "Workflow" as const,
      sourceFile: testFile,
      generatedFile: "",
      name: "test",
      functionName: "test",
      description: undefined,
      instances: [],
      connections: [],
      nodeTypes: [nodeType!],
      startPorts: {},
      exitPorts: {},
      imports: [],
      metadata: {},
    };

    // Generate annotations
    const regeneratedAnnotations = annotationGenerator.generate(workflowAST, {
      includeComments: true,
      includeMetadata: true,
    });

    // Should contain @name tag since name differs from functionName
    expect(regeneratedAnnotations).toContain("@name customDisplayName");
    expect(regeneratedAnnotations).toContain("@label My Custom Node");

    // Cleanup
    fs.rmSync(testFile, { force: true });
  });

  it("should NOT generate @name tag when name equals functionName", () => {
    const testContent = `
/**
 * @flowWeaver nodeType
 * @label My Node
 * @input value
 * @output result
 */
function myNode(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

export { myNode };
    `.trim();

    const fs = require("fs");
    const testFile = path.join(os.tmpdir(), `flow-weaver-scope-roundtrip-${process.pid}`, "test-no-name-annotation.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, testContent);

    // Parse the file
    const result = parser.parse(testFile);
    const nodeType = result.nodeTypes.find((nt) => nt.functionName === "myNode");

    expect(nodeType).toBeDefined();
    // name should equal functionName when no @name tag
    expect(nodeType?.name).toBe("myNode");
    expect(nodeType?.functionName).toBe("myNode");

    // Create a workflow AST with this node type
    const workflowAST = {
      type: "Workflow" as const,
      sourceFile: testFile,
      generatedFile: "",
      name: "test",
      functionName: "test",
      description: undefined,
      instances: [],
      connections: [],
      nodeTypes: [nodeType!],
      startPorts: {},
      exitPorts: {},
      imports: [],
      metadata: {},
    };

    // Generate annotations
    const regeneratedAnnotations = annotationGenerator.generate(workflowAST, {
      includeComments: true,
      includeMetadata: true,
    });

    // Should NOT contain @name tag since name equals functionName
    expect(regeneratedAnnotations).not.toContain("@name ");
    // But should still have @label
    expect(regeneratedAnnotations).toContain("@label My Node");

    // Cleanup
    fs.rmSync(testFile, { force: true });
  });

  it("should preserve @name tag during round-trip parse -> generate -> parse", () => {
    const testContent = `
/**
 * @flowWeaver nodeType
 * @label Expression Node
 * @name ExpressionNode_123456
 * @input value
 * @output result
 */
function expr_abc123xyz(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

export { expr_abc123xyz };
    `.trim();

    const fs = require("fs");
    const testFile = path.join(os.tmpdir(), `flow-weaver-scope-roundtrip-${process.pid}`, "test-name-roundtrip.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, testContent);

    // First parse
    const result1 = parser.parse(testFile);
    const nodeType1 = result1.nodeTypes.find((nt) => nt.functionName === "expr_abc123xyz");

    expect(nodeType1).toBeDefined();
    expect(nodeType1?.name).toBe("ExpressionNode_123456");
    expect(nodeType1?.functionName).toBe("expr_abc123xyz");

    // Generate annotations
    const workflowAST = {
      type: "Workflow" as const,
      sourceFile: testFile,
      generatedFile: "",
      name: "test",
      functionName: "test",
      description: undefined,
      instances: [],
      connections: [],
      nodeTypes: [nodeType1!],
      startPorts: {},
      exitPorts: {},
      imports: [],
      metadata: {},
    };

    const regeneratedAnnotations = annotationGenerator.generate(workflowAST, {
      includeComments: true,
      includeMetadata: true,
    });

    // Write regenerated content to a new file
    const testFile2 = path.join(os.tmpdir(), `flow-weaver-scope-roundtrip-${process.pid}`, "test-name-roundtrip-2.ts");
    fs.writeFileSync(testFile2, regeneratedAnnotations);

    // Second parse
    const result2 = parser.parse(testFile2);
    const nodeType2 = result2.nodeTypes.find((nt) => nt.functionName === "expr_abc123xyz");

    expect(nodeType2).toBeDefined();
    // name should be preserved after round-trip
    expect(nodeType2?.name).toBe("ExpressionNode_123456");
    expect(nodeType2?.functionName).toBe("expr_abc123xyz");

    // Cleanup
    fs.rmSync(testFile, { force: true });
    fs.rmSync(testFile2, { force: true });
  });
});