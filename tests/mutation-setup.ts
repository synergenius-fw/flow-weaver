/**
 * Setup file for mutation runs (vitest.stryker.config.ts).
 *
 * Stryker reruns the tests that cover a mutant once per mutant, so a test
 * file's setup is paid thousands of times. tests/setup.ts imports the parser
 * and parses a fixture to warm the ts-morph checker before every file, which
 * costs seconds and, for a mutant in the parser's own signature resolution,
 * would hide the very fault the mutant plants. This file gives the tests the
 * same environment and helpers without that work: the helpers that need the
 * parser load it on first use.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { WorkflowRuntime, WorkflowRuntimeServices } from '../src/runtime/durable-execution';

// Stryker picks the tests that cover a mutant by name, joining the describe
// and test names with a space (@stryker-mutator/vitest-runner 10), while
// Vitest 5 matches the name pattern against names joined with " > ". Left
// alone, the pattern matches no test, nothing runs, and every covered mutant
// is reported as survived. Let a space in the pattern stand for either.
const SEPARATOR = '(?: | > )';
const worker = (globalThis as { __vitest_worker__?: { config?: { testNamePattern?: RegExp } } }).__vitest_worker__;
const namePattern = worker?.config?.testNamePattern;
if (worker?.config && namePattern instanceof RegExp && !namePattern.source.includes(SEPARATOR)) {
  worker.config.testNamePattern = new RegExp(namePattern.source.replaceAll(' ', SEPARATOR), namePattern.flags);
}

process.env.FW_SERVICES_DIR ??=fs.mkdtempSync(path.join(os.tmpdir(), 'fw-services-test-'));

const outputDir = path.join(os.tmpdir(), 'flow-weaver-tests-output');
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.join(os.tmpdir(), 'flow-weaver-tests-temp'), { recursive: true });

// The runtime is loaded before any test runs so createRuntime can stay
// synchronous, as it is in tests/setup.ts. It does not pull in ts-morph.
const { createWorkflowRuntime } = await import('../src/runtime/durable-execution');

(globalThis as { testHelpers?: typeof globalThis.testHelpers }).testHelpers = {
  outputDir,

  createRuntime(workflowId: string, services: WorkflowRuntimeServices = {}, abortSignal?: AbortSignal): WorkflowRuntime {
    return createWorkflowRuntime({
      runId: `test:${workflowId}:${crypto.randomUUID()}`,
      workflowId,
      services,
      abortSignal,
    });
  },

  cleanupOutput(filename: string) {
    fs.rmSync(path.join(outputDir, filename), { force: true });
  },

  readOutput(filename: string): string {
    return fs.readFileSync(path.join(outputDir, filename), 'utf-8');
  },

  async generateFast(filePath: string, workflowName: string, options: { production?: boolean } = {}): Promise<string> {
    const { parseWorkflow } = await import('../src/api/parse');
    const { generateCode } = await import('../src/api/generate');
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
