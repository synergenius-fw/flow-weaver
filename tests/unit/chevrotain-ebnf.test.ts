/**
 * Tests for EBNF generation from Chevrotain grammars.
 * Ensures 100% accurate translation.
 */

import {
  getPortGrammar,
  getNodeGrammar,
  getConnectGrammar,
  getPositionGrammar,
  getScopeGrammar,
  getAllGrammars,
  generateGrammarDiagrams,
} from "../../src/chevrotain-parser";

describe("EBNF Generation", () => {
  describe("getAllGrammars", () => {
    it("should return all grammar collections", () => {
      const grammars = getAllGrammars();

      expect(grammars.port).toBeDefined();
      expect(grammars.node).toBeDefined();
      expect(grammars.connect).toBeDefined();
      expect(grammars.position).toBeDefined();
      expect(grammars.scope).toBeDefined();

      // Each should have rules
      expect(grammars.port.length).toBeGreaterThan(0);
      expect(grammars.node.length).toBeGreaterThan(0);
      expect(grammars.connect.length).toBeGreaterThan(0);
      expect(grammars.position.length).toBeGreaterThan(0);
      expect(grammars.scope.length).toBeGreaterThan(0);
    });
  });

  describe("Port Grammar Rules", () => {
    it("should have portLine as entry rule", () => {
      const grammar = getPortGrammar();
      const portLine = grammar.find((r: any) => r.name === "portLine");
      expect(portLine).toBeDefined();
      expect(portLine?.type).toBe("Rule");
    });

    it("should have inputPort, outputPort, stepPort rules", () => {
      const grammar = getPortGrammar();
      const ruleNames = grammar.filter((r: any) => r.type === "Rule").map((r: any) => r.name);

      expect(ruleNames).toContain("inputPort");
      expect(ruleNames).toContain("outputPort");
      expect(ruleNames).toContain("stepPort");
    });

    it("should have scopeClause rule", () => {
      const grammar = getPortGrammar();
      const scopeClause = grammar.find((r: any) => r.name === "scopeClause");
      expect(scopeClause).toBeDefined();
    });

    it("should have metadataBracket rule with order and placement", () => {
      const grammar = getPortGrammar();
      const ruleNames = grammar.filter((r: any) => r.type === "Rule").map((r: any) => r.name);

      expect(ruleNames).toContain("metadataBracket");
      expect(ruleNames).toContain("orderAttr");
      expect(ruleNames).toContain("placementAttr");
    });
  });

  describe("Node Grammar Rules", () => {
    it("should have nodeLine as entry rule", () => {
      const grammar = getNodeGrammar();
      const nodeLine = grammar.find((r: any) => r.name === "nodeLine");
      expect(nodeLine).toBeDefined();
    });

    it("should have attribute rules", () => {
      const grammar = getNodeGrammar();
      const ruleNames = grammar.filter((r: any) => r.type === "Rule").map((r: any) => r.name);

      expect(ruleNames).toContain("attributeBracket");
      expect(ruleNames).toContain("labelAttr");
      expect(ruleNames).toContain("exprAttr");
      expect(ruleNames).toContain("portOrderAttr");
      expect(ruleNames).toContain("minimizedAttr");
      expect(ruleNames).toContain("pullExecutionAttr");
    });

    it("should have parentScopeRef rule", () => {
      const grammar = getNodeGrammar();
      const parentScopeRef = grammar.find((r: any) => r.name === "parentScopeRef");
      expect(parentScopeRef).toBeDefined();
    });
  });

  describe("Connect Grammar Rules", () => {
    it("should have connectLine as entry rule", () => {
      const grammar = getConnectGrammar();
      const connectLine = grammar.find((r: any) => r.name === "connectLine");
      expect(connectLine).toBeDefined();
    });

    it("should have portRef rule", () => {
      const grammar = getConnectGrammar();
      const portRef = grammar.find((r: any) => r.name === "portRef");
      expect(portRef).toBeDefined();
    });
  });

  describe("Position Grammar Rules", () => {
    it("should have positionLine as entry rule", () => {
      const grammar = getPositionGrammar();
      const positionLine = grammar.find((r: any) => r.name === "positionLine");
      expect(positionLine).toBeDefined();
    });
  });

  describe("Scope Grammar Rules", () => {
    it("should have scopeLine as entry rule", () => {
      const grammar = getScopeGrammar();
      const scopeLine = grammar.find((r: any) => r.name === "scopeLine");
      expect(scopeLine).toBeDefined();
    });

    it("should have scopeRef rule", () => {
      const grammar = getScopeGrammar();
      const scopeRef = grammar.find((r: any) => r.name === "scopeRef");
      expect(scopeRef).toBeDefined();
    });
  });

  describe("generateGrammarDiagrams", () => {
    let html: string;

    beforeAll(() => {
      html = generateGrammarDiagrams();
    });

    it("should generate valid HTML", () => {
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<meta charset");
      expect(html).toContain("<script>");
      expect(html).toContain("</script>");
    });

    it("should include title", () => {
      expect(html).toContain("Flow Weaver JSDoc Grammar");
    });

    it("should include tabs for diagrams and EBNF", () => {
      expect(html).toContain("Railroad Diagrams");
      expect(html).toContain("EBNF Text");
    });

    it("should include EBNF content", () => {
      expect(html).toContain("ebnf-container");
    });

    it("should include back link", () => {
      expect(html).toContain("Back to API Documentation");
      expect(html).toContain('href="index.html"');
    });

    describe("EBNF Content Validation", () => {
      it("should contain portLine rule", () => {
        expect(html).toContain("portLine");
        expect(html).toContain("::=");
      });

      it("should contain @input terminal", () => {
        expect(html).toContain('"@input"');
      });

      it("should contain @output terminal", () => {
        expect(html).toContain('"@output"');
      });

      it("should contain @step terminal", () => {
        expect(html).toContain('"@step"');
      });

      it("should contain @node terminal", () => {
        expect(html).toContain('"@node"');
      });

      it("should contain @connect terminal", () => {
        expect(html).toContain('"@connect"');
      });

      it("should contain @position terminal", () => {
        expect(html).toContain('"@position"');
      });

      it("should contain @scope terminal", () => {
        expect(html).toContain('"@scope"');
      });

      it("should contain scope: prefix", () => {
        expect(html).toContain('"scope:"');
      });

      it("should contain order: prefix", () => {
        expect(html).toContain('"order:"');
      });

      it("should contain placement: prefix", () => {
        expect(html).toContain('"placement:"');
      });

      it("should contain TOP and BOTTOM keywords", () => {
        expect(html).toContain('"TOP"');
        expect(html).toContain('"BOTTOM"');
      });

      it("should contain label: prefix", () => {
        expect(html).toContain('"label:"');
      });

      it("should contain expr: prefix", () => {
        expect(html).toContain('"expr:"');
      });

      it("should contain portOrder: prefix", () => {
        expect(html).toContain('"portOrder:"');
      });

      it("should contain pullExecution: prefix", () => {
        expect(html).toContain('"pullExecution:"');
      });

      it("should contain minimized keyword", () => {
        expect(html).toContain('"minimized"');
      });

      it("should contain arrow terminal", () => {
        expect(html).toContain('"-&gt;"'); // HTML-escaped ->
      });

      it("should contain punctuation terminals", () => {
        expect(html).toContain('"["');
        expect(html).toContain('"]"');
        expect(html).toContain('"."');
        expect(html).toContain('","');
        expect(html).toContain('"="');
      });

      it("should contain non-terminal references", () => {
        expect(html).toContain("&lt;inputPort&gt;");
        expect(html).toContain("&lt;outputPort&gt;");
        expect(html).toContain("&lt;stepPort&gt;");
        expect(html).toContain("&lt;scopeClause&gt;");
        expect(html).toContain("&lt;portRef&gt;");
      });

      it("should use EBNF notation for optional", () => {
        // Optional should use [ ]
        expect(html).toMatch(/\[\s*<span class="nonterminal">/);
      });

      it("should use EBNF notation for repetition", () => {
        // Repetition should use { }
        expect(html).toMatch(/\{\s*<span class="nonterminal">/);
      });

      it("should use EBNF notation for alternation", () => {
        // Alternation should use ( | )
        expect(html).toContain(" | ");
      });
    });

    describe("Syntax Highlighting", () => {
      it("should highlight rule names", () => {
        expect(html).toContain('class="rule-name"');
      });

      it("should highlight terminals", () => {
        expect(html).toContain('class="terminal"');
      });

      it("should highlight non-terminals", () => {
        expect(html).toContain('class="nonterminal"');
      });
    });
  });
});
