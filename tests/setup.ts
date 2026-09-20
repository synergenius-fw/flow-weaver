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
import {
  createWorkflowRuntime,
  type WorkflowRuntime,
  type WorkflowRuntimeServices,
} from '../src/runtime/durable-execution';

// A test that starts an fw service (the MCP server, the console) must not
// announce itself in the real ~/.fw/services. Every test file gets its own
// directory, which the OS cleans up.
process.env.FW_SERVICES_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'fw-services-test-'));

// Warm the ts-morph checker for callback-type inference. The FIRST complex
// inference on a COLD checker is non-deterministic: ts-morph (notably v28)
// can return `undefined` for a callback parameter/return type until the
// checker is fully initialized, which makes the scoped-port inference tests
// flake (`expected undefined to be defined`). Parsing a tiny fixture that has
// both a scoped OUTPUT (callback parameter) and a scoped INPUT (callback
// return) drives that exact code path to completion, leaving the checker warm.
//
// Both vitest projects run with `isolate: true` (fresh process + fresh module
// registry per test file), so this setup module re-imports and re-runs once per
// file. A single module-level call therefore already warms the checker at the
// start of every file. (An earlier version also re-warmed in `beforeAll` on the
// belief the shared project used `isolate: false`. It does not, so the extra
// call was a redundant second parse per file, doubling setup cost under load for
// no benefit. The deterministic fix lives in the parser: see
// `resolveCallSignatures` in src/jsdoc-parser.ts, which forces signature
// resolution via the apparent type / declaration when a cold checker returns an
// empty signature list. This warmup is cheap belt-and-suspenders.)
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
`,
  );
  parser.parse(warmFixture);
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
    createRuntime: (
      workflowId: string,
      services?: WorkflowRuntimeServices,
      abortSignal?: AbortSignal,
    ) => WorkflowRuntime;
    generateFast: (filePath: string, workflowName: string, options?: { production?: boolean }) => Promise<string>;
  };
}

// Global test utilities
(globalThis as { testHelpers?: typeof globalThis.testHelpers }).testHelpers = {
  outputDir,

  createRuntime(
    workflowId: string,
    services: WorkflowRuntimeServices = {},
    abortSignal?: AbortSignal,
  ): WorkflowRuntime {
    return createWorkflowRuntime({
      runId: `test:${workflowId}:${crypto.randomUUID()}`,
      workflowId,
      services,
      abortSignal,
    });
  },

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
  async generateFast(filePath: string, workflowName: string, options: { production?: boolean } = {}): Promise<string> {
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
