/**
 * GOLDEN characterization tests for AnnotationParser (debt item #4).
 *
 * Parses a curated corpus of real fixture workflows and snapshots the full
 * ParseResult (workflows, nodeTypes, patterns, errors, warnings) with absolute
 * paths normalized. Pins the parser's current output BEFORE the god-class
 * decomposition (extracting the macro-expansion and port-inference clusters
 * into modules), so the extraction can be proven behavior-neutral.
 *
 * If any snapshot changes, the refactor changed parser output. Investigate
 * before updating. Snapshots are captured against the pre-refactor code.
 */

import { parser } from '../../../src/parser';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..', '..');

// Curated fixtures spanning the parser's feature surface: basic pipelines,
// branching, expressions, scoped/foreach (macros), port configs, autoconnect
// (auto-connections), pull nodes, and an invalid workflow.
const FIXTURES = [
  'fixtures/basic/example.ts',
  'fixtures/basic/example-branching.ts',
  'fixtures/basic/example-pipeline.ts',
  'fixtures/basic/example-expressions.ts',
  'fixtures/basic/example-expression-mode.ts',
  'fixtures/basic/example-autoconnect.ts',
  'fixtures/basic/example-error.ts',
  'fixtures/basic/example-error-onFailure.ts',
  'fixtures/basic/minimal-hello-world.ts',
  'fixtures/advanced/example-scoped.ts',
  'fixtures/advanced/example-scoped-ports.ts',
  'fixtures/advanced/example-foreach.ts',
  'fixtures/advanced/example-dependencies.ts',
  'fixtures/advanced/example-port-configs.ts',
  'fixtures/advanced/example-pull.ts',
  'fixtures/advanced/example-sync-pull.ts',
  'fixtures/advanced/example-execution-strategies.ts',
  'fixtures/real-world/example-invalid.ts',
  'use-cases/hello-world.ts',
  'use-cases/data-pipeline.ts',
  'use-cases/human-approval.ts',
  'use-cases/parallel-enrichment.ts',
];

/**
 * Recursively normalize a parsed value for stable snapshots: replace any string
 * that contains the repo root (absolute paths in sourceFile / sourceLocation)
 * with a repo-relative form using forward slashes.
 */
function normalize(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.includes(ROOT)) {
      return value.split(ROOT).join('<ROOT>').split(path.sep).join('/');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalize(v);
    }
    return out;
  }
  return value;
}

describe('AnnotationParser golden (debt #4)', () => {
  for (const fixture of FIXTURES) {
    it(`parse output is stable: ${fixture}`, () => {
      const result = parser.parse(path.join(ROOT, fixture));
      expect(normalize(result)).toMatchSnapshot();
    });
  }
});
