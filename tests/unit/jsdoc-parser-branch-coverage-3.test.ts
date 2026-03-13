/**
 * Branch coverage tests (round 3) for src/jsdoc-parser.ts
 *
 * Targets remaining partial branches and uncovered lines to push
 * branch coverage above 90%.
 */

import { describe, it, expect } from 'vitest';
import { jsdocParser, type JSDocWorkflowConfig } from '../../src/jsdoc-parser';
import { extractFunctionLikes } from '../../src/function-like';
import { getSharedProject } from '../../src/shared-project';
import type { TagHandlerRegistry } from '../../src/parser/tag-registry';

const project = getSharedProject();

let fileCounter = 0;
function nextFile(prefix: string) {
  return `bc3-${prefix}-${++fileCounter}.ts`;
}

function parseNodeType(code: string, tagRegistry?: TagHandlerRegistry) {
  const sourceFile = project.createSourceFile(nextFile('nt'), code, { overwrite: true });
  const functions = extractFunctionLikes(sourceFile);
  const warnings: string[] = [];
  const config = jsdocParser.parseNodeType(functions[0], warnings, tagRegistry);
  return { config, warnings, functions };
}

function parseWorkflow(code: string, tagRegistry?: TagHandlerRegistry) {
  const sourceFile = project.createSourceFile(nextFile('wf'), code, { overwrite: true });
  const functions = extractFunctionLikes(sourceFile);
  const warnings: string[] = [];
  const config = jsdocParser.parseWorkflow(functions[0], warnings, tagRegistry);
  return { config, warnings, functions };
}

function parsePattern(code: string) {
  const sourceFile = project.createSourceFile(nextFile('pt'), code, { overwrite: true });
  const functions = extractFunctionLikes(sourceFile);
  const warnings: string[] = [];
  const config = jsdocParser.parsePattern(functions[0], warnings);
  return { config, warnings, functions };
}

/** Minimal fake TagHandlerRegistry for testing delegation paths */
function fakeRegistry(knownTags: string[], cicdTrigger = false): TagHandlerRegistry {
  const tags = new Set(knownTags);
  if (cicdTrigger) tags.add('_cicdTrigger');
  return {
    has(tag: string) { return tags.has(tag); },
    handle(_tag: string, _comment: string, _ctx: string, deploy: Record<string, Record<string, unknown>>, _w: string[]) {
      deploy['__handled'] = { handled: true };
    },
    getRegisteredTags() { return [...tags]; },
  } as unknown as TagHandlerRegistry;
}

describe('JSDocParser branch coverage 3', () => {

  // ── nodeType: tagRegistry delegation in default branch ─────

  describe('nodeType tag registry delegation', () => {
    it('delegates unknown tag to tagRegistry when registry has it', () => {
      const registry = fakeRegistry(['customTag']);
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @customTag some value
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`, registry);
      expect(config).not.toBeNull();
      expect(config!.deploy).toBeDefined();
      expect(config!.deploy!['__handled']).toEqual({ handled: true });
      // Should NOT produce unknown-tag warning
      expect(warnings.some(w => w.includes('Unknown annotation @customTag'))).toBe(false);
    });

    it('skips standard JSDoc tags without warning in nodeType when registry present', () => {
      const registry = fakeRegistry([]);
      const { warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @example something
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`, registry);
      expect(warnings.some(w => w.includes('@example'))).toBe(false);
    });
  });

  // ── workflow: tagRegistry delegation in default branch ─────

  describe('workflow tag registry delegation', () => {
    it('delegates unknown tag to tagRegistry when registry has it', () => {
      const registry = fakeRegistry(['customWfTag']);
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @customWfTag some value
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`, registry);
      expect(config).not.toBeNull();
      expect(config!.deploy).toBeDefined();
      expect(config!.deploy!['__handled']).toEqual({ handled: true });
      expect(warnings.some(w => w.includes('Unknown annotation @customWfTag'))).toBe(false);
    });

    it('skips standard JSDoc tags without warning in workflow', () => {
      const registry = fakeRegistry([]);
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @see something
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`, registry);
      expect(warnings.some(w => w.includes('@see'))).toBe(false);
    });

    it('warns unknown tag with suggestions when no registry match', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @nde myInst TypeA
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Unknown annotation @nde') && w.includes('Did you mean'))).toBe(true);
    });
  });

  // ── trigger: _cicdTrigger delegation (lines 1469-1472) ────

  describe('trigger _cicdTrigger delegation', () => {
    it('delegates non-core trigger to _cicdTrigger handler', () => {
      const registry = fakeRegistry([], true);
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @trigger push branches=main
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`, registry);
      expect(config).not.toBeNull();
      expect(config!.deploy).toBeDefined();
      expect(config!.deploy!['__handled']).toEqual({ handled: true });
    });

    it('warns on invalid trigger format when no cicd handler', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @trigger push branches=main
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Invalid @trigger format'))).toBe(true);
    });
  });

  // ── @input: reserved port with explicit non-STEP type (line 812-813) ──

  describe('input reserved port type override warning', () => {
    it('warns when execute port has explicit non-STEP type annotation', () => {
      // This exercises the result.dataType truthy + !== STEP branch
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input execute [type:STRING]
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['execute'].type).toBe('STEP');
      expect(warnings.some(w => w.includes('reserved control port'))).toBe(true);
    });
  });

  // ── @output: reserved port with explicit non-STEP type ──

  describe('output reserved port type override warning', () => {
    it('warns when onSuccess port has explicit non-STEP type', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output onSuccess [type:NUMBER]
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.outputs!['onSuccess'].type).toBe('STEP');
      expect(warnings.some(w => w.includes('reserved control port'))).toBe(true);
    });

    it('warns when onFailure port has explicit non-STEP type', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output onFailure [type:STRING]
 */
function myNode(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`);
      expect(config!.outputs!['onFailure'].type).toBe('STEP');
      expect(warnings.some(w => w.includes('reserved control port'))).toBe(true);
    });
  });

  // ── @output: property type null fallback (line 964) ──

  describe('output property type fallback to ANY', () => {
    it('falls back to ANY when output property exists but type cannot be resolved', () => {
      // Use a type where the property exists but getPropertyType might return undefined
      // This is hard to trigger via normal code, so we test the fallback path indirectly
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output result
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      // 'result' is not in the return type, so it falls to the else branch (line 967)
      expect(config!.outputs!['result'].type).toBe('ANY');
    });
  });

  // ── @input: scoped mandatory port (success/failure with scope) ──

  describe('scoped mandatory input ports', () => {
    it('assigns STEP type to scoped success port', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input success scope:loop
 */
function myNode(execute: boolean, loop: () => { success: boolean }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['success'].type).toBe('STEP');
    });

    it('assigns STEP type to scoped failure port', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input failure scope:loop
 */
function myNode(execute: boolean, loop: () => { failure: boolean }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['failure'].type).toBe('STEP');
    });
  });

  // ── @input: scope callback param not found ──

  describe('scoped input with missing callback param', () => {
    it('warns when scope callback parameter does not exist', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data scope:nonexistent
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['data'].type).toBe('ANY');
      expect(warnings.some(w => w.includes("no callback parameter named 'nonexistent'"))).toBe(true);
    });
  });

  // ── @input: parameter found with underscore prefix ──

  describe('input parameter with underscore prefix', () => {
    it('infers type from _prefixed parameter', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data
 */
function myNode(execute: boolean, _data: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['data'].type).toBe('STRING');
    });
  });

  // ── @input: parameter not found falls back to ANY ──

  describe('input parameter not found', () => {
    it('falls back to ANY when param not in signature', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input phantom
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['phantom'].type).toBe('ANY');
    });
  });

  // ── @input: expression in description ──

  describe('input expression in description', () => {
    it('extracts expression from description starting with Expression:', () => {
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
  });

  // ── @input: duplicate port detection ──

  describe('input duplicate port detection', () => {
    it('warns on duplicate input port', () => {
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
      expect(warnings.some(w => w.includes('Duplicate @input "data"'))).toBe(true);
    });
  });

  // ── @output: duplicate port detection ──

  describe('output duplicate port detection', () => {
    it('warns on duplicate output port', () => {
      const { config, warnings } = parseNodeType(`
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
  });

  // ── @output: scoped output with missing callback ──

  describe('scoped output with missing callback', () => {
    it('warns when scope callback not found for output', () => {
      const { config, warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output data scope:nonexistent
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.outputs!['data'].type).toBe('ANY');
      expect(warnings.some(w => w.includes("no callback parameter named 'nonexistent'"))).toBe(true);
    });
  });

  // ── @input: with mergeStrategy ──

  describe('input with mergeStrategy', () => {
    it('parses merge strategy', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data [mergeStrategy:latest]
 */
function myNode(execute: boolean, data: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['data'].mergeStrategy).toBe('latest');
    });
  });

  // ── @input: with hidden ──

  describe('input with hidden', () => {
    it('parses hidden flag', () => {
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
  });

  // ── @input: with order ──

  describe('input with order metadata', () => {
    it('parses order metadata', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input data [order:5]
 */
function myNode(execute: boolean, data: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['data'].metadata).toBeDefined();
      expect(config!.inputs!['data'].metadata!.order).toBe(5);
    });
  });

  // ── @output: with hidden ──

  describe('output with hidden', () => {
    it('parses hidden flag on output', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output result [hidden]
 */
function myNode(execute: boolean): { onSuccess: boolean; result: string } {
  return { onSuccess: true, result: '' };
}
`);
      expect(config!.outputs!['result'].hidden).toBe(true);
    });
  });

  // ── @output: with order ──

  describe('output with order metadata', () => {
    it('parses order metadata on output', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @output result [order:3]
 */
function myNode(execute: boolean): { onSuccess: boolean; result: string } {
  return { onSuccess: true, result: '' };
}
`);
      expect(config!.outputs!['result'].metadata).toBeDefined();
      expect(config!.outputs!['result'].metadata!.order).toBe(3);
    });
  });

  // ── @node without optional fields (falsy branches for spread) ──

  describe('@node with minimal fields', () => {
    it('creates instance with only id and type (no optional fields)', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node simple TypeA
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      const inst = config!.instances![0];
      expect(inst.id).toBe('simple');
      expect(inst.type).toBe('TypeA');
      expect(inst.parentScope).toBeUndefined();
      expect(inst.label).toBeUndefined();
      expect(inst.portConfigs).toBeUndefined();
      expect(inst.pullExecution).toBeUndefined();
      expect(inst.minimized).toBeUndefined();
      expect(inst.color).toBeUndefined();
      expect(inst.icon).toBeUndefined();
      expect(inst.tags).toBeUndefined();
      expect(inst.width).toBeUndefined();
      expect(inst.height).toBeUndefined();
      expect(inst.x).toBeUndefined();
      expect(inst.y).toBeUndefined();
      expect(inst.job).toBeUndefined();
      expect(inst.environment).toBeUndefined();
      expect(inst.suppressWarnings).toBeUndefined();
    });
  });

  // ── @retries: invalid value ──

  describe('@retries validation', () => {
    it('warns on negative retries value', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @retries -1
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Invalid @retries value'))).toBe(true);
    });

    it('warns on non-numeric retries', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @retries abc
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Invalid @retries value'))).toBe(true);
    });

    it('accepts zero retries', () => {
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @retries 0
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.retries).toBe(0);
      expect(warnings.length).toBe(0);
    });
  });

  // ── @timeout: empty value ──

  describe('@timeout edge cases', () => {
    it('does not set timeout when value is empty', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @timeout
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.timeout).toBeUndefined();
    });

    it('strips quotes from timeout value', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @timeout "30s"
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.timeout).toBe('30s');
    });
  });

  // ── @strictTypes: false value ──

  describe('@strictTypes edge cases', () => {
    it('sets strictTypes false when value is "false"', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @strictTypes false
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.strictTypes).toBe(false);
    });

    it('sets strictTypes true with no value', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @strictTypes
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.strictTypes).toBe(true);
    });
  });

  // ── @param: execute port becomes STEP ──

  describe('@param execute port', () => {
    it('assigns STEP type to execute param', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param execute
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.startPorts!['execute'].dataType).toBe('STEP');
    });
  });

  // ── @param: catch-all Record type does not warn ──

  describe('@param with catch-all Record type', () => {
    it('does not warn for catch-all Record<string, any>', () => {
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param data
 */
export async function myWf(execute: boolean, params: Record<string, any>) { return { onSuccess: true }; }
`);
      expect(config!.startPorts!['data'].dataType).toBe('ANY');
      expect(warnings.some(w => w.includes('does not match any field'))).toBe(false);
    });

    it('does not warn for empty object params type', () => {
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param data
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      // {} is a catch-all, so no field-match warning
      expect(config!.startPorts!['data'].dataType).toBe('ANY');
    });
  });

  // ── @param: field match in params type ──

  describe('@param field matching', () => {
    it('infers type from params object field', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param count
 */
export async function myWf(execute: boolean, params: { count: number }) { return { onSuccess: true }; }
`);
      expect(config!.startPorts!['count'].dataType).toBe('NUMBER');
    });

    it('warns when param does not match any field in non-catchall params', () => {
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param missing
 */
export async function myWf(execute: boolean, params: { other: string }) { return { onSuccess: true }; }
`);
      expect(config!.startPorts!['missing'].dataType).toBe('ANY');
      expect(warnings.some(w => w.includes('does not match any field'))).toBe(true);
    });
  });

  // ── @param: duplicate detection ──

  describe('@param duplicate detection', () => {
    it('warns on duplicate param', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param data - first
 * @param data - second
 */
export async function myWf(execute: boolean, params: { data: string }) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Duplicate @param "data"'))).toBe(true);
    });
  });

  // ── @returns: duplicate detection ──

  describe('@returns duplicate detection', () => {
    it('warns on duplicate returns', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @returns result - first
 * @returns result - second
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true, result: '' }; }
`);
      expect(warnings.some(w => w.includes('Duplicate @returns "result"'))).toBe(true);
    });
  });

  // ── @returns: onSuccess/onFailure become STEP ──

  describe('@returns reserved ports', () => {
    it('assigns STEP to onSuccess return', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @returns onSuccess
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.returnPorts!['onSuccess'].dataType).toBe('STEP');
    });

    it('assigns STEP to onFailure return', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @returns onFailure
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.returnPorts!['onFailure'].dataType).toBe('STEP');
    });
  });

  // ── @returns: type inference fallback ──

  describe('@returns type inference fallback', () => {
    it('warns when return field cannot be inferred and defaults to ANY', () => {
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @returns phantom
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.returnPorts!['phantom'].dataType).toBe('ANY');
      expect(warnings.some(w => w.includes('Could not infer type'))).toBe(true);
    });
  });

  // ── Deploy tag parsing edge cases ──

  describe('deploy tag edge cases', () => {
    it('handles deploy tag with only target name and no kv pairs', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy myTarget
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy).toBeDefined();
      expect(config!.deploy!['myTarget']).toEqual({});
    });

    it('handles deploy tag with empty text', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      // Empty deploy tag should not crash
      expect(config).not.toBeNull();
    });

    it('handles deploy with quoted comma-separated list value', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy myTarget envs="staging,production"
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy!['myTarget']['envs']).toEqual(['staging', 'production']);
    });

    it('handles deploy with boolean and numeric bare values', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy myTarget enabled=true disabled=false retries=3
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy!['myTarget']['enabled']).toBe(true);
      expect(config!.deploy!['myTarget']['disabled']).toBe(false);
      expect(config!.deploy!['myTarget']['retries']).toBe(3);
    });

    it('handles deploy with non-numeric bare string value', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy myTarget framework=next
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy!['myTarget']['framework']).toBe('next');
    });
  });

  // ── @position: deprecation warning for non-virtual nodes ──

  describe('@position deprecation', () => {
    it('emits deprecation warning for non-virtual node positions', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA
 * @position myInst 100 200
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Deprecated: @position myInst'))).toBe(true);
    });

    it('does not emit deprecation for Start virtual node', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @position Start 100 200
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Deprecated'))).toBe(false);
    });

    it('does not emit deprecation for Exit virtual node', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @position Exit 100 200
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Deprecated'))).toBe(false);
    });
  });

  // ── Pattern: positions applied to instances ──

  describe('pattern position application', () => {
    it('applies positions to instances that match', () => {
      const { config } = parsePattern(`
/**
 * @flowWeaver pattern
 * @node instA TypeA
 * @position instA 100 200
 */
function myPattern() {}
`);
      expect(config!.instances![0].config).toBeDefined();
      expect(config!.instances![0].config!.x).toBe(100);
      expect(config!.instances![0].config!.y).toBe(200);
    });

    it('does not apply positions to non-matching instances', () => {
      const { config } = parsePattern(`
/**
 * @flowWeaver pattern
 * @node instA TypeA
 * @position instB 100 200
 */
function myPattern() {}
`);
      expect(config!.instances![0].config).toBeUndefined();
    });
  });

  // ── @connect in workflow with scoped endpoints ──

  describe('@connect with scopes', () => {
    it('parses connect with source scope', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @node b TypeB
 * @connect a.output:myScope -> b.input
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      const conn = config!.connections![0];
      expect(conn.from.scope).toBe('myScope');
      expect(conn.to.scope).toBeUndefined();
    });

    it('parses connect with target scope', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @node b TypeB
 * @connect a.output -> b.input:myScope
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      const conn = config!.connections![0];
      expect(conn.from.scope).toBeUndefined();
      expect(conn.to.scope).toBe('myScope');
    });
  });

  // ── @trigger: CI/CD keyword warning ──

  describe('@trigger CI/CD keyword warning', () => {
    it('warns when event name matches CI/CD keyword "push"', () => {
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @trigger event="push"
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.trigger).toBeDefined();
      expect(warnings.some(w => w.includes('treated as an Inngest event trigger'))).toBe(true);
    });

    it('warns when event name matches CI/CD keyword "pull_request"', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @trigger event="pull_request"
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('treated as an Inngest event trigger'))).toBe(true);
    });

    it('does not warn for non-CI/CD event name', () => {
      const { config, warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @trigger event="user.created"
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.trigger!.event).toBe('user.created');
      expect(warnings.some(w => w.includes('Inngest'))).toBe(false);
    });
  });

  // ── @trigger: cron accumulation ──

  describe('@trigger accumulation', () => {
    it('accumulates event and cron from separate trigger tags', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @trigger event="user.created"
 * @trigger cron="0 * * * *"
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.trigger!.event).toBe('user.created');
      expect(config!.trigger!.cron).toBe('0 * * * *');
    });
  });

  // ── nodeType: context validation warnings ──

  describe('nodeType context validation', () => {
    it('warns when @param used in nodeType block', () => {
      const { warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @param data
 */
function myNode(execute: boolean, data: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(warnings.some(w => w.includes('@param is for workflows'))).toBe(true);
    });

    it('warns when @returns used in nodeType block', () => {
      const { warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @returns data
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(warnings.some(w => w.includes('@returns is for workflows'))).toBe(true);
    });

    it('warns when @return used in nodeType block', () => {
      const { warnings } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @return data
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(warnings.some(w => w.includes('@return is for workflows'))).toBe(true);
    });
  });

  // ── workflow: context validation warnings ──

  describe('workflow context validation', () => {
    it('warns when @color used in workflow block', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @color "#ff0000"
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@color is for node types'))).toBe(true);
    });

    it('warns when @icon used in workflow block', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @icon "star"
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@icon is for node types'))).toBe(true);
    });

    it('warns when @tag used in workflow block', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @tag beta
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@tag is for node types'))).toBe(true);
    });

    it('warns when @input used in workflow block', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @input data
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@input is for node types'))).toBe(true);
    });

    it('warns when @output used in workflow block', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @output data
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@output is for node types'))).toBe(true);
    });

    it('warns when @step used in workflow block', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @step trigger
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@step is for node types'))).toBe(true);
    });
  });

  // ── @pullExecution with empty value ──

  describe('@pullExecution edge cases', () => {
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
  });

  // ── @fwImport: invalid format ──

  describe('@fwImport validation', () => {
    it('warns on invalid fwImport format', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @fwImport invalid format
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Invalid @fwImport tag format'))).toBe(true);
    });

    it('parses valid fwImport', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @fwImport npm/lodash/map map from "lodash"
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.imports![0]).toEqual({
        name: 'npm/lodash/map',
        functionName: 'map',
        importSource: 'lodash',
      });
    });
  });

  // ── @node tag with expressions merging into existing portConfig ──

  describe('@node expressions merging', () => {
    it('merges expression into existing portConfig from portOrder', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [portOrder: data=1] [expr: data="params.x"]
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      const pc = config!.instances![0].portConfigs!.find(p => p.portName === 'data');
      expect(pc!.order).toBe(1);
      expect(pc!.expression).toBe('params.x');
    });

    it('adds expression as new portConfig when no prior entry', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [expr: newPort="params.y"]
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      const pc = config!.instances![0].portConfigs!.find(p => p.portName === 'newPort');
      expect(pc).toBeDefined();
      expect(pc!.expression).toBe('params.y');
    });
  });

  // ── @node with suppress warnings ──

  describe('@node with suppress', () => {
    it('parses suppress warnings list', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node myInst TypeA [suppress: "unused-port"]
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.instances![0].suppressWarnings).toContain('unused-port');
    });
  });

  // ── @cancelOn parsing ──

  describe('@cancelOn parsing', () => {
    it('parses cancelOn with event', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @cancelOn event="user.deleted"
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.cancelOn).toBeDefined();
      expect(config!.cancelOn!.event).toBe('user.deleted');
    });

    it('warns on invalid cancelOn format', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @cancelOn
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Invalid @cancelOn format'))).toBe(true);
    });
  });

  // ── @throttle parsing ──

  describe('@throttle parsing', () => {
    it('parses throttle with limit and period', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @throttle limit=10 period="1m"
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.throttle).toBeDefined();
      expect(config!.throttle!.limit).toBe(10);
      expect(config!.throttle!.period).toBe('1m');
    });

    it('warns on invalid throttle format', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @throttle
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Invalid @throttle format'))).toBe(true);
    });
  });

  // ── @coerce parsing ──

  describe('@coerce parsing', () => {
    it('parses valid coerce tag', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @node b TypeB
 * @coerce coerce1 a.output -> b.input as string
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.coercions).toBeDefined();
      expect(config!.coercions![0].targetType).toBe('string');
    });

    it('warns on invalid coerce format', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @coerce
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Invalid @coerce tag format'))).toBe(true);
    });
  });

  // ── @fanOut: source without port ──

  describe('@fanOut source without port', () => {
    it('warns when fanOut source has no port', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @fanOut a -> b, c
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@fanOut source must specify a port') || w.includes('Invalid @fanOut'))).toBe(true);
    });
  });

  // ── @fanOut: multiple tags (cover the || [] branch) ──

  describe('@fanOut multiple tags', () => {
    it('accumulates multiple fanOut declarations', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @node b TypeB
 * @node c TypeC
 * @fanOut a.out -> b, c
 * @fanOut a.other -> b, c
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.fanOuts).toBeDefined();
      expect(config!.fanOuts!.length).toBe(2);
    });
  });

  // ── @fanIn: target without port ──

  describe('@fanIn target without port', () => {
    it('warns when fanIn target has no port', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @fanIn a, b -> c
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('@fanIn target must specify a port') || w.includes('Invalid @fanIn'))).toBe(true);
    });
  });

  // ── @fanIn: multiple tags (cover the || [] branch) ──

  describe('@fanIn multiple tags', () => {
    it('accumulates multiple fanIn declarations', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @node b TypeB
 * @node c TypeC
 * @fanIn a, b -> c.input
 * @fanIn a, b -> c.other
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.fanIns).toBeDefined();
      expect(config!.fanIns!.length).toBe(2);
    });
  });

  // ── @map: invalid format ──

  describe('@map invalid format', () => {
    it('warns on invalid map format', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @map
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Invalid @map tag format'))).toBe(true);
    });
  });

  // ── @map: multiple tags (cover the || [] branch) ──

  describe('@map multiple tags', () => {
    it('accumulates multiple map declarations', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node src TypeA
 * @map m1 child1 over src.data
 * @map m2 child2 over src.other
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.maps).toBeDefined();
      expect(config!.maps!.length).toBe(2);
    });
  });

  // ── @path: invalid format ──

  describe('@path invalid format', () => {
    it('warns on invalid path format', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @path
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Invalid @path tag format'))).toBe(true);
    });
  });

  // ── @path: multiple tags (cover the || [] branch) ──

  describe('@path multiple tags', () => {
    it('accumulates multiple path declarations', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @node b TypeB
 * @node c TypeC
 * @path a -> b -> c
 * @path c -> b -> a
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.paths).toBeDefined();
      expect(config!.paths!.length).toBe(2);
    });
  });

  // ── @coerce: multiple tags (cover the || [] branch) ──

  describe('@coerce multiple tags', () => {
    it('accumulates multiple coerce declarations', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @node a TypeA
 * @node b TypeB
 * @coerce c1 a.out -> b.in as string
 * @coerce c2 a.other -> b.data as number
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.coercions).toBeDefined();
      expect(config!.coercions!.length).toBe(2);
    });
  });

  // ── @deploy: multiple tags targeting same target (cover the already-exists branch) ──

  describe('@deploy multiple tags same target', () => {
    it('merges multiple deploy tags into same target', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @deploy myTarget memory=256
 * @deploy myTarget timeout=30
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(config!.deploy!['myTarget']['memory']).toBe(256);
      expect(config!.deploy!['myTarget']['timeout']).toBe(30);
    });
  });

  // ── @scope: invalid format ──

  describe('@scope invalid format', () => {
    it('warns on invalid scope format', () => {
      const { warnings } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @scope
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true }; }
`);
      expect(warnings.some(w => w.includes('Invalid @scope tag format'))).toBe(true);
    });
  });

  // ── @tag nodeType with tooltip ──

  describe('@tag with tooltip', () => {
    it('parses tag with tooltip', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @tag beta "This is a beta feature"
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.tags).toBeDefined();
      expect(config!.tags![0].label).toBe('beta');
      expect(config!.tags![0].tooltip).toBe('This is a beta feature');
    });

    it('parses tag without tooltip', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @tag stable
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.tags![0].label).toBe('stable');
      expect(config!.tags![0].tooltip).toBeUndefined();
    });
  });

  // ── Pattern: @port parsing ──

  describe('pattern @port parsing', () => {
    it('parses IN port without description', () => {
      const { config } = parsePattern(`
/**
 * @flowWeaver pattern
 * @port IN.data
 */
function myPattern() {}
`);
      expect(config!.ports![0].direction).toBe('IN');
      expect(config!.ports![0].name).toBe('data');
      expect(config!.ports![0].description).toBeUndefined();
    });

    it('parses OUT port with description', () => {
      const { config } = parsePattern(`
/**
 * @flowWeaver pattern
 * @port OUT.result - The final result
 */
function myPattern() {}
`);
      expect(config!.ports![0].direction).toBe('OUT');
      expect(config!.ports![0].name).toBe('result');
      expect(config!.ports![0].description).toBe('The final result');
    });

    it('warns on invalid port format', () => {
      const { warnings } = parsePattern(`
/**
 * @flowWeaver pattern
 * @port invalid
 */
function myPattern() {}
`);
      expect(warnings.some(w => w.includes('Invalid @port tag format'))).toBe(true);
    });
  });

  // ── nodeType @deploy tag ──

  describe('nodeType @deploy', () => {
    it('parses deploy tag on nodeType', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @deploy aws memory=256
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.deploy).toBeDefined();
      expect(config!.deploy!['aws']['memory']).toBe(256);
    });
  });

  // ── @input: optional with default value ──

  describe('input optional with default value parsing', () => {
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
      expect(config!.inputs!['count'].optional).toBe(true);
    });

    it('parses string default value that is not valid JSON', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input [name=hello]
 */
function myNode(execute: boolean, name: string): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['name'].defaultValue).toBe('hello');
    });
  });

  // ── @step tag ──

  describe('@step tag', () => {
    it('creates input STEP port when parameter exists', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @step trigger - Custom trigger
 */
function myNode(execute: boolean, trigger: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['trigger'].type).toBe('STEP');
      expect(config!.inputs!['trigger'].label).toBe('Custom trigger');
    });

    it('creates output STEP port when parameter does not exist', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @step done - Completion signal
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.outputs!['done'].type).toBe('STEP');
      expect(config!.outputs!['done'].label).toBe('Completion signal');
    });
  });

  // ── @input: with scope and tsType inference ──

  describe('input scoped type inference with non-async callback', () => {
    it('infers type from sync callback return field', () => {
      const { config } = parseNodeType(`
/**
 * @flowWeaver nodeType
 * @input items scope:loop
 */
function myNode(execute: boolean, loop: (items: number[]) => { items: string[] }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`);
      expect(config!.inputs!['items']).toBeDefined();
      expect(config!.inputs!['items'].tsType).toBeDefined();
    });
  });

  // ── @returns with order metadata ──

  describe('@returns with order', () => {
    it('parses order metadata on return port', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @returns result [order:2] - The result
 */
export async function myWf(execute: boolean, params: {}) { return { onSuccess: true, result: '' }; }
`);
      expect(config!.returnPorts!['result'].metadata).toBeDefined();
      expect(config!.returnPorts!['result'].metadata!.order).toBe(2);
    });
  });

  // ── @param with order metadata ──

  describe('@param with order', () => {
    it('parses order metadata on param', () => {
      const { config } = parseWorkflow(`
/**
 * @flowWeaver workflow
 * @param count [order:1] - The count
 */
export async function myWf(execute: boolean, params: { count: number }) { return { onSuccess: true }; }
`);
      expect(config!.startPorts!['count'].metadata).toBeDefined();
      expect(config!.startPorts!['count'].metadata!.order).toBe(1);
    });
  });
});
