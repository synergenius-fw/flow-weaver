/**
 * Test JSDoc Port Sync utilities
 * These functions parse and update @input/@output annotations in function text
 */

import {
  parsePortsFromFunctionText,
  updatePortsInFunctionText,
  formatPortsInFunctionText,
  parseFunctionSignature,
  parseReturnFields,
  tsTypeToPortType,
  syncSignatureToJSDoc,
  syncJSDocToSignature,
  renamePortInCode,
  syncCodeRenames,
  computePortsDiff,
  applyPortsDiffToCode,
  hasOrphanPortLines,
} from "../../src/jsdoc-port-sync";

describe("JSDoc Port Sync", () => {
  describe("parsePortsFromFunctionText", () => {
    it("parses @input tags", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input x
 * @input name
 */
function Add(execute: boolean, x: number, name: string): { onSuccess: boolean; onFailure: boolean } { return { onSuccess: true, onFailure: false }; }
`;
      const result = parsePortsFromFunctionText(code);
      expect(result.inputs).toHaveProperty("x");
      expect(result.inputs.x.dataType).toBe("NUMBER");
      expect(result.inputs).toHaveProperty("name");
      expect(result.inputs.name.dataType).toBe("STRING");
    });

    it("parses @output tags", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @output result
 * @output success
 */
function Add(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: number; success: boolean } { return { onSuccess: true, onFailure: false, result: 1, success: true }; }
`;
      const result = parsePortsFromFunctionText(code);
      expect(result.outputs).toHaveProperty("result");
      expect(result.outputs.result.dataType).toBe("NUMBER");
      expect(result.outputs).toHaveProperty("success");
      expect(result.outputs.success.dataType).toBe("BOOLEAN");
    });

    it("handles optional ports [name]", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input [optional]
 */
function Add() {}
`;
      const result = parsePortsFromFunctionText(code);
      expect(result.inputs.optional.optional).toBe(true);
    });

    it("handles default values [name=value]", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input [count=10]
 */
function Add() {}
`;
      const result = parsePortsFromFunctionText(code);
      expect(result.inputs.count.optional).toBe(true);
      expect(result.inputs.count.default).toBe(10);
    });

    it("handles scope attribute matching callback param name", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input success scope:inner
 * @output result scope:inner
 */
function Scoped(execute: boolean, inner: (x: boolean) => { success: boolean }) {}
`;
      const result = parsePortsFromFunctionText(code);
      expect(result.inputs.success.scope).toBe("inner");
      expect(result.outputs.result.scope).toBe("inner");
    });

    it("preserves scope when @scope tag name differs from port scope:XXX attribute", () => {
      // User has @scope processItem but ports use scope:iteration
      // Both should be valid - we shouldn't drop the scope attribute just because names differ
      const code = `
/**
 * @flowWeaver nodeType
 * @scope processItem
 * @output start scope:iteration [order:0]
 * @input success scope:iteration [order:2]
 * @input failure scope:iteration [order:3]
 */
function forEach(execute: boolean, processItem: (start: boolean) => { success: boolean; failure: boolean }): { onSuccess: boolean; onFailure: boolean } { return { onSuccess: true, onFailure: false }; }
`;
      const result = parsePortsFromFunctionText(code);
      // Ports should preserve their scope attribute
      expect(result.outputs.start.scope).toBe("iteration");
      expect(result.inputs.success.scope).toBe("iteration");
      expect(result.inputs.failure.scope).toBe("iteration");
    });

    it("parses placement metadata from @input", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input success scope:inner [placement:TOP]
 */
function Scoped(execute: boolean, inner: (x: boolean) => { success: boolean }) {}
`;
      const result = parsePortsFromFunctionText(code);
      expect(result.inputs.success.metadata?.placement).toBe("TOP");
    });

    it("parses placement metadata from @output", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @output start scope:inner [placement:BOTTOM]
 */
function Scoped(execute: boolean, inner: (start: boolean) => { }) {}
`;
      const result = parsePortsFromFunctionText(code);
      expect(result.outputs.start.metadata?.placement).toBe("BOTTOM");
    });

    it("parses both order and placement metadata", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input x [order:2] [placement:BOTTOM]
 */
function Test(x: number) {}
`;
      const result = parsePortsFromFunctionText(code);
      expect(result.inputs.x.metadata?.order).toBe(2);
      expect(result.inputs.x.metadata?.placement).toBe("BOTTOM");
    });

    it("handles labels after dash", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input x - The X coordinate
 * @output result - Calculated result
 */
function Add() {}
`;
      const result = parsePortsFromFunctionText(code);
      expect(result.inputs.x.label).toBe("The X coordinate");
      expect(result.outputs.result.label).toBe("Calculated result");
    });

    it("returns empty for code without JSDoc", () => {
      const code = `function Add() {}`;
      const result = parsePortsFromFunctionText(code);
      expect(Object.keys(result.inputs)).toHaveLength(0);
      expect(Object.keys(result.outputs)).toHaveLength(0);
    });

    it("returns empty for JSDoc without port annotations", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @description A simple function
 */
function Add() {}
`;
      const result = parsePortsFromFunctionText(code);
      expect(Object.keys(result.inputs)).toHaveLength(0);
      expect(Object.keys(result.outputs)).toHaveLength(0);
    });
  });

  describe("updatePortsInFunctionText", () => {
    it("adds JSDoc to code without it", () => {
      const code = `function Add(x, y) { return x + y; }`;
      const result = updatePortsInFunctionText(code, {
        x: { dataType: "NUMBER" },
        y: { dataType: "NUMBER" },
      }, {
        result: { dataType: "NUMBER" },
      });
      expect(result).toContain("@flowWeaver nodeType");
      expect(result).toContain("@input x");
      expect(result).toContain("@input y");
      expect(result).toContain("@output result");
      expect(result).toContain("function Add");
    });

    it("updates ports preserving description", () => {
      const code = `
/**
 * This is the description of the node.
 * It spans multiple lines.
 * @flowWeaver nodeType
 * @input x
 */
function Add() {}
`;
      const result = updatePortsInFunctionText(code, {
        y: { dataType: "STRING" },
      }, {});
      expect(result).toContain("This is the description of the node.");
      expect(result).toContain("It spans multiple lines.");
      expect(result).toContain("@input y");
      expect(result).not.toContain("@input x");
    });

    it("updates ports preserving @label tag", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @label My Custom Node
 * @input x
 */
function Add() {}
`;
      const result = updatePortsInFunctionText(code, {
        y: { dataType: "STRING" },
      }, {});
      expect(result).toContain("@label My Custom Node");
      expect(result).toContain("@input y");
    });

    it("updates ports preserving other JSDoc tags", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @scope inner
 * @executeWhen onSuccess
 * @input x
 */
function Add() {}
`;
      const result = updatePortsInFunctionText(code, {
        y: { dataType: "STRING" },
      }, {});
      expect(result).toContain("@scope inner");
      expect(result).toContain("@executeWhen onSuccess");
      expect(result).toContain("@input y");
    });

    it("handles adding new ports", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input x
 */
function Add() {}
`;
      const result = updatePortsInFunctionText(code, {
        x: { dataType: "NUMBER" },
        y: { dataType: "NUMBER" },
      }, {
        result: { dataType: "NUMBER" },
      });
      expect(result).toContain("@input x");
      expect(result).toContain("@input y");
      expect(result).toContain("@output result");
    });

    it("handles removing ports", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 * @output result
 */
function Add() {}
`;
      const result = updatePortsInFunctionText(code, {
        x: { dataType: "NUMBER" },
      }, {});
      expect(result).toContain("@input x");
      expect(result).not.toContain("@input y");
      expect(result).not.toContain("@output result");
    });

    it("generates port with label", () => {
      const code = `function Add() {}`;
      const result = updatePortsInFunctionText(code, {
        x: { dataType: "NUMBER", label: "X Value" },
      }, {});
      expect(result).toContain("@input x - X Value");
    });

    it("generates optional port", () => {
      const code = `function Add() {}`;
      const result = updatePortsInFunctionText(code, {
        x: { dataType: "NUMBER", optional: true },
      }, {});
      expect(result).toContain("@input [x]");
    });

    it("generates port with default value", () => {
      const code = `function Add() {}`;
      const result = updatePortsInFunctionText(code, {
        x: { dataType: "NUMBER", optional: true, default: 10 },
      }, {});
      expect(result).toContain("@input [x=10]");
    });

    it("generates scoped port", () => {
      const code = `function Add(execute: boolean, inner: (x: boolean) => void) {}`;
      const result = updatePortsInFunctionText(code, {
        success: { dataType: "STEP", scope: "inner" },
      }, {});
      // Scoped mandatory ports (start, success, failure) use @input/@output, not @step
      expect(result).toContain("@input success scope:inner");
    });

    it("generates scoped data port", () => {
      const code = `function Add(execute: boolean, inner: (x: boolean) => void) {}`;
      const result = updatePortsInFunctionText(code, {
        value: { dataType: "NUMBER", scope: "inner" },
      }, {});
      // Non-STEP ports use @input/@output
      expect(result).toContain("@input value scope:inner");
    });

    it("preserves inline comments in JSDoc", () => {
      const code = `
/**
 * This is my node type.
 *
 * It does something useful.
 * Here's more context about what it does.
 *
 * @flowWeaver nodeType
 * @label Custom Label
 * @input x - The old input
 *
 * Some trailing comments here.
 */
function Add() {}
`;
      const result = updatePortsInFunctionText(code, {
        y: { dataType: "STRING" },
      }, {});
      expect(result).toContain("This is my node type.");
      expect(result).toContain("It does something useful.");
      expect(result).toContain("Here's more context about what it does.");
      expect(result).toContain("Some trailing comments here.");
      expect(result).toContain("@label Custom Label");
      expect(result).toContain("@input y");
    });

    it("preserves function body unchanged", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input x
 */
function Add(x) {
  // Some comment
  const result = x + 1;
  return { result };
}
`;
      const result = updatePortsInFunctionText(code, {
        y: { dataType: "STRING" },
      }, {});
      expect(result).toContain("// Some comment");
      expect(result).toContain("const result = x + 1");
      expect(result).toContain("return { result }");
    });

    it("round-trip: parse → update → parse matches", () => {
      const inputs = {
        x: { dataType: "NUMBER" as const, label: "X coord" },
        y: { dataType: "NUMBER" as const, optional: true, default: 0 },
      };
      const outputs = {
        result: { dataType: "NUMBER" as const },
      };

      // Include signature so types can be inferred on re-parse
      const code = `function Add(execute: boolean, x: number, y?: number): { onSuccess: boolean; onFailure: boolean; result: number } {}`;
      const updated = updatePortsInFunctionText(code, inputs, outputs);
      const parsed = parsePortsFromFunctionText(updated);

      expect(parsed.inputs.x.dataType).toBe("NUMBER");
      expect(parsed.inputs.x.label).toBe("X coord");
      expect(parsed.inputs.y.dataType).toBe("NUMBER");
      expect(parsed.inputs.y.optional).toBe(true);
      expect(parsed.inputs.y.default).toBe(0);
      expect(parsed.outputs.result.dataType).toBe("NUMBER");
    });

    it("preserves JSDoc order", () => {
      // Port order in JSDoc should be preserved
      const code = `
/**
 * @flowWeaver nodeType
 * @input a - First input
 * @input b - Second input
 * @output x - First output
 * @output y - Second output
 */
function Test(execute: boolean, a: number, b: number): { onSuccess: boolean; onFailure: boolean; x: number; y: number } {}
`;
      const result = updatePortsInFunctionText(code, {
        a: { dataType: "NUMBER", label: "First input" },
        b: { dataType: "NUMBER", label: "Second input" },
      }, {
        x: { dataType: "NUMBER", label: "First output" },
        y: { dataType: "NUMBER", label: "Second output" },
      });

      // Get the order of @input lines
      const lines = result.split("\n");
      const inputLines = lines.filter(l => l.includes("@input"));
      const outputLines = lines.filter(l => l.includes("@output"));

      // a should come before b (order preserved)
      expect(inputLines[0]).toContain("a");
      expect(inputLines[1]).toContain("b");

      // x should come before y (order preserved)
      expect(outputLines[0]).toContain("x");
      expect(outputLines[1]).toContain("y");
    });

    it("inserts new @input after existing inputs, before outputs", () => {
      // When adding a new input, it should go after existing inputs, not at the end
      const code = `
/**
 * @flowWeaver nodeType
 * @input items
 * @output results
 */
function forEach(execute: boolean, items: any[], iteration: (execute: boolean, item: any) => { onSuccess: boolean; processed: any }) {}`;

      const result = updatePortsInFunctionText(code, {
        items: { dataType: "ARRAY" },
        banana: { dataType: "STRING" }, // New input
      }, {
        results: { dataType: "ARRAY" },
      });

      const lines = result.split("\n");
      const itemsIndex = lines.findIndex(l => l.includes("@input") && l.includes("items"));
      const bananaIndex = lines.findIndex(l => l.includes("@input") && l.includes("banana"));
      const resultsIndex = lines.findIndex(l => l.includes("@output") && l.includes("results"));

      // Both inputs should come before output
      expect(itemsIndex).toBeLessThan(resultsIndex);
      expect(bananaIndex).toBeLessThan(resultsIndex);
    });
  });

  describe("Edge Cases", () => {
    describe("parsePortsFromFunctionText edge cases", () => {
      it("ignores @input without port name", () => {
        const code = `
/**
 * @flowWeaver nodeType
 * @input
 * @input validName
 */
function Add() {}
`;
        const result = parsePortsFromFunctionText(code);
        // Should only parse the valid port (first line with no name is ignored)
        expect(Object.keys(result.inputs)).toHaveLength(1);
        expect(result.inputs).toHaveProperty("validName");
      });

      it("parses ports without type (new format)", () => {
        // In new format, @input name is valid (type from signature)
        const code = `
/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 */
function Add(execute: boolean, x: number, y: string) {}
`;
        const result = parsePortsFromFunctionText(code);
        // Both ports should be parsed
        expect(Object.keys(result.inputs)).toHaveLength(2);
        expect(result.inputs).toHaveProperty("x");
        expect(result.inputs).toHaveProperty("y");
        // Types inferred from signature
        expect(result.inputs.x.dataType).toBe("NUMBER");
        expect(result.inputs.y.dataType).toBe("STRING");
      });

      it("handles empty string input", () => {
        const result = parsePortsFromFunctionText("");
        expect(Object.keys(result.inputs)).toHaveLength(0);
        expect(Object.keys(result.outputs)).toHaveLength(0);
      });

      it("handles labels with special characters", () => {
        const code = `
/**
 * @flowWeaver nodeType
 * @input x - Value (in meters) & ratio
 * @output result - Output: "formatted"
 */
function Add() {}
`;
        const result = parsePortsFromFunctionText(code);
        expect(result.inputs.x.label).toBe("Value (in meters) & ratio");
        expect(result.outputs.result.label).toBe('Output: "formatted"');
      });

      it("handles very long labels", () => {
        const longLabel = "A".repeat(200);
        const code = `
/**
 * @flowWeaver nodeType
 * @input x - ${longLabel}
 */
function Add() {}
`;
        const result = parsePortsFromFunctionText(code);
        expect(result.inputs.x.label).toBe(longLabel);
      });

      it("first port wins when duplicate names exist", () => {
        const code = `
/**
 * @flowWeaver nodeType
 * @input x - First
 * @input x - Second
 */
function Add(execute: boolean, x: string) {}
`;
        const result = parsePortsFromFunctionText(code);
        // First one wins (duplicates are skipped), type from signature
        expect(result.inputs.x.dataType).toBe("STRING");
        expect(result.inputs.x.label).toBe("First");
      });

      it("should NOT capture next line as label when no label provided", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input input1
 * @output result
 */
function test() {}`;

        const { inputs, outputs } = parsePortsFromFunctionText(code);

        expect(inputs.input1.label).toBeUndefined();
        expect(outputs.result.label).toBeUndefined();
      });

      it("should NOT capture next line as label when trailing dash without text", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input input1 -
 * @output result -
 */
function test() {}`;

        const { inputs, outputs } = parsePortsFromFunctionText(code);

        // Trailing dash without text should result in undefined label, NOT next line content
        expect(inputs.input1.label).toBeUndefined();
        expect(outputs.result.label).toBeUndefined();
      });

      it("parses output types from async Promise<{...}> return type", () => {
        const code = `
/**
 * @flowWeaver nodeType
 * @input messages [order:1] - Conversation messages
 * @input execute [order:0] - Execute
 * @output content [order:2] - Text response
 * @output toolCalls [order:3] - Tool calls
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function llmCall(
  execute: boolean,
  messages: string[]
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  content: string | null;
  toolCalls: string[];
}> {
  return { onSuccess: true, onFailure: false, content: null, toolCalls: [] };
}`;
        const result = parsePortsFromFunctionText(code);

        // Input types should be resolved from signature
        expect(result.inputs.execute.dataType).toBe("STEP");
        expect(result.inputs.messages.dataType).toBe("ARRAY");

        // Output types should be resolved from Promise<{...}> return type, NOT default to ANY
        expect(result.outputs.onSuccess.dataType).toBe("STEP");
        expect(result.outputs.onFailure.dataType).toBe("STEP");
        expect(result.outputs.content.dataType).not.toBe("ANY");
        expect(result.outputs.toolCalls.dataType).not.toBe("ANY");
      });

    });

    describe("updatePortsInFunctionText edge cases", () => {
      it("handles empty inputs and outputs", () => {
        const code = `
/**
 * @flowWeaver nodeType
 * @input x
 */
function Add() {}
`;
        const result = updatePortsInFunctionText(code, {}, {});
        // Should preserve JSDoc structure but remove ports
        expect(result).toContain("@flowWeaver nodeType");
        expect(result).not.toContain("@input");
        expect(result).not.toContain("@output");
      });

      it("handles empty string input code", () => {
        const result = updatePortsInFunctionText("", {
          x: { dataType: "NUMBER" },
        }, {});
        expect(result).toContain("@flowWeaver nodeType");
        expect(result).toContain("@input x");
      });

      it("handles labels with special characters in output", () => {
        const code = `function Add() {}`;
        const result = updatePortsInFunctionText(code, {
          x: { dataType: "NUMBER", label: 'Value (in meters) & "ratio"' },
        }, {});
        expect(result).toContain('@input x - Value (in meters) & "ratio"');
      });

      it("does not add label if label equals name", () => {
        const code = `function Add() {}`;
        const result = updatePortsInFunctionText(code, {
          myPort: { dataType: "NUMBER", label: "myPort" },
        }, {});
        // Should not have " - myPort" at the end since label === name
        expect(result).toContain("@input myPort");
        expect(result).not.toContain("@input myPort - myPort");
      });
    });

    describe("Commented code handling", () => {
      it("ignores commented-out JSDoc blocks", () => {
        // This simulates the default template with commented example
        const code = `/**
 * @flowWeaver nodeType
 * @label My Node
 * @input value
 * @output result
 */
function myNode(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: 0 };
  }
  return { onSuccess: true, onFailure: false, result: value * 2 };
}

// ============================================================
// SCOPED NODE TEMPLATE
// ============================================================
// /**
//  * @flowWeaver nodeType
//  * @label For Each
//  * @scope iteration
//  * @input items
//  * @output results
//  * @output start scope:iteration
//  * @output item scope:iteration
//  * @input success scope:iteration
//  * @input failure scope:iteration
//  * @input processed scope:iteration
//  */
// function forEach(execute: boolean, items: any[]) {}
`;

        const result = parsePortsFromFunctionText(code);

        // Should only parse the REAL node type (myNode), not the commented forEach
        expect(Object.keys(result.inputs)).toHaveLength(1);
        expect(result.inputs).toHaveProperty("value");
        expect(result.inputs).not.toHaveProperty("items");
        expect(result.inputs).not.toHaveProperty("success");
        expect(result.inputs).not.toHaveProperty("failure");
        expect(result.inputs).not.toHaveProperty("processed");

        expect(Object.keys(result.outputs)).toHaveLength(1);
        expect(result.outputs).toHaveProperty("result");
        expect(result.outputs).not.toHaveProperty("results");
        expect(result.outputs).not.toHaveProperty("start");
        expect(result.outputs).not.toHaveProperty("item");
      });

      it("ignores JSDoc in single-line comments", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function real(execute: boolean, x: number) {}

// /** @input y */ function fake() {}
`;

        const result = parsePortsFromFunctionText(code);
        expect(Object.keys(result.inputs)).toHaveLength(1);
        expect(result.inputs).toHaveProperty("x");
        expect(result.inputs).not.toHaveProperty("y");
      });
    });
  });

  describe("applyPortsDiffToCode - type changes should NOT modify function body", () => {
    it("should NOT modify return statements when output type changes", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @output result
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: 0 };
  }
  return { onSuccess: true, onFailure: false, result: 42 };
}`;

      const diff = {
        added: [],
        removed: [],
        renamed: [],
        labelChanged: [],
        typeChanged: [{ name: "result", type: "ARRAY", direction: "OUTPUT" as const }],
      };

      const result = applyPortsDiffToCode(code, diff);

      // Return type annotation should be updated
      expect(result).toMatch(/\):\s*\{[^}]*result:\s*any\[\]/);

      // Return statements in body should NOT be modified
      expect(result).toContain("result: 0");
      expect(result).toContain("result: 42");
    });

    it("should only modify return type annotation, not return statement values", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function myNode(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; result: number } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: 0 };
  }

  try {
    const result = value * 2;
    return { onSuccess: true, onFailure: false, result };
  } catch (error) {
    return { onSuccess: false, onFailure: true, result: 0 };
  }
}`;

      const diff = {
        added: [],
        removed: [],
        renamed: [],
        labelChanged: [],
        typeChanged: [{ name: "result", type: "ARRAY", direction: "OUTPUT" as const }],
      };

      const result = applyPortsDiffToCode(code, diff);

      // All return statements should be preserved exactly
      expect(result).toContain("return { onSuccess: false, onFailure: false, result: 0 };");
      expect(result).toContain("return { onSuccess: true, onFailure: false, result };");
      expect(result).toContain("return { onSuccess: false, onFailure: true, result: 0 };");
    });
  });

  describe("syncJSDocToSignature - return type should NOT modify function body", () => {
    it("should NOT modify return statements inside function body when syncing return type", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @output result
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: any[] } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: 0 };
  }
  return { onSuccess: true, onFailure: false, result: 42 };
}`;
      const result = syncJSDocToSignature(code);

      // Return statements in body should NOT be modified
      expect(result).toContain("result: 0");
      expect(result).toContain("result: 42");
      // Should NOT have type annotation syntax in return statements
      expect(result).not.toMatch(/return\s*\{[^}]*result:\s*any\[\]/);
    });

    it("should preserve numeric values in return statements when return type is array", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function myNode(
  execute: boolean,
  value: number
): { onSuccess: boolean; onFailure: boolean; result: any[] } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: 0 };
  }

  try {
    const result = value * 2;
    return { onSuccess: true, onFailure: false, result };
  } catch (error) {
    return { onSuccess: false, onFailure: true, result: 0 };
  }
}`;
      const result = syncJSDocToSignature(code);

      // All return statements should be preserved exactly
      expect(result).toContain("return { onSuccess: false, onFailure: false, result: 0 };");
      expect(result).toContain("return { onSuccess: true, onFailure: false, result };");
      expect(result).toContain("return { onSuccess: false, onFailure: true, result: 0 };");
    });
  });

});
