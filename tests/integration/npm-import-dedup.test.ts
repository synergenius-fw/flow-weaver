/**
 * TDD test: Reproduces the bug where adding an npm node type via the browser modal
 * results in 3 duplicate @fwImport entries.
 *
 * Hypothesis: The parser at line 1130 concatenates availableNodeTypes (which includes
 * the npm type from externalNodeTypes) with importedNpmNodeTypes (from @fwImport annotations)
 * WITHOUT deduplication. Each write cycle adds one more @fwImport, causing exponential growth:
 *   Write 1: 1 @fwImport (from addNodeType)
 *   Write 2: 2 @fwImport (1 from @fwImport parse + 1 from external → both get importSource)
 *   Write 3: 3 @fwImport (2 from @fwImport parse + 1 from external → all get importSource)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parser } from '../../src/parser';
import type { TExternalNodeType } from '../../src/parser';
import { generateInPlace } from '../../src/api/generate-in-place';
import { addNodeType, addNode } from '../../src/api';
import type { TNodeTypeAST, TNodeInstanceAST, TWorkflowAST } from '../../src/ast/types';

describe('npm @fwImport deduplication bug', () => {
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

  // The npm node type being added (as the server receives it from addNodeTypeInWorkflow)
  const npmNodeType: TNodeTypeAST = {
    type: 'NodeType',
    name: 'npm/acorn/parseExpressionAt',
    functionName: 'parseExpressionAt',
    importSource: 'acorn',
    inputs: { execute: { dataType: 'STEP' }, args: { dataType: 'OBJECT' } },
    outputs: { result: { dataType: 'ANY' } },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
  };

  // The external node type injected by the client (from localNodeTypes via wrappedServiceLayer)
  const externalNodeType: TExternalNodeType = {
    name: 'npm/acorn/parseExpressionAt',
    functionName: 'npm/acorn/parseExpressionAt', // Client uses full npm path as functionName
    ports: [
      { name: 'execute', type: 'STEP', direction: 'INPUT' },
      { name: 'args', type: 'OBJECT', direction: 'INPUT' },
      { name: 'result', type: 'ANY', direction: 'OUTPUT' },
      { name: 'onSuccess', type: 'STEP', direction: 'OUTPUT' },
      { name: 'onFailure', type: 'STEP', direction: 'OUTPUT' },
    ],
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-npm-dedup-test-'));
    tempFile = path.join(tempDir, 'test-workflow.ts');
    fs.writeFileSync(tempFile, MINIMAL_WORKFLOW, 'utf-8');
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Simulate what mutateWorkflowFile does on the server:
   * 1. Read source code
   * 2. Parse with external types
   * 3. Apply mutator
   * 4. Merge importSource from parsed types
   * 5. Generate in-place
   * 6. Write back
   * Returns the workflow that would be returned to the client.
   */
  function simulateMutateWorkflowFile(
    mutator: (workflow: TWorkflowAST) => TWorkflowAST,
    externalTypes?: TExternalNodeType[]
  ): { workflow: TWorkflowAST; writtenCode: string } {
    const sourceCode = fs.readFileSync(tempFile, 'utf-8');

    parser.clearCache();
    const parsed = parser.parse(tempFile, externalTypes);
    const workflow = parsed.workflows[0];

    // Apply mutation
    const updatedWorkflow = mutator(workflow);

    // Merge importSource (replicating mutateWorkflowFile lines 660-687)
    const parsedNodeTypes = workflow.nodeTypes;
    const parsedTypesWithImportSource = new Map<string, string>();
    for (const nt of parsedNodeTypes) {
      const importSource = (nt as { importSource?: string }).importSource;
      if (importSource) {
        parsedTypesWithImportSource.set(nt.name, importSource);
      }
    }

    const mutatedTypeNames = new Set(updatedWorkflow.nodeTypes.map((nt) => nt.name));
    const missingTypes = parsedNodeTypes.filter((nt) => !mutatedTypeNames.has(nt.name));

    const nodeTypesWithImportSource = updatedWorkflow.nodeTypes.map((nt) => {
      const parsedImportSource = parsedTypesWithImportSource.get(nt.name);
      if (parsedImportSource && !(nt as { importSource?: string }).importSource) {
        return { ...nt, importSource: parsedImportSource };
      }
      return nt;
    });

    const workflowForGeneration =
      missingTypes.length > 0 || nodeTypesWithImportSource !== updatedWorkflow.nodeTypes
        ? { ...updatedWorkflow, nodeTypes: [...nodeTypesWithImportSource, ...missingTypes] }
        : updatedWorkflow;

    // Generate in-place
    const result = generateInPlace(sourceCode, workflowForGeneration);

    // Write back
    fs.writeFileSync(tempFile, result.code, 'utf-8');

    return { workflow: updatedWorkflow, writtenCode: result.code };
  }

  function countFwImports(code: string): number {
    return (code.match(/@fwImport/g) || []).length;
  }

  it('should produce exactly 1 @fwImport after addNodeType (write 1)', () => {
    const { writtenCode } = simulateMutateWorkflowFile(
      (workflow) => addNodeType(workflow, npmNodeType),
      [externalNodeType]
    );

    expect(countFwImports(writtenCode)).toBe(1);
  });

  it('should still have exactly 1 @fwImport after addNode (write 2)', () => {
    // Write 1: addNodeType
    simulateMutateWorkflowFile(
      (workflow) => addNodeType(workflow, npmNodeType),
      [externalNodeType]
    );

    // Write 2: addNode (simulates addNodeToWorkflow)
    const nodeInstance: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: 'npm_node_1',
      nodeType: 'npm/acorn/parseExpressionAt',
      config: { x: 100, y: 100 },
    };

    const { writtenCode } = simulateMutateWorkflowFile(
      (workflow) => addNode(workflow, nodeInstance),
      [externalNodeType]
    );

    expect(countFwImports(writtenCode)).toBe(1);
  });

  it('should still have exactly 1 @fwImport after a third write', () => {
    // Write 1: addNodeType
    simulateMutateWorkflowFile(
      (workflow) => addNodeType(workflow, npmNodeType),
      [externalNodeType]
    );

    // Write 2: addNode
    const nodeInstance: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: 'npm_node_1',
      nodeType: 'npm/acorn/parseExpressionAt',
      config: { x: 100, y: 100 },
    };

    simulateMutateWorkflowFile(
      (workflow) => addNode(workflow, nodeInstance),
      [externalNodeType]
    );

    // Write 3: another addNode (or any mutation)
    const nodeInstance2: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: 'npm_node_2',
      nodeType: 'npm/acorn/parseExpressionAt',
      config: { x: 200, y: 200 },
    };

    const { writtenCode } = simulateMutateWorkflowFile(
      (workflow) => addNode(workflow, nodeInstance2),
      [externalNodeType]
    );

    expect(countFwImports(writtenCode)).toBe(1);
  });

  it('traces: show nodeTypes count at each step', () => {
    // Step 0: Initial state
    parser.clearCache();
    let parsed = parser.parse(tempFile, [externalNodeType]);
    let workflow = parsed.workflows[0];

    // Write 1: addNodeType
    const result1 = simulateMutateWorkflowFile(
      (wf) => addNodeType(wf, npmNodeType),
      [externalNodeType]
    );

    // Write 2: addNode
    const nodeInstance: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: 'npm_node_1',
      nodeType: 'npm/acorn/parseExpressionAt',
      config: { x: 100, y: 100 },
    };

    // Parse the file again to see what the parser produces
    parser.clearCache();
    parsed = parser.parse(tempFile, [externalNodeType]);
    workflow = parsed.workflows[0];

    const result2 = simulateMutateWorkflowFile(
      (wf) => addNode(wf, nodeInstance),
      [externalNodeType]
    );

    // Write 3: another mutation
    const nodeInstance2: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: 'npm_node_2',
      nodeType: 'npm/acorn/parseExpressionAt',
      config: { x: 200, y: 200 },
    };

    // Parse again
    parser.clearCache();
    parsed = parser.parse(tempFile, [externalNodeType]);
    workflow = parsed.workflows[0];

    const result3 = simulateMutateWorkflowFile(
      (wf) => addNode(wf, nodeInstance2),
      [externalNodeType]
    );

    // The actual assertion: should always be 1
    expect(countFwImports(result3.writtenCode)).toBe(1);
  });

  it('generateInPlace deduplicates @fwImport when AST has duplicate npm types', () => {
    // Construct an AST with the same npm type appearing twice (defense-in-depth test)
    const sourceCode = fs.readFileSync(tempFile, 'utf-8');
    parser.clearCache();
    const parsed = parser.parse(tempFile);
    const workflow = parsed.workflows[0];

    const duplicateNpmTypes: TNodeTypeAST[] = [npmNodeType, { ...npmNodeType }];

    const workflowWithDupes: TWorkflowAST = {
      ...workflow,
      nodeTypes: [...workflow.nodeTypes, ...duplicateNpmTypes],
    };

    const result = generateInPlace(sourceCode, workflowWithDupes);
    expect(countFwImports(result.code)).toBe(1);
  });
});
