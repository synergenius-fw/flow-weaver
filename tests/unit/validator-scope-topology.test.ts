/**
 * Tests for scoped node inner topology validation.
 * Validates that inner graph wiring for scoped nodes is correct.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parser } from '../../src/parser';
import { validator, WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

describe('Scoped Node Inner Topology Validation', () => {
  it('should error when scope output connects to non-existent inner node', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @scope loop
 * @output item scope:loop - Item to process
 * @input result scope:loop - Processed result
 * @output results - All results
 */
export async function forEach(
  execute: boolean,
  items: unknown[],
  itemProcessor: (execute: boolean, item: unknown) => Promise<{ processed: unknown }>
) {
  return { onSuccess: true, onFailure: false, results: [] };
}

/**
 * @flowWeaver workflow
 * @param items - unknown[]
 * @returns {unknown[]} results - All results
 * @node loop forEach
 * @connect Start.items -> loop.items
 * @connect loop.item -> nonExistent.input:loop
 * @connect loop.results -> Exit.results
 */
export async function testWorkflow(execute: boolean, params: { items: unknown[] }): Promise<{
  onSuccess: boolean; onFailure: boolean; results: unknown[];
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'scope-topo-nonexistent.ts');
    fs.writeFileSync(testFile, source);

    try {
      const parsed = parser.parse(testFile);
      const workflow = parsed.workflows[0];
      const result = validator.validate(workflow);

      // Should have an error about the non-existent node reference
      const scopeErrors = result.errors.filter(
        (e) => e.code === 'UNDEFINED_NODE' || e.code === 'UNKNOWN_TARGET_NODE'
      );
      expect(scopeErrors.length).toBeGreaterThan(0);
    } finally {
      global.testHelpers.cleanupOutput('scope-topo-nonexistent.ts');
    }
  });

  it('should error when inner node has unconnected required input within scope', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @scope loop
 * @output item scope:loop - Item to process
 * @input result scope:loop - Processed result
 * @output results - All results
 */
export async function forEach(
  execute: boolean,
  items: unknown[],
  itemProcessor: (execute: boolean, item: unknown) => Promise<{ processed: unknown }>
) {
  return { onSuccess: true, onFailure: false, results: [] };
}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @input config - string
 * @output processed - unknown
 */
export async function processItem(execute: boolean, data: unknown, config: string) {
  return { onSuccess: true, onFailure: false, processed: data };
}

/**
 * @flowWeaver workflow
 * @param items - unknown[]
 * @returns {unknown[]} results - All results
 * @node loop forEach
 * @node proc processItem loop.loop
 * @connect Start.items -> loop.items
 * @connect loop.item -> proc.data:loop
 * @connect proc.processed -> loop.result:loop
 * @connect loop.results -> Exit.results
 */
export async function testWorkflow(execute: boolean, params: { items: unknown[] }): Promise<{
  onSuccess: boolean; onFailure: boolean; results: unknown[];
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'scope-topo-missing-input.ts');
    fs.writeFileSync(testFile, source);

    try {
      const parsed = parser.parse(testFile);
      const workflow = parsed.workflows[0];
      const result = validator.validate(workflow);

      // processItem has required input 'config' not connected within the scope
      const scopeErrors = result.errors.filter(
        (e) =>
          e.code === 'SCOPE_MISSING_REQUIRED_INPUT' &&
          e.message.includes('config')
      );
      expect(scopeErrors.length).toBeGreaterThan(0);
    } finally {
      global.testHelpers.cleanupOutput('scope-topo-missing-input.ts');
    }
  });

  it('should warn when scoped input port has no connection from inner nodes', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @scope loop
 * @output item scope:loop - Item to process
 * @input result scope:loop - Processed result
 * @output results - All results
 */
export async function forEach(
  execute: boolean,
  items: unknown[],
  itemProcessor: (execute: boolean, item: unknown) => Promise<{ processed: unknown }>
) {
  return { onSuccess: true, onFailure: false, results: [] };
}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output processed - unknown
 */
export async function processItem(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, processed: data };
}

/**
 * @flowWeaver workflow
 * @param items - unknown[]
 * @returns {unknown[]} results - All results
 * @node loop forEach
 * @node proc processItem loop.loop
 * @connect Start.items -> loop.items
 * @connect loop.item -> proc.data:loop
 * @connect loop.results -> Exit.results
 */
export async function testWorkflow(execute: boolean, params: { items: unknown[] }): Promise<{
  onSuccess: boolean; onFailure: boolean; results: unknown[];
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'scope-topo-unused-input.ts');
    fs.writeFileSync(testFile, source);

    try {
      const parsed = parser.parse(testFile);
      const workflow = parsed.workflows[0];
      const result = validator.validate(workflow);

      // Scoped input 'result' has no inner node connecting to it
      const scopeWarnings = result.warnings.filter(
        (w) =>
          w.code === 'SCOPE_UNUSED_INPUT' &&
          w.message.includes('result')
      );
      expect(scopeWarnings.length).toBeGreaterThan(0);
    } finally {
      global.testHelpers.cleanupOutput('scope-topo-unused-input.ts');
    }
  });

  it('should pass validation for a complete valid scope topology', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @scope loop
 * @output item scope:loop - Item to process
 * @input result scope:loop - Processed result
 * @output results - All results
 */
export async function forEach(
  execute: boolean,
  items: unknown[],
  itemProcessor: (execute: boolean, item: unknown) => Promise<{ processed: unknown }>
) {
  return { onSuccess: true, onFailure: false, results: [] };
}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output processed - unknown
 */
export async function processItem(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, processed: data };
}

/**
 * @flowWeaver workflow
 * @param items - unknown[]
 * @returns {unknown[]} results - All results
 * @node loop forEach
 * @node proc processItem loop.loop
 * @connect Start.items -> loop.items
 * @connect loop.item -> proc.data:loop
 * @connect proc.processed -> loop.result:loop
 * @connect loop.results -> Exit.results
 */
export async function testWorkflow(execute: boolean, params: { items: unknown[] }): Promise<{
  onSuccess: boolean; onFailure: boolean; results: unknown[];
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'scope-topo-valid.ts');
    fs.writeFileSync(testFile, source);

    try {
      const parsed = parser.parse(testFile);
      const workflow = parsed.workflows[0];
      const result = validator.validate(workflow);

      // No scope-related errors
      const scopeErrors = result.errors.filter(
        (e) => e.code === 'SCOPE_MISSING_REQUIRED_INPUT'
      );
      expect(scopeErrors).toHaveLength(0);

      const scopeWarnings = result.warnings.filter(
        (w) => w.code === 'SCOPE_UNUSED_INPUT'
      );
      expect(scopeWarnings).toHaveLength(0);
    } finally {
      global.testHelpers.cleanupOutput('scope-topo-valid.ts');
    }
  });

  it('should validate nested scopes independently', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @scope outer
 * @output item scope:outer - Outer item
 * @input result scope:outer - Outer result
 * @output results - All results
 */
export async function outerForEach(
  execute: boolean,
  items: unknown[],
  processor: (execute: boolean, item: unknown) => Promise<{ processed: unknown }>
) {
  return { onSuccess: true, onFailure: false, results: [] };
}

/**
 * @flowWeaver nodeType
 * @scope inner
 * @output subItem scope:inner - Inner item
 * @input subResult scope:inner - Inner result
 * @output subResults - Sub results
 */
export async function innerForEach(
  execute: boolean,
  items: unknown[],
  processor: (execute: boolean, item: unknown) => Promise<{ processed: unknown }>
) {
  return { onSuccess: true, onFailure: false, subResults: [] };
}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output processed - unknown
 */
export async function transform(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, processed: data };
}

/**
 * @flowWeaver workflow
 * @param items - unknown[]
 * @returns {unknown[]} results - All results
 * @node oLoop outerForEach
 * @node iLoop innerForEach oLoop.outer
 * @node t transform iLoop.inner
 * @connect Start.items -> oLoop.items
 * @connect oLoop.item -> iLoop.items:outer
 * @connect iLoop.subItem -> t.data:inner
 * @connect t.processed -> iLoop.subResult:inner
 * @connect iLoop.subResults -> oLoop.result:outer
 * @connect oLoop.results -> Exit.results
 */
export async function testWorkflow(execute: boolean, params: { items: unknown[] }): Promise<{
  onSuccess: boolean; onFailure: boolean; results: unknown[];
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'scope-topo-nested.ts');
    fs.writeFileSync(testFile, source);

    try {
      const parsed = parser.parse(testFile);
      const workflow = parsed.workflows[0];
      const result = validator.validate(workflow);

      // Both scopes should be valid — no scope errors
      const scopeErrors = result.errors.filter(
        (e) => e.code === 'SCOPE_MISSING_REQUIRED_INPUT'
      );
      expect(scopeErrors).toHaveLength(0);
    } finally {
      global.testHelpers.cleanupOutput('scope-topo-nested.ts');
    }
  });

  // ── New scope validation checks ──────────────────────────────────────

  it('should error when connection uses invalid scope qualifier', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @scope loop
 * @output item scope:loop - Item to process
 * @input result scope:loop - Processed result
 * @output results - All results
 */
export async function forEach(
  execute: boolean,
  items: unknown[],
  itemProcessor: (execute: boolean, item: unknown) => Promise<{ processed: unknown }>
) {
  return { onSuccess: true, onFailure: false, results: [] };
}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output processed - unknown
 */
export async function processItem(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, processed: data };
}

/**
 * @flowWeaver workflow
 * @param items - unknown[]
 * @returns {unknown[]} results - All results
 * @node loop forEach
 * @node proc processItem loop.loop
 * @connect Start.items -> loop.items
 * @connect loop.item:loop -> proc.data:loop
 * @connect proc.processed -> loop.result:wrongScope
 * @connect loop.results -> Exit.results
 */
export async function testWorkflow(execute: boolean, params: { items: unknown[] }): Promise<{
  onSuccess: boolean; onFailure: boolean; results: unknown[];
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'scope-topo-wrong-scope.ts');
    fs.writeFileSync(testFile, source);

    try {
      const parsed = parser.parse(testFile);
      const workflow = parsed.workflows[0];
      const result = validator.validate(workflow);

      const scopeErrors = result.errors.filter(
        (e) => e.code === 'SCOPE_WRONG_SCOPE_NAME'
      );
      expect(scopeErrors.length).toBeGreaterThan(0);
      expect(scopeErrors[0].message).toContain('wrongScope');
    } finally {
      global.testHelpers.cleanupOutput('scope-topo-wrong-scope.ts');
    }
  });

  it('should error when scoped connection references non-existent scoped port', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @scope loop
 * @output item scope:loop - Item to process
 * @input result scope:loop - Processed result
 * @output results - All results
 */
export async function forEach(
  execute: boolean,
  items: unknown[],
  itemProcessor: (execute: boolean, item: unknown) => Promise<{ processed: unknown }>
) {
  return { onSuccess: true, onFailure: false, results: [] };
}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output processed - unknown
 */
export async function processItem(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, processed: data };
}

/**
 * @flowWeaver workflow
 * @param items - unknown[]
 * @returns {unknown[]} results - All results
 * @node loop forEach
 * @node proc processItem loop.loop
 * @connect Start.items -> loop.items
 * @connect loop.nonExistentPort:loop -> proc.data:loop
 * @connect proc.processed -> loop.result:loop
 * @connect loop.results -> Exit.results
 */
export async function testWorkflow(execute: boolean, params: { items: unknown[] }): Promise<{
  onSuccess: boolean; onFailure: boolean; results: unknown[];
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'scope-topo-unknown-port.ts');
    fs.writeFileSync(testFile, source);

    try {
      const parsed = parser.parse(testFile);
      const workflow = parsed.workflows[0];
      const result = validator.validate(workflow);

      const scopeErrors = result.errors.filter(
        (e) => e.code === 'SCOPE_UNKNOWN_PORT' && e.message.includes('nonExistentPort')
      );
      expect(scopeErrors.length).toBeGreaterThan(0);
    } finally {
      global.testHelpers.cleanupOutput('scope-topo-unknown-port.ts');
    }
  });

  it('should error when port belongs to a different scope', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @scope alpha
 * @scope beta
 * @output aItem scope:alpha - Alpha item
 * @input aResult scope:alpha - Alpha result
 * @output bItem scope:beta - Beta item
 * @input bResult scope:beta - Beta result
 * @output results - All results
 */
export async function multiScope(
  execute: boolean,
  items: unknown[]
) {
  return { onSuccess: true, onFailure: false, results: [] };
}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output processed - unknown
 */
export async function processItem(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, processed: data };
}

/**
 * @flowWeaver workflow
 * @param items - unknown[]
 * @returns {unknown[]} results
 * @node ms multiScope
 * @node proc processItem ms.alpha
 * @connect Start.items -> ms.items
 * @connect ms.bItem:alpha -> proc.data:alpha
 * @connect proc.processed -> ms.aResult:alpha
 * @connect ms.results -> Exit.results
 */
export async function testWorkflow(execute: boolean, params: { items: unknown[] }): Promise<{
  onSuccess: boolean; onFailure: boolean; results: unknown[];
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'scope-topo-wrong-port-scope.ts');
    fs.writeFileSync(testFile, source);

    try {
      const parsed = parser.parse(testFile);
      const workflow = parsed.workflows[0];
      const result = validator.validate(workflow);

      // bItem belongs to scope "beta" but is used in scope "alpha"
      const scopeErrors = result.errors.filter(
        (e) => e.code === 'SCOPE_UNKNOWN_PORT' && e.message.includes('bItem')
      );
      expect(scopeErrors.length).toBeGreaterThan(0);
      expect(scopeErrors[0].message).toContain('beta');
    } finally {
      global.testHelpers.cleanupOutput('scope-topo-wrong-port-scope.ts');
    }
  });

  it('should warn when child node is orphaned within scope', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @scope loop
 * @output item scope:loop - Item to process
 * @input result scope:loop - Processed result
 * @output results - All results
 */
export async function forEach(
  execute: boolean,
  items: unknown[],
  itemProcessor: (execute: boolean, item: unknown) => Promise<{ processed: unknown }>
) {
  return { onSuccess: true, onFailure: false, results: [] };
}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output processed - unknown
 */
export async function processItem(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, processed: data };
}

/**
 * @flowWeaver nodeType
 * @input value - unknown
 * @output logged - boolean
 */
export async function logger(execute: boolean, value: unknown) {
  return { onSuccess: true, onFailure: false, logged: true };
}

/**
 * @flowWeaver workflow
 * @param items - unknown[]
 * @returns {unknown[]} results - All results
 * @node loop forEach
 * @node proc processItem loop.loop
 * @node log logger loop.loop
 * @connect Start.items -> loop.items
 * @connect loop.item -> proc.data:loop
 * @connect proc.processed -> loop.result:loop
 * @connect loop.results -> Exit.results
 */
export async function testWorkflow(execute: boolean, params: { items: unknown[] }): Promise<{
  onSuccess: boolean; onFailure: boolean; results: unknown[];
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'scope-topo-orphaned.ts');
    fs.writeFileSync(testFile, source);

    try {
      const parsed = parser.parse(testFile);
      const workflow = parsed.workflows[0];
      const result = validator.validate(workflow);

      // "log" is in loop.loop but has no scoped connections to/from "loop"
      const orphanWarnings = result.warnings.filter(
        (w) => w.code === 'SCOPE_ORPHANED_CHILD' && w.message.includes('log')
      );
      expect(orphanWarnings.length).toBeGreaterThan(0);
      expect(orphanWarnings[0].message).toContain('loop');
    } finally {
      global.testHelpers.cleanupOutput('scope-topo-orphaned.ts');
    }
  });

  it('should warn on type mismatch between parent scoped port and child port', () => {
    // Construct AST directly since the parser's type inference may resolve
    // output types differently from explicit [type:] annotations.
    const forEachType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'forEach',
      functionName: 'forEach',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'ARRAY' },
        result: { dataType: 'ANY', scope: 'loop' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        item: { dataType: 'STRING', scope: 'loop' },
        results: { dataType: 'ARRAY' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: true,
      executeWhen: 'CONJUNCTION',
      scope: 'loop',
    };

    const processItemType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'processItem',
      functionName: 'processItem',
      inputs: {
        execute: { dataType: 'STEP' },
        data: { dataType: 'NUMBER' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
        processed: { dataType: 'ANY' },
      },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: true,
      executeWhen: 'CONJUNCTION',
    };

    const workflow: TWorkflowAST = {
      type: 'Workflow',
      name: 'testWorkflow',
      functionName: 'testWorkflow',
      sourceFile: 'test.ts',
      nodeTypes: [forEachType, processItemType],
      instances: [
        { type: 'NodeInstance', id: 'loop', nodeType: 'forEach' },
        { type: 'NodeInstance', id: 'proc', nodeType: 'processItem', parent: { id: 'loop', scope: 'loop' } },
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'items' }, to: { node: 'loop', port: 'items' } },
        // Scoped connection: parent STRING output -> child NUMBER input (type mismatch)
        { type: 'Connection', from: { node: 'loop', port: 'item', scope: 'loop' }, to: { node: 'proc', port: 'data', scope: 'loop' } },
        { type: 'Connection', from: { node: 'proc', port: 'processed', scope: 'loop' }, to: { node: 'loop', port: 'result', scope: 'loop' } },
        { type: 'Connection', from: { node: 'loop', port: 'results' }, to: { node: 'Exit', port: 'results' } },
      ],
      scopes: { 'loop.loop': ['proc'] },
      startPorts: { execute: { dataType: 'STEP' }, items: { dataType: 'ARRAY' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, results: { dataType: 'ARRAY' } },
      imports: [],
    };

    const v = new WorkflowValidator();
    const result = v.validate(workflow);

    const typeWarnings = result.warnings.filter(
      (w) => w.code === 'SCOPE_PORT_TYPE_MISMATCH'
    );
    expect(typeWarnings.length).toBeGreaterThan(0);
  });

  it('should error when scoped connection targets node outside scope', async () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @scope loop
 * @output item scope:loop - Item to process
 * @input result scope:loop - Processed result
 * @output results - All results
 */
export async function forEach(
  execute: boolean,
  items: unknown[],
  itemProcessor: (execute: boolean, item: unknown) => Promise<{ processed: unknown }>
) {
  return { onSuccess: true, onFailure: false, results: [] };
}

/**
 * @flowWeaver nodeType
 * @input data - unknown
 * @output processed - unknown
 */
export async function processItem(execute: boolean, data: unknown) {
  return { onSuccess: true, onFailure: false, processed: data };
}

/**
 * @flowWeaver nodeType
 * @input value - unknown
 * @output logged - boolean
 */
export async function outsideNode(execute: boolean, value: unknown) {
  return { onSuccess: true, onFailure: false, logged: true };
}

/**
 * @flowWeaver workflow
 * @param items - unknown[]
 * @returns {unknown[]} results - All results
 * @node loop forEach
 * @node proc processItem loop.loop
 * @node outside outsideNode
 * @connect Start.items -> loop.items
 * @connect loop.item:loop -> proc.data:loop
 * @connect proc.processed:loop -> outside.value
 * @connect loop.results -> Exit.results
 */
export async function testWorkflow(execute: boolean, params: { items: unknown[] }): Promise<{
  onSuccess: boolean; onFailure: boolean; results: unknown[];
}> {
  // @flow-weaver-body
  // @end-flow-weaver-body
}
    `.trim();

    const testFile = path.join(global.testHelpers.outputDir, 'scope-topo-connection-outside.ts');
    fs.writeFileSync(testFile, source);

    try {
      const parsed = parser.parse(testFile);
      const workflow = parsed.workflows[0];
      const result = validator.validate(workflow);

      const scopeErrors = result.errors.filter(
        (e) => e.code === 'SCOPE_CONNECTION_OUTSIDE'
      );
      expect(scopeErrors.length).toBeGreaterThan(0);
      expect(scopeErrors[0].message).toContain('outside');
    } finally {
      global.testHelpers.cleanupOutput('scope-topo-connection-outside.ts');
    }
  });
});
