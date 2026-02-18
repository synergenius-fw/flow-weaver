import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { generateInPlace } from '../../src/api/generate-in-place';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

const MOCK_FILE = path.join(os.tmpdir(), 'test-workflow.ts');

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

function makeWorkflow(nodeTypes: TNodeTypeAST[]): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: MOCK_FILE,
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    nodeTypes,
    instances: [],
    connections: [],
    startPorts: { execute: { dataType: 'STEP' } },
    exitPorts: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
    },
    imports: [],
  };
}

describe('@fwImport annotation format', () => {
  it('FAILING: should use actual function name, not the full npm path', () => {
    // This is what the client sends - functionName is the full npm path (bug)
    const npmNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'npm/autoprefixer/autoprefixer',
      functionName: 'npm/autoprefixer/autoprefixer', // BUG: should be 'autoprefixer'
      importSource: 'autoprefixer',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const ast = makeWorkflow([npmNodeType]);
    const result = generateInPlace(MINIMAL_WORKFLOW_SOURCE, ast);

    // The @fwImport should use the ACTUAL function name (autoprefixer),
    // not the full npm path (npm/autoprefixer/autoprefixer)
    // Format: @fwImport <name> <functionName> from "<package>"
    // Expected: @fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"
    // NOT: @fwImport npm/autoprefixer/autoprefixer npm/autoprefixer/autoprefixer from "autoprefixer"

    expect(result.code).toContain('@fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"');
    expect(result.code).not.toContain('@fwImport npm/autoprefixer/autoprefixer npm/autoprefixer/autoprefixer');
  });

  it('should derive function name from importSource when functionName equals name', () => {
    // When functionName === name (both are npm paths), derive from importSource
    const npmNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'npm/lodash/map',
      functionName: 'npm/lodash/map', // Same as name - should derive 'map' from name
      importSource: 'lodash',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const ast = makeWorkflow([npmNodeType]);
    const result = generateInPlace(MINIMAL_WORKFLOW_SOURCE, ast);

    // Should extract 'map' from the name 'npm/lodash/map'
    expect(result.code).toContain('@fwImport npm/lodash/map map from "lodash"');
  });

  it('should use explicit functionName when different from name', () => {
    // When functionName is explicitly set to the actual function name
    const npmNodeType: TNodeTypeAST = {
      type: 'NodeType',
      name: 'npm/date-fns/format',
      functionName: 'format', // Explicitly set
      importSource: 'date-fns',
      inputs: { execute: { dataType: 'STEP' } },
      outputs: { result: { dataType: 'ANY' } },
      hasSuccessPort: true,
      hasFailurePort: true,
      isAsync: false,
      executeWhen: 'CONJUNCTION',
    };

    const ast = makeWorkflow([npmNodeType]);
    const result = generateInPlace(MINIMAL_WORKFLOW_SOURCE, ast);

    expect(result.code).toContain('@fwImport npm/date-fns/format format from "date-fns"');
  });
});
