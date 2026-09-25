/**
 * Friendly errors fed with what the validator actually emits.
 *
 * The mapper tests elsewhere hand-write messages. These run WorkflowValidator
 * on small ASTs and assert the friendly text names the right node and port,
 * so a change to a validator message cannot silently break the mapping.
 */

import { describe, it, expect } from 'vitest';
import { WorkflowValidator } from '../../../src/validation/validator';
import { getFriendlyError } from '../../../src/validation/friendly-errors';
import type { TWorkflowAST, TNodeTypeAST, TConnectionAST } from '../../../src/ast/types';

const nodeType = (name: string, inputs: TNodeTypeAST['inputs'], outputs: TNodeTypeAST['outputs']): TNodeTypeAST => ({
  type: 'NodeType',
  name,
  functionName: name,
  inputs: { execute: { dataType: 'STEP' }, ...inputs },
  outputs: {
    onSuccess: { dataType: 'STEP', isControlFlow: true },
    onFailure: { dataType: 'STEP', failure: true, isControlFlow: true },
    ...outputs,
  },
  hasSuccessPort: true,
  hasFailurePort: true,
  isAsync: false,
  executeWhen: 'CONJUNCTION',
});

const conn = (from: string, to: string): TConnectionAST => {
  const [fromNode, fromPort] = from.split('.');
  const [toNode, toPort] = to.split('.');
  return { type: 'Connection', from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } };
};

function workflow(connections: TConnectionAST[]): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'wf',
    functionName: 'wf',
    sourceFile: 'wf.ts',
    nodeTypes: [
      nodeType('producer', {}, { text: { dataType: 'STRING' } }),
      nodeType('consumer', { value: { dataType: 'STRING', optional: true } }, { out: { dataType: 'STRING' } }),
    ],
    instances: [
      { type: 'NodeInstance', id: 'p', nodeType: 'producer' },
      { type: 'NodeInstance', id: 'c', nodeType: 'consumer' },
    ],
    connections,
    scopes: {},
    startPorts: { execute: { dataType: 'STEP' }, counter: { dataType: 'NUMBER' } },
    exitPorts: { result: { dataType: 'STRING' } },
    imports: [],
  };
}

function friendly(connections: TConnectionAST[], code: string) {
  const result = new WorkflowValidator().validate(workflow(connections));
  const diag = [...result.errors, ...result.warnings].find((d) => d.code === code);
  expect(diag, `expected the validator to emit ${code}`).toBeDefined();
  const f = getFriendlyError(diag!);
  expect(f).not.toBeNull();
  return { diag: diag!, friendly: f! };
}

describe('friendly errors from real validator output', () => {
  it('UNKNOWN_SOURCE_PORT on a Start port keeps the port name and the suggestion', () => {
    const { diag, friendly: f } = friendly(
      [conn('Start.execute', 'p.execute'), conn('Start.count', 'c.value')],
      'UNKNOWN_SOURCE_PORT',
    );
    expect(diag.message).toContain('Start node does not have output port "count"');
    expect(f.explanation).toContain("Port 'count' doesn't exist on node 'Start'");
    expect(f.explanation).toContain("Did you mean 'counter'?");
    expect(f.fix).toContain('@param count');
  });

  it('UNKNOWN_SOURCE_PORT on a node names the node and the port', () => {
    const { friendly: f } = friendly(
      [conn('Start.execute', 'p.execute'), conn('p.txt', 'c.value')],
      'UNKNOWN_SOURCE_PORT',
    );
    expect(f.explanation).toContain("Port 'txt' doesn't exist on node 'p'");
    expect(f.explanation).toContain("Did you mean 'text'?");
    expect(f.fix).toContain('@output txt');
  });

  it('UNKNOWN_TARGET_PORT on a node and on Exit', () => {
    const onNode = friendly(
      [conn('Start.execute', 'p.execute'), conn('p.text', 'c.valu')],
      'UNKNOWN_TARGET_PORT',
    );
    expect(onNode.friendly.explanation).toContain("Port 'valu' doesn't exist on node 'c'");
    expect(onNode.friendly.explanation).toContain("Did you mean 'value'?");

    const onExit = friendly(
      [conn('Start.execute', 'p.execute'), conn('p.text', 'Exit.reslt')],
      'UNKNOWN_TARGET_PORT',
    );
    expect(onExit.friendly.explanation).toContain("Port 'reslt' doesn't exist on node 'Exit'");
    expect(onExit.friendly.fix).toContain('@returns reslt');
  });

  it('STEP_PORT_TYPE_MISMATCH says which end is the STEP port, both ways round', () => {
    const stepToData = friendly(
      [conn('Start.execute', 'p.execute'), conn('p.onSuccess', 'c.value')],
      'STEP_PORT_TYPE_MISMATCH',
    );
    expect(stepToData.friendly.explanation).toContain("'p.onSuccess' is a STEP port");
    expect(stepToData.friendly.explanation).toContain("'c.value' is a data port");

    const dataToStep = friendly(
      [conn('Start.execute', 'p.execute'), conn('p.text', 'c.execute')],
      'STEP_PORT_TYPE_MISMATCH',
    );
    expect(dataToStep.friendly.explanation).toContain("'c.execute' is a STEP port");
    expect(dataToStep.friendly.explanation).toContain("'p.text' carries data");
  });

  it('MULTIPLE_CONNECTIONS_TO_INPUT names the port and node and points at mergeStrategy', () => {
    const wf = workflow([
      conn('Start.execute', 'p.execute'),
      conn('p.text', 'c.value'),
      conn('p.text', 'c.value'),
    ]);
    // Two distinct sources into the same port.
    wf.connections[2] = { type: 'Connection', from: { node: 'Start', port: 'counter' }, to: { node: 'c', port: 'value' } };
    const result = new WorkflowValidator().validate(wf);
    const diag = result.errors.find((d) => d.code === 'MULTIPLE_CONNECTIONS_TO_INPUT')!;
    const f = getFriendlyError(diag)!;
    expect(f.explanation).toContain("Input port 'value' on node 'c'");
    expect(f.fix).toContain('@input value [mergeStrategy:');
  });

  it('EXPRESSION_SYNTAX has a friendly mapping with the port and instance', () => {
    const wf = workflow([conn('Start.execute', 'p.execute'), conn('p.onSuccess', 'c.execute')]);
    wf.instances[1].config = { portConfigs: [{ portName: 'value', expression: '24h' }] };
    const result = new WorkflowValidator().validate(wf);
    const diag = result.errors.find((d) => d.code === 'EXPRESSION_SYNTAX')!;
    const f = getFriendlyError(diag)!;
    expect(f.title).toBe('Expression Is Not JavaScript');
    expect(f.explanation).toContain("'value' on 'c'");
    expect(f.fix).toContain("timeout=\"'24h'\"");
  });
});
