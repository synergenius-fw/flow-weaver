/**
 * Tests for recursive workflow invocation
 * A workflow should be able to reference itself as a node type (recursion)
 */

import { AnnotationParser } from "../../src/parser";

describe("Recursive Workflow Invocation", () => {
  let parser: AnnotationParser;

  beforeEach(() => {
    parser = new AnnotationParser();
    parser.clearCache();
  });

  describe("Self-referencing workflow parsing", () => {
    it("should parse a workflow that references itself as a node", () => {
      const code = `
/**
 * @flowWeaver workflow
 * @node self factorial
 * @connect Start.n -> self.n
 * @connect self.result -> Exit.result
 * @connect self.onSuccess -> Exit.onSuccess
 * @connect self.onFailure -> Exit.onFailure
 * @param n - Input number
 * @returns result - Factorial result
 */
export function factorial(
  execute: boolean,
  params: { n: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 1 };
}
`;
      const result = parser.parseFromString(code);

      expect(result.errors).toHaveLength(0);
      expect(result.workflows.length).toBe(1);

      const workflow = result.workflows[0];
      expect(workflow.name).toBe("factorial");
      expect(workflow.instances.length).toBe(1);
      expect(workflow.instances[0].nodeType).toBe("factorial");
    });

    it("should have correct ports on self-referencing nodeType", () => {
      const code = `
/**
 * @flowWeaver workflow
 * @node self countdown
 * @connect Start.count -> self.count
 * @connect self.remaining -> Exit.remaining
 * @connect self.onSuccess -> Exit.onSuccess
 * @connect self.onFailure -> Exit.onFailure
 * @param count - Current count
 * @returns remaining - Remaining count
 */
export function countdown(
  execute: boolean,
  params: { count: number }
): { onSuccess: boolean; onFailure: boolean; remaining: number } {
  return { onSuccess: true, onFailure: false, remaining: 0 };
}
`;
      const result = parser.parseFromString(code);

      expect(result.errors).toHaveLength(0);

      const workflow = result.workflows[0];
      const selfNodeType = workflow.nodeTypes.find(nt => nt.name === "countdown");

      expect(selfNodeType).toBeDefined();
      expect(selfNodeType?.inputs.execute).toBeDefined();
      expect(selfNodeType?.inputs.count).toBeDefined();
      expect(selfNodeType?.outputs.remaining).toBeDefined();
      expect(selfNodeType?.outputs.onSuccess).toBeDefined();
      expect(selfNodeType?.outputs.onFailure).toBeDefined();
      expect(selfNodeType?.variant).toBe("IMPORTED_WORKFLOW");
    });
  });

  describe("Mutual recursion", () => {
    it("should support workflows that call each other (mutual recursion)", () => {
      const code = `
/**
 * @flowWeaver workflow
 * @node b isOdd
 * @connect Start.n -> b.n
 * @connect b.result -> Exit.result
 * @connect b.onSuccess -> Exit.onSuccess
 * @connect b.onFailure -> Exit.onFailure
 * @param n - Number to check
 * @returns result - Boolean result
 */
export function isEven(
  execute: boolean,
  params: { n: number }
): { onSuccess: boolean; onFailure: boolean; result: boolean } {
  return { onSuccess: true, onFailure: false, result: true };
}

/**
 * @flowWeaver workflow
 * @node a isEven
 * @connect Start.n -> a.n
 * @connect a.result -> Exit.result
 * @connect a.onSuccess -> Exit.onSuccess
 * @connect a.onFailure -> Exit.onFailure
 * @param n - Number to check
 * @returns result - Boolean result
 */
export function isOdd(
  execute: boolean,
  params: { n: number }
): { onSuccess: boolean; onFailure: boolean; result: boolean } {
  return { onSuccess: true, onFailure: false, result: false };
}
`;
      const result = parser.parseFromString(code);

      expect(result.errors).toHaveLength(0);
      expect(result.workflows.length).toBe(2);

      const isEven = result.workflows.find(w => w.name === "isEven");
      const isOdd = result.workflows.find(w => w.name === "isOdd");

      // isEven uses isOdd
      expect(isEven?.instances[0].nodeType).toBe("isOdd");
      // isOdd uses isEven
      expect(isOdd?.instances[0].nodeType).toBe("isEven");

      // Both should be available as nodeTypes in each workflow
      expect(isEven?.nodeTypes.find(nt => nt.name === "isOdd")).toBeDefined();
      expect(isOdd?.nodeTypes.find(nt => nt.name === "isEven")).toBeDefined();
    });
  });

  describe("Combined same-file and recursive", () => {
    it("should support a workflow using both other workflows and itself", () => {
      const code = `
/**
 * @flowWeaver workflow
 * @connect Start.x -> Exit.y
 * @connect Start.execute -> Exit.onSuccess
 * @param x - Input
 * @returns y - Output
 */
export function helper(
  execute: boolean,
  params: { x: number }
): { onSuccess: boolean; onFailure: boolean; y: number } {
  return { onSuccess: true, onFailure: false, y: 0 };
}

/**
 * @flowWeaver workflow
 * @node h helper
 * @node self complex
 * @connect Start.value -> h.x
 * @connect h.y -> self.value
 * @connect self.result -> Exit.result
 * @connect self.onSuccess -> Exit.onSuccess
 * @connect self.onFailure -> Exit.onFailure
 * @param value - Input value
 * @returns result - Result
 */
export function complex(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 0 };
}
`;
      const result = parser.parseFromString(code);

      expect(result.errors).toHaveLength(0);
      expect(result.workflows.length).toBe(2);

      const complex = result.workflows.find(w => w.name === "complex");
      expect(complex?.instances.length).toBe(2);
      expect(complex?.instances.find(i => i.nodeType === "helper")).toBeDefined();
      expect(complex?.instances.find(i => i.nodeType === "complex")).toBeDefined();

      // Both helper and complex should be in nodeTypes
      expect(complex?.nodeTypes.find(nt => nt.name === "helper")).toBeDefined();
      expect(complex?.nodeTypes.find(nt => nt.name === "complex")).toBeDefined();
    });
  });
});
