/**
 * Tests for annotation validation: quote stripping, duplicate detection,
 * unknown tag detection, context validation, reserved ports, type fallbacks,
 * and validator-level checks (duplicate instances, connections, color/icon/type
 * validation, portConfig refs, executeWhen, empty scopes, scope consistency).
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { AnnotationParser } from '../../src/parser';
import { WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST, TNodeTypeAST, TNodeVisualsAST } from '../../src/ast/types';

// ── Helpers ────────────────────────────────────────────────────────────

function createNodeType(
  name: string,
  overrides: Partial<TNodeTypeAST> = {}
): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP', failure: true },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
    ...overrides,
  };
}

function createWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    type: 'Workflow',
    functionName: 'testWorkflow',
    name: 'testWorkflow',
    sourceFile: 'test.ts',
    nodeTypes: [],
    instances: [],
    connections: [],
    scopes: {},
    startPorts: {},
    exitPorts: {},
    imports: [],
    ...overrides,
  };
}

// ── Parser-level tests (JSDoc parser) ──────────────────────────────────

describe('Annotation Validation — Parser', () => {
  let parser: AnnotationParser;
  let warnSpy: MockInstance;

  beforeEach(() => {
    parser = new AnnotationParser();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // A: Quote stripping
  describe('quote stripping', () => {
    it('@color "blue" parses to blue (no quotes)', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @color "blue"
 * @input value
 * @output result
 */
function myNode(value: number): { result: number } {
  return { result: value };
}
`;
      const result = parser.parseFromString(code, 'color-quotes.ts');
      const nodeType = result.nodeTypes[0];
      expect(nodeType.visuals?.color).toBe('blue');
    });

    it("@icon 'database' parses to database (no quotes)", () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @icon 'database'
 * @input value
 * @output result
 */
function myNode(value: number): { result: number } {
  return { result: value };
}
`;
      const result = parser.parseFromString(code, 'icon-quotes.ts');
      const nodeType = result.nodeTypes[0];
      expect(nodeType.visuals?.icon).toBe('database');
    });

    it('@color blue (no quotes) still works', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @color blue
 * @input value
 * @output result
 */
function myNode(value: number): { result: number } {
  return { result: value };
}
`;
      const result = parser.parseFromString(code, 'color-noquotes.ts');
      const nodeType = result.nodeTypes[0];
      expect(nodeType.visuals?.color).toBe('blue');
    });
  });

  // B: Duplicate port detection
  describe('duplicate port detection', () => {
    it('duplicate @input produces parser warning', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value
 * @input value
 * @output result
 */
function myNode(value: number): { result: number } {
  return { result: value };
}
`;
      const result = parser.parseFromString(code, 'dup-input.ts');
      expect(result.warnings.some((w) => w.includes('Duplicate @input "value"'))).toBe(true);
    });

    it('duplicate @output produces parser warning', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 * @output result
 */
function myNode(value: number): { result: number } {
  return { result: value };
}
`;
      const result = parser.parseFromString(code, 'dup-output.ts');
      expect(result.warnings.some((w) => w.includes('Duplicate @output "result"'))).toBe(true);
    });

    it('duplicate @param produces parser warning', () => {
      const code = `
/**
 * @flowWeaver workflow
 * @node n1 myNode
 * @param value
 * @param value
 * @connect Start.execute -> n1.execute
 * @connect n1.onSuccess -> Exit.onSuccess
 */
export async function myWf(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`;
      const result = parser.parseFromString(code, 'dup-param.ts');
      expect(result.warnings.some((w) => w.includes('Duplicate @param "value"'))).toBe(true);
    });

    it('duplicate @returns produces parser warning', () => {
      const code = `
/**
 * @flowWeaver workflow
 * @node n1 myNode
 * @returns result
 * @returns result
 * @connect Start.execute -> n1.execute
 * @connect n1.onSuccess -> Exit.onSuccess
 */
export async function myWf(
  execute: boolean,
  params: {}
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
`;
      const result = parser.parseFromString(code, 'dup-returns.ts');
      expect(result.warnings.some((w) => w.includes('Duplicate @returns "result"'))).toBe(true);
    });
  });

  // C: Unknown annotation tag detection
  describe('unknown annotation tag detection', () => {
    it('@colro produces warning with "Did you mean @color?"', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @colro blue
 * @input value
 * @output result
 */
function myNode(value: number): { result: number } {
  return { result: value };
}
`;
      const result = parser.parseFromString(code, 'typo-tag.ts');
      expect(result.warnings.some((w) =>
        w.includes('Unknown annotation @colro') && w.includes('Did you mean @color')
      )).toBe(true);
    });

    it('standard JSDoc tags like @example are not flagged', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @example const x = 1;
 * @input value
 * @output result
 */
function myNode(value: number): { result: number } {
  return { result: value };
}
`;
      const result = parser.parseFromString(code, 'standard-jsdoc.ts');
      expect(result.warnings.some((w) => w.includes('@example'))).toBe(false);
    });
  });

  // D: Context validation
  describe('annotation context validation', () => {
    it('@color on workflow block produces context warning', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function myNode(value: number): { result: number } {
  return { result: value };
}

/**
 * @flowWeaver workflow
 * @color blue
 * @node n1 myNode
 * @connect Start.execute -> n1.execute
 * @connect n1.onSuccess -> Exit.onSuccess
 */
export async function myWf(
  execute: boolean,
  params: {}
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`;
      const result = parser.parseFromString(code, 'color-on-wf.ts');
      expect(result.warnings.some((w) =>
        w.includes('@color is for node types') && w.includes('not workflows')
      )).toBe(true);
    });

    it('@input on workflow block produces context warning', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function myNode(value: number): { result: number } {
  return { result: value };
}

/**
 * @flowWeaver workflow
 * @input data
 * @node n1 myNode
 * @connect Start.execute -> n1.execute
 * @connect n1.onSuccess -> Exit.onSuccess
 */
export async function myWf(
  execute: boolean,
  params: {}
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`;
      const result = parser.parseFromString(code, 'input-on-wf.ts');
      expect(result.warnings.some((w) =>
        w.includes('@input is for node types') && w.includes('not workflows')
      )).toBe(true);
    });

    it('@param on nodeType block produces context warning', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @param foo
 * @input value
 * @output result
 */
function myNode(value: number): { result: number } {
  return { result: value };
}
`;
      const result = parser.parseFromString(code, 'param-on-node.ts');
      expect(result.warnings.some((w) =>
        w.includes('@param is for workflows') && w.includes('not node types')
      )).toBe(true);
    });
  });

  // E: Reserved port type override warning
  describe('reserved port type override', () => {
    it('@input execute [type:STRING] warns about type override', () => {
      const code = `
/**
 * @flowWeaver nodeType
 * @input execute [type:STRING]
 * @output onSuccess
 */
function myNode(execute: boolean): { onSuccess: boolean } {
  return { onSuccess: true };
}
`;
      const result = parser.parseFromString(code, 'reserved-port.ts');
      expect(result.warnings.some((w) =>
        w.includes('"execute"') && w.includes('reserved control port')
      )).toBe(true);
    });
  });
});

// ── Validator-level tests ──────────────────────────────────────────────

describe('Annotation Validation — Validator', () => {
  let validator: WorkflowValidator;

  beforeEach(() => {
    validator = new WorkflowValidator();
  });

  // H: Duplicate instance IDs
  describe('duplicate instance IDs', () => {
    it('produces DUPLICATE_INSTANCE_ID error', () => {
      const nodeType = createNodeType('myType');
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'myType', config: { x: 0, y: 0 } },
          { type: 'NodeInstance', id: 'a', nodeType: 'myType', config: { x: 100, y: 0 } },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = validator.validate(workflow);
      expect(result.errors.some((e) => e.code === 'DUPLICATE_INSTANCE_ID')).toBe(true);
    });
  });

  // I: Duplicate connections
  describe('duplicate connections', () => {
    it('produces DUPLICATE_CONNECTION error', () => {
      const nodeType = createNodeType('myType');
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'myType', config: { x: 0, y: 0 } },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = validator.validate(workflow);
      expect(result.errors.some((e) => e.code === 'DUPLICATE_CONNECTION')).toBe(true);
    });
  });

  // J: Color validation
  describe('color validation', () => {
    it('invalid color produces INVALID_COLOR warning with suggestion', () => {
      const nodeType = createNodeType('myType', {
        visuals: { color: 'bule' },
      });
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'myType', config: { x: 0, y: 0 } },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = validator.validate(workflow);
      const warning = result.warnings.find((w) => w.code === 'INVALID_COLOR');
      expect(warning).toBeDefined();
      expect(warning!.message).toContain('bule');
      expect(warning!.message).toContain('blue');
    });

    it('valid color produces no warning', () => {
      const nodeType = createNodeType('myType', {
        visuals: { color: 'purple' },
      });
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'myType', config: { x: 0, y: 0 } },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = validator.validate(workflow);
      expect(result.warnings.some((w) => w.code === 'INVALID_COLOR')).toBe(false);
    });

    it('instance-level invalid color produces INVALID_COLOR warning', () => {
      const nodeType = createNodeType('myType');
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'myType', config: { x: 0, y: 0, color: 'invalidcolor' } },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = validator.validate(workflow);
      expect(result.warnings.some((w) => w.code === 'INVALID_COLOR')).toBe(true);
    });
  });

  // K: Icon validation
  describe('icon validation', () => {
    it('invalid icon produces INVALID_ICON warning with suggestion', () => {
      const nodeType = createNodeType('myType', {
        visuals: { icon: 'databse' },
      });
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'myType', config: { x: 0, y: 0 } },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = validator.validate(workflow);
      const warning = result.warnings.find((w) => w.code === 'INVALID_ICON');
      expect(warning).toBeDefined();
      expect(warning!.message).toContain('databse');
      expect(warning!.message).toContain('database');
    });

    it('valid icon produces no warning', () => {
      const nodeType = createNodeType('myType', {
        visuals: { icon: 'database' },
      });
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'myType', config: { x: 0, y: 0 } },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = validator.validate(workflow);
      expect(result.warnings.some((w) => w.code === 'INVALID_ICON')).toBe(false);
    });
  });

  // L: Port type validation
  describe('port type validation', () => {
    it('invalid port type produces INVALID_PORT_TYPE warning', () => {
      const nodeType = createNodeType('myType', {
        inputs: {
          execute: { dataType: 'STEP' },
          value: { dataType: 'INVALID' as any },
        },
      });
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'myType', config: { x: 0, y: 0 } },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = validator.validate(workflow);
      expect(result.warnings.some((w) => w.code === 'INVALID_PORT_TYPE')).toBe(true);
    });
  });

  // M: portConfig reference validation
  describe('portConfig reference validation', () => {
    it('portOrder referencing nonexistent port produces INVALID_PORT_CONFIG_REF warning', () => {
      const nodeType = createNodeType('myType', {
        inputs: {
          execute: { dataType: 'STEP' },
          value: { dataType: 'NUMBER' },
        },
      });
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          {
            type: 'NodeInstance',
            id: 'a',
            nodeType: 'myType',
            config: {
              x: 0, y: 0,
              portConfigs: [{ portName: 'nonexistent', order: 0 }],
            },
          },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = validator.validate(workflow);
      const warning = result.warnings.find((w) => w.code === 'INVALID_PORT_CONFIG_REF');
      expect(warning).toBeDefined();
      expect(warning!.message).toContain('nonexistent');
    });
  });

  // N: @executeWhen validation
  describe('@executeWhen validation', () => {
    it('invalid @executeWhen value produces INVALID_EXECUTE_WHEN warning', () => {
      const nodeType = createNodeType('myType', {
        executeWhen: 'INVALID' as any,
      });
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'myType', config: { x: 0, y: 0 } },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = validator.validate(workflow);
      expect(result.warnings.some((w) => w.code === 'INVALID_EXECUTE_WHEN')).toBe(true);
    });

    it('valid @executeWhen value produces no warning', () => {
      const nodeType = createNodeType('myType', {
        executeWhen: 'DISJUNCTION',
      });
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'myType', config: { x: 0, y: 0 } },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = validator.validate(workflow);
      expect(result.warnings.some((w) => w.code === 'INVALID_EXECUTE_WHEN')).toBe(false);
    });
  });

  // O: Empty scope warning
  describe('empty scope warning', () => {
    it('scope with no children produces SCOPE_EMPTY warning', () => {
      const nodeType = createNodeType('scopedType', {
        inputs: {
          execute: { dataType: 'STEP' },
          success: { dataType: 'STEP', scope: 'loop' },
        },
        outputs: {
          onSuccess: { dataType: 'STEP' },
          onFailure: { dataType: 'STEP', failure: true },
          start: { dataType: 'STEP', scope: 'loop' },
        },
      });
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          { type: 'NodeInstance', id: 'parent', nodeType: 'scopedType', config: { x: 0, y: 0 } },
          // No children declared with parent scope
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'parent', port: 'execute' } },
          { type: 'Connection', from: { node: 'parent', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
      });
      const result = validator.validate(workflow);
      expect(result.warnings.some((w) => w.code === 'SCOPE_EMPTY')).toBe(true);
    });
  });

  // P: Scope consistency
  describe('scope consistency', () => {
    it('instance in multiple scopes produces SCOPE_INCONSISTENT error', () => {
      const nodeType = createNodeType('myType');
      const workflow = createWorkflow({
        nodeTypes: [nodeType],
        instances: [
          { type: 'NodeInstance', id: 'a', nodeType: 'myType', config: { x: 0, y: 0 } },
        ],
        connections: [
          { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
          { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        ],
        scopes: {
          'parent.scope1': ['a'],
          'parent.scope2': ['a'],
        },
      });
      const result = validator.validate(workflow);
      expect(result.errors.some((e) => e.code === 'SCOPE_INCONSISTENT')).toBe(true);
    });
  });
});
