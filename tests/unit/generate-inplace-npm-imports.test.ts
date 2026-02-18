import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { generateInPlace } from '../../src/api/generate-in-place';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

const MOCK_FILE = path.join(os.tmpdir(), 'test-workflow.ts');

function makeNpmNodeType(name: string, functionName: string, importSource: string): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName,
    importSource,
    inputs: { execute: { dataType: 'STEP' } },
    outputs: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
      result: { dataType: 'ANY' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
  };
}

function makeWorkflow(nodeTypes: TNodeTypeAST[]): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: MOCK_FILE,
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    nodeTypes,
    instances: [],
    connections: [],
    startPorts: {
      execute: { dataType: 'STEP' },
    },
    exitPorts: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
    },
    imports: [],
  };
}

const MINIMAL_WORKFLOW_SOURCE = `/**
 * @flowWeaver workflow
 * @name testWorkflow
 */
export async function testWorkflow(execute: boolean, params: {}) {
  // @flow-weaver-body-start
  return { onSuccess: true, onFailure: false };
  // @flow-weaver-body-end
}
`;

describe('generateInPlace npm @fwImport annotation', () => {
  it('FAILING: should generate @fwImport annotation for npm node type with importSource', () => {
    // Create a workflow AST with an npm node type
    const npmNodeType = makeNpmNodeType(
      'npm/autoprefixer/autoprefixer',
      'autoprefixer',
      'autoprefixer'
    );
    const ast = makeWorkflow([npmNodeType]);

    // Generate in place
    const result = generateInPlace(MINIMAL_WORKFLOW_SOURCE, ast);

    // The @fwImport annotation should be present
    expect(result.code).toContain('@fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"');
  });

  it('should preserve @fwImport annotation after re-generation', () => {
    const npmNodeType = makeNpmNodeType(
      'npm/date-fns/format',
      'format',
      'date-fns'
    );
    const ast = makeWorkflow([npmNodeType]);

    // First generation
    const result1 = generateInPlace(MINIMAL_WORKFLOW_SOURCE, ast);

    // Should have the @fwImport
    expect(result1.code).toContain('@fwImport npm/date-fns/format format from "date-fns"');

    // Second generation (simulate re-opening file)
    const result2 = generateInPlace(result1.code, ast);

    // Should still have the @fwImport
    expect(result2.code).toContain('@fwImport npm/date-fns/format format from "date-fns"');
  });

  it('should generate multiple @fwImport annotations for multiple npm types', () => {
    const npmType1 = makeNpmNodeType('npm/lodash/map', 'map', 'lodash');
    const npmType2 = makeNpmNodeType('npm/lodash/filter', 'filter', 'lodash');
    const ast = makeWorkflow([npmType1, npmType2]);

    const result = generateInPlace(MINIMAL_WORKFLOW_SOURCE, ast);

    expect(result.code).toContain('@fwImport npm/lodash/map map from "lodash"');
    expect(result.code).toContain('@fwImport npm/lodash/filter filter from "lodash"');
  });

  it('should NOT generate @fwImport for local node types (no importSource)', () => {
    const localNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'myLocalFunction',
      functionName: 'myLocalFunction',
      // NO importSource
      inputs: { execute: { dataType: 'STEP' } },
      outputs: {
        onSuccess: { dataType: 'STEP', isControlFlow: true },
        result: { dataType: 'STRING' },
      },
      hasSuccessPort: true,
      hasFailurePort: false,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };
    const ast = makeWorkflow([localNodeType]);

    const result = generateInPlace(MINIMAL_WORKFLOW_SOURCE, ast);

    // Should NOT have any @fwImport annotation
    expect(result.code).not.toContain('@fwImport');
  });

  it('verifies importSource is preserved on TNodeTypeAST', () => {
    // This test documents the expected structure
    const npmNodeType = makeNpmNodeType(
      'npm/autoprefixer/autoprefixer',
      'autoprefixer',
      'autoprefixer'
    );

    expect(npmNodeType.importSource).toBe('autoprefixer');
    expect(npmNodeType.name).toBe('npm/autoprefixer/autoprefixer');
    expect(npmNodeType.functionName).toBe('autoprefixer');
  });
});
