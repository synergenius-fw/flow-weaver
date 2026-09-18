/**
 * The scaffold templates must produce workflows that validate cleanly and
 * run. Nothing else checks the generated text as a workflow, so a template
 * edit that breaks the annotations would otherwise pass CI.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseWorkflow, validateWorkflow } from '../../../src/api/index';
import { executeWorkflow } from '../../../src/mcp/workflow-executor';
import { sequentialTemplate } from '../../../src/cli/templates/workflows/sequential';
import { foreachTemplate } from '../../../src/cli/templates/workflows/foreach';
import type { WorkflowTemplateOptions } from '../../../src/cli/templates/index';

const bundleDigest = `sha256:${'d'.repeat(64)}`;

async function scaffold(code: string, name: string): Promise<{ file: string; cleanup: () => void }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `fw-template-${name}-`));
  const file = path.join(dir, `${name}.ts`);
  fs.writeFileSync(file, code);
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function validateClean(file: string, workflowName: string) {
  const parsed = await parseWorkflow(file, { workflowName });
  expect(parsed.errors).toEqual([]);
  const v = validateWorkflow(parsed.ast);
  expect(v.errors).toEqual([]);
  expect(v.warnings.map((w) => w.code)).toEqual([]);
  return parsed.ast;
}

describe('scaffold templates produce valid, runnable workflows', () => {
  for (const isAsync of [false, true]) {
    it(`sequential (async: ${isAsync})`, async () => {
      const code = sequentialTemplate.generate({ workflowName: 'pipeline', async: isAsync } as WorkflowTemplateOptions);
      const { file, cleanup } = await scaffold(code, 'sequential');
      try {
        await validateClean(file, 'pipeline');
        const outcome = await executeWorkflow({
          runId: `template-sequential-${isAsync}`,
          bundleDigest,
          filePath: file,
          workflowName: 'pipeline',
          params: { data: { hello: 'world' } },
          production: false,
        });
        expect(outcome.kind).toBe('completed');
        if (outcome.kind === 'completed') {
          expect((outcome.result as { onSuccess: boolean }).onSuccess).toBe(true);
        }
      } finally {
        cleanup();
      }
    });

    it(`sequential with custom nodes and ports (async: ${isAsync})`, async () => {
      const code = sequentialTemplate.generate({
        workflowName: 'pipeline',
        async: isAsync,
        config: { nodes: ['fetch', 'parse', 'store'], input: 'url', output: 'stored' },
      } as unknown as WorkflowTemplateOptions);
      const { file, cleanup } = await scaffold(code, 'sequential-custom');
      try {
        await validateClean(file, 'pipeline');
        const outcome = await executeWorkflow({
          runId: `template-sequential-custom-${isAsync}`,
          bundleDigest,
          filePath: file,
          workflowName: 'pipeline',
          params: { url: 'https://example.test' },
          production: false,
        });
        expect(outcome.kind).toBe('completed');
        if (outcome.kind === 'completed') {
          expect(outcome.result).toMatchObject({ onSuccess: true, stored: 'https://example.test' });
        }
      } finally {
        cleanup();
      }
    });

    it(`foreach (async: ${isAsync})`, async () => {
      const code = foreachTemplate.generate({ workflowName: 'batch', async: isAsync } as WorkflowTemplateOptions);
      const { file, cleanup } = await scaffold(code, 'foreach');
      try {
        const ast = await validateClean(file, 'batch');
        // The scope wiring stays explicit; everything else comes from @path
        const explicit = (ast.macros ?? []).filter((m) => m.type === 'path');
        expect(explicit.length).toBeGreaterThan(0);
        const outcome = await executeWorkflow({
          runId: `template-foreach-${isAsync}`,
          bundleDigest,
          filePath: file,
          workflowName: 'batch',
          params: { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
          production: false,
        });
        expect(outcome.kind).toBe('completed');
        if (outcome.kind === 'completed') {
          expect(outcome.result).toMatchObject({ onSuccess: true, successCount: 3, failedCount: 0 });
          expect((outcome.result as { results: unknown[] }).results).toHaveLength(3);
        }
      } finally {
        cleanup();
      }
    });
  }
});
