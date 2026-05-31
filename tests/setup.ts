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

// Warm the ts-morph checker for callback-type inference before any real test
// parses. Each file runs in its own process (isolate:true), and the FIRST
// complex inference on a cold checker is non-deterministic: ts-morph can return
// undefined for a callback parameter/return type until the checker is fully
// initialized, which made the scoped-port inference tests flake (~1 run in N)
// regardless of isolation. Running the real parser once on a tiny fixture that
// has both a scoped OUTPUT (callback parameter) and a scoped INPUT (callback
// return) drives that exact code path to completion, so the checker is warm for
// it by the time the actual tests run. This is far cheaper than the old warmup
// (which resolved every property of a synthetic type per file); it parses one
// 6-line function.
const warmFixture = path.join(os.tmpdir(), `fw-warm-${process.pid}.ts`);
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
  // Drop only the warm fixture's cache entry; do NOT reset the Project, or the
  // checker would go cold again and the warmup would be pointless. The fixture
  // lives at a unique temp path no test references, so leaving it in the Project
  // is harmless.
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
