/**
 * Integration test for npm @fwImport persistence when external node types are passed.
 * This simulates the exact server flow where the client sends externalNodeTypes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parser, TExternalNodeType } from '../../src/parser';
import { generateInPlace } from '../../src/api/generate-in-place';
import { addNodeType, addNode } from '../../src/api';
import type { TNodeTypeAST, TNodeInstanceAST } from '../../src/ast/types';

describe('npm @fwImport with external node types', () => {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-npm-ext-test-'));
    tempFile = path.join(tempDir, 'test-workflow.ts');
    fs.writeFileSync(tempFile, MINIMAL_WORKFLOW, 'utf-8');

    // Clear parser cache to ensure fresh parse
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should preserve @fwImport when external types are passed on second parse', () => {
    // This simulates the exact server flow:
    // 1. addNodeTypeInWorkflow - parses with external types, writes @fwImport
    // 2. addNodeToWorkflow - parses with external types, should see @fwImport

    // Simulate external node type passed by client (without importSource)
    const externalNodeType: TExternalNodeType = {
      name: 'npm/autoprefixer/autoprefixer',
      functionName: 'npm/autoprefixer/autoprefixer',
      ports: [
        { name: 'execute', type: 'STEP', direction: 'INPUT' },
        { name: 'args', type: 'OBJECT', direction: 'INPUT' },
        { name: 'result', type: 'ANY', direction: 'OUTPUT' },
        { name: 'onSuccess', type: 'STEP', direction: 'OUTPUT' },
        { name: 'onFailure', type: 'STEP', direction: 'OUTPUT' },
      ],
    };

    // Step 1: Parse with external types (like addNodeTypeInWorkflow does)
    let parsed = parser.parse(tempFile, [externalNodeType]);
    let workflow = parsed.workflows[0];

    // Step 2: Add npm node type with importSource (the mutation)
    const npmNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'npm/autoprefixer/autoprefixer',
      functionName: 'npm/autoprefixer/autoprefixer',
      importSource: 'autoprefixer',
      inputs: { execute: { dataType: 'STEP' }, args: { dataType: 'OBJECT' } },
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    workflow = addNodeType(workflow, npmNodeType);

    // Step 3: Generate and write (like addNodeTypeInWorkflow does)
    let sourceCode = fs.readFileSync(tempFile, 'utf-8');
    let result = generateInPlace(sourceCode, workflow);

    expect(result.code).toContain('@fwImport npm/autoprefixer/autoprefixer');

    fs.writeFileSync(tempFile, result.code, 'utf-8');

    // Step 4: Parse AGAIN with external types (like addNodeToWorkflow does)
    // This is the critical step - the parser should see the @fwImport annotation
    parsed = parser.parse(tempFile, [externalNodeType]);
    workflow = parsed.workflows[0];

    // The npm type should have importSource (from @fwImport annotation)
    const npmTypesWithImportSource = workflow.nodeTypes.filter(
      nt => (nt as { importSource?: string }).importSource
    );

    expect(npmTypesWithImportSource.length).toBeGreaterThan(0);
    expect(npmTypesWithImportSource.some(
      nt => nt.name === 'npm/autoprefixer/autoprefixer' &&
            (nt as { importSource?: string }).importSource === 'autoprefixer'
    )).toBe(true);

    // Step 5: Add a node and regenerate
    const nodeInstance: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: 'npm_node_1',
      nodeType: 'npm/autoprefixer/autoprefixer',
      config: { x: 100, y: 100 },
    };

    workflow = addNode(workflow, nodeInstance);

    // Regenerate
    sourceCode = fs.readFileSync(tempFile, 'utf-8');
    result = generateInPlace(sourceCode, workflow);

    // The @fwImport should still be there
    expect(result.code).toContain('@fwImport npm/autoprefixer/autoprefixer');
  });

  it('should handle case where external type and @fwImport type have different functionName', () => {
    // The external type from client has functionName = 'npm/...'
    // The @fwImport creates a type with functionName = 'autoprefixer' (actual function name)
    // Both should coexist, and the one with importSource should be used for @fwImport generation

    const externalNodeType: TExternalNodeType = {
      name: 'npm/autoprefixer/autoprefixer',
      functionName: 'npm/autoprefixer/autoprefixer', // Full path as functionName
      ports: [],
    };

    // Write a file that already has @fwImport
    const workflowWithImport = `/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"
 */
export async function testWorkflow(execute: boolean, params: {}): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  return { onSuccess: true, onFailure: false };
  // @flow-weaver-body-end
}
`;
    fs.writeFileSync(tempFile, workflowWithImport, 'utf-8');
    parser.clearCache();

    // Parse with external type
    const parsed = parser.parse(tempFile, [externalNodeType]);
    const workflow = parsed.workflows[0];

    // Should have at least one type with importSource
    const typesWithImportSource = workflow.nodeTypes.filter(
      nt => (nt as { importSource?: string }).importSource
    );
    expect(typesWithImportSource.length).toBeGreaterThan(0);

    // Now regenerate and verify @fwImport is preserved
    const sourceCode = fs.readFileSync(tempFile, 'utf-8');
    const result = generateInPlace(sourceCode, workflow);

    expect(result.code).toContain('@fwImport npm/autoprefixer/autoprefixer');
  });
});
