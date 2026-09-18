/**
 * An @expression node in a gated workflow is treated as @durablePure without
 * the tag. Expression mode is a pure input-to-output function by
 * construction, so requiring the classification was pure boilerplate. An
 * explicit tag still applies, and gate/effect nodes still need their tag.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { parseWorkflow } from '../../src/api/parse';
import { validateDurableClosure } from '../../src/api/durable-validation';
import { executeWorkflow } from '../../src/mcp/workflow-executor';

const bundleDigest = `sha256:${'7'.repeat(64)}`;

const GATED_NO_PURE_TAGS = `
/** @flowWeaver nodeType @expression */
function prep(path: string) {
  return { agentId: 'inspect', context: { path }, prompt: \`Look at \${path}\` };
}

/** @flowWeaver nodeType @expression */
function done(verdict: Record<string, unknown>) {
  return { report: String(verdict?.summary ?? '(none)') };
}

/**
 * @flowWeaver workflow
 * @param path - File
 * @returns report - Report
 * @node p prep
 * @node inspect waitForAgent [expr: agentId="p.agentId", context="p.context", prompt="p.prompt"]
 * @node d done [expr: verdict="inspect.agentResult"]
 * @path Start -> p -> inspect -> d -> Exit
 */
export async function gated(execute: boolean, params: { path: string }): Promise<{ onSuccess: boolean; onFailure: boolean; report: string }> {
  throw new Error('stub');
}
`;

async function inTemp<T>(code: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-implied-pure-'));
  const file = path.join(dir, 'flow.ts');
  fs.writeFileSync(file, code);
  try {
    return await fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('@expression implies @durablePure in a gated workflow', () => {
  it('the closure validator does not flag untagged expression nodes as unclassified', async () => {
    await inTemp(GATED_NO_PURE_TAGS, async (file) => {
      const parsed = await parseWorkflow(file, { workflowName: 'gated' });
      expect(parsed.errors).toEqual([]);
      const analysis = validateDurableClosure(parsed.ast, []);
      expect(analysis.hasDurableGate).toBe(true);
    });
  });

  it('runs, yields at the gate and resumes to completion', async () => {
    await inTemp(GATED_NO_PURE_TAGS, async (file) => {
      const yielded = await executeWorkflow({
        runId: 'implied-pure-run',
        bundleDigest,
        filePath: file,
        workflowName: 'gated',
        params: { path: 'x.ts' },
        production: false,
      });
      expect(yielded.kind).toBe('yielded');
      if (yielded.kind !== 'yielded') return;
      expect(yielded.gate.kind).toBe('agent');

      const resumed = await executeWorkflow({
        runId: 'implied-pure-run',
        bundleDigest,
        filePath: file,
        workflowName: 'gated',
        params: { path: 'x.ts' },
        production: false,
        continuation: yielded.continuation,
        resolution: { gateId: yielded.gate.id, value: { onSuccess: true, onFailure: false, agentResult: { summary: 'ok' } } },
      });
      expect(resumed.kind).toBe('completed');
      if (resumed.kind !== 'completed') return;
      expect(resumed.result).toMatchObject({ onSuccess: true, report: 'ok' });
    });
  });

  it('still rejects a normal-mode node with no durable classification', async () => {
    const code = `
/** @flowWeaver nodeType @expression */
function prep(path: string) { return { agentId: 'inspect', context: { path }, prompt: 'x' }; }

/**
 * A normal-mode node (execute param, onSuccess/onFailure) is NOT implicitly pure.
 * @flowWeaver nodeType
 * @input verdict
 * @output report
 */
function done(execute: boolean, verdict: Record<string, unknown>): { onSuccess: boolean; onFailure: boolean; report: string } {
  if (!execute) return { onSuccess: false, onFailure: false, report: '' };
  return { onSuccess: true, onFailure: false, report: String(verdict?.summary ?? '') };
}

/**
 * @flowWeaver workflow
 * @param path - File
 * @returns report - Report
 * @node p prep
 * @node inspect waitForAgent [expr: agentId="p.agentId", context="p.context", prompt="p.prompt"]
 * @node d done [expr: verdict="inspect.agentResult"]
 * @path Start -> p -> inspect -> d -> Exit
 */
export async function gated(execute: boolean, params: { path: string }): Promise<{ onSuccess: boolean; onFailure: boolean; report: string }> {
  throw new Error('stub');
}
`;
    await inTemp(code, async (file) => {
      const parsed = await parseWorkflow(file, { workflowName: 'gated' });
      expect(parsed.errors).toEqual([]);
      expect(() => validateDurableClosure(parsed.ast, [])).toThrow(/gated\.d \(done\): unclassified/);
    });
  });
});
