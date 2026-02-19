/**
 * Tests for parser source location tracking
 *
 * Validates that the parser captures line numbers for workflow elements
 * (node instances, connections) so diagnostics can point to exact source locations.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parser } from "../../src/parser";

describe("Parser Source Location Tracking", () => {
  const uniqueId = `parser-source-location-${process.pid}-${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), `flow-weaver-${uniqueId}`);

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("Node Instance Source Location", () => {
    it("should include sourceLocation for node instances", () => {
      const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node myNode double
 * @position myNode 100 100
 */
export function myWorkflow(execute: boolean) {
  return { onSuccess: true };
}
`;

      const testFile = path.join(tempDir, "test-node-source-location.ts");
      fs.writeFileSync(testFile, sourceCode, "utf-8");

      try {
        const result = parser.parse(testFile);
        const workflow = result.workflows[0];

        expect(workflow).toBeDefined();
        expect(workflow.instances).toHaveLength(1);

        const instance = workflow.instances[0];
        expect(instance.sourceLocation).toBeDefined();
        expect(instance.sourceLocation!.line).toBe(13); // @node is on line 13
      } finally {
        if (fs.existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
      }
    });

    it("should track correct line for multiple node instances", () => {
      const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node node1 double
 * @node node2 double
 * @node node3 double
 * @position node1 100 100
 * @position node2 200 100
 * @position node3 300 100
 */
export function myWorkflow(execute: boolean) {
  return { onSuccess: true };
}
`;

      const testFile = path.join(tempDir, "test-multiple-nodes-location.ts");
      fs.writeFileSync(testFile, sourceCode, "utf-8");

      try {
        const result = parser.parse(testFile);
        const workflow = result.workflows[0];

        expect(workflow.instances).toHaveLength(3);

        // Each node should have its correct line number
        const node1 = workflow.instances.find(i => i.id === "node1");
        const node2 = workflow.instances.find(i => i.id === "node2");
        const node3 = workflow.instances.find(i => i.id === "node3");

        expect(node1?.sourceLocation?.line).toBe(13);
        expect(node2?.sourceLocation?.line).toBe(14);
        expect(node3?.sourceLocation?.line).toBe(15);
      } finally {
        if (fs.existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
      }
    });
  });

  describe("Connection Source Location", () => {
    it("should include sourceLocation for connections", () => {
      const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node node1 double
 * @node node2 double
 * @connect node1.onSuccess -> node2.execute
 * @position node1 100 100
 * @position node2 200 100
 */
export function myWorkflow(execute: boolean) {
  return { onSuccess: true };
}
`;

      const testFile = path.join(tempDir, "test-connection-source-location.ts");
      fs.writeFileSync(testFile, sourceCode, "utf-8");

      try {
        const result = parser.parse(testFile);
        const workflow = result.workflows[0];

        expect(workflow.connections).toHaveLength(1);

        const connection = workflow.connections[0];
        expect(connection.sourceLocation).toBeDefined();
        expect(connection.sourceLocation!.line).toBe(15); // @connect is on line 15
      } finally {
        if (fs.existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
      }
    });

    it("should track correct line for multiple connections", () => {
      const sourceCode = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node node1 double
 * @node node2 double
 * @node node3 double
 * @connect node1.onSuccess -> node2.execute
 * @connect node2.onSuccess -> node3.execute
 * @connect node1.result -> node2.value
 * @position node1 100 100
 * @position node2 200 100
 * @position node3 300 100
 */
export function myWorkflow(execute: boolean) {
  return { onSuccess: true };
}
`;

      const testFile = path.join(tempDir, "test-multiple-connections-location.ts");
      fs.writeFileSync(testFile, sourceCode, "utf-8");

      try {
        const result = parser.parse(testFile);
        const workflow = result.workflows[0];

        expect(workflow.connections).toHaveLength(3);

        // Connections should have their correct line numbers
        // Note: order may vary, so we check by from/to
        const conn1 = workflow.connections.find(
          c => c.from.node === "node1" && c.to.node === "node2" && c.from.port === "onSuccess"
        );
        const conn2 = workflow.connections.find(
          c => c.from.node === "node2" && c.to.node === "node3"
        );
        const conn3 = workflow.connections.find(
          c => c.from.node === "node1" && c.to.node === "node2" && c.from.port === "result"
        );

        expect(conn1?.sourceLocation?.line).toBe(16);
        expect(conn2?.sourceLocation?.line).toBe(17);
        expect(conn3?.sourceLocation?.line).toBe(18);
      } finally {
        if (fs.existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
      }
    });
  });

  describe("parseFromString Source Location", () => {
    it("should include sourceLocation when parsing from string", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function double(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

/**
 * @flowWeaver workflow
 * @node myNode double
 * @connect Start.execute -> myNode.execute
 * @position myNode 100 100
 */
export function myWorkflow(execute: boolean) {
  return { onSuccess: true };
}
`;

      const result = parser.parseFromString(code);
      const workflow = result.workflows[0];

      expect(workflow.instances[0].sourceLocation).toBeDefined();
      expect(workflow.instances[0].sourceLocation!.line).toBe(13);

      expect(workflow.connections[0].sourceLocation).toBeDefined();
      expect(workflow.connections[0].sourceLocation!.line).toBe(14);
    });
  });
});
