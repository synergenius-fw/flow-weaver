/**
 * Test Parser @connect Scope Suffix
 * Verifies that @connect annotations with scope suffix (port:scope) are parsed correctly
 *
 * Uses in-memory parsing (parseFromString) for speed - no file I/O.
 */

import { parser } from "../../src/parser";
import { generateInPlace } from "../../src/api/generate-in-place";
import { annotationGenerator } from "../../src/annotation-generator";

describe("Parser @connect Scope Suffix", () => {
  it("should parse @connect with scope suffix on from port", () => {
    const content = `
/**
 * @flowWeaver nodeType
 * @scopes iteration
 * @output start scope:iteration
 * @output item scope:iteration
 * @input success scope:iteration
 */
function forEach(execute: boolean, items: any[]) {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver nodeType
 * @input item
 * @output processed
 */
function transform(execute: boolean, item: any) {
  return { onSuccess: true, onFailure: false, processed: item };
}

/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @node forEach1 forEach
 * @node transform1 transform forEach1.iteration
 * @connect forEach1.start:iteration -> transform1.execute
 * @connect forEach1.item:iteration -> transform1.item
 * @connect transform1.onSuccess -> forEach1.success:iteration
 */
export function testWorkflow(execute: boolean, params: { items: any[] }) {
  throw new Error("Not implemented");
}
`;

    const parsed = parser.parseFromString(content);
    const workflow = parsed.workflows.find(w => w.name === "testWorkflow");

    expect(workflow).toBeDefined();
    expect(workflow!.connections.length).toBe(3);

    // Check first connection: forEach1.start:iteration -> transform1.execute
    const conn1 = workflow!.connections[0];
    expect(conn1.from.node).toBe("forEach1");
    expect(conn1.from.port).toBe("start");
    expect(conn1.from.scope).toBe("iteration");
    expect(conn1.to.node).toBe("transform1");
    expect(conn1.to.port).toBe("execute");
    expect(conn1.to.scope).toBeUndefined();

    // Check second connection: forEach1.item:iteration -> transform1.item
    const conn2 = workflow!.connections[1];
    expect(conn2.from.scope).toBe("iteration");
    expect(conn2.to.scope).toBeUndefined();

    // Check third connection: transform1.onSuccess -> forEach1.success:iteration
    const conn3 = workflow!.connections[2];
    expect(conn3.from.scope).toBeUndefined();
    expect(conn3.to.scope).toBe("iteration");
  });

  it("should parse @connect with scope suffix on both ports", () => {
    const content = `
/**
 * @flowWeaver nodeType
 * @scopes outer
 * @output start scope:outer
 * @input success scope:outer
 */
function outer(execute: boolean) {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver nodeType
 * @scopes inner
 * @output start scope:inner
 * @input success scope:inner
 */
function inner(execute: boolean) {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @node outer1 outer
 * @node inner1 inner outer1.outer
 * @connect outer1.start:outer -> inner1.start:inner
 * @connect inner1.success:inner -> outer1.success:outer
 */
export function testWorkflow(execute: boolean, params: {}) {
  throw new Error("Not implemented");
}
`;

    const parsed = parser.parseFromString(content);
    const workflow = parsed.workflows.find(w => w.name === "testWorkflow");

    expect(workflow).toBeDefined();
    expect(workflow!.connections.length).toBe(2);

    // Check first connection has scope on both ends
    const conn1 = workflow!.connections[0];
    expect(conn1.from.scope).toBe("outer");
    expect(conn1.to.scope).toBe("inner");

    // Check second connection has scope on both ends
    const conn2 = workflow!.connections[1];
    expect(conn2.from.scope).toBe("inner");
    expect(conn2.to.scope).toBe("outer");
  });

  it("should roundtrip scope suffix in generateInPlace", () => {
    // Parse workflow with scope suffix - simple linear flow to avoid cycle detection
    const content = `
/**
 * @flowWeaver nodeType
 * @input x
 * @output y scope:result
 */
function addOne(execute: boolean, x: number) {
  return { onSuccess: true, onFailure: false, y: x + 1 };
}

/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @node node1 addOne
 * @connect Start.x -> node1.x
 * @connect node1.y:result -> Exit.result
 */
export function testWorkflow(execute: boolean, params: { x: number }) {
  throw new Error("Not implemented");
}
`;

    const parsed = parser.parseFromString(content);
    const workflow = parsed.workflows.find(w => w.name === "testWorkflow");
    expect(workflow).toBeDefined();

    // Verify parsed connection has scope
    const conn2 = workflow!.connections.find(c => c.from.port === "y");
    expect(conn2?.from.scope).toBe("result");

    // Generate using generateInPlace (the actual file mutation path)
    const result = generateInPlace(content, workflow!);

    // Verify scope suffix is present in generated output
    expect(result.code).toContain("@connect node1.y:result -> Exit.result");
  });

  it("should roundtrip scope suffix in annotation generator", () => {
    // Parse workflow with scope suffix
    const content = `
/**
 * @flowWeaver nodeType
 * @scopes iteration
 * @output start scope:iteration
 * @output item scope:iteration
 * @input success scope:iteration
 */
function forEach(execute: boolean, items: any[]) {
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver nodeType
 * @input item
 * @output processed
 */
function transform(execute: boolean, item: any) {
  return { onSuccess: true, onFailure: false, processed: item };
}

/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @node forEach1 forEach
 * @node transform1 transform forEach1.iteration
 * @connect forEach1.start:iteration -> transform1.execute
 * @connect forEach1.item:iteration -> transform1.item
 * @connect transform1.onSuccess -> forEach1.success:iteration
 */
export function testWorkflow(execute: boolean, params: { items: any[] }) {
  throw new Error("Not implemented");
}
`;

    const parsed = parser.parseFromString(content);
    const workflow = parsed.workflows.find(w => w.name === "testWorkflow");
    expect(workflow).toBeDefined();

    // Generate annotations from the parsed workflow
    const generated = annotationGenerator.generate(workflow!);

    // Verify scope suffix is present in generated annotations
    expect(generated).toContain("@connect forEach1.start:iteration -> transform1.execute");
    expect(generated).toContain("@connect forEach1.item:iteration -> transform1.item");
    expect(generated).toContain("@connect transform1.onSuccess -> forEach1.success:iteration");
  });

});
