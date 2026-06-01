/**
 * Vitest Setup File
 *
 * Runs before all tests to set up test environment
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseWorkflow } from '../src/api/parse';
import { generateCode } from '../src/api/generate';
import { parser } from '../src/parser';
import { resetSharedProject } from '../src/shared-project';

// Warm the ts-morph checker for callback-type inference. The FIRST complex
// inference on a COLD checker is non-deterministic: ts-morph (notably v28)
// can return `undefined` for a callback parameter/return type until the
// checker is fully initialized, which makes the scoped-port inference tests
// flake (`expected undefined to be defined`). Parsing a tiny fixture that has
// both a scoped OUTPUT (callback parameter) and a scoped INPUT (callback
// return) drives that exact code path to completion, leaving the checker warm.
//
// CRITICAL: this MUST run per-file in `beforeAll`, not just once at module
// import. The `shared` vitest project runs with `isolate: false` (files share
// one process + one ts-morph Project to amortize the expensive Project), and
// the `afterAll` below calls `resetSharedProject()` after EVERY file, which
// discards the warmed checker. So a module-level warmup only protects the
// first file in the shard. Every subsequent file starts on a freshly-reset,
// cold checker, and the first one that does complex inference
// (scoped-port-type-inference) flakes. Re-warming in `beforeAll` guarantees a
// warm checker at the start of each file regardless of run order or which
// project (isolated/shared) hosts it.
function warmTsMorphChecker(): void {
  const warmFixture = path.join(os.tmpdir(), `fw-warm-${process.pid}-${Date.now()}.ts`);
  try {
    fs.writeFileSync(
      warmFixture,
      `/**
 * @flowWeaver nodeType
 * @scope s
 * @output i scope:s
 * @input o scope:s
 */
function __warm(execute: boolean, cb: (i: number) => { o: boolean }): { onSuccess: boolean } {
  return { onSuccess: true };
}
`
    );
    parser.parse(warmFixture);
    // Drop only the warm fixture's cache entry; do NOT reset the Project, or
    // the checker would go cold again and the warmup would be pointless. The
    // fixture lives at a unique temp path no test references, so leaving it in
    // the Project is harmless.
    parser.clearParseCache();
  } catch {
    // Warmup is best-effort; never let it fail a run.
  } finally {
    try {
      fs.unlinkSync(warmFixture);
    } catch {
      /* ignore */
    }
  }
}

// Warm at module import (covers the first file before any beforeAll fires)...
warmTsMorphChecker();
// ...and again before every file, after the prior file's afterAll reset left
// the checker cold.
beforeAll(() => {
  warmTsMorphChecker();
});

// Use OS temp directory - no PID suffix to ensure consistency across forks
const outputDir = path.join(os.tmpdir(), 'flow-weaver-tests-output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Temp directory for tests that need to write temporary files
const tempDir = path.join(os.tmpdir(), 'flow-weaver-tests-temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Both projects run isolate:true, so each file gets a fresh process and the
// ts-morph Project + parser caches never carry over between files. The reset
// here is therefore a belt-and-suspenders guard (and what keeps the suite
// correct if a project is ever switched back to isolate:false): it clears the
// Project and parser caches at the end of every file so nothing leaks.
afterAll(() => {
  resetSharedProject();
  parser.clearCache();
});

// Extend global with test helpers
declare global {
   
  var testHelpers: {
    outputDir: string;
    cleanupOutput: (filename: string) => void;
    readOutput: (filename: string) => string;
    generateFast: (
      filePath: string,
      workflowName: string,
      options?: { production?: boolean }
    ) => Promise<string>;
  };
}

// Global test utilities
(globalThis as { testHelpers?: typeof globalThis.testHelpers }).testHelpers = {
  outputDir,

  /**
   * Clean up generated files after tests
   */
  cleanupOutput(filename: string) {
    const filepath = path.join(outputDir, filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  },

  /**
   * Read generated file
   */
  readOutput(filename: string): string {
    const filepath = path.join(outputDir, filename);
    return fs.readFileSync(filepath, 'utf-8');
  },

  /**
   * Fast workflow generation without console logging.
   * Use this instead of generator.generate() for better test performance.
   */
  async generateFast(
    filePath: string,
    workflowName: string,
    options: { production?: boolean } = {}
  ): Promise<string> {
    const parseResult = await parseWorkflow(filePath, { workflowName });
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors: ${parseResult.errors.join(', ')}`);
    }
    return generateCode(parseResult.ast, {
      production: options.production ?? false,
      allWorkflows: parseResult.allWorkflows,
    });
  },
};
