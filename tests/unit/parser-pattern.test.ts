/**
 * Tests for @flowWeaver pattern parsing
 * TDD: These tests should FAIL until we implement pattern parsing
 */

import { AnnotationParser } from "../../src/parser";

describe("Pattern Parser", () => {
  let parser: AnnotationParser;

  beforeEach(() => {
    parser = new AnnotationParser();
  });

  describe("pattern recognition", () => {
    it("should recognize @flowWeaver pattern annotation", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name validateTransform
 */
function placeholder() {}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.patterns).toBeDefined();
      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].name).toBe("validateTransform");
    });

    it("should parse @name and @description tags", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name myPattern
 * @description A reusable validation and transformation pattern
 */
function placeholder() {}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.patterns[0].name).toBe("myPattern");
      expect(result.patterns[0].description).toBe("A reusable validation and transformation pattern");
    });

    it("should require @name tag", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @description Missing name
 */
function placeholder() {}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.errors.some(e => e.includes("@name"))).toBe(true);
    });
  });

  describe("pattern nodes", () => {
    it("should parse @node declarations", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name testPattern
 * @node v validateInput
 * @node t transformData
 */
function placeholder() {}

function validateInput(execute: boolean, data: any) {
  return { onSuccess: true, onFailure: false, result: data };
}

function transformData(execute: boolean, input: any) {
  return { onSuccess: true, onFailure: false, output: input };
}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.patterns[0].instances).toHaveLength(2);
      expect(result.patterns[0].instances[0].id).toBe("v");
      expect(result.patterns[0].instances[0].nodeType).toBe("validateInput");
      expect(result.patterns[0].instances[1].id).toBe("t");
      expect(result.patterns[0].instances[1].nodeType).toBe("transformData");
    });
  });

  describe("pattern connections with IN/OUT", () => {
    it("should parse connections using IN pseudo-node", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name testPattern
 * @node v validateInput
 * @connect IN.data -> v.input
 */
function placeholder() {}

function validateInput(execute: boolean, input: any) {
  return { onSuccess: true, onFailure: false };
}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.patterns[0].connections).toHaveLength(1);
      expect(result.patterns[0].connections[0].from.node).toBe("IN");
      expect(result.patterns[0].connections[0].from.port).toBe("data");
      expect(result.patterns[0].connections[0].to.node).toBe("v");
      expect(result.patterns[0].connections[0].to.port).toBe("input");
    });

    it("should parse connections using OUT pseudo-node", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name testPattern
 * @node v validateInput
 * @connect v.result -> OUT.output
 */
function placeholder() {}

function validateInput(execute: boolean, input: any) {
  return { onSuccess: true, onFailure: false, result: null };
}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.patterns[0].connections).toHaveLength(1);
      expect(result.patterns[0].connections[0].from.node).toBe("v");
      expect(result.patterns[0].connections[0].to.node).toBe("OUT");
      expect(result.patterns[0].connections[0].to.port).toBe("output");
    });

    it("should parse internal connections between pattern nodes", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name testPattern
 * @node v validateInput
 * @node t transformData
 * @connect v.result -> t.input
 */
function placeholder() {}

function validateInput(execute: boolean, data: any) {
  return { onSuccess: true, onFailure: false, result: data };
}

function transformData(execute: boolean, input: any) {
  return { onSuccess: true, onFailure: false, output: input };
}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.patterns[0].connections).toHaveLength(1);
      expect(result.patterns[0].connections[0].from.node).toBe("v");
      expect(result.patterns[0].connections[0].to.node).toBe("t");
    });
  });

  describe("pattern port declarations", () => {
    it("should parse @port IN declarations", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name testPattern
 * @port IN.data - Input data to process
 * @port IN.config - Configuration options
 */
function placeholder() {}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.patterns[0].inputPorts).toBeDefined();
      expect(result.patterns[0].inputPorts.data).toBeDefined();
      expect(result.patterns[0].inputPorts.data.description).toBe("Input data to process");
      expect(result.patterns[0].inputPorts.config).toBeDefined();
    });

    it("should parse @port OUT declarations", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name testPattern
 * @port OUT.result - Processed result
 * @port OUT.error - Error information
 */
function placeholder() {}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.patterns[0].outputPorts).toBeDefined();
      expect(result.patterns[0].outputPorts.result).toBeDefined();
      expect(result.patterns[0].outputPorts.result.description).toBe("Processed result");
      expect(result.patterns[0].outputPorts.error).toBeDefined();
    });
  });

  describe("pattern positions", () => {
    it("should parse @position for pattern nodes", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name testPattern
 * @node v validateInput
 * @position v 0 0
 */
function placeholder() {}

function validateInput(execute: boolean, data: any) {
  return { onSuccess: true, onFailure: false };
}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.patterns[0].instances[0].config).toEqual({ x: 0, y: 0 });
    });
  });

  describe("pattern node types", () => {
    it("should collect inline node types used by pattern", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name testPattern
 * @node v validateInput
 */
function placeholder() {}

/**
 * @flowWeaver nodeType
 * @input data - Data to validate
 * @output result - Validated data
 */
function validateInput(execute: boolean, data: any) {
  return { onSuccess: true, onFailure: false, result: data };
}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.patterns[0].nodeTypes).toBeDefined();
      expect(result.patterns[0].nodeTypes).toHaveLength(1);
      expect(result.patterns[0].nodeTypes[0].name).toBe("validateInput");
    });
  });

  describe("complete pattern example", () => {
    it("should parse a complete pattern with all elements", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name validateTransform
 * @description Validates input then transforms it
 * @node v inputValidator
 * @node t dataTransformer
 * @connect IN.data -> v.input
 * @connect v.valid -> t.input
 * @connect t.output -> OUT.result
 * @connect v.invalid -> OUT.error
 * @port IN.data - Raw input data
 * @port OUT.result - Transformed data
 * @port OUT.error - Validation errors
 * @position v -90 0
 * @position t 90 0
 */
function patternPlaceholder() {}

/**
 * @flowWeaver nodeType
 * @input input - Data to validate
 * @output valid - Valid data
 * @output invalid - Invalid data with errors
 */
function inputValidator(execute: boolean, input: any) {
  if (!execute) return { onSuccess: false, onFailure: false, valid: null, invalid: null };
  if (input) {
    return { onSuccess: true, onFailure: false, valid: input, invalid: null };
  }
  return { onSuccess: false, onFailure: true, valid: null, invalid: { error: "Invalid input" } };
}

/**
 * @flowWeaver nodeType
 * @input input - Data to transform
 * @output output - Transformed data
 */
function dataTransformer(execute: boolean, input: any) {
  if (!execute) return { onSuccess: false, onFailure: false, output: null };
  return { onSuccess: true, onFailure: false, output: { transformed: input } };
}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.patterns).toHaveLength(1);

      const pattern = result.patterns[0];
      expect(pattern.name).toBe("validateTransform");
      expect(pattern.description).toBe("Validates input then transforms it");

      // Nodes
      expect(pattern.instances).toHaveLength(2);

      // Connections
      expect(pattern.connections).toHaveLength(4);

      // Ports
      expect(Object.keys(pattern.inputPorts)).toEqual(["data"]);
      expect(Object.keys(pattern.outputPorts)).toEqual(["result", "error"]);

      // Node types
      expect(pattern.nodeTypes).toHaveLength(2);
    });
  });

  describe("multiple patterns in one file", () => {
    it("should parse multiple patterns from same file", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name patternA
 */
function placeholderA() {}

/**
 * @flowWeaver pattern
 * @name patternB
 */
function placeholderB() {}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.patterns).toHaveLength(2);
      expect(result.patterns[0].name).toBe("patternA");
      expect(result.patterns[1].name).toBe("patternB");
    });
  });

  describe("error handling", () => {
    it("should error if IN/OUT used in workflow instead of pattern", () => {
      const code = `
/**
 * @flowWeaver workflow
 * @connect IN.data -> processor.input
 */
export function badWorkflow() {}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("IN");
    });

    it("should error on duplicate pattern names in same file", () => {
      const code = `
/**
 * @flowWeaver pattern
 * @name duplicate
 */
function a() {}

/**
 * @flowWeaver pattern
 * @name duplicate
 */
function b() {}
`;
      const result = parser.parseFromString(code, "test.ts");

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("duplicate");
    });
  });
});
