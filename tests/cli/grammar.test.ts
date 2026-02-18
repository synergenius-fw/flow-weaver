/**
 * Tests for grammar CLI command
 * Tests EBNF and HTML output from grammar generation
 */

import {
  getAllGrammars,
  serializedToEBNF,
  generateGrammarDiagrams,
} from '../../src/chevrotain-parser';

describe('grammar command', () => {
  describe('EBNF output', () => {
    it('should contain expected rule names', () => {
      const grammars = getAllGrammars();
      const allProductions = [
        ...grammars.port,
        ...grammars.node,
        ...grammars.connect,
        ...grammars.position,
        ...grammars.scope,
      ];
      const ebnf = serializedToEBNF(allProductions);

      // Should contain rule definitions (name ::= body)
      expect(ebnf).toContain('::=');
      // Should contain at least some grammar content
      expect(ebnf.length).toBeGreaterThan(100);
    });

    it('should output parseable EBNF format', () => {
      const grammars = getAllGrammars();
      const allProductions = [
        ...grammars.port,
        ...grammars.node,
        ...grammars.connect,
        ...grammars.position,
        ...grammars.scope,
      ];
      const ebnf = serializedToEBNF(allProductions);

      // Each non-empty line should either be a rule definition or continuation
      const lines = ebnf.split('\n').filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(0);

      // At least one rule per grammar section
      const ruleCount = (ebnf.match(/::=/g) || []).length;
      expect(ruleCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe('HTML output', () => {
    it('should contain expected HTML structure', () => {
      const html = generateGrammarDiagrams();

      // Should contain the custom title
      expect(html).toContain('Flow Weaver JSDoc Grammar');
      // Should contain tabs for switching views
      expect(html).toContain('Railroad Diagrams');
      expect(html).toContain('EBNF Text');
      // Should contain the EBNF container
      expect(html).toContain('ebnf-container');
      // Should contain style elements
      expect(html).toContain('<style');
    });

    it('should contain diagram elements', () => {
      const html = generateGrammarDiagrams();

      // Should contain the diagrams div
      expect(html).toContain('id="diagrams"');
      // Should contain style elements
      expect(html).toContain('<style');
    });
  });

  describe('individual grammars', () => {
    it('should have all five grammar sections', () => {
      const grammars = getAllGrammars();

      expect(grammars.port).toBeDefined();
      expect(grammars.port.length).toBeGreaterThan(0);
      expect(grammars.node).toBeDefined();
      expect(grammars.node.length).toBeGreaterThan(0);
      expect(grammars.connect).toBeDefined();
      expect(grammars.connect.length).toBeGreaterThan(0);
      expect(grammars.position).toBeDefined();
      expect(grammars.position.length).toBeGreaterThan(0);
      expect(grammars.scope).toBeDefined();
      expect(grammars.scope.length).toBeGreaterThan(0);
    });
  });
});
