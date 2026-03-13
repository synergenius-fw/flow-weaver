/**
 * Branch coverage tests for src/jsdoc-parser.ts
 * Targets uncovered branches: error paths, empty inputs, malformed JSDoc,
 * optional parameters, early returns, ternaries, and fallback logic.
 */

import { jsdocParser, JSDocParser } from '../../src/jsdoc-parser';
import { extractFunctionLikes } from '../../src/function-like';
import { getSharedProject } from '../../src/shared-project';

const project = getSharedProject();

function parseNode(code: string) {
  const sf = project.createSourceFile(`_test_${Date.now()}_${Math.random()}.ts`, code, { overwrite: true });
  const funcs = extractFunctionLikes(sf);
  const warnings: string[] = [];
  const config = jsdocParser.parseNodeType(funcs[0], warnings);
  return { config, warnings, funcs };
}

function parseWorkflow(code: string, tagRegistry?: any) {
  const sf = project.createSourceFile(`_test_${Date.now()}_${Math.random()}.ts`, code, { overwrite: true });
  const funcs = extractFunctionLikes(sf);
  const warnings: string[] = [];
  const config = jsdocParser.parseWorkflow(funcs[0], warnings, tagRegistry);
  return { config, warnings, funcs };
}

function parsePattern(code: string) {
  const sf = project.createSourceFile(`_test_${Date.now()}_${Math.random()}.ts`, code, { overwrite: true });
  const funcs = extractFunctionLikes(sf);
  const warnings: string[] = [];
  const config = jsdocParser.parsePattern(funcs[0], warnings);
  return { config, warnings, funcs };
}

describe('JSDocParser branch coverage', () => {
  // ── parseNodeType ──────────────────────────────────────────────

  describe('parseNodeType', () => {
    it('returns null when function has no JSDoc', () => {
      const { config } = parseNode(`function bare() { return {}; }`);
      expect(config).toBeNull();
    });

    it('returns null when JSDoc has no @flowWeaver nodeType tag', () => {
      const { config } = parseNode(`
        /** just a comment */
        function bare() { return {}; }
      `);
      expect(config).toBeNull();
    });

    it('returns null when @flowWeaver comment is something other than nodeType/node', () => {
      const { config } = parseNode(`
        /** @flowWeaver workflow */
        function bare() { return {}; }
      `);
      expect(config).toBeNull();
    });

    it('handles @flowWeaver node shorthand (sets expression=true)', () => {
      const { config } = parseNode(`
        /** @flowWeaver node */
        function myNode(execute: boolean, x: number): { onSuccess: boolean; result: string } {
          return { onSuccess: true, result: 'ok' };
        }
      `);
      expect(config).not.toBeNull();
      expect(config!.expression).toBe(true);
    });

    it('parses @name tag', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @name MyCustomName
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.name).toBe('MyCustomName');
    });

    it('parses @label tag', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @label My Label
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.label).toBe('My Label');
    });

    it('parses @description tag (overrides JSDoc body)', () => {
      const { config } = parseNode(`
        /**
         * Body description here
         * @flowWeaver nodeType
         * @description Explicit description
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.description).toBe('Explicit description');
    });

    it('parses @color and @icon, stripping quotes', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @color "#ff0000"
         * @icon 'my-icon'
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.color).toBe('#ff0000');
      expect(config!.icon).toBe('my-icon');
    });

    it('parses @tag with and without tooltip', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @tag core "Core functionality"
         * @tag experimental
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.tags).toHaveLength(2);
      expect(config!.tags![0]).toEqual({ label: 'core', tooltip: 'Core functionality' });
      expect(config!.tags![1]).toEqual({ label: 'experimental' });
    });

    it('parses @executeWhen tag', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @executeWhen manual
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.executeWhen).toBe('manual');
    });

    it('parses @scope tag on nodeType', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @scope myScope
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.scope).toBe('myScope');
    });

    it('parses @expression tag', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @expression
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.expression).toBe(true);
    });

    it('parses @pullExecution with a value', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @pullExecution trigger
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.defaultConfig).toEqual({ pullExecution: { triggerPort: 'trigger' } });
    });

    it('does not set pullExecution when value is empty', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @pullExecution
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.defaultConfig).toBeUndefined();
    });

    it('parses JSDoc body description', () => {
      const { config } = parseNode(`
        /**
         * This is the body.
         * @flowWeaver nodeType
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.description).toBe('This is the body.');
    });

    it('does not set description when body is empty', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      // description should be undefined (no body text, no @description)
      expect(config!.description).toBeUndefined();
    });

    it('warns on @param/@returns in nodeType context', () => {
      const { warnings } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @param x something
         * @returns y something
         */
        function myNode(execute: boolean, x: number): { onSuccess: boolean; y: string } {
          return { onSuccess: true, y: '' };
        }
      `);
      expect(warnings.some(w => w.includes('@param is for workflows'))).toBe(true);
      expect(warnings.some(w => w.includes('@returns is for workflows') || w.includes('@return is for workflows'))).toBe(true);
    });

    it('warns on unknown tag in nodeType with suggestion', () => {
      const { warnings } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @inpt something
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('Unknown annotation @inpt'))).toBe(true);
    });

    it('delegates to tagRegistry when available', () => {
      const sf = project.createSourceFile('_tag_reg.ts', `
        /**
         * @flowWeaver nodeType
         * @myCustomTag someVal
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `, { overwrite: true });
      const funcs = extractFunctionLikes(sf);
      const warnings: string[] = [];
      const mockRegistry = {
        has: vi.fn().mockReturnValue(true),
        handle: vi.fn(),
        getRegisteredTags: vi.fn().mockReturnValue([]),
      };
      const config = jsdocParser.parseNodeType(funcs[0], warnings, mockRegistry as any);
      expect(mockRegistry.has).toHaveBeenCalledWith('myCustomTag');
      expect(mockRegistry.handle).toHaveBeenCalled();
    });

    it('parses @deploy tag on nodeType', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @deploy myTarget key1=val1 key2=true key3=42
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.deploy).toBeDefined();
      expect(config!.deploy!['myTarget']).toEqual({ key1: 'val1', key2: true, key3: 42 });
    });
  });

  // ── parseInputTag branches ──────────────────────────────────────

  describe('parseInputTag branches', () => {
    it('infers STEP type for execute port', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input execute
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['execute'].type).toBe('STEP');
    });

    it('warns when non-STEP type is specified on a reserved control port', () => {
      const { config, warnings } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input execute {string}
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['execute'].type).toBe('STEP');
      // The warning about reserved control port type
      expect(warnings.some(w => w.includes('reserved control port'))).toBe(true);
    });

    it('falls back to ANY when no matching param found', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input noSuchParam
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['noSuchParam'].type).toBe('ANY');
    });

    it('matches parameter with underscore prefix', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input value
         */
        function myNode(execute: boolean, _value: number): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['value'].type).toBe('NUMBER');
    });

    it('handles optional input with default value as JSON', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input [count=42]
         */
        function myNode(execute: boolean, count: number): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['count'].defaultValue).toBe(42);
      expect(config!.inputs!['count'].optional).toBe(true);
    });

    it('handles Expression: prefix in description', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input myPort - Expression: params.x + 1
         */
        function myNode(execute: boolean, myPort: number): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['myPort'].expression).toBe('params.x + 1');
      expect(config!.inputs!['myPort'].label).toBeUndefined();
    });

    it('warns on duplicate @input', () => {
      const { warnings } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input x
         * @input x
         */
        function myNode(execute: boolean, x: number): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('Duplicate @input "x"'))).toBe(true);
    });

    it('warns when scoped INPUT port scope callback param not found', () => {
      const { config, warnings } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input myPort scope:nonExistentScope
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['myPort'].type).toBe('ANY');
      expect(warnings.some(w => w.includes("no callback parameter named 'nonExistentScope'"))).toBe(true);
    });

    it('handles scoped mandatory port (success/failure with scope) as STEP', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input onSuccess scope:body
         */
        function myNode(execute: boolean, body: (onSuccess: boolean) => { onSuccess: boolean }): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['onSuccess'].type).toBe('STEP');
    });

    it('sets hidden flag from port parser', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input myPort [hidden]
         */
        function myNode(execute: boolean, myPort: string): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['myPort'].hidden).toBe(true);
    });

    it('sets order metadata from port parser', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input myPort [order:5]
         */
        function myNode(execute: boolean, myPort: string): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['myPort'].metadata?.order).toBe(5);
    });

    it('sets mergeStrategy from port parser', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input myPort [merge:waitAll]
         */
        function myNode(execute: boolean, myPort: string): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['myPort'].mergeStrategy).toBe('waitAll');
    });
  });

  // ── parseOutputTag branches ─────────────────────────────────────

  describe('parseOutputTag branches', () => {
    it('infers STEP for onSuccess/onFailure ports', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @output onSuccess
         * @output onFailure
         */
        function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
          return { onSuccess: true, onFailure: false };
        }
      `);
      expect(config!.outputs!['onSuccess'].type).toBe('STEP');
      expect(config!.outputs!['onFailure'].type).toBe('STEP');
    });

    it('warns on non-STEP type for reserved output port', () => {
      const { config, warnings } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @output onSuccess {string}
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.outputs!['onSuccess'].type).toBe('STEP');
      expect(warnings.some(w => w.includes('reserved control port'))).toBe(true);
    });

    it('falls back to ANY when output property not found in return type', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @output noSuchOutput
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.outputs!['noSuchOutput'].type).toBe('ANY');
    });

    it('warns on duplicate @output', () => {
      const { warnings } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @output result
         * @output result
         */
        function myNode(execute: boolean): { onSuccess: boolean; result: string } {
          return { onSuccess: true, result: '' };
        }
      `);
      expect(warnings.some(w => w.includes('Duplicate @output "result"'))).toBe(true);
    });

    it('warns when scoped OUTPUT port scope callback param not found', () => {
      const { config, warnings } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @output data scope:noScope
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.outputs!['data'].type).toBe('ANY');
      expect(warnings.some(w => w.includes("no callback parameter named 'noScope'"))).toBe(true);
    });

    it('handles scoped mandatory output port as STEP', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @output onSuccess scope:body
         */
        function myNode(execute: boolean, body: (onSuccess: boolean) => void): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.outputs!['onSuccess'].type).toBe('STEP');
    });

    it('infers type from return type property', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @output result
         */
        function myNode(execute: boolean): { onSuccess: boolean; result: number } {
          return { onSuccess: true, result: 42 };
        }
      `);
      expect(config!.outputs!['result'].type).toBe('NUMBER');
    });
  });

  // ── parseStepTag ────────────────────────────────────────────────

  describe('parseStepTag branches', () => {
    it('creates input STEP port when param exists in signature', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @step trigger - My trigger
         */
        function myNode(execute: boolean, trigger: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['trigger']).toBeDefined();
      expect(config!.inputs!['trigger'].type).toBe('STEP');
    });

    it('creates output STEP port when param does not exist in signature', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @step customStep - My step
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.outputs!['customStep']).toBeDefined();
      expect(config!.outputs!['customStep'].type).toBe('STEP');
    });
  });

  // ── parseWorkflow ──────────────────────────────────────────────

  describe('parseWorkflow', () => {
    it('returns null when function has no JSDoc', () => {
      const { config } = parseWorkflow(`function bare() { return {}; }`);
      expect(config).toBeNull();
    });

    it('returns null when no @flowWeaver workflow tag', () => {
      const { config } = parseWorkflow(`
        /** @flowWeaver nodeType */
        function bare() { return {}; }
      `);
      expect(config).toBeNull();
    });

    it('parses @name on workflow', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @name MyWorkflow
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.name).toBe('MyWorkflow');
    });

    it('parses @description on workflow', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @description A test workflow
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.description).toBe('A test workflow');
    });

    it('parses @strictTypes as true by default', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @strictTypes
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.strictTypes).toBe(true);
    });

    it('parses @strictTypes false', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @strictTypes false
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.strictTypes).toBe(false);
    });

    it('parses @autoConnect', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @autoConnect
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.autoConnect).toBe(true);
    });

    it('parses @retries with valid value', () => {
      const { config, warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @retries 3
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.retries).toBe(3);
      expect(warnings).toHaveLength(0);
    });

    it('warns on invalid @retries value', () => {
      const { config, warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @retries -1
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('Invalid @retries'))).toBe(true);
    });

    it('warns on non-numeric @retries', () => {
      const { config, warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @retries abc
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('Invalid @retries'))).toBe(true);
    });

    it('parses @timeout stripping quotes', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @timeout "30s"
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.timeout).toBe('30s');
    });

    it('does not set timeout when value is empty', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @timeout
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.timeout).toBeUndefined();
    });

    it('warns on context-misplaced tags (@color, @icon, @tag)', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @color red
         * @icon star
         * @tag something
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.filter(w => w.includes('is for node types, not workflows'))).toHaveLength(3);
    });

    it('warns on @input/@output/@step in workflow context', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @input x
         * @output y
         * @step z
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.filter(w => w.includes('is for node types, not workflows'))).toHaveLength(3);
    });

    it('warns on unknown workflow tag with suggestion', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @nod a b
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('Unknown annotation @nod'))).toBe(true);
    });

    it('delegates to tagRegistry for unknown tags when registry has it', () => {
      const mockRegistry = {
        has: vi.fn().mockReturnValue(true),
        handle: vi.fn(),
        getRegisteredTags: vi.fn().mockReturnValue([]),
      };
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @customPack someValue
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `, mockRegistry);
      expect(mockRegistry.handle).toHaveBeenCalled();
    });

    it('uses tagRegistry.getRegisteredTags for unknown tag suggestion when registry present but tag not handled', () => {
      const mockRegistry = {
        has: vi.fn().mockReturnValue(false),
        handle: vi.fn(),
        getRegisteredTags: vi.fn().mockReturnValue(['myCustomTag']),
      };
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @totallyUnknown something
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `, mockRegistry);
      expect(warnings.some(w => w.includes('Unknown annotation @totallyUnknown'))).toBe(true);
    });

    it('parses @deploy on workflow', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @deploy myTarget key=val
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.deploy!['myTarget']).toEqual({ key: 'val' });
    });
  });

  // ── parseReturnTag / parseParamTag ─────────────────────────────

  describe('parseReturnTag', () => {
    it('infers STEP for onSuccess/onFailure return ports', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @returns onSuccess
         * @returns onFailure
         */
        export async function myWorkflow(execute: boolean, params: {}): Promise<{ onSuccess: boolean; onFailure: boolean }> {
          return { onSuccess: true, onFailure: false };
        }
      `);
      expect(config!.returnPorts!['onSuccess'].dataType).toBe('STEP');
      expect(config!.returnPorts!['onFailure'].dataType).toBe('STEP');
    });

    it('warns when return type field not found and defaults to ANY', () => {
      const { config, warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @returns noSuchField
         */
        export async function myWorkflow(execute: boolean, params: {}): Promise<{ onSuccess: boolean }> {
          return { onSuccess: true };
        }
      `);
      expect(config!.returnPorts!['noSuchField'].dataType).toBe('ANY');
      expect(warnings.some(w => w.includes('Could not infer type for @returns "noSuchField"'))).toBe(true);
    });

    it('warns on duplicate @returns', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @returns result
         * @returns result
         */
        export async function myWorkflow(execute: boolean, params: {}): Promise<{ onSuccess: boolean; result: string }> {
          return { onSuccess: true, result: '' };
        }
      `);
      expect(warnings.some(w => w.includes('Duplicate @returns "result"'))).toBe(true);
    });

    it('parses order and description on @returns', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @returns result [order:2] - The result
         */
        export async function myWorkflow(execute: boolean, params: {}): Promise<{ onSuccess: boolean; result: string }> {
          return { onSuccess: true, result: '' };
        }
      `);
      expect(config!.returnPorts!['result'].metadata?.order).toBe(2);
      expect(config!.returnPorts!['result'].label).toBe('The result');
    });
  });

  describe('parseParamTag', () => {
    it('infers STEP for execute param', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @param execute
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.startPorts!['execute'].dataType).toBe('STEP');
    });

    it('infers type from params object', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @param count
         */
        export async function myWorkflow(execute: boolean, params: { count: number }) {
          return { onSuccess: true };
        }
      `);
      expect(config!.startPorts!['count'].dataType).toBe('NUMBER');
    });

    it('warns when param not found in params object and defaults to ANY', () => {
      const { config, warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @param missing
         */
        export async function myWorkflow(execute: boolean, params: { x: number }) {
          return { onSuccess: true };
        }
      `);
      expect(config!.startPorts!['missing'].dataType).toBe('ANY');
      expect(warnings.some(w => w.includes('@param "missing" does not match'))).toBe(true);
    });

    it('skips field matching for catch-all Record types', () => {
      const { config, warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @param anything
         */
        export async function myWorkflow(execute: boolean, params: Record<string, any>) {
          return { onSuccess: true };
        }
      `);
      // Should NOT produce a warning for unmatched field since it's a catch-all Record
      expect(config!.startPorts!['anything'].dataType).toBe('ANY');
      expect(warnings.filter(w => w.includes('does not match'))).toHaveLength(0);
    });

    it('warns on duplicate @param', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @param x
         * @param x
         */
        export async function myWorkflow(execute: boolean, params: { x: string }) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('Duplicate @param "x"'))).toBe(true);
    });
  });

  // ── parseImportTag ──────────────────────────────────────────────

  describe('parseImportTag', () => {
    it('parses valid @fwImport', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @fwImport npm/lodash/map map from "lodash"
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.imports).toHaveLength(1);
      expect(config!.imports![0]).toEqual({
        name: 'npm/lodash/map',
        functionName: 'map',
        importSource: 'lodash',
      });
    });

    it('warns on invalid @fwImport format', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @fwImport badformat
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('Invalid @fwImport tag format'))).toBe(true);
    });
  });

  // ── parsePositionTag ────────────────────────────────────────────

  describe('parsePositionTag', () => {
    it('emits deprecation warning for non-virtual nodes', () => {
      const { warnings, config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @node a MyType
         * @position a 100 200
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.positions!['a']).toEqual({ x: 100, y: 200 });
      expect(warnings.some(w => w.includes('Deprecated: @position a'))).toBe(true);
    });

    it('does not emit deprecation for Start/Exit virtual nodes', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @position Start 0 0
         * @position Exit 500 500
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.filter(w => w.includes('Deprecated'))).toHaveLength(0);
    });

    it('warns on invalid @position format', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @position
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('@position') || w.includes('position'))).toBe(true);
    });
  });

  // ── parseConnectTag ─────────────────────────────────────────────

  describe('parseConnectTag', () => {
    it('parses valid connection', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @node a TypeA
         * @node b TypeB
         * @connect a.out -> b.in
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.connections).toHaveLength(1);
      expect(config!.connections![0].from).toEqual({ node: 'a', port: 'out' });
      expect(config!.connections![0].to).toEqual({ node: 'b', port: 'in' });
    });

    it('warns on invalid @connect format', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @connect !!!
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('@connect'))).toBe(true);
    });
  });

  // ── parseScopeTag ───────────────────────────────────────────────

  describe('parseScopeTag', () => {
    it('parses valid @scope', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @node a TypeA
         * @node b TypeB
         * @scope a.body [b]
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.scopes!['a.body']).toEqual(['b']);
    });

    it('warns on invalid @scope format', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @scope
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('@scope') || w.includes('scope'))).toBe(true);
    });
  });

  // ── parseMapTag ─────────────────────────────────────────────────

  describe('parseMapTag', () => {
    it('warns on invalid @map format', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @map
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('@map'))).toBe(true);
    });
  });

  // ── parsePathTag ────────────────────────────────────────────────

  describe('parsePathTag', () => {
    it('warns on invalid @path format', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @path
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('@path'))).toBe(true);
    });
  });

  // ── parseFanOutTag / parseFanInTag ──────────────────────────────

  describe('parseFanOutTag', () => {
    it('warns on invalid @fanOut format', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @fanOut
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('@fanOut'))).toBe(true);
    });
  });

  describe('parseFanInTag', () => {
    it('warns on invalid @fanIn format', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @fanIn
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('@fanIn'))).toBe(true);
    });
  });

  // ── parseCoerceTag ──────────────────────────────────────────────

  describe('parseCoerceTag', () => {
    it('warns on invalid @coerce format', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @coerce
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('@coerce'))).toBe(true);
    });
  });

  // ── parseTriggerTag ─────────────────────────────────────────────

  describe('parseTriggerTag', () => {
    it('parses valid event trigger', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @trigger event="my.event"
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.trigger?.event).toBe('my.event');
    });

    it('parses cron trigger', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @trigger cron="0 * * * *"
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.trigger?.cron).toBe('0 * * * *');
    });

    it('warns when event name matches CI/CD keyword', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @trigger event="push"
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('Inngest event trigger'))).toBe(true);
    });

    it('delegates to _cicdTrigger handler when core parsing fails and registry has it', () => {
      const mockRegistry = {
        has: vi.fn((name: string) => name === '_cicdTrigger'),
        handle: vi.fn(),
        getRegisteredTags: vi.fn().mockReturnValue([]),
      };
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @trigger push
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `, mockRegistry);
      expect(mockRegistry.handle).toHaveBeenCalledWith(
        '_cicdTrigger',
        'push',
        'workflow',
        expect.any(Object),
        expect.any(Array),
      );
    });

    it('warns on invalid trigger with no registry fallback', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @trigger !!!invalid
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('Invalid @trigger format'))).toBe(true);
    });
  });

  // ── parseCancelOnTag ────────────────────────────────────────────

  describe('parseCancelOnTag', () => {
    it('warns on invalid @cancelOn format', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @cancelOn
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('@cancelOn'))).toBe(true);
    });
  });

  // ── parseDeployTag ──────────────────────────────────────────────

  describe('parseDeployTag', () => {
    it('handles target-only deploy (no key=value pairs)', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @deploy myTarget
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.deploy!['myTarget']).toEqual({});
    });

    it('handles empty deploy tag', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @deploy
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      // Empty deploy tag should not create any deploy entries
      expect(config!.deploy).toEqual({});
    });

    it('parses quoted values with commas as arrays', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @deploy ci branches="main,develop,staging"
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.deploy!['ci'].branches).toEqual(['main', 'develop', 'staging']);
    });

    it('parses boolean bare values (true/false)', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @deploy ci enabled=true disabled=false
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.deploy!['ci'].enabled).toBe(true);
      expect(config!.deploy!['ci'].disabled).toBe(false);
    });

    it('parses numeric bare values', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @deploy ci retries=3 timeout=30
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.deploy!['ci'].retries).toBe(3);
      expect(config!.deploy!['ci'].timeout).toBe(30);
    });

    it('parses non-numeric bare values as strings', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @deploy ci runner=ubuntu-latest
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.deploy!['ci'].runner).toBe('ubuntu-latest');
    });

    it('parses quoted string without commas as plain string', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @deploy ci action="actions/checkout@v4"
         */
        function myNode(execute: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.deploy!['ci'].action).toBe('actions/checkout@v4');
    });
  });

  // ── parseDefaultValue ───────────────────────────────────────────

  describe('parseDefaultValue', () => {
    it('parses JSON default value', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input [count=42]
         */
        function myNode(execute: boolean, count: number): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['count'].defaultValue).toBe(42);
    });

    it('parses JSON boolean default', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input [flag=true]
         */
        function myNode(execute: boolean, flag: boolean): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['flag'].defaultValue).toBe(true);
    });

    it('parses JSON string default', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input [mode="fast"]
         */
        function myNode(execute: boolean, mode: string): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['mode'].defaultValue).toBe('fast');
    });

    it('falls back to raw string for non-JSON default', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input [mode=notJson]
         */
        function myNode(execute: boolean, mode: string): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['mode'].defaultValue).toBe('notJson');
    });
  });

  // ── parsePattern ────────────────────────────────────────────────

  describe('parsePattern', () => {
    it('returns null when no JSDoc', () => {
      const { config } = parsePattern(`function bare() {}`);
      expect(config).toBeNull();
    });

    it('returns null when no @flowWeaver pattern tag', () => {
      const { config } = parsePattern(`
        /** @flowWeaver nodeType */
        function bare() {}
      `);
      expect(config).toBeNull();
    });

    it('parses @name and @description on pattern', () => {
      const { config } = parsePattern(`
        /**
         * @flowWeaver pattern
         * @name MyPattern
         * @description A pattern
         */
        function myPattern() {}
      `);
      expect(config!.name).toBe('MyPattern');
      expect(config!.description).toBe('A pattern');
    });

    it('parses @node in pattern', () => {
      const { config } = parsePattern(`
        /**
         * @flowWeaver pattern
         * @node a TypeA
         */
        function myPattern() {}
      `);
      expect(config!.instances).toHaveLength(1);
      expect(config!.instances![0]).toEqual({ id: 'a', nodeType: 'TypeA' });
    });

    it('warns on invalid @node in pattern', () => {
      const { warnings } = parsePattern(`
        /**
         * @flowWeaver pattern
         * @node
         */
        function myPattern() {}
      `);
      expect(warnings.some(w => w.includes('@node'))).toBe(true);
    });

    it('parses @position in pattern', () => {
      const { config } = parsePattern(`
        /**
         * @flowWeaver pattern
         * @node a TypeA
         * @position a 100 200
         */
        function myPattern() {}
      `);
      expect(config!.positions!['a']).toEqual({ x: 100, y: 200 });
      // Also applies position to instance config
      expect(config!.instances![0].config).toEqual({ x: 100, y: 200 });
    });

    it('warns on invalid @position in pattern', () => {
      const { warnings } = parsePattern(`
        /**
         * @flowWeaver pattern
         * @position
         */
        function myPattern() {}
      `);
      expect(warnings.some(w => w.includes('@position') || w.includes('position'))).toBe(true);
    });

    it('parses @connect in pattern', () => {
      const { config } = parsePattern(`
        /**
         * @flowWeaver pattern
         * @node a TypeA
         * @node b TypeB
         * @connect a.out -> b.in
         */
        function myPattern() {}
      `);
      expect(config!.connections).toHaveLength(1);
      expect(config!.connections![0].from).toEqual({ node: 'a', port: 'out' });
    });

    it('warns on invalid @connect in pattern', () => {
      const { warnings } = parsePattern(`
        /**
         * @flowWeaver pattern
         * @connect !!!
         */
        function myPattern() {}
      `);
      expect(warnings.some(w => w.includes('@connect'))).toBe(true);
    });

    it('parses @port IN and OUT in pattern', () => {
      const { config } = parsePattern(`
        /**
         * @flowWeaver pattern
         * @port IN.data - Input data
         * @port OUT.result
         */
        function myPattern() {}
      `);
      expect(config!.ports).toHaveLength(2);
      expect(config!.ports![0]).toEqual({ direction: 'IN', name: 'data', description: 'Input data' });
      expect(config!.ports![1]).toEqual({ direction: 'OUT', name: 'result', description: undefined });
    });

    it('warns on invalid @port format in pattern', () => {
      const { warnings } = parsePattern(`
        /**
         * @flowWeaver pattern
         * @port INVALID
         */
        function myPattern() {}
      `);
      expect(warnings.some(w => w.includes('Invalid @port tag format'))).toBe(true);
    });

    it('warns on unknown tag in pattern', () => {
      const { warnings } = parsePattern(`
        /**
         * @flowWeaver pattern
         * @unknownStuff abc
         */
        function myPattern() {}
      `);
      expect(warnings.some(w => w.includes('Unknown annotation @unknownStuff'))).toBe(true);
    });

    it('position does not apply to instance if no matching instance exists', () => {
      const { config } = parsePattern(`
        /**
         * @flowWeaver pattern
         * @node a TypeA
         * @position b 100 200
         */
        function myPattern() {}
      `);
      // Instance 'a' should not get position from 'b'
      expect(config!.instances![0].config).toBeUndefined();
    });
  });

  // ── parseNodeTag (workflow @node) ───────────────────────────────

  describe('parseNodeTag (workflow)', () => {
    it('parses @node with all options', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @node myInst MyType myScope [label: "My Label"] [minimized] [color: "#ff0"] [icon: "star"]
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      const inst = config!.instances![0];
      expect(inst.id).toBe('myInst');
      expect(inst.type).toBe('MyType');
      expect(inst.parentScope).toBe('myScope');
      expect(inst.label).toBe('My Label');
      expect(inst.minimized).toBe(true);
      expect(inst.color).toBe('#ff0');
      expect(inst.icon).toBe('star');
    });

    it('parses @node with portOrder, portLabel, expressions', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @node myInst MyType [portOrder: a=1 b=2] [portLabel: a="Alpha"] [expr: a="1+1"]
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      const inst = config!.instances![0];
      expect(inst.portConfigs).toBeDefined();
      // portOrder should set order, portLabel should merge label, expr should merge expression
      const aConfig = inst.portConfigs!.find(pc => pc.portName === 'a');
      expect(aConfig).toBeDefined();
      expect(aConfig!.order).toBe(1);
      expect(aConfig!.label).toBe('Alpha');
      expect(aConfig!.expression).toBe('1+1');
      const bConfig = inst.portConfigs!.find(pc => pc.portName === 'b');
      expect(bConfig).toBeDefined();
      expect(bConfig!.order).toBe(2);
    });

    it('parses @node with pullExecution', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @node myInst MyType [pullExecution: trigger]
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.instances![0].pullExecution).toEqual({ triggerPort: 'trigger' });
    });

    it('parses @node with size and position', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @node myInst MyType [size: 200 100] [position: 50 75]
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      const inst = config!.instances![0];
      expect(inst.width).toBe(200);
      expect(inst.height).toBe(100);
      expect(inst.x).toBe(50);
      expect(inst.y).toBe(75);
    });

    it('parses @node with job and environment', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @node myInst MyType [job: build] [environment: production]
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      const inst = config!.instances![0];
      expect(inst.job).toBe('build');
      expect(inst.environment).toBe('production');
    });

    it('parses @node with suppress warnings', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @node myInst MyType [suppress: W001 W002]
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      const inst = config!.instances![0];
      expect(inst.suppressWarnings).toEqual(['W001', 'W002']);
    });

    it('parses @node with tags', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @node myInst MyType [tag: core] [tag: experimental]
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      const inst = config!.instances![0];
      expect(inst.tags).toBeDefined();
      expect(inst.tags!.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── parseConnectTag with scopes ─────────────────────────────────

  describe('parseConnectTag with scopes', () => {
    it('parses scoped connections', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @connect a.out:myScope -> b.in:myScope
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      const conn = config!.connections![0];
      expect(conn.from.scope).toBe('myScope');
      expect(conn.to.scope).toBe('myScope');
    });
  });

  // ── Scoped input/output type inference from callbacks ────────────

  describe('scoped port type inference', () => {
    it('infers scoped INPUT type from callback return type', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input data scope:body
         */
        function myNode(execute: boolean, body: () => { data: string }): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['data'].type).toBe('STRING');
      expect(config!.inputs!['data'].tsType).toBe('string');
    });

    it('falls back to ANY when callback return type field extraction fails', () => {
      const { config, warnings } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @input noField scope:body
         */
        function myNode(execute: boolean, body: () => { data: string }): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.inputs!['noField'].type).toBe('ANY');
      expect(warnings.some(w => w.includes("Cannot infer type for scoped INPUT port 'noField'"))).toBe(true);
    });

    it('infers scoped OUTPUT type from callback parameter', () => {
      const { config } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @output item scope:body
         */
        function myNode(execute: boolean, body: (item: number) => { onSuccess: boolean }): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.outputs!['item'].type).toBe('NUMBER');
      expect(config!.outputs!['item'].tsType).toBe('number');
    });

    it('falls back to ANY when callback parameter extraction fails for output', () => {
      const { config, warnings } = parseNode(`
        /**
         * @flowWeaver nodeType
         * @output noParam scope:body
         */
        function myNode(execute: boolean, body: (item: number) => { onSuccess: boolean }): { onSuccess: boolean } {
          return { onSuccess: true };
        }
      `);
      expect(config!.outputs!['noParam'].type).toBe('ANY');
      expect(warnings.some(w => w.includes("Cannot infer type for scoped OUTPUT port 'noParam'"))).toBe(true);
    });
  });

  // ── @return tag (alias for @returns) ────────────────────────────

  describe('@return alias', () => {
    it('parses @return the same as @returns', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @return result - The result
         */
        export async function myWorkflow(execute: boolean, params: {}): Promise<{ onSuccess: boolean; result: string }> {
          return { onSuccess: true, result: '' };
        }
      `);
      expect(config!.returnPorts!['result']).toBeDefined();
      expect(config!.returnPorts!['result'].label).toBe('The result');
    });
  });

  // ── Multiple @deploy tags accumulate ────────────────────────────

  describe('multiple @deploy tags', () => {
    it('accumulates deploy config across multiple tags', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @deploy ci runner=ubuntu
         * @deploy prod memory=256
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.deploy!['ci']).toEqual({ runner: 'ubuntu' });
      expect(config!.deploy!['prod']).toEqual({ memory: 256 });
    });
  });

  // ── Multiple @trigger tags merge ────────────────────────────────

  describe('multiple @trigger tags merge', () => {
    it('merges event and cron from separate trigger tags', () => {
      const { config } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @trigger event="my.event"
         * @trigger cron="0 * * * *"
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(config!.trigger?.event).toBe('my.event');
      expect(config!.trigger?.cron).toBe('0 * * * *');
    });
  });

  // ── @fanOut / @fanIn with missing port ──────────────────────────

  describe('fanOut/fanIn port validation', () => {
    it('warns when @fanOut source has no port', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @fanOut src -> a, b
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('@fanOut'))).toBe(true);
    });

    it('warns when @fanIn target has no port', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @fanIn a, b -> target
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.some(w => w.includes('@fanIn'))).toBe(true);
    });
  });

  // ── Catch-all Record variants ───────────────────────────────────

  describe('catch-all Record detection variants', () => {
    it('treats {} as catch-all (no field matching warning)', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @param x
         */
        export async function myWorkflow(execute: boolean, params: {}) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.filter(w => w.includes('does not match'))).toHaveLength(0);
    });

    it('treats Record<string, never> as catch-all', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @param x
         */
        export async function myWorkflow(execute: boolean, params: Record<string, never>) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.filter(w => w.includes('does not match'))).toHaveLength(0);
    });

    it('treats Record<string, unknown> as catch-all', () => {
      const { warnings } = parseWorkflow(`
        /**
         * @flowWeaver workflow
         * @param x
         */
        export async function myWorkflow(execute: boolean, params: Record<string, unknown>) {
          return { onSuccess: true };
        }
      `);
      expect(warnings.filter(w => w.includes('does not match'))).toHaveLength(0);
    });
  });
});
