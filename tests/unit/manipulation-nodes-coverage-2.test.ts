/**
 * Additional coverage tests for src/api/manipulation/nodes.ts
 * Targets uncovered lines 184-185 (map macro), 188-196 (fanOut/fanIn macros)
 * in renameNode when updating macro references.
 */

import { renameNode } from '../../src/api/manipulation/nodes';
import type { TWorkflowAST } from '../../src/ast/types';
import {
  createProcessorNodeType,
  createNodeInstance,
} from '../helpers/test-fixtures';

function makeWorkflowWithMacros(macros: TWorkflowAST['macros']): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'test',
    functionName: 'test',
    sourceFile: 'test.ts',
    nodeTypes: [createProcessorNodeType()],
    instances: [
      createNodeInstance('nodeA', 'process'),
      createNodeInstance('nodeB', 'process'),
      createNodeInstance('nodeC', 'process'),
    ],
    connections: [
      {
        type: 'Connection',
        from: { node: 'Start', port: 'x' },
        to: { node: 'nodeA', port: 'input' },
      },
    ],
    scopes: {},
    startPorts: { x: { dataType: 'NUMBER' } },
    exitPorts: {},
    imports: [],
    macros,
  };
}

describe('renameNode - macro reference updates', () => {
  it('should update map macro instanceId and childId when renaming a referenced node', () => {
    const workflow = makeWorkflowWithMacros([
      {
        type: 'map',
        instanceId: 'nodeA',
        childId: 'nodeB',
        sourcePort: 'Start.x',
      },
    ]);

    const result = renameNode(workflow, 'nodeA', 'renamedA');
    expect(result.macros![0]).toMatchObject({
      type: 'map',
      instanceId: 'renamedA',
      childId: 'nodeB',
    });

    // Also rename the childId target
    const result2 = renameNode(workflow, 'nodeB', 'renamedB');
    expect(result2.macros![0]).toMatchObject({
      type: 'map',
      instanceId: 'nodeA',
      childId: 'renamedB',
    });
  });

  it('should update fanOut macro source and targets when renaming', () => {
    const workflow = makeWorkflowWithMacros([
      {
        type: 'fanOut',
        source: { node: 'nodeA', port: 'output' },
        targets: [
          { node: 'nodeB', port: 'input' },
          { node: 'nodeC', port: 'input' },
        ],
      },
    ]);

    // Rename the source node
    const result = renameNode(workflow, 'nodeA', 'renamedA');
    const macro = result.macros![0] as { type: 'fanOut'; source: { node: string }; targets: Array<{ node: string }> };
    expect(macro.source.node).toBe('renamedA');
    expect(macro.targets[0].node).toBe('nodeB');

    // Rename a target node
    const result2 = renameNode(workflow, 'nodeB', 'renamedB');
    const macro2 = result2.macros![0] as typeof macro;
    expect(macro2.source.node).toBe('nodeA');
    expect(macro2.targets[0].node).toBe('renamedB');
    expect(macro2.targets[1].node).toBe('nodeC');
  });

  it('should update fanIn macro target and sources when renaming', () => {
    const workflow = makeWorkflowWithMacros([
      {
        type: 'fanIn',
        sources: [
          { node: 'nodeA', port: 'output' },
          { node: 'nodeB', port: 'output' },
        ],
        target: { node: 'nodeC', port: 'input' },
      },
    ]);

    // Rename the target node
    const result = renameNode(workflow, 'nodeC', 'renamedC');
    const macro = result.macros![0] as { type: 'fanIn'; target: { node: string }; sources: Array<{ node: string }> };
    expect(macro.target.node).toBe('renamedC');
    expect(macro.sources[0].node).toBe('nodeA');

    // Rename a source node
    const result2 = renameNode(workflow, 'nodeA', 'renamedA');
    const macro2 = result2.macros![0] as typeof macro;
    expect(macro2.sources[0].node).toBe('renamedA');
    expect(macro2.sources[1].node).toBe('nodeB');
    expect(macro2.target.node).toBe('nodeC');
  });
});
