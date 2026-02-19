/**
 * @module chevrotain-parser/tokens.test
 *
 * Tests for Chevrotain token definitions.
 * TDD: Verify tokens before building parser.
 */

import { JSDocLexer, InputTag, OutputTag, Identifier, ScopePrefix, Integer, StringLiteral, LBracket, RBracket, OrderPrefix, PlacementPrefix, TopKeyword, BottomKeyword, Dash, Arrow, Dot, Colon, NodeTag, ConnectTag, PositionTag, ExprPrefix, Equals } from "../../src/chevrotain-parser/tokens";

describe("Chevrotain JSDoc Tokens", () => {
  describe("Basic tokenization", () => {
    it("should tokenize @input tag", () => {
      const result = JSDocLexer.tokenize("@input");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].tokenType).toBe(InputTag);
    });

    it("should tokenize @output tag", () => {
      const result = JSDocLexer.tokenize("@output");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].tokenType).toBe(OutputTag);
    });

    it("should tokenize identifier", () => {
      const result = JSDocLexer.tokenize("myPort");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].tokenType).toBe(Identifier);
      expect(result.tokens[0].image).toBe("myPort");
    });

    it("should tokenize identifier with underscore", () => {
      const result = JSDocLexer.tokenize("my_port_123");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].tokenType).toBe(Identifier);
    });
  });

  describe("Port line tokenization", () => {
    it("should tokenize simple @input line", () => {
      const result = JSDocLexer.tokenize("@input myPort");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens).toHaveLength(2);
      expect(result.tokens[0].tokenType).toBe(InputTag);
      expect(result.tokens[1].tokenType).toBe(Identifier);
      expect(result.tokens[1].image).toBe("myPort");
    });

    it("should tokenize @input with scope", () => {
      const result = JSDocLexer.tokenize("@input myPort scope:iteration");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens).toHaveLength(4);
      expect(result.tokens[0].tokenType).toBe(InputTag);
      expect(result.tokens[1].tokenType).toBe(Identifier);
      expect(result.tokens[2].tokenType).toBe(ScopePrefix);
      expect(result.tokens[3].tokenType).toBe(Identifier);
    });

    it("should tokenize @input with order metadata", () => {
      const result = JSDocLexer.tokenize("@input myPort [order:1]");
      expect(result.errors).toHaveLength(0);
      const tokenTypes = result.tokens.map(t => t.tokenType.name);
      expect(tokenTypes).toContain("InputTag");
      expect(tokenTypes).toContain("LBracket");
      expect(tokenTypes).toContain("OrderPrefix");
      expect(tokenTypes).toContain("Integer");
      expect(tokenTypes).toContain("RBracket");
    });

    it("should tokenize @input with placement", () => {
      const result = JSDocLexer.tokenize("@input myPort [placement:TOP]");
      expect(result.errors).toHaveLength(0);
      const tokenTypes = result.tokens.map(t => t.tokenType.name);
      expect(tokenTypes).toContain("PlacementPrefix");
      expect(tokenTypes).toContain("TopKeyword");
    });

    it("should tokenize @input with description", () => {
      const result = JSDocLexer.tokenize("@input myPort - This is a description");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[0].tokenType).toBe(InputTag);
      expect(result.tokens[1].tokenType).toBe(Identifier);
      expect(result.tokens[2].tokenType).toBe(Dash);
    });
  });

  describe("@node tokenization", () => {
    it("should tokenize simple @node", () => {
      const result = JSDocLexer.tokenize("@node adder1 adder");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[0].tokenType).toBe(NodeTag);
      expect(result.tokens[1].tokenType).toBe(Identifier);
      expect(result.tokens[2].tokenType).toBe(Identifier);
    });

    it("should tokenize @node with label", () => {
      const result = JSDocLexer.tokenize('@node adder1 adder [label: "My Adder"]');
      expect(result.errors).toHaveLength(0);
      const tokenTypes = result.tokens.map(t => t.tokenType.name);
      expect(tokenTypes).toContain("NodeTag");
      expect(tokenTypes).toContain("LabelPrefix");
      expect(tokenTypes).toContain("StringLiteral");
    });

    it("should tokenize @node with expr attribute", () => {
      const result = JSDocLexer.tokenize('@node myNode type [expr: value="20"]');
      expect(result.errors).toHaveLength(0);
      const tokenTypes = result.tokens.map(t => t.tokenType.name);
      expect(tokenTypes).toContain("ExprPrefix");
      expect(tokenTypes).toContain("Equals");
      expect(tokenTypes).toContain("StringLiteral");
    });
  });

  describe("@connect tokenization", () => {
    it("should tokenize simple @connect", () => {
      const result = JSDocLexer.tokenize("@connect Start.x -> adder.a");
      expect(result.errors).toHaveLength(0);
      const tokenTypes = result.tokens.map(t => t.tokenType.name);
      expect(tokenTypes).toContain("ConnectTag");
      expect(tokenTypes).toContain("Dot");
      expect(tokenTypes).toContain("Arrow");
    });

    it("should tokenize @connect with scope suffix", () => {
      const result = JSDocLexer.tokenize("@connect node.port:scope -> other.port:scope2");
      expect(result.errors).toHaveLength(0);
      const tokenTypes = result.tokens.map(t => t.tokenType.name);
      expect(tokenTypes).toContain("ConnectTag");
      expect(tokenTypes).toContain("Colon");
      expect(tokenTypes).toContain("Arrow");
    });
  });

  describe("@position tokenization", () => {
    it("should tokenize @position", () => {
      const result = JSDocLexer.tokenize("@position adder1 100 200");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[0].tokenType).toBe(PositionTag);
      expect(result.tokens[1].tokenType).toBe(Identifier);
      expect(result.tokens[2].tokenType).toBe(Integer);
      expect(result.tokens[3].tokenType).toBe(Integer);
    });

    it("should tokenize @position with negative coordinates", () => {
      const result = JSDocLexer.tokenize("@position node1 -50 -100");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[2].image).toBe("-50");
      expect(result.tokens[3].image).toBe("-100");
    });
  });

  describe("String literals", () => {
    it("should tokenize simple string", () => {
      const result = JSDocLexer.tokenize('"hello world"');
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[0].tokenType).toBe(StringLiteral);
      expect(result.tokens[0].image).toBe('"hello world"');
    });

    it("should tokenize string with escaped quotes", () => {
      const result = JSDocLexer.tokenize('"hello \\"world\\""');
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[0].tokenType).toBe(StringLiteral);
    });

    it("should tokenize string in expression", () => {
      const result = JSDocLexer.tokenize('value="test"');
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[0].tokenType).toBe(Identifier);
      expect(result.tokens[1].tokenType).toBe(Equals);
      expect(result.tokens[2].tokenType).toBe(StringLiteral);
    });
  });
});
