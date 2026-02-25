import { parser } from "../../src/parser";
import { TPortDefinition } from "../../src/ast/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Helper to safely get order from metadata (metadata is Record<string, unknown>)
function getOrder(port: TPortDefinition): number {
  const order = port.metadata?.order;
  return typeof order === "number" ? order : Infinity;
}

describe("Mandatory Port Ordering", () => {
  const testDir = path.join(os.tmpdir(), `flow-weaver-mandatory-port-ordering-${process.pid}`);

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up test files but keep directory
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testDir, file));
      }
    }
  });

  describe("Scoped ports without explicit order", () => {
    it("should order mandatory scoped OUTPUT ports before regular scoped OUTPUT ports", () => {
      // forEach node where mandatory ports (execute) appear AFTER regular ports (item) in JSDoc
      const testContent = `
/**
 * @flowWeaver nodeType
 * @input items
 * @output item scope:iteration - Current item
 * @output start scope:iteration - MANDATORY execute
 * @output results
 */
function forEach(execute: boolean, items: any[]) {
  return { onSuccess: true, onFailure: false, results: [] };
}

export { forEach };
      `.trim();

      const testFile = path.join(testDir, "scoped-output-order.ts");
      fs.writeFileSync(testFile, testContent);

      const result = parser.parse(testFile);
      const forEachNode = result.nodeTypes.find((nt) => nt.functionName === "forEach");

      expect(forEachNode).toBeDefined();

      // Get scoped OUTPUT ports
      const scopedOutputs = Object.entries(forEachNode!.outputs).filter(
        ([_, port]) => port.scope === "iteration"
      );

      // Extract the order metadata
      const orderedPorts = scopedOutputs
        .map(([name, port]) => ({
          name,
          order: getOrder(port),
        }))
        .sort((a, b) => a.order - b.order);

      // EXPECTED: start (mandatory) should have lower order than item (regular)
      // So start should appear first in the sorted list
      expect(orderedPorts[0].name).toBe("start");
      expect(orderedPorts[1].name).toBe("item");

      // Verify the order values: mandatory port should have order < regular port
      const startOrder = getOrder(forEachNode!.outputs.start);
      const itemOrder = getOrder(forEachNode!.outputs.item);

      expect(startOrder).not.toBe(Infinity);
      expect(itemOrder).not.toBe(Infinity);
      expect(startOrder).toBeLessThan(itemOrder);
    });

    it("should order mandatory scoped INPUT ports before regular scoped INPUT ports", () => {
      // Mandatory INPUT ports (success, failure) appear AFTER regular port (processed)
      const testContent = `
/**
 * @flowWeaver nodeType
 * @input items
 * @input processed scope:iteration - Processed value
 * @input success scope:iteration - MANDATORY success
 * @input failure scope:iteration - MANDATORY failure
 * @output start scope:iteration
 * @output item scope:iteration
 * @output results
 */
function forEach(execute: boolean, items: any[]) {
  return { onSuccess: true, onFailure: false, results: [] };
}

export { forEach };
      `.trim();

      const testFile = path.join(testDir, "scoped-input-order.ts");
      fs.writeFileSync(testFile, testContent);

      const result = parser.parse(testFile);
      const forEachNode = result.nodeTypes.find((nt) => nt.functionName === "forEach");

      expect(forEachNode).toBeDefined();

      // Get scoped INPUT ports
      const scopedInputs = Object.entries(forEachNode!.inputs).filter(
        ([name, port]) => port.scope === "iteration" && name !== "items"
      );

      // Extract and sort by order
      const orderedPorts = scopedInputs
        .map(([name, port]) => ({
          name,
          order: getOrder(port),
        }))
        .sort((a, b) => a.order - b.order);

      // EXPECTED: success and failure (mandatory) should appear before processed (regular)
      expect(orderedPorts[0].name).toBe("success");
      expect(orderedPorts[1].name).toBe("failure");
      expect(orderedPorts[2].name).toBe("processed");

      // Verify order values
      const successOrder = getOrder(forEachNode!.inputs.success);
      const failureOrder = getOrder(forEachNode!.inputs.failure);
      const processedOrder = getOrder(forEachNode!.inputs.processed);

      expect(successOrder).not.toBe(Infinity);
      expect(failureOrder).not.toBe(Infinity);
      expect(processedOrder).not.toBe(Infinity);
      expect(successOrder).toBeLessThan(processedOrder);
      expect(failureOrder).toBeLessThan(processedOrder);
    });

    it("should preserve explicit order when specified", () => {
      // Regular port has explicit order 0; mandatory ports get negative implicit orders
      const testContent = `
/**
 * @flowWeaver nodeType
 * @input items
 * @output item scope:iteration [order:0] - Regular port with explicit order 0
 * @output start scope:iteration - MANDATORY (gets negative order, sorts before item)
 * @output results
 */
function forEach(execute: boolean, items: any[]) {
  return { onSuccess: true, onFailure: false, results: [] };
}

export { forEach };
      `.trim();

      const testFile = path.join(testDir, "explicit-order.ts");
      fs.writeFileSync(testFile, testContent);

      const result = parser.parse(testFile);
      const forEachNode = result.nodeTypes.find((nt) => nt.functionName === "forEach");

      expect(forEachNode).toBeDefined();

      // item has explicit order 0
      const itemOrder = getOrder(forEachNode!.outputs.item);
      expect(itemOrder).toBe(0);

      // start (mandatory) gets a negative implicit order (sorts before item)
      const startOrder = getOrder(forEachNode!.outputs.start);
      expect(startOrder).not.toBe(Infinity);
      expect(startOrder).toBeLessThan(0);

      // Verify sorted order: mandatory first (negative), then explicit
      const scopedOutputs = Object.entries(forEachNode!.outputs)
        .filter(([_, port]) => port.scope === "iteration")
        .map(([name, port]) => ({ name, order: getOrder(port) }))
        .sort((a, b) => a.order - b.order);

      expect(scopedOutputs[0].name).toBe("start"); // mandatory, negative order
      expect(scopedOutputs[1].name).toBe("item"); // explicit order 0
    });
  });

  describe("Non-scoped ports without explicit order", () => {
    it("should order mandatory external ports before regular external ports", () => {
      const testContent = `
/**
 * @flowWeaver nodeType
 * @input value - Regular input
 * @input execute - MANDATORY execute
 * @output result - Regular output
 * @output onSuccess - MANDATORY success
 * @output onFailure - MANDATORY failure
 */
function processValue(execute: boolean, value: number) {
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

export { processValue };
      `.trim();

      const testFile = path.join(testDir, "external-port-order.ts");
      fs.writeFileSync(testFile, testContent);

      const result = parser.parse(testFile);
      const processNode = result.nodeTypes.find((nt) => nt.functionName === "processValue");

      expect(processNode).toBeDefined();

      // Check INPUT port ordering
      const inputPorts = Object.entries(processNode!.inputs)
        .map(([name, port]) => ({ name, order: getOrder(port) }))
        .sort((a, b) => a.order - b.order);

      // execute (mandatory) should appear before value (regular)
      expect(inputPorts[0].name).toBe("execute");
      expect(inputPorts[1].name).toBe("value");

      // Check OUTPUT port ordering
      const outputPorts = Object.entries(processNode!.outputs)
        .map(([name, port]) => ({ name, order: getOrder(port) }))
        .sort((a, b) => a.order - b.order);

      // onSuccess, onFailure (mandatory) should appear before result (regular)
      expect(outputPorts[0].name).toBe("onSuccess");
      expect(outputPorts[1].name).toBe("onFailure");
      expect(outputPorts[2].name).toBe("result");
    });
  });

  describe("Mixed mandatory and regular ports", () => {
    it("should handle complex forEach node with correct ordering", () => {
      // Real-world forEach example from the issue
      const testContent = `
/**
 * @flowWeaver nodeType
 * @label For Each
 * @input items - Array to iterate over
 * @input success scope:iteration - MANDATORY: Success control from scope
 * @input failure scope:iteration - MANDATORY: Failure control from scope
 * @input processed scope:iteration - Processed value returned from scope
 * @input execute - Execute
 * @output start scope:iteration - MANDATORY: Execute control for scope
 * @output item scope:iteration - Current item passed to scope
 * @output processItem scope:iteration - Scoped OUTPUT: iteration function
 * @output results - Processed results
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 */
function forEach(execute: boolean, items: any[]) {
  return { onSuccess: true, onFailure: false, results: [] };
}

export { forEach };
      `.trim();

      const testFile = path.join(testDir, "complex-forEach.ts");
      fs.writeFileSync(testFile, testContent);

      const result = parser.parse(testFile);
      const forEachNode = result.nodeTypes.find((nt) => nt.functionName === "forEach");

      expect(forEachNode).toBeDefined();

      // Scoped OUTPUT ports: execute (mandatory) should come before item, processItem (regular)
      const scopedOutputs = Object.entries(forEachNode!.outputs)
        .filter(([_, port]) => port.scope === "iteration")
        .map(([name, port]) => ({ name, order: getOrder(port) }))
        .sort((a, b) => a.order - b.order);

      expect(scopedOutputs[0].name).toBe("start"); // mandatory first
      // item and processItem follow (order doesn't matter between them)

      // Scoped INPUT ports: success, failure (mandatory) should come before processed (regular)
      const scopedInputs = Object.entries(forEachNode!.inputs)
        .filter(([_, port]) => port.scope === "iteration")
        .map(([name, port]) => ({ name, order: getOrder(port) }))
        .sort((a, b) => a.order - b.order);

      expect(scopedInputs[0].name).toBe("success"); // mandatory first
      expect(scopedInputs[1].name).toBe("failure"); // mandatory second
      expect(scopedInputs[2].name).toBe("processed"); // regular last

      // External OUTPUT ports: onSuccess, onFailure (mandatory) should come before results (regular)
      const externalOutputs = Object.entries(forEachNode!.outputs)
        .filter(([_, port]) => !port.scope)
        .map(([name, port]) => ({ name, order: getOrder(port) }))
        .sort((a, b) => a.order - b.order);

      expect(externalOutputs[0].name).toBe("onSuccess"); // mandatory first
      expect(externalOutputs[1].name).toBe("onFailure"); // mandatory second
      expect(externalOutputs[2].name).toBe("results"); // regular last
    });
  });
});
