/**
 * End-to-end execution test: compile workflows with auto-injected built-in
 * nodes, then execute the generated code to verify correctness.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const OUTPUT_DIR = path.join(os.tmpdir(), `fw-builtin-exec-${process.pid}`);

const SOURCES: Record<string, string> = {
  delayWorkflow: `
/**
 * @flowWeaver workflow
 * @node wait delay [expr: duration="'50ms'"]
 * @path Start -> wait -> Exit
 */
export async function delayWorkflow(
  execute: boolean,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`,
  waitEventWorkflow: `
/**
 * @flowWeaver workflow
 * @node evt waitForEvent [expr: eventName="'app/test'"]
 * @path Start -> evt -> Exit
 */
export async function waitEventWorkflow(
  execute: boolean,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`,
  invokeTest: `
/**
 * @flowWeaver workflow
 * @node sub invokeWorkflow [expr: functionId="'test/fn'", payload="{}"]
 * @path Start -> sub -> Exit
 */
export async function invokeTest(
  execute: boolean,
): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('Not implemented');
}
`,
};

const modules: Record<string, Record<string, unknown>> = {};

beforeAll(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const [name, source] of Object.entries(SOURCES)) {
    const sourceFile = path.join(OUTPUT_DIR, `${name}.ts`);
    fs.writeFileSync(sourceFile, source, 'utf-8');

    const code = await testHelpers.generateFast(sourceFile, name);
    const outputFile = path.join(OUTPUT_DIR, `${name}.generated.ts`);
    fs.writeFileSync(outputFile, code, 'utf-8');

    modules[name] = await import(outputFile);
  }
});

afterAll(() => {
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
});

describe('built-in node execution (end-to-end)', () => {
  it('delay workflow executes with execute=true', async () => {
    const fn = modules.delayWorkflow.delayWorkflow as (
      execute: boolean,
      params: Record<string, never>
    ) => Promise<{ onSuccess: boolean; onFailure: boolean }>;

    const result = await fn(true, {});
    expect(result.onSuccess).toBe(true);
    expect(result.onFailure).toBe(false);
  });

  it('delay workflow skips with execute=false', async () => {
    const fn = modules.delayWorkflow.delayWorkflow as (
      execute: boolean,
      params: Record<string, never>
    ) => Promise<{ onSuccess: boolean; onFailure: boolean }>;

    const result = await fn(false, {});
    expect(result.onFailure).toBe(false);
  });

  it('waitForEvent workflow executes with execute=true', async () => {
    const fn = modules.waitEventWorkflow.waitEventWorkflow as (
      execute: boolean,
      params: Record<string, never>
    ) => Promise<{ onSuccess: boolean; onFailure: boolean }>;

    const result = await fn(true, {});
    expect(result.onSuccess).toBe(true);
  });

  it('invokeWorkflow workflow executes with execute=true', async () => {
    const fn = modules.invokeTest.invokeTest as (
      execute: boolean,
      params: Record<string, never>
    ) => Promise<{ onSuccess: boolean; onFailure: boolean }>;

    const result = await fn(true, {});
    expect(result.onSuccess).toBe(true);
  });
});
