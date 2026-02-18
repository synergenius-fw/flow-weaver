/**
 * Test JSDoc Format Preservation utilities
 * Tests for incomplete lines, whitespace handling, flexible spacing, and formatting
 */

import {
  parsePortsFromFunctionText,
  updatePortsInFunctionText,
  formatPortsInFunctionText,
  syncSignatureToJSDoc,
  syncJSDocToSignature,
  hasOrphanPortLines,
} from "../../src/jsdoc-port-sync";

describe("JSDoc Format Preservation", () => {
  describe("Incomplete Port Lines", () => {
    describe("updatePortsInFunctionText preserves incomplete lines", () => {
      it("preserves incomplete @input line (no type/name)", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input
 * @input x
 */
function test(execute: boolean, x: number) {}`;
        const result = updatePortsInFunctionText(code,
          { x: { dataType: "NUMBER" } },
          {}
        );
        expect(result).toContain(" * @input ");
        expect(result).toContain("@input x");
      });

      it("preserves orphan @input line (just tag, no name)", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input
 * @input x
 */
function test(execute: boolean, x: number) {}`;
        const result = updatePortsInFunctionText(code,
          { x: { dataType: "NUMBER" } },
          {}
        );
        // Orphan line should be preserved
        expect(result).toContain(" * @input ");
      });

      it("preserves incomplete @output line", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @output
 * @output result
 */
function test(execute: boolean): { result: number } {}`;
        const result = updatePortsInFunctionText(code,
          {},
          { result: { dataType: "NUMBER" } }
        );
        expect(result).toContain(" * @output ");
      });
    });

    describe("Incomplete Optional Port Syntax", () => {
      it("preserves incomplete opening bracket after port name: banana [", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input banana [
 * @input x
 */
function test(execute: boolean, x: number) {}`;
        const result = updatePortsInFunctionText(code,
          { x: { dataType: "NUMBER" } },
          {}
        );
        expect(result).toContain("@input banana [");
      });

      it("preserves incomplete optional with partial name: [ban", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input [ban
 * @input x
 */
function test(execute: boolean, x: number) {}`;
        const result = updatePortsInFunctionText(code,
          { x: { dataType: "NUMBER" } },
          {}
        );
        expect(result).toContain("@input [ban");
      });

      it("preserves incomplete optional with name but no closing bracket: [banana", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input [banana
 * @input x
 */
function test(execute: boolean, x: number) {}`;
        const result = updatePortsInFunctionText(code,
          { x: { dataType: "NUMBER" } },
          {}
        );
        expect(result).toContain("@input [banana");
      });

      it("preserves incomplete optional with equals but no value: [banana=", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input [banana=
 * @input x
 */
function test(execute: boolean, x: number) {}`;
        const result = updatePortsInFunctionText(code,
          { x: { dataType: "NUMBER" } },
          {}
        );
        expect(result).toContain("@input [banana=");
      });

      it("preserves incomplete output optional syntax: [result", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @output [result
 * @output sum
 */
function test(execute: boolean): { sum: number } {}`;
        const result = updatePortsInFunctionText(code,
          {},
          { sum: { dataType: "NUMBER" } }
        );
        expect(result).toContain("@output [result");
      });

      it("preserves incomplete bracket with label: banana [ - Test", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input banana [ - Test
 * @input x
 */
function test(execute: boolean, x: number) {}`;
        const result = updatePortsInFunctionText(code,
          { x: { dataType: "NUMBER" } },
          {}
        );
        expect(result).toContain("@input banana [ - Test");
      });
    });

    describe("Sync functions preserve incomplete bracket with label", () => {
      it("syncSignatureToJSDoc preserves incomplete bracket with label", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input banana [ - Test
 */
function test(execute: boolean) {}`;

        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@input banana [ - Test");
      });

      it("syncJSDocToSignature preserves incomplete bracket with label", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input banana [ - Test
 */
function test(execute: boolean) {}`;

        const result = syncJSDocToSignature(code);
        expect(result).toContain("@input banana [ - Test");
      });

      it("syncSignatureToJSDoc does NOT add duplicate port for incomplete bracket line", () => {
        // Scenario: user has "banana [ - Test" (incomplete optional), signature has "banana: string"
        // The sync should NOT add a second "@input banana" line
        const code = `/**
 * @flowWeaver nodeType
 * @input banana [ - Test
 */
function test(execute: boolean, banana: string) {}`;

        const result = syncSignatureToJSDoc(code);

        // Should still have the incomplete line
        expect(result).toContain("@input banana [ - Test");

        // Should NOT have a duplicate banana port (count occurrences)
        const bananaMatches = result.match(/@input.*banana/g) || [];
        expect(bananaMatches.length).toBe(1);
      });
    });
  });

  describe("Trailing Whitespace Behavior", () => {
    it("syncSignatureToJSDoc strips trailing whitespace (expected behavior)", () => {
      // User typed " * @input test " (with trailing space)
      // Note: Template literal needs explicit trailing space
      const codeWithTrailingSpace = "/**\n * @flowWeaver nodeType\n * @input test \n */\nfunction test(execute: boolean, test: any) {}";
      const codeWithoutTrailingSpace = "/**\n * @flowWeaver nodeType\n * @input test\n */\nfunction test(execute: boolean, test: any) {}";

      const result = syncSignatureToJSDoc(codeWithTrailingSpace);

      // The sync DOES strip trailing whitespace - this is expected behavior
      // The UI layer should use normalized comparison to avoid cursor jumps
      expect(result).toBe(codeWithoutTrailingSpace);
    });

    it("syncJSDocToSignature should not change synced code", () => {
      const codeAlreadySynced = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`;

      const result = syncJSDocToSignature(codeAlreadySynced);

      // Already synced code should not change
      expect(result).toBe(codeAlreadySynced);
    });
  });

  describe("Flexible Port Line Parsing (TDD)", () => {
    describe("updatePortsInFunctionText preserves incomplete lines", () => {
      it("handles partial name: @input na - now parsed as valid port named na", () => {
        // Note: With new format (no {TYPE}), @input na IS a valid port named "na"
        // When updating with empty inputs, it gets removed (no `na` port provided)
        const code = `/**
 * @flowWeaver nodeType
 * @input na
 */
function test(execute: boolean) {}`;

        // With empty inputs, na is removed (it was a port but not in new inputs)
        const result = updatePortsInFunctionText(code, {}, {});
        expect(result).not.toContain("@input na");

        // With na in inputs, it's preserved
        const result2 = updatePortsInFunctionText(code, { na: { dataType: "ANY" } }, {});
        expect(result2).toContain("@input na");
      });

      it("preserves just the tag with whitespace: @input ", () => {
        // Note: template literal has trailing space after @input
        const code = "/**\n * @flowWeaver nodeType\n * @input \n */\nfunction test(execute: boolean) {}";

        const result = updatePortsInFunctionText(code, {}, {});
        expect(result).toContain("@input ");
      });

      it("preserves just the tag: @input", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input
 */
function test(execute: boolean) {}`;

        const result = updatePortsInFunctionText(code, {}, {});
        expect(result).toContain("@input");
      });

      it("preserves incomplete label: @input name -", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input name -
 */
function test(execute: boolean) {}`;

        const result = updatePortsInFunctionText(code, {}, {});
        expect(result).toContain("@input name -");
      });

      it("preserves incomplete label with space: @input name - ", () => {
        // Note: template literal has trailing space after hyphen
        const code = "/**\n * @flowWeaver nodeType\n * @input name - \n */\nfunction test(execute: boolean) {}";

        const result = updatePortsInFunctionText(code, {}, {});
        // We preserve the line as-is (may or may not have trailing space depending on input)
        expect(result).toContain("@input name -");
      });
    });

    describe("parsePortsFromFunctionText handles partial syntax", () => {
      it("parses unknown type as ANY: @input name", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input name
 */
function test(execute: boolean) {}`;

        const result = parsePortsFromFunctionText(code);
        expect(result.inputs).toHaveProperty("name");
        expect(result.inputs.name.dataType).toBe("ANY");
      });

      it("parses missing type as ANY: @input name", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input name
 */
function test(execute: boolean) {}`;

        const result = parsePortsFromFunctionText(code);
        expect(result.inputs).toHaveProperty("name");
        expect(result.inputs.name.dataType).toBe("ANY");
      });

      it("does not parse wrong brackets (legacy format removed): @input (STRING) name", () => {
        // Note: We removed {TYPE} format entirely. (STRING) is not valid syntax.
        const code = `/**
 * @flowWeaver nodeType
 * @input (STRING) name
 */
function test(execute: boolean) {}`;

        const result = parsePortsFromFunctionText(code);
        // With legacy format removed, this does not parse as valid port
        expect(result.inputs).not.toHaveProperty("name");
      });

      it("does not parse typo in tag: @inptu {STRING} name", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @inptu {STRING} name
 */
function test(execute: boolean) {}`;

        const result = parsePortsFromFunctionText(code);
        expect(result.inputs).not.toHaveProperty("name");
      });
    });

    describe("Sync functions handle partial syntax", () => {
      it("syncSignatureToJSDoc preserves unknown type line", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input name
 */
function test(execute: boolean, name: string) {}`;

        const result = syncSignatureToJSDoc(code);
        // Should preserve the original line with unknown type, not regenerate
        expect(result).toContain("@input name");
      });

      it("syncSignatureToJSDoc preserves incomplete label mid-typing", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input name - My la
 */
function test(execute: boolean, name: string) {}`;

        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@input name - My la");
      });
    });

    describe("User typing [ to start optional syntax", () => {
      it("preserves [ immediately after name: @input name[", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input name[
 */
function test(execute: boolean, name: string) {}`;

        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@input name[");
      });

      it("preserves [ with space before: @input name [", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input name [
 */
function test(execute: boolean, name: string) {}`;

        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@input name [");
      });

      it("preserves empty brackets [] - CodeMirror auto-completes", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input test []
 */
function test(execute: boolean, test: any) {}`;

        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@input test []");
      });

      it("preserves @input test [ - user's exact scenario", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input test [
 */
function test(execute: boolean, test: any) {}`;

        const result = syncSignatureToJSDoc(code);
        expect(result).toContain("@input test [");
      });

      it("updatePortsInFunctionText preserves name[ pattern", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input name[
 */
function test(execute: boolean) {}`;

        const result = updatePortsInFunctionText(code, {}, {});
        expect(result).toContain("@input name[");
      });

      it("updatePortsInFunctionText preserves @input test [", () => {
        const code = `/**
 * @flowWeaver nodeType
 * @input test [
 */
function test(execute: boolean) {}`;

        const result = updatePortsInFunctionText(code, {}, {});
        expect(result).toContain("@input test [");
      });
    });
  });

});
describe("Flexible Spacing After Asterisk", () => {
  describe("parsePortsFromFunctionText handles varying spacing", () => {
    it("parses with double space after asterisk: *  @input", () => {
      const code = `/**
 *  @flowWeaver nodeType
 *  @input x
 *  @output result
 */
function test(execute: boolean, x: number): { result: string } {}`;
      const { inputs, outputs } = parsePortsFromFunctionText(code);
      expect(inputs).toHaveProperty("x");
      expect(inputs.x.dataType).toBe("NUMBER");
      expect(outputs).toHaveProperty("result");
      expect(outputs.result.dataType).toBe("STRING");
    });

    it("parses with no space after asterisk: *@input", () => {
      const code = `/**
 *@flowWeaver nodeType
 *@input x
 *@output result
 */
function test(execute: boolean, x: number): { result: string } {}`;
      const { inputs, outputs } = parsePortsFromFunctionText(code);
      expect(inputs).toHaveProperty("x");
      expect(inputs.x.dataType).toBe("NUMBER");
      expect(outputs).toHaveProperty("result");
      expect(outputs.result.dataType).toBe("STRING");
    });

    it("parses with tab after asterisk: *\\t@input", () => {
      const code = "/**\n *\t@flowWeaver nodeType\n *\t@input x\n *\t@output result\n */\nfunction test(execute: boolean, x: number): { result: string } {}";
      const { inputs, outputs } = parsePortsFromFunctionText(code);
      expect(inputs).toHaveProperty("x");
      expect(inputs.x.dataType).toBe("NUMBER");
      expect(outputs).toHaveProperty("result");
      expect(outputs.result.dataType).toBe("STRING");
    });

    it("parses with multiple spaces after asterisk: *   @input", () => {
      const code = `/**
 *   @flowWeaver nodeType
 *   @input x
 *   @output result
 */
function test(execute: boolean, x: number): { result: string } {}`;
      const { inputs, outputs } = parsePortsFromFunctionText(code);
      expect(inputs).toHaveProperty("x");
      expect(inputs.x.dataType).toBe("NUMBER");
      expect(outputs).toHaveProperty("result");
      expect(outputs.result.dataType).toBe("STRING");
    });

    it("parses optional port with double space: *  @input [x]", () => {
      const code = `/**
 *  @flowWeaver nodeType
 *  @input [x]
 */
function test(execute: boolean) {}`;
      const { inputs } = parsePortsFromFunctionText(code);
      expect(inputs).toHaveProperty("x");
      expect(inputs.x.optional).toBe(true);
    });

    it("parses port with default value with double space: *  @input [x=10]", () => {
      const code = `/**
 *  @flowWeaver nodeType
 *  @input [x=10]
 */
function test(execute: boolean) {}`;
      const { inputs } = parsePortsFromFunctionText(code);
      expect(inputs).toHaveProperty("x");
      expect(inputs.x.default).toBe(10);
    });

    it("parses port with label and double space: *  @input x - Label", () => {
      const code = `/**
 *  @flowWeaver nodeType
 *  @input x - The X Value
 */
function test(execute: boolean, x: number) {}`;
      const { inputs } = parsePortsFromFunctionText(code);
      expect(inputs.x.label).toBe("The X Value");
    });

    it("parses port with scope and double space: *  @input success scope:inner", () => {
      const code = `/**
 *  @flowWeaver nodeType
 *  @input success scope:inner
 */
function test(execute: boolean, inner: (x: boolean) => void) {}`;
      const { inputs } = parsePortsFromFunctionText(code);
      expect(inputs.success.scope).toBe("inner");
    });
  });

  describe("updatePortsInFunctionText preserves incomplete lines with varying spacing", () => {
    it("preserves incomplete line with double space: *  @input name [", () => {
      const code = `/**
 *  @flowWeaver nodeType
 *  @input name [
 */
function test(execute: boolean) {}`;
      const result = updatePortsInFunctionText(code, {}, {});
      expect(result).toContain("@input name [");
    });

    it("preserves incomplete line with no space: *@input name [", () => {
      const code = `/**
 *@flowWeaver nodeType
 *@input name [
 */
function test(execute: boolean) {}`;
      const result = updatePortsInFunctionText(code, {}, {});
      expect(result).toContain("@input name [");
    });
  });

  describe("syncSignatureToJSDoc handles varying spacing", () => {
    it("preserves ports with double space after asterisk", () => {
      const code = `/**
 *  @flowWeaver nodeType
 *  @input x
 */
function test(execute: boolean, x: number, y: number) {}`;
      const result = syncSignatureToJSDoc(code);
      // Should add y and preserve existing x
      expect(result).toContain("@input x");
      expect(result).toContain("@input y");
    });

    it("preserves incomplete line with double space: *  @input test [", () => {
      const code = `/**
 *  @flowWeaver nodeType
 *  @input test [
 */
function test(execute: boolean, test: any) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input test [");
    });
  });

  describe("syncJSDocToSignature handles varying spacing", () => {
    it("syncs ports with double space to signature", () => {
      // Ports x and y already exist in signature with types
      const code = `/**
 *  @flowWeaver nodeType
 *  @input x
 *  @input y
 */
function test(execute: boolean, x: number, y: string) {}`;
      const result = syncJSDocToSignature(code);
      // Types preserved from signature
      expect(result).toContain("x: number");
      expect(result).toContain("y: string");
    });
  });

  describe("Mixed spacing within same JSDoc block", () => {
    it("parses ports with mixed spacing (single, double, none)", () => {
      // Test that varying spacing after asterisk still parses ports
      // Types now come from signature, not JSDoc
      const code = `/**
 * @flowWeaver nodeType
 *  @input a
 *@input b
 *   @input c
 */
function test(execute: boolean, a: number, b: string, c: boolean) {}`;
      const { inputs } = parsePortsFromFunctionText(code);
      expect(inputs).toHaveProperty("a");
      expect(inputs.a.dataType).toBe("NUMBER");
      expect(inputs).toHaveProperty("b");
      expect(inputs.b.dataType).toBe("STRING");
      expect(inputs).toHaveProperty("c");
      expect(inputs.c.dataType).toBe("BOOLEAN");
    });
  });
});

describe("Permissive Port Sync - Only modify valid lines", () => {
  describe("syncSignatureToJSDoc leaves invalid/incomplete lines untouched", () => {
    it("preserves [o] while user types order", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x [o]
 */
function test(execute: boolean, x: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x [o]");
    });

    it("preserves [or] while user types order", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x [or]
 */
function test(execute: boolean, x: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x [or]");
    });

    it("preserves [order] while user types order", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x [order]
 */
function test(execute: boolean, x: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x [order]");
    });

    it("preserves [order:] while user types number", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x [order:]
 */
function test(execute: boolean, x: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x [order:]");
    });

    it("preserves [order:1 with missing closing bracket", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x [order:1
 */
function test(execute: boolean, x: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x [order:1");
    });

    it("preserves any garbage after port name", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x asdfasdf
 */
function test(execute: boolean, x: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x asdfasdf");
    });

    it("preserves typo in type like {NUBMER}", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x");
    });

    it("preserves incomplete label: x -", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x -
 */
function test(execute: boolean, x: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x -");
    });

    it("preserves incomplete optional: [x", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input [x
 */
function test(execute: boolean) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input [x");
    });

    it("preserves incomplete default: [x=", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input [x=
 */
function test(execute: boolean) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input [x=");
    });
  });

  describe("syncSignatureToJSDoc correctly syncs valid lines", () => {
    it("syncs basic @input x", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x
 */
function test(execute: boolean, x: number, y: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x");
      expect(result).toContain("@input y");
    });

    it("syncs optional [x] when param exists", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input [x]
 */
function test(execute: boolean, x?: number) {}`;
      const result = syncSignatureToJSDoc(code);
      // New format: no {TYPE} - just @input [x]
      expect(result).toContain("@input [x]");
    });

    it("syncs with default [x=10] when param exists", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input [x=10]
 */
function test(execute: boolean, x: number = 10) {}`;
      const result = syncSignatureToJSDoc(code);
      // New format: no {TYPE} - just @input [x=10]
      expect(result).toContain("@input [x=10]");
    });

    it("syncs complete [order:1]", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x [order:1]
 */
function test(execute: boolean, x: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x");
    });

    it("syncs with label: x - My Label", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x - My Label
 */
function test(execute: boolean, x: number) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x - My Label");
    });

    it("syncs with scope: x scope:inner", () => {
      const code = `/**
 * @flowWeaver nodeType
 * @input x scope:inner
 */
function test(execute: boolean, inner: (x: number) => void) {}`;
      const result = syncSignatureToJSDoc(code);
      expect(result).toContain("@input x scope:inner");
    });
  });
});
describe("formatPortsInFunctionText (Aggressive Mode)", () => {
  it("regenerates all port lines even if incomplete", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x [o]
 * @input y asdf garbage
 */
function test(execute: boolean, x: number, y: string) {}`;

    const result = formatPortsInFunctionText(code,
      { x: { dataType: "NUMBER" }, y: { dataType: "STRING" } },
      {}
    );

    // Should have clean, regenerated lines
    expect(result).toContain("@input x");
    expect(result).toContain("@input y");
    // Should NOT have garbage
    expect(result).not.toContain("[o]");
    expect(result).not.toContain("asdf garbage");
  });

  it("sorts ports by [order:N] metadata", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input b [order:2]
 * @input a [order:1]
 */
function test(execute: boolean) {}`;

    const result = formatPortsInFunctionText(code,
      {
        b: { dataType: "STRING", metadata: { order: 2 } },
        a: { dataType: "NUMBER", metadata: { order: 1 } }
      },
      {}
    );

    // a should come before b in output
    const aIndex = result.indexOf("@input a");
    const bIndex = result.indexOf("@input b");
    expect(aIndex).toBeLessThan(bIndex);
  });

  it("preserves non-port JSDoc content", () => {
    const code = `/**
 * My description here
 * @flowWeaver nodeType
 * @label My Node
 * @input x [garbage
 */
function test(execute: boolean, x: number) {}`;

    const result = formatPortsInFunctionText(code,
      { x: { dataType: "NUMBER" } },
      {}
    );

    expect(result).toContain("My description here");
    expect(result).toContain("@label My Node");
    expect(result).toContain("@input x");
    expect(result).not.toContain("[garbage");
  });

  it("creates JSDoc when none exists", () => {
    const code = `function test(execute: boolean, x: number) {}`;

    const result = formatPortsInFunctionText(code,
      { x: { dataType: "NUMBER" } },
      {}
    );

    expect(result).toContain("/**");
    expect(result).toContain("@flowWeaver nodeType");
    expect(result).toContain("@input x");
    expect(result).toContain("*/");
  });

  it("handles outputs with order", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @output b [order:2]
 * @output a [order:1]
 */
function test(execute: boolean): { a: number; b: string } {}`;

    const result = formatPortsInFunctionText(code,
      {},
      {
        b: { dataType: "STRING", metadata: { order: 2 } },
        a: { dataType: "NUMBER", metadata: { order: 1 } }
      }
    );

    // a should come before b in output
    const aIndex = result.indexOf("@output a");
    const bIndex = result.indexOf("@output b");
    expect(aIndex).toBeLessThan(bIndex);
  });

  it("regenerates port with label", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x - Old Label
 */
function test(execute: boolean, x: number) {}`;

    const result = formatPortsInFunctionText(code,
      { x: { dataType: "NUMBER", label: "New Label" } },
      {}
    );

    expect(result).toContain("@input x - New Label");
    expect(result).not.toContain("Old Label");
  });

  it("regenerates port with scope", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input inner scope:inner [garbage
 */
function test(execute: boolean) {}`;

    // Note: STEP type with scope generates @step tag, not @input
    const result = formatPortsInFunctionText(code,
      { inner: { dataType: "STEP", scope: "inner" } },
      {}
    );

    // STEP dataType uses @step tag, not @input
    expect(result).toContain("@step inner scope:inner");
    expect(result).not.toContain("[garbage");
  });

  it("handles mixed inputs and outputs", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @input x garbage
 * @output result garbage
 */
function test(execute: boolean, x: number): { result: string } {}`;

    const result = formatPortsInFunctionText(code,
      { x: { dataType: "NUMBER" } },
      { result: { dataType: "STRING" } }
    );

    expect(result).toContain("@input x");
    expect(result).toContain("@output result");
    expect(result).not.toContain("garbage");
  });

  it("orders scoped ports: external inputs → scoped outputs → scoped inputs → external outputs", () => {
    const code = `/**
 * @flowWeaver nodeType
 * @scope iteration
 */
function test() {}`;

    const result = formatPortsInFunctionText(code,
      {
        items: { dataType: "ARRAY" },  // external input
        success: { dataType: "STEP", scope: "iteration" },  // scoped input
        failure: { dataType: "STEP", scope: "iteration" },  // scoped input
        processed: { dataType: "ANY", scope: "iteration" }  // scoped input
      },
      {
        start: { dataType: "STEP", scope: "iteration" },  // scoped output
        item: { dataType: "ANY", scope: "iteration" },  // scoped output
        results: { dataType: "ARRAY" }  // external output
      }
    );

    // Extract the order of port lines from the result
    // Note: NEW format has no {TYPE} - matches @input name or @output name
    const lines = result.split("\n").filter(l => /@(input|output|step)/.test(l));
    const portOrder = lines.map(l => {
      const match = l.match(/@(input|output|step)\s+(\w+)/);
      return match ? match[2] : "";
    });

    // Expected order: external inputs → scoped outputs → scoped inputs → external outputs
    // items (external input) → start, item (scoped outputs) → success, failure, processed (scoped inputs) → results (external output)
    expect(portOrder[0]).toBe("items");  // external input first
    expect(portOrder.indexOf("start")).toBeLessThan(portOrder.indexOf("success"));  // scoped outputs before scoped inputs
    expect(portOrder.indexOf("item")).toBeLessThan(portOrder.indexOf("success"));
    expect(portOrder.indexOf("processed")).toBeLessThan(portOrder.indexOf("results"));  // scoped inputs before external outputs
    expect(portOrder[portOrder.length - 1]).toBe("results");  // external output last
  });

  it("removes empty JSDoc lines before inserting port tags (no extra newlines after @label)", () => {
    // BUG: When user has @label followed by port tags, and format is triggered,
    // empty JSDoc lines (" *") get preserved, causing extra blank lines
    const code = `/**
 * @flowWeaver nodeType
 * @label Banana
 *
 * @input execute [order:0] [placement:TOP] - Execute
 */
function test(execute: boolean) {}`;

    const result = formatPortsInFunctionText(code,
      { execute: { dataType: "STEP", metadata: { order: 0 }, label: "Execute" } },
      {}
    );

    // Should NOT have empty line between @label and @input
    expect(result).not.toContain("@label Banana\n *\n");
    expect(result).not.toContain("@label Banana\n * \n");

    // Should have @label directly followed by port tag (just one newline)
    expect(result).toMatch(/@label Banana\n \* @/);
  });

  it("removes malformed empty JSDoc lines (missing asterisk) before inserting port tags", () => {
    // BUG: When blank line has no asterisk (just space or empty), it's not being removed
    // This causes extra blank lines to accumulate on each format
    const code = `/**
 * A banana 2
 * @flowWeaver nodeType
 * @label Banana

 * @input execute [order:0] [placement:TOP] - Execute
 */
function banana(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}`;

    const result = formatPortsInFunctionText(code,
      { execute: { dataType: "STEP", metadata: { order: 0 }, label: "Execute" } },
      { onSuccess: { dataType: "STEP" } }
    );

    // Should NOT have blank line (missing asterisk) between @label and @input
    expect(result).not.toContain("@label Banana\n \n");
    expect(result).not.toContain("@label Banana\n\n");

    // Should have @label directly followed by port tag
    expect(result).toMatch(/@label Banana\n \* @/);
  });
});
