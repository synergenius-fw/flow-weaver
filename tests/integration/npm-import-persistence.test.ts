/**
 * Integration test for npm @fwImport persistence through parse/generate cycle.
 *
 * This test verifies that when:
 * 1. An npm node type is added to a workflow (with importSource)
 * 2. generateInPlace writes the @fwImport annotation to the file
 * 3. The file is re-parsed
 * 4. The npm node type still has importSource (from @fwImport parsing)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parser } from '../../src/parser';
import { generateInPlace } from '../../src/api/generate-in-place';
import { addNodeType, addNode } from '../../src/api';
import type { TNodeTypeAST, TNodeInstanceAST } from '../../src/ast/types';

describe('npm @fwImport persistence through parse/generate cycle', () => {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-npm-test-'));
    tempFile = path.join(tempDir, 'test-workflow.ts');
    fs.writeFileSync(tempFile, MINIMAL_WORKFLOW, 'utf-8');

    // Clear parser cache to ensure fresh parse
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should parse @fwImport annotation and create npm node type with importSource', () => {
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

    // Parse the file
    const parsed = parser.parse(tempFile);
    expect(parsed.workflows.length).toBe(1);

    const workflow = parsed.workflows[0];
    // Find the npm node type
    const npmType = workflow.nodeTypes.find((nt) => nt.name === 'npm/autoprefixer/autoprefixer');
    expect(npmType).toBeDefined();
    expect((npmType as { importSource?: string }).importSource).toBe('autoprefixer');
  });

  it('should preserve importSource through addNodeType -> generateInPlace -> re-parse cycle', () => {
    // Step 1: Parse initial file (no npm types)
    let parsed = parser.parse(tempFile);
    let workflow = parsed.workflows[0];

    // The workflow may include itself as a same-file workflow type, so nodeTypes might not be 0
    // The important thing is that there are no npm types with importSource yet
    const initialNpmTypes = workflow.nodeTypes.filter(
      (nt) => (nt as { importSource?: string }).importSource
    );
    expect(initialNpmTypes.length).toBe(0);

    // Step 2: Add npm node type
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

    // Verify the npm type has importSource
    const addedType = workflow.nodeTypes.find((nt) => nt.name === 'npm/autoprefixer/autoprefixer');
    expect(addedType).toBeDefined();
    expect((addedType as { importSource?: string }).importSource).toBe('autoprefixer');

    // Step 3: Generate code (should write @fwImport annotation)
    const sourceCode = fs.readFileSync(tempFile, 'utf-8');
    const result = generateInPlace(sourceCode, workflow);

    expect(result.code).toContain('@fwImport npm/autoprefixer/autoprefixer');

    // Write the generated code
    fs.writeFileSync(tempFile, result.code, 'utf-8');

    // Step 4: Clear cache and re-parse
    parser.clearCache();

    parsed = parser.parse(tempFile);
    workflow = parsed.workflows[0];

    // The npm type should still have importSource (from @fwImport parsing)
    const reparsedType = workflow.nodeTypes.find(
      (nt) => nt.name === 'npm/autoprefixer/autoprefixer'
    );
    expect(reparsedType).toBeDefined();
    expect((reparsedType as { importSource?: string }).importSource).toBe('autoprefixer');
  });

  it('FAILING: should preserve importSource when addNode is called after addNodeType', () => {
    // This simulates the actual bug:
    // 1. Client calls addNodeType (writes @fwImport)
    // 2. Client calls addNode (re-parses, should see @fwImport)
    // 3. But addNode's workflow has no importSource, so @fwImport gets dropped

    // Step 1: Parse initial file
    let parsed = parser.parse(tempFile);
    let workflow = parsed.workflows[0];

    // Step 2: Add npm node type
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

    // Step 3: Generate and write (like addNodeTypeInWorkflow does)
    let sourceCode = fs.readFileSync(tempFile, 'utf-8');
    let result = generateInPlace(sourceCode, workflow);
    fs.writeFileSync(tempFile, result.code, 'utf-8');

    // Step 4: Clear cache and re-parse (like addNodeToWorkflow does)
    parser.clearCache();

    parsed = parser.parse(tempFile);
    workflow = parsed.workflows[0];

    // Step 5: Add a node instance
    const nodeInstance: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: 'npm_node_1',
      nodeType: 'npm/autoprefixer/autoprefixer',
      config: { x: 100, y: 100 },
    };

    workflow = addNode(workflow, nodeInstance);

    // Step 6: Generate again (like addNodeToWorkflow does)
    sourceCode = fs.readFileSync(tempFile, 'utf-8');
    result = generateInPlace(sourceCode, workflow);

    // The @fwImport should still be there!
    expect(result.code).toContain('@fwImport npm/autoprefixer/autoprefixer');

    // Write and re-parse one more time to verify persistence
    fs.writeFileSync(tempFile, result.code, 'utf-8');
    parser.clearCache();

    parsed = parser.parse(tempFile);
    workflow = parsed.workflows[0];

    const finalNpmType = workflow.nodeTypes.find(
      (nt) => nt.name === 'npm/autoprefixer/autoprefixer'
    );
    expect(finalNpmType).toBeDefined();
    expect((finalNpmType as { importSource?: string }).importSource).toBe('autoprefixer');
  });

  it('should infer expression: true for npm @fwImport node types', () => {
    // Verify that @fwImport uses proper inference and sets expression: true
    const workflowWithImport = `/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport npm/lodash/map map from "lodash"
 */
export async function testWorkflow(execute: boolean, params: {}): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  return { onSuccess: true, onFailure: false };
  // @flow-weaver-body-end
}
`;
    fs.writeFileSync(tempFile, workflowWithImport, 'utf-8');

    // Parse the file
    const parsed = parser.parse(tempFile);
    const workflow = parsed.workflows[0];

    // Find the npm node type
    const npmType = workflow.nodeTypes.find((nt) => nt.name === 'npm/lodash/map');
    expect(npmType).toBeDefined();

    // Key assertion: expression should be true (inferred from .d.ts, or stub fallback)
    // This is the main fix - previously expression was undefined
    expect(npmType?.expression).toBe(true);
    // importSource should be preserved
    expect(npmType?.importSource).toBe('lodash');
  });

  it('should preserve expression flag through parse/generate/re-parse cycle', () => {
    // Parse workflow with @fwImport
    const workflowWithImport = `/**
 * @flowWeaver workflow
 * @name testWorkflow
 * @fwImport npm/lodash/map map from "lodash"
 */
export async function testWorkflow(execute: boolean, params: {}): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  // @flow-weaver-body-start
  return { onSuccess: true, onFailure: false };
  // @flow-weaver-body-end
}
`;
    fs.writeFileSync(tempFile, workflowWithImport, 'utf-8');

    // First parse
    let parsed = parser.parse(tempFile);
    let workflow = parsed.workflows[0];
    let npmType = workflow.nodeTypes.find((nt) => nt.name === 'npm/lodash/map');

    expect(npmType?.expression).toBe(true);
    const initialInputCount = Object.keys(npmType?.inputs || {}).length;

    // Generate and re-write (simulating normal edit cycle)
    const sourceCode = fs.readFileSync(tempFile, 'utf-8');
    const result = generateInPlace(sourceCode, workflow);
    fs.writeFileSync(tempFile, result.code, 'utf-8');

    // Re-parse
    parser.clearCache();
    parsed = parser.parse(tempFile);
    workflow = parsed.workflows[0];
    npmType = workflow.nodeTypes.find((nt) => nt.name === 'npm/lodash/map');

    // expression should still be true (re-inferred on parse)
    expect(npmType?.expression).toBe(true);
    // Inputs should be preserved/re-inferred
    expect(Object.keys(npmType?.inputs || {}).length).toBe(initialInputCount);
  });
});
