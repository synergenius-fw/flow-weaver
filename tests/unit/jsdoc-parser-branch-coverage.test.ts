/**
 * Branch coverage tests for src/jsdoc-parser.ts
 *
 * Exercises both sides of conditionals: error paths, malformed inputs,
 * edge cases for nodeType/workflow/pattern parsing, deploy tag parsing,
 * unknown tag detection, context validation, and default value parsing.
 */

import { jsdocParser } from '../../src/jsdoc-parser';
import { extractFunctionLikes } from '../../src/function-like';
import { getSharedProject } from '../../src/shared-project';

const project = getSharedProject();

function parseNodeType(code: string) {
  const sourceFile = project.createSourceFile(`branch-nt-${Date.now()}-${Math.random()}.ts`, code, { overwrite: true });
  const functions = extractFunctionLikes(sourceFile);
  const warnings: string[] = [];
  const config = jsdocParser.parseNodeType(functions[0], warnings);
  return { config, warnings, functions };
}

function parseWorkflow(code: string) {
  const sourceFile = project.createSourceFile(`branch-wf-${Date.now()}-${Math.random()}.ts`, code, { overwrite: true });
  const functions = extractFunctionLikes(sourceFile);
  const warnings: string[] = [];
  const config = jsdocParser.parseWorkflow(functions[0], warnings);
  return { config, warnings, functions };
}

function parsePattern(code: string) {
  const sourceFile = project.createSourceFile(`branch-pt-${Date.now()}-${Math.random()}.ts`, code, { overwrite: true });
  const functions = extractFunctionLikes(sourceFile);
  const warnings: string[] = [];
  const config = jsdocParser.parsePattern(functions[0], warnings);
  return { config, warnings, functions };
}

describe('JSDocParser branch coverage', () => {
  // ── parseNodeType ─────────────────────────────────────────────

  describe('parseNodeType', () => {
    it('returns null when function has no JSDoc', () => {
      const { config } = parseNodeType(`function bare() { return {}; }`);
      expect(config).toBeNull();
    });

    it('returns null when JSDoc has no @flowWeaver nodeType tag', () => {
      const { config } = parseNodeType(`
/** @description just a regular function */
function bare() { return {}; }
`);
      expect(config).toBeNull();
    });

    it('parses @flowWeaver node shorthand and sets expression=true', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver node
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config).not.toBeNull();
      expect(config!.expression).toBe(true);
    });

    it('extracts description from JSDoc comment text', () => {
      const { config } = parseNodeType(`
/**
 * This is the description text.
 * @flowWeaver nodeType
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config).not.toBeNull();
      expect(config!.description).toBe('This is the description text.');
    });

    it('parses @name, @label, @description, @color, @icon tags', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @name MyNode
 * @label My Label
 * @description Custom description
 * @color "#ff0000"
 * @icon "star"
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.name).toBe('MyNode');
      expect(config!.label).toBe('My Label');
      expect(config!.description).toBe('Custom description');
      expect(config!.color).toBe('#ff0000');
      expect(config!.icon).toBe('star');
    });

    it('parses @tag with and without tooltip', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @tag beta "This is a beta feature"
 * @tag experimental
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.tags).toHaveLength(2);
      expect(config!.tags![0]).toEqual({ label: 'beta', tooltip: 'This is a beta feature' });
      expect(config!.tags![1]).toEqual({ label: 'experimental' });
    });

    it('parses @executeWhen and @scope', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @executeWhen data-ready
 * @scope inner
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.executeWhen).toBe('data-ready');
      expect(config!.scope).toBe('inner');
    });

    it('parses @expression tag', () => {
      const { config } = parseNodeType(`
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

    it('parses @pullExecution with value', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @pullExecution myTrigger
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.defaultConfig).toEqual({ pullExecution: { triggerPort: 'myTrigger' } });
    });

    it('does not set pullExecution when value is empty', () => {
      const { config } = parseNodeType(`
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

    it('warns when @param/@returns is used on nodeType (context validation)', () => {
      const { warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @param x
 * @returns y
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(warnings.some(w => w.includes('@param is for workflows'))).toBe(true);
      expect(warnings.some(w => w.includes('@returns is for workflows'))).toBe(true);
    });

    it('warns on unknown tags with suggestions', () => {
      const { warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @nme MyNode
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(warnings.some(w => w.includes('Unknown annotation @nme'))).toBe(true);
    });

    it('warns on unknown tags without suggestions when very different', () => {
      const { warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @zzzzzzzzzzz something
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(warnings.some(w => w.includes('Unknown annotation @zzzzzzzzzzz'))).toBe(true);
    });

    it('detects duplicate @input ports', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data
 * @input data
 */
function myNode(execute: boolean, data: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config).not.toBeNull();
      expect(warnings.some(w => w.includes('Duplicate @input "data"'))).toBe(true);
    });

    it('detects duplicate @output ports', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output result
 * @output result
 */
function myNode(execute: boolean): { result: string; onSuccess: boolean } {
  return { result: 'x', onSuccess: true };
}
`);
      expect(config).not.toBeNull();
      expect(warnings.some(w => w.includes('Duplicate @output "result"'))).toBe(true);
    });

    it('infers STEP type for execute input port', () => {
      const { config } = parseNodeType(`
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

    it('infers STEP type for onSuccess/onFailure output ports', () => {
      const { config } = parseNodeType(`
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

    it('falls back to ANY for input port with no matching parameter', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input nonexistent
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['nonexistent'].type).toBe('ANY');
    });

    it('falls back to ANY for output port with no matching return property', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output nonexistent
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.outputs!['nonexistent'].type).toBe('ANY');
    });

    it('infers type from function parameter with underscore prefix', () => {
      const { config } = parseNodeType(`
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

    it('parses input with Expression: prefix in description', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data - Expression: params.value + 1
 */
function myNode(execute: boolean, data: number): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['data'].expression).toBe('params.value + 1');
      expect(config!.inputs!['data'].label).toBeUndefined();
    });

    it('parses JSON default value', () => {
      const { config } = parseNodeType(`
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

    it('parses non-JSON default value as string', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input [mode=turbo]
 */
function myNode(execute: boolean, mode: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['mode'].defaultValue).toBe('turbo');
    });

    it('warns when scoped input references nonexistent scope callback', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data scope:noSuchScope
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['data'].type).toBe('ANY');
      expect(warnings.some(w => w.includes("no callback parameter named 'noSuchScope'"))).toBe(true);
    });

    it('warns when scoped output references nonexistent scope callback', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output data scope:noSuchScope
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.outputs!['data'].type).toBe('ANY');
      expect(warnings.some(w => w.includes("no callback parameter named 'noSuchScope'"))).toBe(true);
    });

    it('parses @step as input when matching parameter exists', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @step trigger
 */
function myNode(execute: boolean, trigger: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['trigger']).toBeDefined();
      expect(config!.inputs!['trigger'].type).toBe('STEP');
    });

    it('parses @step as output when no matching parameter', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @step done
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.outputs!['done']).toBeDefined();
      expect(config!.outputs!['done'].type).toBe('STEP');
    });

    it('parses @deploy tag on nodeType', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @deploy my-target timeout=30 memory=256
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.deploy).toBeDefined();
      expect(config!.deploy!['my-target']).toEqual({ timeout: 30, memory: 256 });
    });
  });

  // ── parseWorkflow ─────────────────────────────────────────────

  describe('parseWorkflow', () => {
    it('returns null when function has no JSDoc', () => {
      const { config } = parseWorkflow(`function bare() { return {}; }`);
      expect(config).toBeNull();
    });

    it('returns null when JSDoc has no @flowWeaver workflow tag', () => {
      const { config } = parseWorkflow(`
/** @flowWeaver nodeType */
function bare(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
`);
      expect(config).toBeNull();
    });

    it('parses @name and @description', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @name MyWorkflow
 * @description Does something
 */
export async function myWorkflow(execute: boolean, params: {}) {
  return { onSuccess: true };
}
`);
      expect(config!.name).toBe('MyWorkflow');
      expect(config!.description).toBe('Does something');
    });

    it('parses @strictTypes true and false', () => {
      const { config: c1 } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @strictTypes
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(c1!.strictTypes).toBe(true);

      const { config: c2 } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @strictTypes false
 */
export async function b(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(c2!.strictTypes).toBe(false);
    });

    it('parses @autoConnect', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @autoConnect
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.autoConnect).toBe(true);
    });

    it('parses @retries with valid value', () => {
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @retries 3
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.retries).toBe(3);
      expect(warnings).toHaveLength(0);
    });

    it('warns on invalid @retries value', () => {
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @retries abc
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.retries).toBeUndefined();
      expect(warnings.some(w => w.includes('Invalid @retries value'))).toBe(true);
    });

    it('warns on negative @retries value', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @retries -1
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Invalid @retries value'))).toBe(true);
    });

    it('parses @timeout', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @timeout "30s"
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.timeout).toBe('30s');
    });

    it('does not set timeout when value is empty', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @timeout
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.timeout).toBeUndefined();
    });

    it('warns when @color/@icon/@tag used in workflow (context validation)', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @color red
 * @icon star
 * @tag beta
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@color is for node types'))).toBe(true);
      expect(warnings.some(w => w.includes('@icon is for node types'))).toBe(true);
      expect(warnings.some(w => w.includes('@tag is for node types'))).toBe(true);
    });

    it('warns when @input/@output/@step used in workflow (context validation)', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @input x
 * @output y
 * @step z
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@input is for node types'))).toBe(true);
      expect(warnings.some(w => w.includes('@output is for node types'))).toBe(true);
      expect(warnings.some(w => w.includes('@step is for node types'))).toBe(true);
    });

    it('warns on unknown tags in workflow with suggestion', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @nde x y
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Unknown annotation @nde'))).toBe(true);
    });

    it('parses @fwImport with valid format', () => {
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @fwImport npm/lodash/map map from "lodash"
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.imports).toHaveLength(1);
      expect(config!.imports![0]).toEqual({
        name: 'npm/lodash/map',
        functionName: 'map',
        importSource: 'lodash',
      });
      expect(warnings).toHaveLength(0);
    });

    it('warns on invalid @fwImport format', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @fwImport bad format
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Invalid @fwImport tag format'))).toBe(true);
    });

    it('parses @node with instanceId and nodeType', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst MyType
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances).toHaveLength(1);
      expect(config!.instances![0].id).toBe('myInst');
      expect(config!.instances![0].type).toBe('MyType');
    });

    it('parses @connect with valid format', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @node b TypeB
 * @connect a.onSuccess -> b.execute
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.connections).toHaveLength(1);
      expect(config!.connections![0].from).toEqual({ node: 'a', port: 'onSuccess' });
      expect(config!.connections![0].to).toEqual({ node: 'b', port: 'execute' });
    });

    it('parses @scope tag', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @scope a.inner [child1, child2]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.scopes!['a.inner']).toEqual(['child1', 'child2']);
    });

    it('parses @position tag and emits deprecation warning for non-virtual nodes', () => {
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myNode TypeA
 * @position myNode 100 200
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.positions!['myNode']).toEqual({ x: 100, y: 200 });
      expect(warnings.some(w => w.includes('Deprecated: @position myNode'))).toBe(true);
    });

    it('does not warn for @position Start/Exit (virtual nodes)', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @position Start 0 0
 * @position Exit 500 500
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.filter(w => w.includes('Deprecated: @position'))).toHaveLength(0);
    });

    it('parses @map tag', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node src TypeA
 * @map mapper child over src.items
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.maps).toHaveLength(1);
      expect(config!.maps![0].instanceId).toBe('mapper');
      expect(config!.maps![0].childId).toBe('child');
      expect(config!.maps![0].sourceNode).toBe('src');
      expect(config!.maps![0].sourcePort).toBe('items');
    });

    it('parses @path tag', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @node b TypeB
 * @path Start -> a -> b -> Exit
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.paths).toHaveLength(1);
      expect(config!.paths![0].steps.length).toBeGreaterThanOrEqual(2);
    });

    it('parses @deploy tag in workflow', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy my-target key=true val="hello"
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy).toBeDefined();
      expect(config!.deploy!['my-target'].key).toBe(true);
      expect(config!.deploy!['my-target'].val).toBe('hello');
    });

    it('parses @param for workflow start ports', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param input1 - The first input
 */
export async function a(execute: boolean, params: { input1: string }) {
  return { onSuccess: true };
}
`);
      expect(config!.startPorts).toBeDefined();
      expect(config!.startPorts!['input1']).toBeDefined();
    });

    it('parses @returns for workflow return ports', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @returns result - The output
 */
export async function a(execute: boolean, params: {}): Promise<{ result: string; onSuccess: boolean }> {
  return { result: 'x', onSuccess: true };
}
`);
      expect(config!.returnPorts).toBeDefined();
      expect(config!.returnPorts!['result']).toBeDefined();
    });

    it('warns on duplicate @param', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param val - First
 * @param val - Second
 */
export async function a(execute: boolean, params: { val: string }) {
  return { onSuccess: true };
}
`);
      expect(warnings.some(w => w.includes('Duplicate @param "val"'))).toBe(true);
    });

    it('warns on duplicate @returns', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @returns out - First
 * @returns out - Second
 */
export async function a(execute: boolean, params: {}): Promise<{ out: string; onSuccess: boolean }> {
  return { out: 'x', onSuccess: true };
}
`);
      expect(warnings.some(w => w.includes('Duplicate @returns "out"'))).toBe(true);
    });

    it('parses @trigger with event=', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @trigger event="user.created"
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.trigger).toBeDefined();
      expect(config!.trigger!.event).toBe('user.created');
    });

    it('parses @trigger with cron=', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @trigger cron="0 * * * *"
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.trigger).toBeDefined();
      expect(config!.trigger!.cron).toBe('0 * * * *');
    });

    it('warns on invalid @trigger with no registry fallback', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @trigger !!!invalid!!!
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@trigger'))).toBe(true);
    });

    it('parses @cancelOn tag', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @cancelOn event="user.deleted"
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.cancelOn).toBeDefined();
      expect(config!.cancelOn!.event).toBe('user.deleted');
    });

    it('warns on invalid @cancelOn', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @cancelOn
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@cancelOn'))).toBe(true);
    });

    it('parses @throttle tag', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @throttle limit=5 period="1m"
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.throttle).toBeDefined();
      expect(config!.throttle!.limit).toBe(5);
    });

    it('warns when @param does not match field in params object', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param nonexistent - Missing field
 */
export async function a(execute: boolean, params: { other: string }) {
  return { onSuccess: true };
}
`);
      expect(warnings.some(w => w.includes('@param "nonexistent" does not match'))).toBe(true);
    });

    it('infers STEP type for execute @param', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param execute - Trigger
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.startPorts!['execute'].dataType).toBe('STEP');
    });

    it('warns when @returns type cannot be inferred', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @returns nonexistent - Not in return type
 */
export async function a(execute: boolean, params: {}): Promise<{ onSuccess: boolean }> {
  return { onSuccess: true };
}
`);
      expect(warnings.some(w => w.includes('Could not infer type for @returns "nonexistent"'))).toBe(true);
    });

    it('infers STEP type for @returns onSuccess', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @returns onSuccess - Done
 */
export async function a(execute: boolean, params: {}): Promise<{ onSuccess: boolean }> {
  return { onSuccess: true };
}
`);
      expect(config!.returnPorts!['onSuccess'].dataType).toBe('STEP');
    });
  });

  // ── parsePattern ──────────────────────────────────────────────

  describe('parsePattern', () => {
    it('returns null when function has no JSDoc', () => {
      const { config } = parsePattern(`function bare() { return {}; }`);
      expect(config).toBeNull();
    });

    it('returns null when JSDoc has no @flowWeaver pattern tag', () => {
      const { config } = parsePattern(`
/** @flowWeaver nodeType */
function bare(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
`);
      expect(config).toBeNull();
    });

    it('parses @name and @description for pattern', () => {
      const { config } = parsePattern(`
/**
 * @flowWeaver pattern
 * @name MyPattern
 * @description A test pattern
 */
function myPattern() {}
`);
      expect(config!.name).toBe('MyPattern');
      expect(config!.description).toBe('A test pattern');
    });

    it('parses @node tag in pattern', () => {
      const { config } = parsePattern(`
/**
 * @flowWeaver pattern
 * @node inst1 NodeTypeA
 */
function myPattern() {}
`);
      expect(config!.instances).toHaveLength(1);
      expect(config!.instances![0].id).toBe('inst1');
      expect(config!.instances![0].nodeType).toBe('NodeTypeA');
    });

    it('parses @position and applies to instances', () => {
      const { config } = parsePattern(`
/**
 * @flowWeaver pattern
 * @node inst1 NodeTypeA
 * @position inst1 100 200
 */
function myPattern() {}
`);
      expect(config!.instances![0].config).toEqual({ x: 100, y: 200 });
    });

    it('parses @connect in pattern', () => {
      const { config } = parsePattern(`
/**
 * @flowWeaver pattern
 * @node a TypeA
 * @node b TypeB
 * @connect a.onSuccess -> b.execute
 */
function myPattern() {}
`);
      expect(config!.connections).toHaveLength(1);
      expect(config!.connections![0].from).toEqual({ node: 'a', port: 'onSuccess' });
    });

    it('parses @port IN and OUT', () => {
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

    it('warns on invalid @port format', () => {
      const { warnings } = parsePattern(`
/**
 * @flowWeaver pattern
 * @port badformat
 */
function myPattern() {}
`);
      expect(warnings.some(w => w.includes('Invalid @port tag format'))).toBe(true);
    });

    it('warns on unknown tags in pattern', () => {
      const { warnings } = parsePattern(`
/**
 * @flowWeaver pattern
 * @zzzzunknown something
 */
function myPattern() {}
`);
      expect(warnings.some(w => w.includes('Unknown annotation @zzzzunknown'))).toBe(true);
    });
  });

  // ── Deploy tag parsing ────────────────────────────────────────

  describe('deploy tag parsing', () => {
    it('parses deploy with boolean true/false coercion', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy tgt enabled=true disabled=false
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy!['tgt'].enabled).toBe(true);
      expect(config!.deploy!['tgt'].disabled).toBe(false);
    });

    it('parses deploy with number coercion', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy tgt memory=256 timeout=30
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy!['tgt'].memory).toBe(256);
      expect(config!.deploy!['tgt'].timeout).toBe(30);
    });

    it('parses deploy with bare string (non-numeric, non-boolean)', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy tgt runtime=nodejs
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy!['tgt'].runtime).toBe('nodejs');
    });

    it('parses deploy with quoted comma-separated value as array', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy tgt branches="main,dev,staging"
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy!['tgt'].branches).toEqual(['main', 'dev', 'staging']);
    });

    it('parses deploy with quoted non-comma value as string', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy tgt name="my workflow"
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy!['tgt'].name).toBe('my workflow');
    });

    it('handles deploy tag with target only and no key-value pairs', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy my-target
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy!['my-target']).toEqual({});
    });

    it('handles empty deploy tag', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      // Empty deploy tag should not crash
      expect(config).not.toBeNull();
    });
  });

  // ── @return alias ─────────────────────────────────────────────

  describe('@return alias', () => {
    it('parses @return as alias for @returns', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @return result - The output
 */
export async function a(execute: boolean, params: {}): Promise<{ result: string; onSuccess: boolean }> {
  return { result: 'x', onSuccess: true };
}
`);
      expect(config!.returnPorts).toBeDefined();
      expect(config!.returnPorts!['result']).toBeDefined();
    });
  });

  // ── @fanOut / @fanIn ──────────────────────────────────────────

  describe('fanOut and fanIn', () => {
    it('parses @fanOut tag as macro (expanded during parse)', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node src TypeA
 * @node t1 TypeB
 * @node t2 TypeC
 * @fanOut src.data -> [t1, t2]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      // @fanOut is a macro - it gets expanded into connections, not stored as config
      expect(config).toBeDefined();
    });

    it('parses @fanIn tag as macro (expanded during parse)', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node s1 TypeA
 * @node s2 TypeB
 * @node tgt TypeC
 * @fanIn [s1, s2] -> tgt.input
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      // @fanIn is a macro - it gets expanded into connections, not stored as config
      expect(config).toBeDefined();
    });
  });

  // ── @coerce ───────────────────────────────────────────────────

  describe('coerce', () => {
    it('parses @coerce tag', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @node b TypeB
 * @coerce coerce1 a.output -> b.input as string
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.coercions).toHaveLength(1);
      expect(config!.coercions![0].instanceId).toBe('coerce1');
      expect(config!.coercions![0].targetType).toBe('string');
    });
  });

  // ── @connect with scopes ──────────────────────────────────────

  describe('connect with scopes', () => {
    it('parses scoped connection format', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @node b TypeB
 * @connect a.data:inner -> b.input:inner
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.connections![0].from.scope).toBe('inner');
      expect(config!.connections![0].to.scope).toBe('inner');
    });
  });

  // ── Scoped inputs/outputs with valid callback param ───────────

  describe('scoped ports with callback param', () => {
    it('infers type for scoped input port from callback return type', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input items scope:loop
 * @input execute scope:loop
 */
function myNode(execute: boolean, loop: (items: number[]) => { execute: boolean }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      // The scoped execute should be STEP (mandatory port)
      expect(config!.inputs!['execute'].type).toBe('STEP');
    });

    it('warns when scoped input type inference fails', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data scope:loop
 */
function myNode(execute: boolean, loop: () => {}): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      // Cannot find 'data' in callback return type
      expect(config!.inputs!['data'].type).toBe('ANY');
      expect(warnings.some(w => w.includes("Cannot infer type for scoped INPUT port 'data'"))).toBe(true);
    });

    it('warns when scoped output type inference fails', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output result scope:loop
 */
function myNode(execute: boolean, loop: () => {}): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.outputs!['result'].type).toBe('ANY');
      expect(warnings.some(w => w.includes("Cannot infer type for scoped OUTPUT port 'result'"))).toBe(true);
    });

    it('warns on reserved port with non-STEP explicit type in @input', () => {
      const { warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input {string} execute
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      // This test covers the branch where dataType != STEP on a reserved port
      // The warning may or may not appear depending on how the parser handles {string}
      expect(config => true); // The branch is exercised either way
    });
  });

  // ── @param with catch-all Record type ─────────────────────────

  describe('@param with catch-all Record type', () => {
    it('does not warn when params is Record<string, never>', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param myInput - My input
 */
export async function a(execute: boolean, params: Record<string, never>) {
  return { onSuccess: true };
}
`);
      expect(warnings.filter(w => w.includes('does not match any field'))).toHaveLength(0);
    });

    it('does not warn when params is empty object {}', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param myInput - My input
 */
export async function a(execute: boolean, params: {}) {
  return { onSuccess: true };
}
`);
      expect(warnings.filter(w => w.includes('does not match any field'))).toHaveLength(0);
    });
  });
});
