/**
 * Tests for same-file workflow invocation
 * Workflows defined in the same file should be usable as nodes in other workflows
 */

import * as path from "path";
import * as fs from "fs";
import { AnnotationParser } from "../../src/parser";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures/same-file");

describe("Same-file Workflow Invocation", () => {
  let parser: AnnotationParser;

  beforeAll(() => {
    // Ensure fixtures directory exists
    if (!fs.existsSync(FIXTURES_DIR)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }
  });

  beforeEach(() => {
    parser = new AnnotationParser();
    parser.clearCache();
  });

  describe("Workflow B uses Workflow A (A defined first)", () => {
    it("should parse workflow B that uses workflow A from same file", () => {
      const code = `
/**
 * @flowWeaver workflow
 * @connect Start.input -> Exit.output
 * @connect Start.execute -> Exit.onSuccess
 * @param input - Input value
 * @returns output - Output value
 */
export function workflowA(
  execute: boolean,
  params: { input: number }
): { onSuccess: boolean; onFailure: boolean; output: number } {
  return { onSuccess: true, onFailure: false, output: 0 };
}

/**
 * @flowWeaver workflow
 * @node a workflowA
 * @connect Start.data -> a.input
 * @connect a.output -> Exit.result
 * @connect a.onSuccess -> Exit.onSuccess
 * @connect a.onFailure -> Exit.onFailure
 * @param data - Input data
 * @returns result - Processed result
 */
export function workflowB(
  execute: boolean,
  params: { data: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 0 };
}
`;
      const result = parser.parseFromString(code);

      // Should have both workflows
      expect(result.workflows.length).toBe(2);
      expect(result.errors).toHaveLength(0);

      // workflowB should have workflowA as a node type
      const workflowB = result.workflows.find(w => w.name === "workflowB");
      expect(workflowB).toBeDefined();
      expect(workflowB?.instances.length).toBe(1);
      expect(workflowB?.instances[0].nodeType).toBe("workflowA");

      // workflowA should be available as a nodeType in workflowB's nodeTypes
      const workflowANodeType = workflowB?.nodeTypes.find(nt => nt.name === "workflowA");
      expect(workflowANodeType).toBeDefined();
      expect(workflowANodeType?.variant).toBe("IMPORTED_WORKFLOW");
    });

    it("should have correct ports on same-file workflow nodeType", () => {
      const code = `
/**
 * @flowWeaver workflow
 * @connect Start.name -> Exit.greeting
 * @connect Start.execute -> Exit.onSuccess
 * @param name - Person name
 * @returns greeting - Greeting message
 */
export function greeter(
  execute: boolean,
  params: { name: string }
): { onSuccess: boolean; onFailure: boolean; greeting: string } {
  return { onSuccess: true, onFailure: false, greeting: "" };
}

/**
 * @flowWeaver workflow
 * @node g greeter
 * @connect Start.person -> g.name
 * @connect g.greeting -> Exit.message
 * @connect g.onSuccess -> Exit.onSuccess
 * @connect g.onFailure -> Exit.onFailure
 * @param person - Person to greet
 * @returns message - Greeting
 */
export function mainWorkflow(
  execute: boolean,
  params: { person: string }
): { onSuccess: boolean; onFailure: boolean; message: string } {
  return { onSuccess: true, onFailure: false, message: "" };
}
`;
      const result = parser.parseFromString(code);

      expect(result.errors).toHaveLength(0);

      const mainWorkflow = result.workflows.find(w => w.name === "mainWorkflow");
      const greeterNodeType = mainWorkflow?.nodeTypes.find(nt => nt.name === "greeter");

      expect(greeterNodeType).toBeDefined();
      expect(greeterNodeType?.inputs.execute).toBeDefined();
      expect(greeterNodeType?.inputs.name).toBeDefined();
      expect(greeterNodeType?.outputs.greeting).toBeDefined();
      expect(greeterNodeType?.outputs.onSuccess).toBeDefined();
      expect(greeterNodeType?.outputs.onFailure).toBeDefined();
    });
  });

  describe("Workflow A uses Workflow B (B defined after A)", () => {
    it("should work regardless of definition order", () => {
      const code = `
/**
 * @flowWeaver workflow
 * @node h helper
 * @connect Start.value -> h.x
 * @connect h.y -> Exit.result
 * @connect h.onSuccess -> Exit.onSuccess
 * @connect h.onFailure -> Exit.onFailure
 * @param value - Input
 * @returns result - Output
 */
export function consumer(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 0 };
}

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
`;
      const result = parser.parseFromString(code);

      // Should parse without errors even though consumer is defined before helper
      expect(result.errors).toHaveLength(0);
      expect(result.workflows.length).toBe(2);

      const consumer = result.workflows.find(w => w.name === "consumer");
      expect(consumer?.instances.length).toBe(1);
      expect(consumer?.instances[0].nodeType).toBe("helper");

      // helper should be in consumer's nodeTypes
      const helperNodeType = consumer?.nodeTypes.find(nt => nt.name === "helper");
      expect(helperNodeType).toBeDefined();
    });
  });

  describe("File-based parsing with parse()", () => {
    const tempFile = path.join(FIXTURES_DIR, "same-file-workflows.ts");

    afterAll(() => {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });

    it("should work with file-based parse() method", () => {
      const code = `
/**
 * @flowWeaver workflow
 * @connect Start.a -> Exit.b
 * @connect Start.execute -> Exit.onSuccess
 * @param a - Input
 * @returns b - Output
 */
export function innerWorkflow(
  execute: boolean,
  params: { a: number }
): { onSuccess: boolean; onFailure: boolean; b: number } {
  return { onSuccess: true, onFailure: false, b: 0 };
}

/**
 * @flowWeaver workflow
 * @node inner innerWorkflow
 * @connect Start.x -> inner.a
 * @connect inner.b -> Exit.y
 * @connect inner.onSuccess -> Exit.onSuccess
 * @connect inner.onFailure -> Exit.onFailure
 * @param x - Input
 * @returns y - Output
 */
export function outerWorkflow(
  execute: boolean,
  params: { x: number }
): { onSuccess: boolean; onFailure: boolean; y: number } {
  return { onSuccess: true, onFailure: false, y: 0 };
}
`;
      fs.writeFileSync(tempFile, code);

      const result = parser.parse(tempFile);

      expect(result.errors).toHaveLength(0);
      expect(result.workflows.length).toBe(2);

      const outer = result.workflows.find(w => w.name === "outerWorkflow");
      expect(outer?.instances[0].nodeType).toBe("innerWorkflow");

      const innerNodeType = outer?.nodeTypes.find(nt => nt.name === "innerWorkflow");
      expect(innerNodeType).toBeDefined();
      expect(innerNodeType?.variant).toBe("IMPORTED_WORKFLOW");
    });
  });

  describe("Path field on workflow nodeTypes", () => {
    it("should set path field on same-file workflow nodeTypes", () => {
      const code = `
/**
 * @flowWeaver workflow
 * @connect Start.x -> Exit.y
 * @connect Start.execute -> Exit.onSuccess
 * @param x - Input
 * @returns y - Output
 */
export function innerWorkflow(
  execute: boolean,
  params: { x: number }
): { onSuccess: boolean; onFailure: boolean; y: number } {
  return { onSuccess: true, onFailure: false, y: 0 };
}

/**
 * @flowWeaver workflow
 * @node inner innerWorkflow
 * @connect Start.a -> inner.x
 * @connect inner.y -> Exit.b
 * @connect inner.onSuccess -> Exit.onSuccess
 * @connect inner.onFailure -> Exit.onFailure
 * @param a - Input
 * @returns b - Output
 */
export function outerWorkflow(
  execute: boolean,
  params: { a: number }
): { onSuccess: boolean; onFailure: boolean; b: number } {
  return { onSuccess: true, onFailure: false, b: 0 };
}
`;
      const result = parser.parseFromString(code, "test/my-file.ts");

      expect(result.errors).toHaveLength(0);

      // Check the outer workflow's nodeTypes include inner with path field
      const outer = result.workflows.find(w => w.name === "outerWorkflow");
      const innerNodeType = outer?.nodeTypes.find(nt => nt.name === "innerWorkflow");

      expect(innerNodeType).toBeDefined();
      expect(innerNodeType?.path).toBe("test/my-file.ts");
      expect(innerNodeType?.variant).toBe("IMPORTED_WORKFLOW");
    });
  });

  describe("Multiple same-file workflow references", () => {
    it("should support multiple workflows referencing each other", () => {
      const code = `
/**
 * @flowWeaver workflow
 * @connect Start.x -> Exit.y
 * @connect Start.execute -> Exit.onSuccess
 * @param x - Input
 * @returns y - Output
 */
export function double(
  execute: boolean,
  params: { x: number }
): { onSuccess: boolean; onFailure: boolean; y: number } {
  return { onSuccess: true, onFailure: false, y: 0 };
}

/**
 * @flowWeaver workflow
 * @connect Start.x -> Exit.y
 * @connect Start.execute -> Exit.onSuccess
 * @param x - Input
 * @returns y - Output
 */
export function triple(
  execute: boolean,
  params: { x: number }
): { onSuccess: boolean; onFailure: boolean; y: number } {
  return { onSuccess: true, onFailure: false, y: 0 };
}

/**
 * @flowWeaver workflow
 * @node d double
 * @node t triple
 * @connect Start.value -> d.x
 * @connect d.y -> t.x
 * @connect t.y -> Exit.result
 * @connect t.onSuccess -> Exit.onSuccess
 * @connect t.onFailure -> Exit.onFailure
 * @param value - Input
 * @returns result - Output
 */
export function combined(
  execute: boolean,
  params: { value: number }
): { onSuccess: boolean; onFailure: boolean; result: number } {
  return { onSuccess: true, onFailure: false, result: 0 };
}
`;
      const result = parser.parseFromString(code);

      expect(result.errors).toHaveLength(0);
      expect(result.workflows.length).toBe(3);

      const combined = result.workflows.find(w => w.name === "combined");
      expect(combined?.instances.length).toBe(2);

      const doubleNodeType = combined?.nodeTypes.find(nt => nt.name === "double");
      const tripleNodeType = combined?.nodeTypes.find(nt => nt.name === "triple");

      expect(doubleNodeType).toBeDefined();
      expect(tripleNodeType).toBeDefined();
    });
  });
});
