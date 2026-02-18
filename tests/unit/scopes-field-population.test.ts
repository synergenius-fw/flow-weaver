import { parser } from "../../src/parser";
import path from "path";
import * as os from "os";

describe("Scopes Field Population", () => {
  it("should populate scopes field from per-port scoped ports", () => {
    // Create a test file with per-port scoped node
    const testContent = `
/**
 * @flowWeaver nodeType
 * @input items
 * @output start scope:iteration
 * @output item scope:iteration
 * @output processItem scope:iteration
 * @input success scope:iteration
 * @input failure scope:iteration
 * @input processed scope:iteration
 * @output results
 */
function forEach(execute: boolean, items: any[], processItem: Function) {
  return { onSuccess: true, onFailure: false, results: [] };
}

export { forEach };
    `.trim();

    const fs = require("fs");
    const testFile = path.join(os.tmpdir(), `flow-weaver-scopes-field-${process.pid}`, "test-scopes-field.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, testContent);

    const result = parser.parse(testFile);
    const forEachNode = result.nodeTypes.find((nt) => nt.functionName === "forEach");

    expect(forEachNode).toBeDefined();
    expect(forEachNode?.scopes).toBeDefined();
    expect(forEachNode?.scopes).toEqual(["iteration"]);

    // Verify ports have scope attribute
    const itemPort = forEachNode?.outputs.item;
    expect(itemPort?.scope).toBe("iteration");
  });

  it("should handle node-level scope (old architecture)", () => {
    const testContent = `
/**
 * @flowWeaver nodeType
 * @scope container
 * @input value
 * @output result
 */
function Container(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value };
}

export { Container };
    `.trim();

    const fs = require("fs");
    const testFile = path.join(os.tmpdir(), `flow-weaver-scopes-field-${process.pid}`, "test-node-level-scope.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, testContent);

    const result = parser.parse(testFile);
    const containerNode = result.nodeTypes.find((nt) => nt.functionName === "Container");

    expect(containerNode).toBeDefined();
    expect(containerNode?.scopes).toBeDefined();
    expect(containerNode?.scopes).toEqual(["container"]);
    expect(containerNode?.scope).toBe("container");
  });

  it("should have undefined scopes when no scopes are defined", () => {
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
    const testFile = path.join(os.tmpdir(), `flow-weaver-scopes-field-${process.pid}`, "test-no-scopes.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, testContent);

    const result = parser.parse(testFile);
    const addNode = result.nodeTypes.find((nt) => nt.functionName === "Add");

    expect(addNode).toBeDefined();
    expect(addNode?.scopes).toBeUndefined();
  });
});