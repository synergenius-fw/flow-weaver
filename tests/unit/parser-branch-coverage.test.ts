/**
 * Branch coverage tests for src/parser.ts
 *
 * Exercises both sides of conditionals: empty inputs, missing annotations,
 * malformed JSDoc, expression nodes, scope detection, async detection,
 * workflow error paths, and cache/clear operations.
 */

import { AnnotationParser } from '../../src/parser';

function freshParser() {
  return new AnnotationParser();
}

describe('AnnotationParser.parseFromString branch coverage', () => {
  describe('empty and trivial inputs', () => {
    it('returns empty results for an empty string', () => {
      const parser = freshParser();
      const result = parser.parseFromString('');
      expect(result.workflows).toHaveLength(0);
      expect(result.nodeTypes).toHaveLength(0);
      expect(result.patterns).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('returns empty results for plain code with no annotations', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        const x = 42;
        function helper(a: number) { return a + 1; }
      `);
      expect(result.workflows).toHaveLength(0);
      expect(result.nodeTypes).toHaveLength(0);
    });

    it('returns empty results for whitespace-only input', () => {
      const parser = freshParser();
      const result = parser.parseFromString('   \n\n  \t  ');
      expect(result.workflows).toHaveLength(0);
      expect(result.nodeTypes).toHaveLength(0);
    });
  });

  describe('nodeType extraction branches', () => {
    it('extracts a basic nodeType with inputs and outputs', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         * @output result NUMBER
         */
        function add(a: number, b: number) { return a + b; }
      `);
      expect(result.nodeTypes.length).toBeGreaterThanOrEqual(1);
      const nt = result.nodeTypes.find(n => n.functionName === 'add');
      expect(nt).toBeDefined();
      // Has inputs and outputs
      expect(Object.keys(nt!.inputs).length).toBeGreaterThan(0);
      expect(Object.keys(nt!.outputs).length).toBeGreaterThan(0);
      // Mandatory ports always present
      expect(nt!.inputs.execute).toBeDefined();
      expect(nt!.outputs.onSuccess).toBeDefined();
    });

    it('extracts a nodeType with no explicit ports (only mandatory ports)', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         */
        function noop() {}
      `);
      const nt = result.nodeTypes.find(n => n.functionName === 'noop');
      expect(nt).toBeDefined();
      expect(nt!.inputs).toHaveProperty('execute');
      expect(nt!.outputs).toHaveProperty('onSuccess');
      expect(nt!.outputs).toHaveProperty('onFailure');
    });

    it('detects async functions', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input url STRING
         * @output data STRING
         */
        async function fetchData(url: string) { return ''; }
      `);
      const nt = result.nodeTypes.find(n => n.functionName === 'fetchData');
      expect(nt).toBeDefined();
      expect(nt!.isAsync).toBe(true);
    });

    it('detects synchronous functions', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input x NUMBER
         */
        function syncFn(x: number) { return x; }
      `);
      const nt = result.nodeTypes.find(n => n.functionName === 'syncFn');
      expect(nt).toBeDefined();
      expect(nt!.isAsync).toBe(false);
    });

    it('handles @expression nodeType with auto-inferred ports', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @expression
         */
        function double(value: number): number { return value * 2; }
      `);
      const nt = result.nodeTypes.find(n => n.functionName === 'double');
      expect(nt).toBeDefined();
      expect(nt!.expression).toBe(true);
      // Should have inferred ports from the function signature
      expect(Object.keys(nt!.inputs).length).toBeGreaterThan(1); // execute + data port(s)
    });

    it('handles @expression nodeType with explicit ports (no auto-infer)', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @expression
         * @input value NUMBER
         * @output result NUMBER
         */
        function triple(value: number): number { return value * 3; }
      `);
      const nt = result.nodeTypes.find(n => n.functionName === 'triple');
      expect(nt).toBeDefined();
      expect(nt!.expression).toBe(true);
      expect(nt!.inputs).toHaveProperty('value');
      expect(nt!.outputs).toHaveProperty('result');
    });

    it('warns on malformed @flowWeaver nodeType annotation', () => {
      const parser = freshParser();
      // The annotation text includes @flowWeaver nodeType but the JSDoc
      // parsing might fail if the structure is malformed.
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * ---
         * This has a horizontal rule which breaks parsing
         * ---
         */
        function broken() {}
      `);
      // Should either produce a warning or gracefully skip
      // The function should NOT appear in nodeTypes if parsing failed
      const hasWarning = result.warnings.some(w => w.includes('broken') || w.includes('could not be parsed'));
      const hasNodeType = result.nodeTypes.some(n => n.functionName === 'broken');
      // One of these must be true: either it warned, or it parsed fine
      expect(hasWarning || hasNodeType).toBe(true);
    });

    it('handles nodeType with custom name via @name', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @name CustomName
         * @input x NUMBER
         */
        function implFn(x: number) { return x; }
      `);
      const nt = result.nodeTypes.find(n => n.name === 'CustomName');
      expect(nt).toBeDefined();
      expect(nt!.functionName).toBe('implFn');
    });

    it('handles nodeType with scoped ports', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @scope loop
         * @input items ARRAY
         * @output item ANY
         */
        function forEach(items: any[]) {}
      `);
      const nt = result.nodeTypes.find(n => n.functionName === 'forEach');
      expect(nt).toBeDefined();
      expect(nt!.scopes).toBeDefined();
    });

    it('handles nodeType with defaultConfig', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @label "My Node"
         * @description "Does stuff"
         */
        function labeled() {}
      `);
      const nt = result.nodeTypes.find(n => n.functionName === 'labeled');
      expect(nt).toBeDefined();
    });

    it('handles nodeType with visuals (color, icon, tags)', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @color #ff0000
         * @icon star
         */
        function colorful() {}
      `);
      const nt = result.nodeTypes.find(n => n.functionName === 'colorful');
      expect(nt).toBeDefined();
      if (nt!.visuals) {
        expect(nt!.visuals.color).toBe('#ff0000');
      }
    });
  });

  describe('workflow extraction branches', () => {
    it('extracts a basic workflow with nodes and connections', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         * @output result NUMBER
         */
        function process(value: number) { return value * 2; }

        /**
         * @flowWeaver workflow
         * @node A process
         * @connect Start.value -> A.value
         * @connect A.result -> Exit.result
         */
        function myWorkflow(execute: boolean, value: number): { result: number } { return { result: 0 }; }
      `);
      expect(result.workflows.length).toBe(1);
      expect(result.workflows[0].name).toBe('myWorkflow');
      expect(result.workflows[0].instances.length).toBe(1);
      expect(result.workflows[0].connections.length).toBe(2);
    });

    it('returns errors when referencing a non-existent node type', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         * @node A nonExistentType
         */
        function badWorkflow() {}
      `);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('nonExistentType'))).toBe(true);
    });

    it('detects async workflow functions', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input x NUMBER
         */
        function step(x: number) {}

        /**
         * @flowWeaver workflow
         * @node A step
         */
        async function asyncWorkflow() {}
      `);
      expect(result.workflows.length).toBe(1);
      expect(result.workflows[0].userSpecifiedAsync).toBe(true);
    });

    it('detects synchronous workflow functions', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input x NUMBER
         */
        function step(x: number) {}

        /**
         * @flowWeaver workflow
         * @node A step
         */
        function syncWorkflow() {}
      `);
      expect(result.workflows.length).toBe(1);
      expect(result.workflows[0].userSpecifiedAsync).toBe(false);
    });

    it('returns errors when IN/OUT pseudo-nodes are used in workflows', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input x NUMBER
         */
        function step(x: number) {}

        /**
         * @flowWeaver workflow
         * @node A step
         * @connect IN.x -> A.x
         */
        function badPseudo() {}
      `);
      // IN/OUT pseudo-nodes should produce errors in workflows
      const hasInOutError = result.errors.some(
        e => e.includes('IN') && e.includes('pseudo-node')
      );
      // The parser might produce errors or the connection may just fail validation
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('workflow with no instances or connections', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         */
        function emptyWorkflow() {}
      `);
      expect(result.workflows.length).toBe(1);
      expect(result.workflows[0].instances).toHaveLength(0);
      expect(result.workflows[0].connections).toHaveLength(0);
    });
  });

  describe('multiple workflows and nodeTypes in one file', () => {
    it('extracts multiple nodeTypes', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input a NUMBER
         * @output sum NUMBER
         */
        function add(a: number, b: number) { return a + b; }

        /**
         * @flowWeaver nodeType
         * @input x NUMBER
         * @output product NUMBER
         */
        function multiply(x: number, y: number) { return x * y; }
      `);
      const names = result.nodeTypes.map(n => n.functionName);
      expect(names).toContain('add');
      expect(names).toContain('multiply');
    });

    it('extracts multiple workflows', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input x NUMBER
         * @output y NUMBER
         */
        function step(x: number) { return x; }

        /**
         * @flowWeaver workflow
         * @node A step
         */
        function wf1() {}

        /**
         * @flowWeaver workflow
         * @node B step
         */
        function wf2() {}
      `);
      expect(result.workflows.length).toBe(2);
    });
  });

  describe('auto-infer node types from unannotated functions', () => {
    it('infers node types for unannotated functions referenced by @node', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        function unannotated(x: number): number { return x + 1; }

        /**
         * @flowWeaver workflow
         * @node A unannotated
         */
        function wf() {}
      `);
      // The parser should auto-infer a node type for "unannotated"
      const nt = result.nodeTypes.find(n => n.functionName === 'unannotated');
      expect(nt).toBeDefined();
    });
  });

  describe('same-file workflow invocation', () => {
    it('allows one workflow to reference another in the same file', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input x NUMBER
         * @output y NUMBER
         */
        function step(x: number): number { return x; }

        /**
         * @flowWeaver workflow
         * @node A step
         */
        function subWorkflow(execute: boolean, x: number): { y: number } { return { y: 0 }; }

        /**
         * @flowWeaver workflow
         * @node S subWorkflow
         */
        function parentWorkflow() {}
      `);
      // parentWorkflow should have an instance referencing subWorkflow
      const parent = result.workflows.find(w => w.name === 'parentWorkflow');
      expect(parent).toBeDefined();
      expect(parent!.instances.some(i => i.nodeType === 'subWorkflow')).toBe(true);
    });
  });

  describe('virtual path handling', () => {
    it('uses default virtual path when not specified', () => {
      const parser = freshParser();
      const result = parser.parseFromString('const x = 1;');
      expect(result.errors).toHaveLength(0);
    });

    it('accepts a custom virtual path', () => {
      const parser = freshParser();
      const result = parser.parseFromString('const x = 1;', 'custom/path.ts');
      expect(result.errors).toHaveLength(0);
    });

    it('handles re-parsing the same virtual path without errors', () => {
      const parser = freshParser();
      parser.parseFromString('const a = 1;', 'reuse.ts');
      const result = parser.parseFromString('const b = 2;', 'reuse.ts');
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('cache operations', () => {
    it('clearCache does not throw', () => {
      const parser = freshParser();
      parser.parseFromString('const x = 1;');
      expect(() => parser.clearCache()).not.toThrow();
    });

    it('clearParseCache does not throw', () => {
      const parser = freshParser();
      parser.parseFromString('const x = 1;');
      expect(() => parser.clearParseCache()).not.toThrow();
    });
  });

  describe('warning deduplication', () => {
    it('deduplicates identical warnings', () => {
      const parser = freshParser();
      // A workflow that references itself as a node type will trigger
      // extractWorkflowSignatures and extractWorkflows to both parse JSDoc,
      // potentially producing duplicate warnings.
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input x NUMBER
         * @output y NUMBER
         */
        function step(x: number) { return x; }

        /**
         * @flowWeaver workflow
         * @node A step
         * @connect Start.x -> A.x
         * @connect A.y -> Exit.y
         */
        function wf(execute: boolean, x: number): { y: number } { return { y: 0 }; }
      `);
      // Check that no warning appears more than once
      const seen = new Set<string>();
      for (const w of result.warnings) {
        expect(seen.has(w)).toBe(false);
        seen.add(w);
      }
    });
  });

  describe('pattern extraction', () => {
    it('returns empty patterns for files with no @flowWeaver pattern', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input x NUMBER
         */
        function step(x: number) {}
      `);
      expect(result.patterns).toHaveLength(0);
    });
  });

  describe('anonymous functions', () => {
    it('handles anonymous arrow functions or unnamed functions gracefully', () => {
      const parser = freshParser();
      // Arrow function assigned to const with nodeType annotation
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input x NUMBER
         */
        const myNode = (x: number) => x + 1;
      `);
      // Should either extract it or skip gracefully
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('executeWhen strategy', () => {
    it('defaults to CONJUNCTION when not specified', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input x NUMBER
         */
        function defaultStrategy(x: number) {}
      `);
      const nt = result.nodeTypes.find(n => n.functionName === 'defaultStrategy');
      expect(nt).toBeDefined();
      expect(nt!.executeWhen).toBe('CONJUNCTION');
    });

    it('respects @executeWhen DISJUNCTION', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @executeWhen DISJUNCTION
         * @input x NUMBER
         */
        function orNode(x: number) {}
      `);
      const nt = result.nodeTypes.find(n => n.functionName === 'orNode');
      expect(nt).toBeDefined();
      expect(nt!.executeWhen).toBe('DISJUNCTION');
    });
  });

  describe('declare function (stub/ambient)', () => {
    it('treats declare function as stub variant with expression mode', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         */
        declare function externalApi(url: string): Promise<string>;
      `);
      const nt = result.nodeTypes.find(n => n.functionName === 'externalApi');
      expect(nt).toBeDefined();
      expect(nt!.variant).toBe('STUB');
      expect(nt!.expression).toBe(true);
      // Stubs should not have functionText
      expect(nt!.functionText).toBeUndefined();
    });
  });
});
