/**
 * Tests for scoped node inner topology validation.
 * Validates that inner graph wiring for scoped nodes is correct.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parser } from '../../src/parser';
import { validator } from '../../src/validator';

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
});
