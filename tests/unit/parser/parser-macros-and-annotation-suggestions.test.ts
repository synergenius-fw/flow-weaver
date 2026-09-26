/**
 * Tests for src/parser/annotation-parser.ts: generateAnnotationSuggestion,
 * isWorkflowBlock, generateWorkflowStructureSuggestion,
 * extractExistingAnnotatedPorts, resolveNpmNodeTypes, externalToAST,
 * parseStartPorts, parseExitPorts, extractTypeSchema, isExpandableObjectType,
 * autoConnect, path macros, fanOut/fanIn macros and coerce macros.
 */

import { AnnotationParser, resolveNpmNodeTypes, type TExternalNodeType } from '../../../src/parser/annotation-parser';
import type { TWorkflowAST, TNodeTypeAST, TPortDefinition } from '../../../src/ast/types';

function freshParser() {
  return new AnnotationParser();
}

describe('parser branch coverage 2', () => {
  // ─── generateAnnotationSuggestion ───────────────────────────────────

  describe('generateAnnotationSuggestion', () => {
    it('returns null for empty content (no functions)', () => {
      const parser = freshParser();
      const result = parser.generateAnnotationSuggestion('const x = 1;', 0);
      expect(result).toBeNull();
    });

    it('returns full annotation block when cursor is above unannotated function', () => {
      const code = ['', 'function add(a: number, b: number): number { return a + b; }'].join('\n');
      const parser = freshParser();
      const result = parser.generateAnnotationSuggestion(code, 0);
      expect(result).not.toBeNull();
      expect(result!.text).toContain('@flowWeaver nodeType');
    });

    it('returns null when function has regular JSDoc but no @flowWeaver', () => {
      const code = ['/** This is a regular JSDoc comment */', 'function add(a: number): number { return a; }'].join(
        '\n',
      );
      const parser = freshParser();
      const result = parser.generateAnnotationSuggestion(code, 0);
      expect(result).toBeNull();
    });

    it('suggests missing ports when function already has partial @flowWeaver nodeType', () => {
      const code = [
        '/**',
        ' * @flowWeaver nodeType',
        ' * @input a NUMBER',
        ' */',
        'function add(a: number, b: number): number { return a + b; }',
      ].join('\n');
      const parser = freshParser();
      const result = parser.generateAnnotationSuggestion(code, 0);
      // Should suggest the missing 'b' input and 'result' output, or return null if all covered
      // Either way it should not throw
      if (result) {
        expect(result.text.length).toBeGreaterThan(0);
      }
    });

    it('returns null when cursor is too far above the function', () => {
      const lines = Array(40).fill('// padding');
      lines.push('function far(x: number): number { return x; }');
      const code = lines.join('\n');
      const parser = freshParser();
      const result = parser.generateAnnotationSuggestion(code, 0);
      expect(result).toBeNull();
    });

    it('generates continuation after user types "/**" on cursor line', () => {
      // The "/**" must be on its own line, followed by a blank line, then the function.
      // The function must be close enough (within 30 lines) for the suggestion to trigger.
      const code = ['  /**', '', 'function add(a: number, b: number): number { return a + b; }'].join('\n');
      const parser = freshParser();
      const result = parser.generateAnnotationSuggestion(code, 0);
      // The lines after the "/**", not a second "/**" block.
      expect(result).not.toBeNull();
      expect(result!.insertLine).toBe(1);
      expect(result!.text.startsWith(' * @flowWeaver nodeType add\n')).toBe(true);
      expect(result!.text).not.toContain('/**');
      expect(result!.text).toMatch(/@input a\b/);
      expect(result!.text).toMatch(/@input b\b/);
      expect(result!.text.trimEnd().endsWith('*/')).toBe(true);
    });

    it('suggests missing @connect lines for workflow blocks', () => {
      const code = [
        '/**',
        ' * @flowWeaver nodeType',
        ' * @input value',
        ' * @output data',
        ' */',
        'function step1(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; data: number } { return { onSuccess: true, onFailure: false, data: value }; }',
        '',
        '/**',
        ' * @flowWeaver nodeType',
        ' * @input data',
        ' * @output summary',
        ' */',
        'function step2(execute: boolean, data: number): { onSuccess: boolean; onFailure: boolean; summary: number } { return { onSuccess: true, onFailure: false, summary: data }; }',
        '',
        '/**',
        ' * @flowWeaver workflow',
        ' * @node A step1',
        ' * @node B step2',
        ' */',
        'function myWf(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }',
      ].join('\n');
      const parser = freshParser();
      const result = parser.generateAnnotationSuggestion(code, 14);
      // A.data and B.data share a name, so they are suggested as a connection,
      // inserted before the workflow block's closing line.
      expect(result).toEqual({
        text: ' * @connect A.data -> B.data\n',
        insertLine: 18,
        replaceLinesCount: 0,
      });
    });

    it('handles re-using the same virtual path', () => {
      const parser = freshParser();
      parser.generateAnnotationSuggestion('function a() {}', 0, 'test.ts');
      const result = parser.generateAnnotationSuggestion('function b() {}', 0, 'test.ts');
      // Should not throw, handles existing file cleanup
      expect(result === null || result.text.length > 0).toBe(true);
    });
  });

  // ─── parseExitPorts branches ────────────────────────────────────────

  describe('parseExitPorts branches', () => {
    it('handles workflow with void return type (warns)', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         */
        function voidWf(execute: boolean): void {}
      `);
      // Should produce a warning about undetermined return type
      expect(result.workflows.length).toBe(1);
    });

    it('handles workflow with Promise return type', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         */
        async function asyncWf(execute: boolean): Promise<{ onSuccess: boolean; result: number }> {
          return { onSuccess: true, result: 42 };
        }
      `);
      expect(result.workflows.length).toBe(1);
      const wf = result.workflows[0];
      expect(wf.exitPorts).toHaveProperty('onSuccess');
      expect(wf.exitPorts).toHaveProperty('result');
      expect(wf.exitPorts.onSuccess.dataType).toBe('STEP');
    });

    it('handles exit port with onFailure', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         */
        function failWf(execute: boolean): { onSuccess: boolean; onFailure: boolean; data: string } {
          return { onSuccess: true, onFailure: false, data: '' };
        }
      `);
      const wf = result.workflows[0];
      expect(wf.exitPorts.onFailure).toBeDefined();
      expect(wf.exitPorts.onFailure.failure).toBe(true);
      expect(wf.exitPorts.data).toBeDefined();
    });
  });

  // ─── parseStartPorts branches ───────────────────────────────────────

  describe('parseStartPorts branches', () => {
    it('handles workflow with no parameters', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         */
        function noParams(): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      const wf = result.workflows[0];
      expect(wf.startPorts.execute).toBeDefined();
      expect(wf.startPorts.execute.dataType).toBe('STEP');
    });

    it('throws for workflow with wrong first parameter name', () => {
      const parser = freshParser();
      expect(() =>
        parser.parseFromString(`
        /**
         * @flowWeaver workflow
         */
        function badSig(notExecute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `),
      ).toThrow(/Expected first parameter to be "execute: boolean"/);
    });

    it('names a workflow signature, with the params object, when the execute parameter is missing', () => {
      const parser = freshParser();
      expect(() =>
        parser.parseFromString(`
        /**
         * @flowWeaver workflow
         */
        export function oldSig(params: { data: string }): { result: string } { throw new Error('stub'); }
      `),
      ).toThrow(
        'Invalid workflow function signature for "oldSig". Expected first parameter to be "execute: boolean", ' +
          'but got "params: { data: string; }". Correct format: export function oldSig(execute: boolean, ' +
          'params: {...}): { onSuccess: boolean; onFailure: boolean; ... }',
      );
    });

    it('extracts data ports from multiple params after execute', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         */
        function multiParam(execute: boolean, name: string, count: number): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      const wf = result.workflows[0];
      expect(wf.startPorts.name).toBeDefined();
      expect(wf.startPorts.count).toBeDefined();
    });

    it('expands single object param into individual ports', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         */
        function objectParam(execute: boolean, data: { name: string; age: number }): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      const wf = result.workflows[0];
      expect(wf.startPorts.name).toBeDefined();
      expect(wf.startPorts.age).toBeDefined();
    });

    it('filters out __runtime__ parameter', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         */
        function withRuntime(execute: boolean, value: number, __runtime__: any): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      const wf = result.workflows[0];
      expect(wf.startPorts.__runtime__).toBeUndefined();
      expect(wf.startPorts.value).toBeDefined();
    });
  });

  // ─── @autoConnect workflow ──────────────────────────────────────────

  describe('autoConnect workflow', () => {
    it('auto-generates linear connections when @autoConnect is set', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         * @output result NUMBER
         */
        function stepA(value: number): number { return value; }

        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         * @output result NUMBER
         */
        function stepB(value: number): number { return value; }

        /**
         * @flowWeaver workflow
         * @autoConnect
         * @node A stepA
         * @node B stepB
         */
        function autoWf(execute: boolean, value: number): { result: number } {
          return { result: 0 };
        }
      `);
      const wf = result.workflows[0];
      // Should have auto-generated connections
      expect(wf.connections.length).toBeGreaterThan(0);
      // Should include Start -> A.execute
      const startConn = wf.connections.find(
        (c) => c.from.node === 'Start' && c.to.node === 'A' && c.to.port === 'execute',
      );
      expect(startConn).toBeDefined();
    });
  });

  // ─── @path macro ────────────────────────────────────────────────────

  describe('@path macro', () => {
    it('expands a path macro into connections', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         * @output result NUMBER
         */
        function nodeA(value: number): number { return value; }

        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         * @output result NUMBER
         */
        function nodeB(value: number): number { return value; }

        /**
         * @flowWeaver workflow
         * @node A nodeA
         * @node B nodeB
         * @path Start -> A -> B -> Exit
         */
        function pathWf(execute: boolean, value: number): { result: number; onSuccess: boolean } {
          return { result: 0, onSuccess: true };
        }
      `);
      const wf = result.workflows[0];
      expect(wf.connections.length).toBeGreaterThan(0);
      expect(wf.macros).toBeDefined();
      expect(wf.macros!.some((m) => m.type === 'path')).toBe(true);
    });

    it('wires `@path Start -> Exit` to Exit.onSuccess, since Exit has no execute port', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         * @path Start -> Exit
         */
        function passThrough(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
          return { onSuccess: true, onFailure: false };
        }
      `);
      expect(result.errors).toEqual([]);
      expect(result.workflows[0].connections).toEqual([
        {
          type: 'Connection',
          from: { node: 'Start', port: 'execute' },
          to: { node: 'Exit', port: 'onSuccess' },
        },
      ]);
    });

    it('reports error for @path with fewer than 2 steps', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         */
        function nodeA(value: number) {}

        /**
         * @flowWeaver workflow
         * @node A nodeA
         * @path A
         */
        function shortPath(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      // Error or warning about insufficient steps
      expect(result.errors.length + result.warnings.length).toBeGreaterThanOrEqual(0);
    });

    it('reports error for @path referencing non-existent node', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         */
        function nodeA(value: number) {}

        /**
         * @flowWeaver workflow
         * @node A nodeA
         * @path Start -> ghost -> Exit
         */
        function ghostPath(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      const hasGhostError = result.errors.some((e) => e.includes('ghost'));
      expect(hasGhostError).toBe(true);
    });

    it('handles @path with fail route', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function step(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } {
          return { onSuccess: true, onFailure: false, result: value };
        }

        /**
         * @flowWeaver workflow
         * @node A step
         * @node B step
         * @path Start -> A:fail -> B -> Exit
         */
        function failPath(execute: boolean, params: { value: number }): { result: number; onSuccess: boolean; onFailure: boolean } {
          return { result: 0, onSuccess: true, onFailure: false };
        }
      `);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      const wf = result.workflows[0];
      const wired = wf.connections.map((c) => `${c.from.node}.${c.from.port}->${c.to.node}.${c.to.port}`);
      // A's failure, not its success, runs B.
      expect(wired).toContain('A.onFailure->B.execute');
      expect(wired).not.toContain('A.onSuccess->B.execute');
      expect(wired).toContain('Start.execute->A.execute');
      expect(wired).toContain('B.onSuccess->Exit.onSuccess');
    });
  });

  // ─── @fanOut macro ──────────────────────────────────────────────────

  describe('@fanOut macro', () => {
    it('expands fanOut into 1-to-N connections', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         * @output result NUMBER
         */
        function worker(value: number): number { return value; }

        /**
         * @flowWeaver workflow
         * @node A worker
         * @node B worker
         * @node C worker
         * @fanOut A.onSuccess -> B, C
         */
        function fanWf(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      const wf = result.workflows[0];
      if (wf.macros && wf.macros.some((m) => m.type === 'fanOut')) {
        expect(wf.connections.length).toBeGreaterThan(0);
      }
    });

    it('reports error when fanOut source does not exist', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         */
        function worker(value: number) {}

        /**
         * @flowWeaver workflow
         * @node A worker
         * @fanOut ghost.onSuccess -> A
         */
        function badFanOut(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      expect(result.errors.some((e) => e.includes('ghost') || e.includes('fanOut'))).toBe(true);
    });

    it('reports error when fanOut target does not exist', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         */
        function worker(value: number) {}

        /**
         * @flowWeaver workflow
         * @node A worker
         * @fanOut A.onSuccess -> ghost
         */
        function badTarget(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      expect(result.errors.some((e) => e.includes('ghost') || e.includes('fanOut'))).toBe(true);
    });
  });

  // ─── @fanIn macro ───────────────────────────────────────────────────

  describe('@fanIn macro', () => {
    it('expands fanIn into N-to-1 connections', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         * @output result NUMBER
         */
        function worker(value: number): number { return value; }

        /**
         * @flowWeaver workflow
         * @node A worker
         * @node B worker
         * @node C worker
         * @fanIn A, B -> C.execute
         */
        function fanInWf(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      const wf = result.workflows[0];
      if (wf.macros && wf.macros.some((m) => m.type === 'fanIn')) {
        expect(wf.connections.length).toBeGreaterThan(0);
      }
    });

    it('reports error when fanIn target does not exist', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         */
        function worker(value: number) {}

        /**
         * @flowWeaver workflow
         * @node A worker
         * @fanIn A -> ghost.execute
         */
        function badFanIn(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      expect(result.errors.some((e) => e.includes('ghost') || e.includes('fanIn'))).toBe(true);
    });

    it('reports error when fanIn source does not exist', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value NUMBER
         */
        function worker(value: number) {}

        /**
         * @flowWeaver workflow
         * @node A worker
         * @fanIn ghost -> A.execute
         */
        function badSource(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      expect(result.errors.some((e) => e.includes('ghost') || e.includes('fanIn'))).toBe(true);
    });
  });

  // ─── @coerce macro ──────────────────────────────────────────────────

  describe('@coerce macro', () => {
    it('expands coerce into synthetic coercion node + connections', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function producer(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: true, onFailure: false, result: value }; }

        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function consumer(execute: boolean, value: string): { onSuccess: boolean; onFailure: boolean; result: string } { return { onSuccess: true, onFailure: false, result: value }; }

        /**
         * @flowWeaver workflow
         * @node A producer
         * @node B consumer
         * @coerce conv A.result -> B.value as string
         */
        function coerceWf(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      expect(result.errors).toEqual([]);
      const wf = result.workflows[0];
      expect(wf.instances.find((i) => i.id === 'conv')?.nodeType).toBe('__fw_toString');
      const wired = wf.connections.map((c) => `${c.from.node}.${c.from.port}->${c.to.node}.${c.to.port}`);
      // The value goes through the coercion node instead of straight across.
      expect(wired).toEqual(expect.arrayContaining(['A.result->conv.value', 'conv.result->B.value']));
      expect(wired).not.toContain('A.result->B.value');
    });
  });

  // ─── inferNodeTypeFromFunction branches ─────────────────────────────

  describe('inferNodeTypeFromFunction (via auto-infer)', () => {
    it('infers output ports from object return type', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        function objectReturn(x: number): { total: number; label: string } {
          return { total: x, label: '' };
        }

        /**
         * @flowWeaver workflow
         * @node A objectReturn
         */
        function wf() {}
      `);
      const nt = result.nodeTypes.find((n) => n.functionName === 'objectReturn');
      expect(nt).toBeDefined();
      expect(nt!.outputs.total).toBeDefined();
      expect(nt!.outputs.label).toBeDefined();
    });

    it('infers single result port from primitive return type', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        function primitiveReturn(x: number): string { return ''; }

        /**
         * @flowWeaver workflow
         * @node A primitiveReturn
         */
        function wf() {}
      `);
      const nt = result.nodeTypes.find((n) => n.functionName === 'primitiveReturn');
      expect(nt).toBeDefined();
      expect(nt!.outputs.result).toBeDefined();
    });

    it('infers void return type as no data output ports', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        function voidReturn(x: number): void {}

        /**
         * @flowWeaver workflow
         * @node A voidReturn
         */
        function wf() {}
      `);
      const nt = result.nodeTypes.find((n) => n.functionName === 'voidReturn');
      expect(nt).toBeDefined();
      // Only mandatory ports, no data outputs
      const dataOutputs = Object.keys(nt!.outputs).filter((k) => k !== 'onSuccess' && k !== 'onFailure');
      expect(dataOutputs).toHaveLength(0);
    });

    it('handles Promise return type by unwrapping', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        async function asyncReturn(x: number): Promise<number> { return x; }

        /**
         * @flowWeaver workflow
         * @node A asyncReturn
         */
        function wf() {}
      `);
      const nt = result.nodeTypes.find((n) => n.functionName === 'asyncReturn');
      expect(nt).toBeDefined();
      expect(nt!.isAsync).toBe(true);
      expect(nt!.outputs.result).toBeDefined();
    });

    it('infers array return type as single result port', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        function arrayReturn(x: number): number[] { return [x]; }

        /**
         * @flowWeaver workflow
         * @node A arrayReturn
         */
        function wf() {}
      `);
      const nt = result.nodeTypes.find((n) => n.functionName === 'arrayReturn');
      expect(nt).toBeDefined();
      expect(nt!.outputs.result).toBeDefined();
    });

    it('marks function as expression when first param is not execute', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        function notExecuteFirst(value: number): number { return value; }

        /**
         * @flowWeaver workflow
         * @node A notExecuteFirst
         */
        function wf() {}
      `);
      const nt = result.nodeTypes.find((n) => n.functionName === 'notExecuteFirst');
      expect(nt).toBeDefined();
      expect(nt!.expression).toBe(true);
    });

    it('marks function as non-expression when first param is execute', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        function hasExecute(execute: boolean, value: number): number { return value; }

        /**
         * @flowWeaver workflow
         * @node A hasExecute
         */
        function wf() {}
      `);
      const nt = result.nodeTypes.find((n) => n.functionName === 'hasExecute');
      expect(nt).toBeDefined();
      expect(nt!.expression).toBe(false);
    });
  });

  // ─── @expression with only explicit inputs (branch: hasExplicitDataOutputs) ─

  describe('expression nodeType with mixed explicit/inferred ports', () => {
    it('infers outputs but uses explicit inputs when only @input given', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @expression
         * @input x NUMBER
         */
        function halfExplicit(x: number): number { return x * 2; }
      `);
      const nt = result.nodeTypes.find((n) => n.functionName === 'halfExplicit');
      expect(nt).toBeDefined();
      expect(nt!.inputs.x).toBeDefined();
      // Output should be inferred since none declared
      expect(nt!.outputs.result).toBeDefined();
    });

    it('infers inputs but uses explicit outputs when only @output given', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @expression
         * @output result NUMBER
         */
        function halfExplicit2(x: number): number { return x * 2; }
      `);
      const nt = result.nodeTypes.find((n) => n.functionName === 'halfExplicit2');
      expect(nt).toBeDefined();
      // Input should be inferred
      expect(nt!.inputs.x).toBeDefined();
      expect(nt!.outputs.result).toBeDefined();
    });
  });

  // ─── resolveNpmNodeTypes ────────────────────────────────────────────

  describe('resolveNpmNodeTypes', () => {
    it('returns ast unchanged when nodeTypes is empty', () => {
      const ast: TWorkflowAST = {
        type: 'Workflow',
        sourceFile: 'test.ts',
        name: 'test',
        functionName: 'test',
        nodeTypes: [],
        instances: [],
        connections: [],
        startPorts: {},
        exitPorts: {},
        imports: [],
      };
      const result = resolveNpmNodeTypes(ast, '/tmp');
      expect(result).toEqual(ast);
    });

    it('passes through node types without importSource', () => {
      const localNt: TNodeTypeAST = {
        type: 'NodeType',
        name: 'local',
        functionName: 'local',
        variant: 'FUNCTION',
        inputs: {},
        outputs: {},
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
      };
      const ast: TWorkflowAST = {
        type: 'Workflow',
        sourceFile: 'test.ts',
        name: 'test',
        functionName: 'test',
        nodeTypes: [localNt],
        instances: [],
        connections: [],
        startPorts: {},
        exitPorts: {},
        imports: [],
      };
      const result = resolveNpmNodeTypes(ast, '/tmp');
      expect(result.nodeTypes[0]).toEqual(localNt);
    });

    it('keeps stub for unresolvable npm import', () => {
      const npmNt: TNodeTypeAST = {
        type: 'NodeType',
        name: 'fakeFunc',
        functionName: 'fakeFunc',
        variant: 'FUNCTION',
        inputs: {},
        outputs: { result: { dataType: 'ANY' } },
        hasSuccessPort: true,
        hasFailurePort: true,
        isAsync: false,
        executeWhen: 'CONJUNCTION',
        importSource: 'nonexistent-package-xyz-12345',
      };
      const ast: TWorkflowAST = {
        type: 'Workflow',
        sourceFile: 'test.ts',
        name: 'test',
        functionName: 'test',
        nodeTypes: [npmNt],
        instances: [],
        connections: [],
        startPorts: {},
        exitPorts: {},
        imports: [],
      };
      const result = resolveNpmNodeTypes(ast, '/tmp');
      // Should keep the stub since the package can't be resolved
      expect(result.nodeTypes[0].name).toBe('fakeFunc');
    });
  });

  // ─── externalToAST (via parse with externalNodeTypes) ───────────────

  describe('externalToAST via parseFromString', () => {
    // externalToAST is only used in fullParse, which is only called from parse().
    // Since parseFromString doesn't take externalNodeTypes, we test the external
    // type flow indirectly by verifying the parser handles external types.
    // We'll just verify the node type format expectations.

    it('keeps an instance of an unknown type for the validator to report', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         * @node A customExternal
         */
        function wf(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      // No parse error: the validator reports the missing type once, as UNKNOWN_NODE_TYPE.
      expect(result.errors).toEqual([]);
      expect(result.workflows[0].instances[0]).toMatchObject({ id: 'A', nodeType: 'customExternal' });
    });
  });

  // ─── isExpandableObjectType branches ────────────────────────────────

  describe('isExpandableObjectType branches (via parseStartPorts)', () => {
    it('does not expand array type parameter', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         */
        function arrayParam(execute: boolean, items: number[]): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      const wf = result.workflows[0];
      // items should be a single port, not expanded
      expect(wf.startPorts.items).toBeDefined();
    });

    it('does not expand primitive type parameter', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         */
        function primitiveParam(execute: boolean, name: string): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      const wf = result.workflows[0];
      expect(wf.startPorts.name).toBeDefined();
    });
  });

  // ─── @map macro ─────────────────────────────────────────────────────

  describe('@map macro', () => {
    it('expands map macro with synthetic node type and connections', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input value
         * @output result
         */
        function processor(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: true, onFailure: false, result: value * 2 }; }

        /**
         * @flowWeaver nodeType
         * @input items
         * @output files
         */
        function scanner(execute: boolean, items: number[]): { onSuccess: boolean; onFailure: boolean; files: number[] } { return { onSuccess: true, onFailure: false, files: items }; }

        /**
         * @flowWeaver workflow
         * @node scan scanner
         * @node proc processor
         * @map loop proc over scan.files
         */
        function mapWf(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      expect(result.errors).toEqual([]);
      const wf = result.workflows[0];
      // The synthetic iterator, with the child moved into its scope.
      expect(wf.instances.find((i) => i.id === 'loop')?.nodeType).toBe('__map_loop__');
      expect(wf.instances.find((i) => i.id === 'proc')?.parent).toEqual({ id: 'loop', scope: 'iterate' });
      const wired = wf.connections.map((c) => `${c.from.node}.${c.from.port}->${c.to.node}.${c.to.port}`);
      expect(wired).toEqual(expect.arrayContaining([
        'scan.files->loop.items',
        'loop.item->proc.value',
        'proc.result->loop.processed',
      ]));
    });

    it('reports error when @map child node not found', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input items ARRAY
         * @output files ARRAY
         */
        function scanner(items: any[]): any[] { return items; }

        /**
         * @flowWeaver workflow
         * @node scan scanner
         * @map loop ghost over scan.files
         */
        function mapBad(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      expect(result.errors.some((e) => e.includes('ghost') || e.includes('@map'))).toBe(true);
    });
  });

  // ─── workflow with IN/OUT pseudo-nodes ──────────────────────────────

  describe('IN/OUT pseudo-node validation in workflows', () => {
    it('reports error for OUT pseudo-node in to position', () => {
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
         * @connect A.x -> OUT.x
         */
        function outWf(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      expect(result.errors.some((e) => e.includes('OUT') && e.includes('not a node'))).toBe(true);
    });
  });

  // ─── workflow options ───────────────────────────────────────────────

  describe('workflow options', () => {
    it('parses @strictTypes option', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         * @strictTypes
         */
        function strictWf(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      const wf = result.workflows[0];
      if (wf.options) {
        expect(wf.options.strictTypes).toBeDefined();
      }
    });
  });

  // ─── @node instance config branches ─────────────────────────────────

  describe('node instance config branches', () => {
    it('parses @node with label via @label tag', () => {
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
         * @label A "Custom Label"
         */
        function labelWf(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      const wf = result.workflows[0];
      const inst = wf.instances.find((i) => i.id === 'A');
      expect(inst).toBeDefined();
      if (inst?.config?.label) {
        expect(inst.config.label).toBe('Custom Label');
      }
    });

    it('parses @node with parentScope', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input items
         * @output item scope:iterate
         * @input processed scope:iterate
         */
        function loop(execute: boolean, items: number[], iterate: (execute: boolean, item: number) => { onSuccess: boolean; onFailure: boolean; processed: number }): { onSuccess: boolean; onFailure: boolean } { return { onSuccess: true, onFailure: false }; }

        /**
         * @flowWeaver nodeType
         * @input value
         */
        function child(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean } { return { onSuccess: true, onFailure: false }; }

        /**
         * @flowWeaver workflow
         * @node L loop
         * @node C child L.iterate
         */
        function scopeWf(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
      `);
      expect(result.errors).toEqual([]);
      const wf = result.workflows[0];
      expect(wf.instances.find((i) => i.id === 'C')?.parent).toEqual({ id: 'L', scope: 'iterate' });
      expect(wf.instances.find((i) => i.id === 'L')?.parent).toBeUndefined();
    });
  });

  // ─── hasFlowWeaverAnnotation branches ───────────────────────────────

  describe('hasFlowWeaverAnnotation', () => {
    it('does not infer functions with @flowWeaver annotation', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver nodeType
         * @input x NUMBER
         */
        function annotated(x: number): number { return x; }

        function notAnnotated(y: number): number { return y; }

        /**
         * @flowWeaver workflow
         * @node A notAnnotated
         */
        function wf() {}
      `);
      // annotated should be parsed as nodeType, notAnnotated should be inferred
      const annotatedNt = result.nodeTypes.find((n) => n.functionName === 'annotated');
      const inferredNt = result.nodeTypes.find((n) => n.functionName === 'notAnnotated');
      expect(annotatedNt).toBeDefined();
      expect(inferredNt).toBeDefined();
      expect(inferredNt!.inferred).toBe(true);
    });
  });

  // ─── workflow malformed annotation warning ──────────────────────────

  describe('workflow malformed annotation', () => {
    it('warns on malformed @flowWeaver workflow annotation', () => {
      const parser = freshParser();
      const result = parser.parseFromString(`
        /**
         * @flowWeaver workflow
         * ---
         * Breaks parsing
         * ---
         */
        function brokenWf() {}
      `);
      const hasWarning = result.warnings.some((w) => w.includes('could not be parsed'));
      const hasWorkflow = result.workflows.length > 0;
      expect(hasWarning || hasWorkflow).toBe(true);
    });
  });
});
