/**
 * Test that importSource is preserved when mutating workflows.
 *
 * This tests the exact bug scenario:
 * 1. addNodeTypeInWorkflow writes @fwImport to file
 * 2. saveWorkflowState (or other mutation) sends client workflow WITHOUT importSource
 * 3. The merge logic should preserve importSource from parsed @fwImport annotation
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parser } from '../../src/parser';
import { generateInPlace } from '../../src/api/generate-in-place';
import type { TNodeTypeAST, TWorkflowAST } from '../../src/ast/types';

describe('importSource preservation through mutations', () => {
  let tempDir: string;
  let tempFile: string;

  const MINIMAL_WORKFLOW = `/**
 * @flowWeaver workflow
 * @name testWorkflow
 */
export async function testWorkflow(execute: boolean, params: {}): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  return { onSuccess: true, onFailure: false };
  // @flow-weaver-body-end
}
`;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-import-preserve-'));
    tempFile = path.join(tempDir, 'test-workflow.ts');
    fs.writeFileSync(tempFile, MINIMAL_WORKFLOW, 'utf-8');
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should preserve importSource when client workflow lacks it but file has @fwImport', () => {
    // Step 1: Write @fwImport to file (simulates addNodeTypeInWorkflow)
    const workflowWithImport = MINIMAL_WORKFLOW.replace(
      '@name testWorkflow',
      '@name testWorkflow\n * @fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"'
    );
    fs.writeFileSync(tempFile, workflowWithImport, 'utf-8');

    // Step 2: Parse the file - should have importSource from @fwImport
    const parsed = parser.parse(tempFile);
    const parsedWorkflow = parsed.workflows[0];

    const parsedNpmType = parsedWorkflow.nodeTypes.find(
      (nt) => nt.name === 'npm/autoprefixer/autoprefixer'
    );
    expect(parsedNpmType).toBeDefined();
    expect((parsedNpmType as { importSource?: string }).importSource).toBe('autoprefixer');

    // Step 3: Simulate client sending workflow WITHOUT importSource
    // (This is what saveWorkflowState does - client doesn't have importSource)
    const clientWorkflow: TWorkflowAST = {
      ...parsedWorkflow,
      nodeTypes: parsedWorkflow.nodeTypes.map((nt) => {
        if (nt.name === 'npm/autoprefixer/autoprefixer') {
          // Client version has the type but NO importSource
          const { importSource, ...rest } = nt as TNodeTypeAST & { importSource?: string };
          return rest as TNodeTypeAST;
        }
        return nt;
      }),
    };

    // Verify client workflow doesn't have importSource
    const clientNpmType = clientWorkflow.nodeTypes.find(
      (nt) => nt.name === 'npm/autoprefixer/autoprefixer'
    );
    expect((clientNpmType as { importSource?: string }).importSource).toBeUndefined();

    // Step 4: Simulate the merge logic from mutateWorkflowFile
    const parsedNodeTypes = parsedWorkflow.nodeTypes;

    // Build map of parsed types with importSource
    const parsedTypesWithImportSource = new Map<string, string>();
    for (const nt of parsedNodeTypes) {
      const importSource = (nt as { importSource?: string }).importSource;
      if (importSource) {
        parsedTypesWithImportSource.set(nt.name, importSource);
      }
    }

    // Preserve importSource from parsed types onto client types
    const mergedNodeTypes = clientWorkflow.nodeTypes.map((nt) => {
      const parsedImportSource = parsedTypesWithImportSource.get(nt.name);
      if (parsedImportSource && !(nt as { importSource?: string }).importSource) {
        return { ...nt, importSource: parsedImportSource };
      }
      return nt;
    });

    const mergedWorkflow = { ...clientWorkflow, nodeTypes: mergedNodeTypes };

    // Step 5: Verify merged workflow has importSource
    const mergedNpmType = mergedWorkflow.nodeTypes.find(
      (nt) => nt.name === 'npm/autoprefixer/autoprefixer'
    );
    expect(mergedNpmType).toBeDefined();
    expect((mergedNpmType as { importSource?: string }).importSource).toBe('autoprefixer');

    // Step 6: Generate code and verify @fwImport is preserved
    const sourceCode = fs.readFileSync(tempFile, 'utf-8');
    const result = generateInPlace(sourceCode, mergedWorkflow);

    expect(result.code).toContain(
      '@fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"'
    );
  });

  it('should NOT overwrite existing importSource on client type', () => {
    // If client already has importSource, don't overwrite it
    const workflowWithImport = MINIMAL_WORKFLOW.replace(
      '@name testWorkflow',
      '@name testWorkflow\n * @fwImport npm/lodash/map map from "lodash"'
    );
    fs.writeFileSync(tempFile, workflowWithImport, 'utf-8');

    const parsed = parser.parse(tempFile);
    const parsedWorkflow = parsed.workflows[0];

    // Client has the type WITH importSource already
    const clientWorkflow: TWorkflowAST = {
      ...parsedWorkflow,
      nodeTypes: parsedWorkflow.nodeTypes.map((nt) => {
        if (nt.name === 'npm/lodash/map') {
          return { ...nt, importSource: 'lodash-es' } as TNodeTypeAST; // Different importSource
        }
        return nt;
      }),
    };

    // Merge logic
    const parsedTypesWithImportSource = new Map<string, string>();
    for (const nt of parsedWorkflow.nodeTypes) {
      const importSource = (nt as { importSource?: string }).importSource;
      if (importSource) {
        parsedTypesWithImportSource.set(nt.name, importSource);
      }
    }

    const mergedNodeTypes = clientWorkflow.nodeTypes.map((nt) => {
      const parsedImportSource = parsedTypesWithImportSource.get(nt.name);
      // Only set if client doesn't already have importSource
      if (parsedImportSource && !(nt as { importSource?: string }).importSource) {
        return { ...nt, importSource: parsedImportSource };
      }
      return nt;
    });

    const mergedWorkflow = { ...clientWorkflow, nodeTypes: mergedNodeTypes };

    // Client's importSource should be preserved (not overwritten)
    const mergedType = mergedWorkflow.nodeTypes.find((nt) => nt.name === 'npm/lodash/map');
    expect((mergedType as { importSource?: string }).importSource).toBe('lodash-es');
  });
});
