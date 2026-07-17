/**
 * GOLDEN characterization tests for WorkflowValidator (debt item #3).
 *
 * These parse a curated corpus of REAL fixture workflows and snapshot the full
 * validation output (valid flag + ordered error/warning diagnostics) in both
 * strict and draft modes. They pin the current behavior of validate() — including
 * rule ordering, cascading-error dedup, draft-mode reclassification, warning
 * suppression, and doc-URL attachment — BEFORE the rule-registry migration, so
 * the migration can be proven behavior-neutral.
 *
 * The corpus deliberately spans valid, invalid, scoped, async, expression,
 * branching, and pull workflows to exercise as many of the ~22 validateX rules
 * as possible through the real parse pipeline.
 *
 * If any snapshot changes, the migration changed validation output — investigate
 * before updating.
 */

import { parseWorkflow } from '../../src/api/parse';
import { parser } from '../../src/parser';
import { WorkflowValidator } from '../../src/validator';
import type { TValidationError } from '../../src/ast/types';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

// Curated fixtures (relative to repo root). Chosen to exercise a broad rule set.
const FIXTURES = [
  'fixtures/basic/example.ts',
  'fixtures/basic/example-branching.ts',
  'fixtures/basic/example-pipeline.ts',
  'fixtures/basic/example-expressions.ts',
  'fixtures/basic/example-error.ts',
  'fixtures/basic/example-error-onFailure.ts',
  'fixtures/basic/example-autoconnect.ts',
  'fixtures/basic/minimal-hello-world.ts',
  'fixtures/advanced/example-scoped.ts',
  'fixtures/advanced/example-foreach.ts',
  'fixtures/advanced/example-dependencies.ts',
  'fixtures/advanced/example-port-configs.ts',
  'fixtures/advanced/example-pull.ts',
  'fixtures/advanced/example-sync-pull.ts',
  'fixtures/advanced/example-execution-strategies.ts',
  'fixtures/real-world/example-invalid.ts',
  'fixtures/validation-demo.ts',
  'use-cases/hello-world.ts',
  'use-cases/data-pipeline.ts',
  'use-cases/human-approval.ts',
  'use-cases/parallel-enrichment.ts',
];

/** Normalize a diagnostic to a stable, diff-friendly shape. */
function normalizeDiag(d: TValidationError) {
  return {
    type: d.type,
    code: d.code,
    node: d.node ?? null,
    message: d.message,
    docUrl: d.docUrl ?? null,
  };
}

function snapshotFor(ast: Parameters<WorkflowValidator['validate']>[0], mode: 'strict' | 'draft') {
  const result = new WorkflowValidator().validate(ast, { mode });
  return {
    valid: result.valid,
    errors: result.errors.map(normalizeDiag),
    warnings: result.warnings.map(normalizeDiag),
  };
}

// Inline invalid-source workflows that trigger the deeper scope-topology
// diagnostics (SCOPE_WRONG_SCOPE_NAME, SCOPE_UNKNOWN_PORT,
// SCOPE_CONNECTION_OUTSIDE, SCOPE_PORT_TYPE_MISMATCH). The fixture corpus above
// is mostly valid workflows, so these pin the exact error output of the most
// complex rule (validateScopeTopology) that a migration must preserve.
const FOR_EACH_NODE = `
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
`;

const SCOPE_SOURCES: Record<string, string> = {
  'wrong-scope-name': `${FOR_EACH_NODE}
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
}`.trim(),

  'unknown-port': `${FOR_EACH_NODE}
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
}`.trim(),
};

describe('WorkflowValidator scope-topology golden (debt #3)', () => {
  for (const [label, source] of Object.entries(SCOPE_SOURCES)) {
    it(`scope diagnostics are stable: ${label}`, () => {
      const dir = (globalThis as { testHelpers?: { outputDir: string } }).testHelpers?.outputDir
        ?? path.join(ROOT, 'tests', '.tmp');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `scope-golden-${label}.ts`);
      fs.writeFileSync(file, source);
      try {
        const parsed = parser.parse(file);
        const workflow = parsed.workflows[0];
        const result = new WorkflowValidator().validate(workflow, { mode: 'strict' });
        expect({
          valid: result.valid,
          errors: result.errors.map(normalizeDiag),
          warnings: result.warnings.map(normalizeDiag),
        }).toMatchSnapshot();
      } finally {
        fs.rmSync(file, { force: true });
      }
    });
  }
});

describe('WorkflowValidator golden (debt #3)', () => {
  for (const fixture of FIXTURES) {
    it(`validation output is stable: ${fixture}`, async () => {
      const parsed = await parseWorkflow(path.join(ROOT, fixture));
      // Validate every workflow found in the file (some fixtures have several).
      // Guard against empty/degenerate ASTs (files with no primary workflow
      // yield `ast: {}`), which are not meaningful validator inputs.
      const candidates = parsed.allWorkflows.length > 0 ? parsed.allWorkflows : [parsed.ast];
      const workflows = candidates.filter(
        (ast) => ast && Array.isArray((ast as { nodeTypes?: unknown }).nodeTypes),
      );
      const perWorkflow = workflows.map((ast) => ({
        workflow: ast.name,
        parseErrors: parsed.errors,
        strict: snapshotFor(ast, 'strict'),
        draft: snapshotFor(ast, 'draft'),
      }));
      expect({ parsedWorkflowCount: workflows.length, perWorkflow }).toMatchSnapshot();
    });
  }
});
