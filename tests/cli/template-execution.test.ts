/**
 * Template execution smoke tests.
 *
 * Verifies that compiled template output actually runs without runtime errors.
 * Catches bugs like duplicate variable declarations in generated code or
 * null access in mock providers that static validation misses.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  listWorkflowTemplates,
  generateWorkflowFromTemplate,
} from '../../src/api/templates';
import { executeWorkflowFromFile } from '../../src/mcp/workflow-executor';

const tempDir = path.join(os.tmpdir(), `fw-template-exec-${process.pid}`);

beforeAll(() => {
  fs.mkdirSync(tempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Sample params for each template. Templates not listed here are skipped
// (they need external dependencies or have no meaningful sync execution path).
const TEMPLATE_PARAMS: Record<string, Record<string, unknown>> = {
  sequential: { data: { name: 'test' } },
  foreach: { items: [{ id: 1 }, { id: 2 }] },
  conditional: { data: { value: 42 } },
  aggregator: { sourceA: { x: 1 }, sourceB: { y: 2 } },
  'error-handler': { data: { value: 5 } },
  webhook: { method: 'GET', path: '/test', headers: {}, body: null },
  'ai-agent': { userMessage: 'Hello' },
  'ai-react': { task: 'Test task' },
  'ai-rag': { question: 'What is Flow Weaver?' },
  'ai-chat': { userMessage: 'Hi' },
};

describe('Template execution smoke tests', () => {
  const templates = listWorkflowTemplates();

  for (const template of templates) {
    const params = TEMPLATE_PARAMS[template.id];
    if (!params) continue;

    it(`${template.id}: compiled output executes without error`, async () => {
      const workflowName = `smoke${template.id.replace(/-/g, '')}`;
      const code = generateWorkflowFromTemplate(template.id, {
        workflowName,
        async: true,
      });

      const filePath = path.join(tempDir, `${template.id}-exec.ts`);
      fs.writeFileSync(filePath, code);

      const result = await executeWorkflowFromFile(filePath, params, {
        production: true,
        includeTrace: false,
      });

      expect((result as unknown as Record<string, unknown>).error).toBeUndefined();
      expect(result.result).toBeDefined();
    }, 15_000);
  }
});
