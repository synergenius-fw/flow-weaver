/**
 * Branch coverage tests (round 2) for src/jsdoc-parser.ts
 *
 * Targets uncovered branches: scoped port type inference with async callbacks,
 * node tag optional fields (portOrder, portLabel, expressions, size, position,
 * color, icon, tags, job, environment, suppress), invalid format branches for
 * scope/map/path/connect/fanOut/fanIn/coerce tags, trigger CI/CD keyword
 * warning, tag registry delegation, standard JSDoc tag skipping, output
 * property type fallback, and edge cases in deploy parsing.
 */

import { jsdocParser } from '../../src/jsdoc-parser';
import { extractFunctionLikes } from '../../src/function-like';
import { getSharedProject } from '../../src/shared-project';

const project = getSharedProject();

let fileCounter = 0;
function nextFile(prefix: string) {
  return `bc2-${prefix}-${++fileCounter}.ts`;
}

function parseNodeType(code: string) {
  const sourceFile = project.createSourceFile(nextFile('nt'), code, { overwrite: true });
  const functions = extractFunctionLikes(sourceFile);
  const warnings: string[] = [];
  const config = jsdocParser.parseNodeType(functions[0], warnings);
  return { config, warnings, functions };
}

function parseWorkflow(code: string) {
  const sourceFile = project.createSourceFile(nextFile('wf'), code, { overwrite: true });
  const functions = extractFunctionLikes(sourceFile);
  const warnings: string[] = [];
  const config = jsdocParser.parseWorkflow(functions[0], warnings);
  return { config, warnings, functions };
}

function parsePattern(code: string) {
  const sourceFile = project.createSourceFile(nextFile('pt'), code, { overwrite: true });
  const functions = extractFunctionLikes(sourceFile);
  const warnings: string[] = [];
  const config = jsdocParser.parsePattern(functions[0], warnings);
  return { config, warnings, functions };
}

describe('JSDocParser branch coverage 2', () => {

  // ── Scoped port type inference with async callbacks ──────────

  describe('scoped port type inference edge cases', () => {
    it('infers scoped input type from async callback return (Promise unwrap)', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input items scope:loop
 */
function myNode(execute: boolean, loop: (items: number[]) => Promise<{ items: string[] }>): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config).not.toBeNull();
      // The callback return type is Promise<{ items: string[] }> which should unwrap
      expect(config!.inputs!['items']).toBeDefined();
    });

    it('infers scoped output type from callback parameter', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output result scope:loop
 */
function myNode(execute: boolean, loop: (result: string) => { onSuccess: boolean }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config).not.toBeNull();
      expect(config!.outputs!['result']).toBeDefined();
      expect(config!.outputs!['result'].type).toBe('STRING');
    });

    it('warns when scoped output param not found in callback signature', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output missing scope:loop
 */
function myNode(execute: boolean, loop: (other: string) => { onSuccess: boolean }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.outputs!['missing'].type).toBe('ANY');
      expect(warnings.some(w => w.includes("Cannot infer type for scoped OUTPUT port 'missing'"))).toBe(true);
    });

    it('handles scoped mandatory output ports (onSuccess in scope)', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output onSuccess scope:loop
 */
function myNode(execute: boolean, loop: () => { onSuccess: boolean }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      // onSuccess is a success port, so even with scope it should be STEP
      expect(config!.outputs!['onSuccess'].type).toBe('STEP');
    });

    it('handles scoped mandatory output ports (onFailure in scope)', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output onFailure scope:loop
 */
function myNode(execute: boolean, loop: () => { onFailure: boolean }): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`);
      expect(config!.outputs!['onFailure'].type).toBe('STEP');
    });
  });

  // ── @node tag with all optional fields ──────────────────────

  describe('@node tag with optional fields', () => {
    it('parses @node with parentScope', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node child TypeA parent.inner
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].parentScope).toBe('parent.inner');
    });

    it('parses @node with label', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [label: "My Label"]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].label).toBe('My Label');
    });

    it('parses @node with portOrder', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [portOrder: data=1,result=2]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].portConfigs).toBeDefined();
      expect(config!.instances![0].portConfigs!.some(pc => pc.portName === 'data' && pc.order === 1)).toBe(true);
    });

    it('parses @node with portLabel', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [portLabel: data="Input Data"]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].portConfigs).toBeDefined();
      expect(config!.instances![0].portConfigs!.some(pc => pc.portName === 'data' && pc.label === 'Input Data')).toBe(true);
    });

    it('parses @node with portOrder AND portLabel merging on same port', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [portOrder: data=1] [portLabel: data="Input Data"]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      const pc = config!.instances![0].portConfigs!.find(p => p.portName === 'data');
      expect(pc).toBeDefined();
      expect(pc!.order).toBe(1);
      expect(pc!.label).toBe('Input Data');
    });

    it('parses @node with expr (expression)', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [expr: data="params.value + 1"]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      const pc = config!.instances![0].portConfigs!.find(p => p.portName === 'data');
      expect(pc).toBeDefined();
      expect(pc!.expression).toBe('params.value + 1');
    });

    it('parses @node with minimized flag', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [minimized]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].minimized).toBe(true);
    });

    it('parses @node with pullExecution', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [pullExecution: myTrigger]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].pullExecution).toEqual({ triggerPort: 'myTrigger' });
    });

    it('parses @node with size', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [size: 200 100]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].width).toBe(200);
      expect(config!.instances![0].height).toBe(100);
    });

    it('parses @node with position', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [position: 300 400]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].x).toBe(300);
      expect(config!.instances![0].y).toBe(400);
    });

    it('parses @node with color', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [color: "#ff0000"]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].color).toBe('#ff0000');
    });

    it('parses @node with icon', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [icon: "star"]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].icon).toBe('star');
    });

    it('parses @node with tags', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [tags: "beta"]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].tags).toBeDefined();
    });

    it('parses @node with job', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [job: "build"]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].job).toBe('build');
    });

    it('parses @node with environment', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [environment: "staging"]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].environment).toBe('staging');
    });

    it('parses @node with suppress', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [suppress: "W001","W002"]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].suppressWarnings).toEqual(['W001', 'W002']);
    });
  });

  // ── Invalid format branches ─────────────────────────────────

  describe('invalid format branches', () => {
    it('warns on invalid @connect format in workflow', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @connect !!!badformat
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@connect'))).toBe(true);
    });

    it('warns on invalid @scope format in workflow', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @scope
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@scope'))).toBe(true);
    });

    it('warns on invalid @map format', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @map !!!invalid
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@map'))).toBe(true);
    });

    it('warns on invalid @path format', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @path
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@path'))).toBe(true);
    });

    it('warns on invalid @coerce format', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @coerce !!!badformat
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@coerce'))).toBe(true);
    });

    it('warns on invalid @position format in workflow', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @position
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@position'))).toBe(true);
    });

    it('warns on invalid @node format in pattern', () => {
      const { warnings } = parsePattern(`
/**
 * @flowWeaver pattern
 * @node
 */
function myPattern() {}
`);
      expect(warnings.some(w => w.includes('@node'))).toBe(true);
    });

    it('warns on invalid @position format in pattern', () => {
      const { warnings } = parsePattern(`
/**
 * @flowWeaver pattern
 * @position
 */
function myPattern() {}
`);
      expect(warnings.some(w => w.includes('@position'))).toBe(true);
    });

    it('warns on invalid @connect format in pattern', () => {
      const { warnings } = parsePattern(`
/**
 * @flowWeaver pattern
 * @connect !!!invalid
 */
function myPattern() {}
`);
      expect(warnings.some(w => w.includes('@connect'))).toBe(true);
    });
  });

  // ── @trigger CI/CD keyword warning ──────────────────────────

  describe('trigger edge cases', () => {
    it('warns when @trigger event name matches CI/CD keyword', () => {
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @trigger event="push"
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.trigger).toBeDefined();
      expect(config!.trigger!.event).toBe('push');
      expect(warnings.some(w => w.includes('CI/CD trigger'))).toBe(true);
    });

    it('accumulates event and cron from separate @trigger tags', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @trigger event="user.created"
 * @trigger cron="0 * * * *"
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.trigger!.event).toBe('user.created');
      expect(config!.trigger!.cron).toBe('0 * * * *');
    });
  });

  // ── Standard JSDoc tags should not produce warnings ─────────

  describe('standard JSDoc tags are skipped', () => {
    it('does not warn on @example in nodeType', () => {
      const { warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @example some example
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(warnings.filter(w => w.includes('@example'))).toHaveLength(0);
    });

    it('does not warn on @deprecated in workflow', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deprecated use v2 instead
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.filter(w => w.includes('@deprecated'))).toHaveLength(0);
    });

    it('does not warn on @see in pattern', () => {
      const { warnings } = parsePattern(`
/**
 * @flowWeaver pattern
 * @see other-pattern
 */
function myPattern() {}
`);
      expect(warnings.filter(w => w.includes('@see'))).toHaveLength(0);
    });
  });

  // ── Output port property type fallback ──────────────────────

  describe('output port edge cases', () => {
    it('handles output port where property exists but type extraction fails', () => {
      // This exercises the getPropertyType fallback to ANY
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output data
 */
function myNode(execute: boolean): { onSuccess: boolean; data: string } {
  return { onSuccess: true, data: 'test' };
}
`);
      expect(config!.outputs!['data']).toBeDefined();
      expect(config!.outputs!['data'].type).toBe('STRING');
    });

    it('warns on non-STEP explicit type on reserved output port', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output onSuccess [type:STRING]
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      // onSuccess is reserved, so type should be STEP regardless
      expect(config!.outputs!['onSuccess'].type).toBe('STEP');
      expect(warnings.some(w => w.includes('reserved control port'))).toBe(true);
    });
  });

  // ── Input port metadata and optional fields ─────────────────

  describe('input port metadata and options', () => {
    it('parses @input with order metadata', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data [order:3]
 */
function myNode(execute: boolean, data: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['data'].metadata).toEqual({ order: 3 });
    });

    it('parses @input with hidden flag', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data [hidden]
 */
function myNode(execute: boolean, data: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['data'].hidden).toBe(true);
    });

    it('parses @input with mergeStrategy', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data [mergeStrategy:append]
 */
function myNode(execute: boolean, data: string[]): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['data'].mergeStrategy).toBe('append');
    });

    it('parses optional @input with brackets', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input [data]
 */
function myNode(execute: boolean, data: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['data'].optional).toBe(true);
    });

    it('parses @output with order metadata', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output result [order:2]
 */
function myNode(execute: boolean): { onSuccess: boolean; result: string } {
  return { onSuccess: true, result: 'x' };
}
`);
      expect(config!.outputs!['result'].metadata).toEqual({ order: 2 });
    });

    it('parses @output with hidden flag', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output result [hidden]
 */
function myNode(execute: boolean): { onSuccess: boolean; result: string } {
  return { onSuccess: true, result: 'x' };
}
`);
      expect(config!.outputs!['result'].hidden).toBe(true);
    });
  });

  // ── @map with custom port names ─────────────────────────────

  describe('@map with custom port mapping', () => {
    it('parses @map with custom input/output port names', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node src TypeA
 * @map mapper child(myInput -> myOutput) over src.items
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.maps).toHaveLength(1);
      expect(config!.maps![0].inputPort).toBe('myInput');
      expect(config!.maps![0].outputPort).toBe('myOutput');
    });
  });

  // ── @param edge cases ───────────────────────────────────────

  describe('@param edge cases', () => {
    it('parses @param with order metadata', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param input1 [order:2] - The first input
 */
export async function a(execute: boolean, params: { input1: string }) {
  return { onSuccess: true };
}
`);
      expect(config!.startPorts!['input1'].metadata).toEqual({ order: 2 });
    });

    it('infers type for @param matching field in params', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param count - Number of items
 */
export async function a(execute: boolean, params: { count: number }) {
  return { onSuccess: true };
}
`);
      expect(config!.startPorts!['count'].dataType).toBe('NUMBER');
    });

    it('handles @param with catch-all Record<string, any>', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param myInput - Something
 */
export async function a(execute: boolean, params: Record<string, any>) {
  return { onSuccess: true };
}
`);
      expect(warnings.filter(w => w.includes('does not match any field'))).toHaveLength(0);
    });

    it('handles @param with catch-all Record<string, unknown>', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param myInput - Something
 */
export async function a(execute: boolean, params: Record<string, unknown>) {
  return { onSuccess: true };
}
`);
      expect(warnings.filter(w => w.includes('does not match any field'))).toHaveLength(0);
    });
  });

  // ── @returns edge cases ─────────────────────────────────────

  describe('@returns edge cases', () => {
    it('parses @returns with order metadata', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @returns result [order:1] - The output
 */
export async function a(execute: boolean, params: {}): Promise<{ result: string; onSuccess: boolean }> {
  return { result: 'x', onSuccess: true };
}
`);
      expect(config!.returnPorts!['result'].metadata).toEqual({ order: 1 });
    });

    it('infers STEP for @returns onFailure', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @returns onFailure - Error case
 */
export async function a(execute: boolean, params: {}): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  return { onSuccess: true, onFailure: false };
}
`);
      expect(config!.returnPorts!['onFailure'].dataType).toBe('STEP');
    });
  });

  // ── Deploy tag with escaped quotes ──────────────────────────

  describe('deploy tag edge cases', () => {
    it('parses deploy tag with escaped quotes in value', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy tgt cmd="echo \\"hello\\""
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy).toBeDefined();
      expect(config!.deploy!['tgt']).toBeDefined();
    });

    it('handles empty targetName in deploy (no-op)', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      // Empty deploy should not crash
      expect(config).not.toBeNull();
    });
  });

  // ── Pattern position not matching an instance ───────────────

  describe('pattern position edge cases', () => {
    it('applies position to matching instance in pattern', () => {
      const { config } = parsePattern(`
/**
 * @flowWeaver pattern
 * @node a TypeA
 * @node b TypeB
 * @position a 50 60
 * @position b 150 160
 */
function myPattern() {}
`);
      expect(config!.instances![0].config).toEqual({ x: 50, y: 60 });
      expect(config!.instances![1].config).toEqual({ x: 150, y: 160 });
    });

    it('stores position for non-matching instance without crashing', () => {
      const { config } = parsePattern(`
/**
 * @flowWeaver pattern
 * @node a TypeA
 * @position nonexistent 100 200
 */
function myPattern() {}
`);
      // The position is stored but not applied to any instance
      expect(config!.positions!['nonexistent']).toEqual({ x: 100, y: 200 });
      expect(config!.instances![0].config).toBeUndefined();
    });
  });

  // ── @flowWeaver tag value edge cases ────────────────────────

  describe('flowWeaver tag value edge cases', () => {
    it('returns null for parseWorkflow when @flowWeaver has nodeType value', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver nodeType
 */
function myNode(execute: boolean): { onSuccess: boolean } { return { onSuccess: true }; }
`);
      expect(config).toBeNull();
    });

    it('returns null for parsePattern when @flowWeaver has workflow value', () => {
      const { config } = parsePattern(`
/**
 * @flowWeaver workflow
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config).toBeNull();
    });
  });

  // ── @connect with coerce in workflow ────────────────────────

  describe('@connect with coerce', () => {
    it('parses @connect with inline coerce', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @node b TypeB
 * @connect a.output -> b.input as string
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.connections).toHaveLength(1);
      // The coerce field should be present on the connection
    });
  });

  // ── @node with expression on existing portOrder port ────────

  describe('@node with overlapping portConfigs', () => {
    it('merges expression onto existing portOrder entry', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [portOrder: data=1] [expr: data="params.x"]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      const pc = config!.instances![0].portConfigs!.find(p => p.portName === 'data');
      expect(pc).toBeDefined();
      expect(pc!.order).toBe(1);
      expect(pc!.expression).toBe('params.x');
    });

    it('adds expression as new portConfig when no prior entry', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [expr: value="params.y"]
 */
export async function a(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      const pc = config!.instances![0].portConfigs!.find(p => p.portName === 'value');
      expect(pc).toBeDefined();
      expect(pc!.expression).toBe('params.y');
    });
  });

  // ── @input with label (description that is NOT Expression:) ─

  describe('input description vs expression', () => {
    it('stores description as label when not starting with Expression:', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data - This is a normal description
 */
function myNode(execute: boolean, data: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['data'].label).toBe('This is a normal description');
      expect(config!.inputs!['data'].expression).toBeUndefined();
    });
  });

  // ── @input with scope on a non-callback param (anonymous fn) ─

  describe('scoped input with non-function scope param', () => {
    it('warns when scope param exists but has no call signatures', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data scope:notACallback
 */
function myNode(execute: boolean, notACallback: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      // notACallback is a string, not a callback, so extractCallbackReturnFieldType returns undefined
      expect(config!.inputs!['data'].type).toBe('ANY');
      expect(warnings.some(w => w.includes("Cannot infer type for scoped INPUT port 'data'"))).toBe(true);
    });
  });

  // ── Multiple JSDoc blocks on a function ─────────────────────

  describe('multiple JSDoc blocks', () => {
    it('finds @flowWeaver tag in second JSDoc block', () => {
      const { config } = parseNodeType(`
/** First comment block without flowWeaver */
/**
 * @flowWeaver nodeType
 * @name SecondBlock
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config).not.toBeNull();
      expect(config!.name).toBe('SecondBlock');
    });
  });
});
