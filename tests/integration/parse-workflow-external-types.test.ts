/**
 * `parseWorkflow` must thread `options.externalNodeTypes` through to the
 * underlying `parser.parse(filePath, externalNodeTypes)` call, the same
 * way the low-level parser already accepts them.
 *
 * Regression: `parseWorkflow` called `parser.parse(filePath)` with no
 * external types, so a workflow that references a foreign nodeType by
 * name (an `@node <id> <foreignType>` from another pack, e.g.
 * `waitForApproval` shipped by `@synergenius/flow-weaver-pack-core`)
 * failed with `Node type "..." not found` even when the caller supplied
 * the definition. On-device this surfaced as "This workflow file can't
 * be read" because the runtime resolves pack-core nodeTypes from the
 * install's wire manifest, not from `node_modules`, and feeds them to
 * the parser via this option.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseWorkflow } from '../../src/api/parse';
import { validateWorkflow } from '../../src/api/validate';
import { parser, type TExternalNodeType } from '../../src/parser/annotation-parser';

describe('parseWorkflow with externalNodeTypes', () => {
  let tempDir: string;
  let tempFile: string;

  // A workflow whose only non-local node, `gate`, is a FOREIGN nodeType
  // (`foreignApproval`) defined by some other pack. The file itself does
  // not declare it, so the parser can only resolve it from the
  // externalNodeTypes the caller passes.
  const WORKFLOW_WITH_FOREIGN_NODE = `/**
 * @flowWeaver nodeType
 * @label Prepare
 * @output prompt - The prompt
 */
function prepare(execute: boolean): { onSuccess: boolean; onFailure: boolean; prompt: string } {
  return { onSuccess: true, onFailure: false, prompt: 'go?' };
}

/**
 * @flowWeaver workflow
 * @summary Uses a foreign approval node.
 *
 * @node prep prepare
 * @node gate foreignApproval
 * @path Start -> prep -> gate -> Exit
 * @connect prep.prompt -> gate.prompt
 */
export function usesForeign(
  execute: boolean,
): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`;

  const FOREIGN_NODE_TYPE: TExternalNodeType = {
    name: 'foreignApproval',
    functionName: 'foreignApproval',
    ports: [
      { name: 'execute', type: 'STEP', direction: 'INPUT' },
      { name: 'prompt', type: 'String', direction: 'INPUT' },
      { name: 'approved', type: 'Boolean', direction: 'OUTPUT' },
      { name: 'onSuccess', type: 'STEP', direction: 'OUTPUT' },
      { name: 'onFailure', type: 'STEP', direction: 'OUTPUT' },
    ],
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-parsewf-ext-'));
    tempFile = path.join(tempDir, 'uses-foreign.ts');
    fs.writeFileSync(tempFile, WORKFLOW_WITH_FOREIGN_NODE, 'utf-8');
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports the foreign node as an unknown node type when externalNodeTypes is NOT supplied', async () => {
    const result = await parseWorkflow(tempFile, { workflowName: 'usesForeign' });
    // Baseline: with no external types the foreign node cannot resolve. The
    // parser keeps the instance and the validator names it, once.
    expect(result.errors).toEqual([]);
    const validation = validateWorkflow(result.ast);
    const unknown = validation.errors.filter((e) => e.code === 'UNKNOWN_NODE_TYPE');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].message).toMatch(/foreignApproval/);
  });

  it('resolves the foreign node when externalNodeTypes IS supplied', async () => {
    const result = await parseWorkflow(tempFile, {
      workflowName: 'usesForeign',
      externalNodeTypes: [FOREIGN_NODE_TYPE],
    });
    expect(result.errors).toEqual([]);
    expect(result.ast.functionName).toBe('usesForeign');
    // The foreign nodeType resolved into the workflow's instance graph.
    const gate = result.ast.instances.find((i) => i.id === 'gate');
    expect(gate?.nodeType).toBe('foreignApproval');
  });
});
