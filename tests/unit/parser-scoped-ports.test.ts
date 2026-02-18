/**
 * Test Parser Scoped Port Attribute Extraction
 * Verifies that @input and @output annotations with scope: attribute are parsed correctly
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parser } from "../../src/parser";

describe("Parser Scoped Port Attributes", () => {
  const testDir = path.join(os.tmpdir(), `flow-weaver-parser-scoped-ports-${process.pid}`);
  const testFile = path.join(testDir, "scoped-ports-test.ts");

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it("should parse scope: attribute from @input ports", () => {
    // Create test file with scoped input port
    const content = `
/**
 * @flowWeaver nodeType
 * @input x scope:container
 * @output y
 */
function testNode(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, y: x + 10 };
}
`;
    fs.writeFileSync(testFile, content);

    // Parse the file
    const parsed = parser.parse(testFile);

    // Verify node type was parsed
    expect(parsed.nodeTypes.length).toBe(1);
    const nodeType = parsed.nodeTypes[0];

    // Verify input port has scope attribute
    expect(nodeType.inputs.x).toBeDefined();
    expect(nodeType.inputs.x.scope).toBe("container");

    // Verify output port has no scope
    expect(nodeType.outputs.y).toBeDefined();
    expect(nodeType.outputs.y.scope).toBeUndefined();
  });

  it("should parse scope: attribute from @output ports", () => {
    // Create test file with scoped output port
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output y scope:container
 */
function testNode(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, y: x + 10 };
}
`;
    fs.writeFileSync(testFile, content);

    // Parse the file
    const parsed = parser.parse(testFile);

    // Verify node type was parsed
    expect(parsed.nodeTypes.length).toBe(1);
    const nodeType = parsed.nodeTypes[0];

    // Verify input port has no scope
    expect(nodeType.inputs.x).toBeDefined();
    expect(nodeType.inputs.x.scope).toBeUndefined();

    // Verify output port has scope attribute
    expect(nodeType.outputs.y).toBeDefined();
    expect(nodeType.outputs.y.scope).toBe("container");
  });

  it("should parse multiple scoped ports with different scope names", () => {
    // Create test file with multiple scoped ports
    const content = `
/**
 * @flowWeaver nodeType
 * @input a scope:scope1
 * @input b scope:scope2
 * @output x scope:scope1
 * @output y scope:scope2
 * @output z
 */
function testNode(execute: boolean, a: number, b: string) {
  return { onSuccess: true, onFailure: false, x: a, y: b, z: true };
}
`;
    fs.writeFileSync(testFile, content);

    // Parse the file
    const parsed = parser.parse(testFile);

    // Verify node type was parsed
    expect(parsed.nodeTypes.length).toBe(1);
    const nodeType = parsed.nodeTypes[0];

    // Verify each port has correct scope
    expect(nodeType.inputs.a.scope).toBe("scope1");
    expect(nodeType.inputs.b.scope).toBe("scope2");
    expect(nodeType.outputs.x.scope).toBe("scope1");
    expect(nodeType.outputs.y.scope).toBe("scope2");
    expect(nodeType.outputs.z.scope).toBeUndefined();
  });

  it("should parse scoped ports with optional parameters and order", () => {
    // Create test file with scoped ports plus optional/order attributes
    const content = `
/**
 * @flowWeaver nodeType
 * @input [x=5] scope:container [order:0] - Input value
 * @output y scope:container [order:1] - Output value
 */
function testNode(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, y: x + 10 };
}
`;
    fs.writeFileSync(testFile, content);

    // Parse the file
    const parsed = parser.parse(testFile);

    // Verify node type was parsed
    expect(parsed.nodeTypes.length).toBe(1);
    const nodeType = parsed.nodeTypes[0];

    // Verify input port has scope plus optional/default/label
    expect(nodeType.inputs.x.scope).toBe("container");
    expect(nodeType.inputs.x.optional).toBe(true);
    expect(nodeType.inputs.x.default).toBe(5);
    expect(nodeType.inputs.x.label).toBe("Input value");

    // Verify output port has scope plus label
    expect(nodeType.outputs.y.scope).toBe("container");
    expect(nodeType.outputs.y.label).toBe("Output value");
  });
});
