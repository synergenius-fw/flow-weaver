/**
 * Tests to find the exact cache behavior causing @fwImport to be lost.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parser, TExternalNodeType } from '../../src/parser';
import { generateInPlace } from '../../src/api/generate-in-place';
import { addNodeType, addNode } from '../../src/api';
import type { TNodeTypeAST, TNodeInstanceAST } from '../../src/ast/types';

describe('npm @fwImport cache behavior', () => {
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

  const externalNpmType: TExternalNodeType = {
    name: 'npm/autoprefixer/autoprefixer',
    functionName: 'npm/autoprefixer/autoprefixer',
    ports: [
      { name: 'execute', type: 'STEP', direction: 'INPUT' },
      { name: 'result', type: 'ANY', direction: 'OUTPUT' },
      { name: 'onSuccess', type: 'STEP', direction: 'OUTPUT' },
      { name: 'onFailure', type: 'STEP', direction: 'OUTPUT' },
    ],
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-cache-test-'));
    tempFile = path.join(tempDir, 'test-workflow.ts');
    fs.writeFileSync(tempFile, MINIMAL_WORKFLOW, 'utf-8');
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('TEST 1: Parse without external types, then with external types after @fwImport added', () => {
    // Simulate: workflow opened (cached), then addNodeType with external types, then addNode without external types

    // Step 1: Parse WITHOUT external types (like when workflow is first opened)
    let parsed = parser.parse(tempFile);

    // Step 2: Write @fwImport to file manually
    const workflowWithImport = MINIMAL_WORKFLOW.replace(
      '@name testWorkflow',
      '@name testWorkflow\n * @fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"'
    );
    fs.writeFileSync(tempFile, workflowWithImport, 'utf-8');

    // Step 3: Parse WITHOUT external types again
    parsed = parser.parse(tempFile);
    const typesWithImportSource = parsed.workflows[0].nodeTypes.filter(
      nt => (nt as { importSource?: string }).importSource
    );

    expect(typesWithImportSource.length).toBeGreaterThan(0);
  });

  it('TEST 2: Cache behavior when external types are passed then NOT passed', () => {
    // This tests: parse with externals -> write @fwImport -> parse WITHOUT externals
    // Does the cache return stale result?

    // Step 1: Parse WITH external types
    let parsed = parser.parse(tempFile, [externalNpmType]);

    // Step 2: Write @fwImport to file
    const workflowWithImport = MINIMAL_WORKFLOW.replace(
      '@name testWorkflow',
      '@name testWorkflow\n * @fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"'
    );
    fs.writeFileSync(tempFile, workflowWithImport, 'utf-8');

    // Step 3: Parse WITHOUT external types - will cache be used?
    parsed = parser.parse(tempFile);
    const typesWithImportSource = parsed.workflows[0].nodeTypes.filter(
      nt => (nt as { importSource?: string }).importSource
    );

    expect(typesWithImportSource.length).toBeGreaterThan(0);
  });

  it('TEST 3: Cache populated by non-external parse, then file changes, then external parse', () => {
    // This is the exact server flow:
    // 1. Workflow opened (no externals) - CACHED
    // 2. addNodeType with externals - writes @fwImport - cache NOT updated (because externals used)
    // 3. addNode with externals - should see @fwImport

    // Step 1: Parse WITHOUT external types (workflow opened)
    let parsed = parser.parse(tempFile);

    // Step 2: Parse WITH external types, add npm type, write @fwImport
    parsed = parser.parse(tempFile, [externalNpmType]);
    let workflow = parsed.workflows[0];

    const npmNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'npm/autoprefixer/autoprefixer',
      functionName: 'npm/autoprefixer/autoprefixer',
      importSource: 'autoprefixer',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };
    workflow = addNodeType(workflow, npmNodeType);

    let sourceCode = fs.readFileSync(tempFile, 'utf-8');
    let result = generateInPlace(sourceCode, workflow);
    fs.writeFileSync(tempFile, result.code, 'utf-8');

    // Step 3: Parse WITH external types again
    parsed = parser.parse(tempFile, [externalNpmType]);
    workflow = parsed.workflows[0];

    const typesWithImportSource = workflow.nodeTypes.filter(
      nt => (nt as { importSource?: string }).importSource
    );

    expect(typesWithImportSource.length).toBeGreaterThan(0);

    // Step 4: Add node and regenerate
    const nodeInstance: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: 'npm_node_1',
      nodeType: 'npm/autoprefixer/autoprefixer',
      config: { x: 100, y: 100 },
    };
    workflow = addNode(workflow, nodeInstance);

    const typesAfterAddNode = workflow.nodeTypes.filter(
      nt => (nt as { importSource?: string }).importSource
    );

    expect(typesAfterAddNode.length).toBeGreaterThan(0);

    sourceCode = fs.readFileSync(tempFile, 'utf-8');
    result = generateInPlace(sourceCode, workflow);

    expect(result.code).toContain('@fwImport npm/autoprefixer/autoprefixer');
  });

  it('TEST 4: What happens when external type is ALREADY in nodeTypes from parse', () => {
    // When parser adds external type, it might interfere with @fwImport type

    // Write file with @fwImport
    const workflowWithImport = MINIMAL_WORKFLOW.replace(
      '@name testWorkflow',
      '@name testWorkflow\n * @fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"'
    );
    fs.writeFileSync(tempFile, workflowWithImport, 'utf-8');

    // Parse WITH external types
    const parsed = parser.parse(tempFile, [externalNpmType]);
    const workflow = parsed.workflows[0];

    // Check for duplicates
    const npmTypes = workflow.nodeTypes.filter(nt => nt.name === 'npm/autoprefixer/autoprefixer');

    const npmTypesWithImportSource = npmTypes.filter(nt => (nt as { importSource?: string }).importSource);

    expect(npmTypesWithImportSource.length).toBeGreaterThan(0);

    // Now generate and check @fwImport is preserved
    const sourceCode = fs.readFileSync(tempFile, 'utf-8');
    const result = generateInPlace(sourceCode, workflow);

    expect(result.code).toContain('@fwImport npm/autoprefixer/autoprefixer');
  });

  it('TEST 5: Rapid file write then parse - timing issue?', async () => {
    // Step 1: Parse file
    let parsed = parser.parse(tempFile, [externalNpmType]);
    let workflow = parsed.workflows[0];

    // Step 2: Add npm type and write immediately
    const npmNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'npm/autoprefixer/autoprefixer',
      functionName: 'npm/autoprefixer/autoprefixer',
      importSource: 'autoprefixer',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };
    workflow = addNodeType(workflow, npmNodeType);

    let sourceCode = fs.readFileSync(tempFile, 'utf-8');
    let result = generateInPlace(sourceCode, workflow);
    fs.writeFileSync(tempFile, result.code, 'utf-8');

    // Step 3: IMMEDIATELY parse again (no delay)
    parsed = parser.parse(tempFile, [externalNpmType]);
    workflow = parsed.workflows[0];

    const typesWithImportSource = workflow.nodeTypes.filter(
      nt => (nt as { importSource?: string }).importSource
    );

    expect(typesWithImportSource.length).toBeGreaterThan(0);

    // Step 4: Add node immediately
    const nodeInstance: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: 'npm_node_1',
      nodeType: 'npm/autoprefixer/autoprefixer',
      config: { x: 100, y: 100 },
    };
    workflow = addNode(workflow, nodeInstance);

    sourceCode = fs.readFileSync(tempFile, 'utf-8');
    result = generateInPlace(sourceCode, workflow);

    expect(result.code).toContain('@fwImport npm/autoprefixer/autoprefixer');
  });
});
