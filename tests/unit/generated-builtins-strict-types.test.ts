/**
 * A compiled workflow is TypeScript the user builds in their own project,
 * usually under `strict`. Built-in node bodies are inlined into it verbatim
 * from the registry, so if that text carries no type annotations every
 * parameter becomes an implicit `any` and the whole file fails to compile --
 * before this was fixed, a workflow using waitForAgent could not be built at
 * all. These tests compile a real workflow per built-in and type-check the
 * result with `noImplicitAny`, which is the only way to catch a built-in
 * whose inlined text quietly lost its types.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { compileWorkflow } from '../../src/api/compile';

function diagnose(code: string): string[] {
  const fileName = 'generated.ts';
  const host = ts.createCompilerHost({}, true);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    name === fileName
      ? ts.createSourceFile(name, code, languageVersion, true)
      : original(name, languageVersion, onError, shouldCreate);
  host.fileExists = (name) => (name === fileName ? true : ts.sys.fileExists(name));
  host.readFile = (name) => (name === fileName ? code : ts.sys.readFile(name));

  const program = ts.createProgram([fileName], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  }, host);

  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(fileName))
    .map((d) => `${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

async function compileSource(source: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-strict-'));
  const file = path.join(dir, 'wf.fw.ts');
  try {
    fs.writeFileSync(file, source);
    await compileWorkflow(file, { write: true });
    return fs.readFileSync(file, 'utf-8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Each case wires one built-in. A durable gate has to be the only boundary in
// its branch region, so the gated cases keep the graph to one expression node
// feeding the gate.
const CASES: Array<{ name: string; builtIn: string; source: string }> = [
  {
    name: 'waitForAgent',
    builtIn: 'waitForAgent',
    source: `
/**
 * @flowWeaver nodeType
 * @expression
 * @input task - task
 * @output agentId - agent to call
 * @output context - context for the agent
 */
function prep(task: string): { agentId: string; context: object } {
  return { agentId: 'worker', context: { task } };
}

/**
 * @flowWeaver workflow
 * @param task - entry
 * @returns agentResult - result
 * @node p prep
 * @node gate waitForAgent [expr: agentId="p.agentId", context="p.context"]
 * @path Start -> p -> gate -> Exit
 */
export async function wf(
  execute: boolean,
  params: { task: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; agentResult: object }> {
  throw new Error('Not implemented');
}
`,
  },
  {
    name: 'waitForEvent',
    builtIn: 'waitForEvent',
    source: `
/**
 * @flowWeaver nodeType
 * @expression
 * @input task - task
 * @output eventName - event to await
 */
function prep(task: string): { eventName: string } {
  return { eventName: \`evt-\${task}\` };
}

/**
 * @flowWeaver workflow
 * @param task - entry
 * @returns eventData - result
 * @node p prep
 * @node gate waitForEvent [expr: eventName="p.eventName"]
 * @path Start -> p -> gate -> Exit
 */
export async function wf(
  execute: boolean,
  params: { task: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; eventData: object }> {
  throw new Error('Not implemented');
}
`,
  },
  {
    name: 'sleep',
    builtIn: 'sleep',
    source: `
/**
 * @flowWeaver nodeType
 * @expression
 * @input task - task
 * @output duration - how long to sleep
 */
function prep(task: string): { duration: string } {
  return { duration: \`1s\${task ? '' : ''}\` };
}

/**
 * @flowWeaver workflow
 * @param task - entry
 * @returns elapsed - result
 * @node p prep
 * @node gate sleep [expr: duration="p.duration"]
 * @path Start -> p -> gate -> Exit
 */
export async function wf(
  execute: boolean,
  params: { task: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; elapsed: boolean }> {
  throw new Error('Not implemented');
}
`,
  },
  {
    // delay and invokeWorkflow are @durablePure, so they share one ungated
    // workflow. invokeWorkflow is the case that needs the full
    // NodeExecutionRuntime: it reads recursionDepth and createNestedRuntime.
    name: 'delay and invokeWorkflow',
    builtIn: 'invokeWorkflow',
    source: `
/**
 * @flowWeaver nodeType
 * @expression
 * @input task - task
 * @output functionId - workflow to invoke
 * @output payload - payload
 * @output duration - delay duration
 */
function prep(task: string): { functionId: string; payload: object; duration: string } {
  return { functionId: 'other/wf', payload: { task }, duration: '1s' };
}

/**
 * @flowWeaver workflow
 * @param task - entry
 * @returns result - result
 * @node p prep
 * @node napped delay [expr: duration="p.duration"]
 * @node called invokeWorkflow [expr: functionId="p.functionId", payload="p.payload"]
 * @path Start -> p -> napped -> called -> Exit
 */
export async function wf(
  execute: boolean,
  params: { task: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; result: object }> {
  throw new Error('Not implemented');
}
`,
  },
];

describe('generated built-ins type-check under strict mode', () => {
  for (const { name, builtIn, source } of CASES) {
    it(`${name}: compiles to TypeScript with no implicit any`, async () => {
      const code = await compileSource(source);

      // The built-in really was inlined, so the check below means something.
      expect(code).toContain(`function ${builtIn}(`);

      const errors = diagnose(code);
      expect(errors).toEqual([]);
    }, 30_000);
  }

  it('inlines built-in signatures with type annotations, not bare parameters', async () => {
    const code = await compileSource(CASES[0].source);

    // The bug this guards: `async function waitForAgent(execute, agentId, ...)`
    // with no annotations anywhere. Every parameter must carry a type, and so
    // must the file-level helpers the body calls.
    expect(code).toMatch(/function waitForAgent\(\s*execute: boolean/);
    expect(code).toMatch(/function __fw_getMockConfig\(runtime\??: /);
    expect(code).not.toMatch(/function waitForAgent\(execute, /);
  }, 30_000);
});
