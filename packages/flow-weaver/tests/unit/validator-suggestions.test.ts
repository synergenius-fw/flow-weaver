import { describe, it, expect } from 'vitest';
import { levenshteinDistance, findClosestMatches } from '../../src/utils/string-distance';
import { WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST } from '../../src/ast/types';

// ─── String Distance Tests ──────────────────────────────────────────────────
describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns length for empty vs non-empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('computes correct distance for simple edits', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('saturday', 'sunday')).toBe(3);
  });

  it('handles single character differences', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
    expect(levenshteinDistance('cat', 'ca')).toBe(1);
  });
});

describe('findClosestMatches', () => {
  const candidates = ['validateLead', 'enrichLead', 'scoreLead', 'processData'];

  it('finds closest match for typo', () => {
    const matches = findClosestMatches('validatrLead', candidates, 3);
    expect(matches).toContain('validateLead');
  });

  it('returns no suggestions when distance > maxDistance', () => {
    const matches = findClosestMatches('completelyDifferent', candidates, 3);
    expect(matches).toEqual([]);
  });

  it('excludes exact match from suggestions', () => {
    const matches = findClosestMatches('validateLead', candidates, 3);
    expect(matches).not.toContain('validateLead');
  });

  it('returns multiple suggestions when equidistant', () => {
    const candidates2 = ['abc', 'abd', 'abe'];
    const matches = findClosestMatches('abx', candidates2, 1);
    expect(matches).toHaveLength(3);
  });

  it('sorts by distance ascending', () => {
    const matches = findClosestMatches('validaeLead', ['validateLead', 'validLead', 'xyzLead'], 5);
    // validateLead (distance 1) should come before validLead (distance 2)
    expect(matches.indexOf('validateLead')).toBeLessThan(matches.indexOf('validLead'));
  });
});

// ─── Validator "Did You Mean?" Tests ────────────────────────────────────────
describe('Validator "Did you mean?" suggestions', () => {
  function makeNodeType(name: string, inputs: string[] = [], outputs: string[] = []): TNodeTypeAST {
    const inputObj: Record<string, { dataType: string }> = {};
    inputs.forEach((p) => (inputObj[p] = { dataType: 'ANY' }));
    const outputObj: Record<string, { dataType: string }> = {};
    outputs.forEach((p) => (outputObj[p] = { dataType: 'ANY' }));
    return {
      type: 'NodeType',
      name,
      functionName: name,
      inputs: inputObj,
      outputs: outputObj,
    } as unknown as TNodeTypeAST;
  }

  function makeInstance(id: string, nodeType: string): TNodeInstanceAST {
    return {
      type: 'NodeInstance',
      id,
      nodeType,
      config: {},
    } as unknown as TNodeInstanceAST;
  }

  function makeWorkflow(
    nodeTypes: TNodeTypeAST[],
    instances: TNodeInstanceAST[],
    connections: TWorkflowAST['connections'] = []
  ): TWorkflowAST {
    return {
      type: 'Workflow',
      sourceFile: 'test.ts',
      name: 'test',
      functionName: 'test',
      nodeTypes,
      instances,
      connections,
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' } },
      imports: [],
    } as unknown as TWorkflowAST;
  }

  it('suggests closest node type name for UNKNOWN_NODE_TYPE', () => {
    const nt = makeNodeType('validateLead', ['execute', 'data'], ['onSuccess', 'result']);
    const instance = makeInstance('validator', 'validatrLead'); // typo
    const wf = makeWorkflow([nt], [instance]);

    const validator = new WorkflowValidator();
    const result = validator.validate(wf);
    const unknownTypeErr = result.errors.find((e) => e.code === 'UNKNOWN_NODE_TYPE');
    expect(unknownTypeErr).toBeDefined();
    expect(unknownTypeErr!.message).toContain('Did you mean');
    expect(unknownTypeErr!.message).toContain('validateLead');
  });

  it('suggests closest source node name for UNKNOWN_SOURCE_NODE', () => {
    const nt = makeNodeType('process', ['execute'], ['onSuccess']);
    const inst1 = makeInstance('processor', 'process');
    const wf = makeWorkflow(
      [nt],
      [inst1],
      [
        {
          from: { node: 'procesor', port: 'onSuccess' },
          to: { node: 'Exit', port: 'onSuccess' },
        } as TWorkflowAST['connections'][0],
      ]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(wf);
    const err = result.errors.find((e) => e.code === 'UNKNOWN_SOURCE_NODE');
    expect(err).toBeDefined();
    expect(err!.message).toContain('Did you mean');
    expect(err!.message).toContain('processor');
  });

  it('suggests closest target node name for UNKNOWN_TARGET_NODE', () => {
    const nt = makeNodeType('process', ['execute'], ['onSuccess']);
    const inst1 = makeInstance('processor', 'process');
    const wf = makeWorkflow(
      [nt],
      [inst1],
      [
        {
          from: { node: 'Start', port: 'execute' },
          to: { node: 'procesor', port: 'execute' },
        } as TWorkflowAST['connections'][0],
      ]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(wf);
    const err = result.errors.find((e) => e.code === 'UNKNOWN_TARGET_NODE');
    expect(err).toBeDefined();
    expect(err!.message).toContain('Did you mean');
    expect(err!.message).toContain('processor');
  });

  it('suggests closest output port name for UNKNOWN_SOURCE_PORT', () => {
    const nt = makeNodeType('process', ['execute'], ['onSuccess', 'result']);
    const inst1 = makeInstance('proc', 'process');
    const inst2 = makeInstance('proc2', 'process');
    const wf = makeWorkflow(
      [nt],
      [inst1, inst2],
      [
        {
          from: { node: 'Start', port: 'execute' },
          to: { node: 'proc', port: 'execute' },
        } as TWorkflowAST['connections'][0],
        {
          from: { node: 'proc', port: 'resul' }, // typo
          to: { node: 'proc2', port: 'execute' },
        } as TWorkflowAST['connections'][0],
      ]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(wf);
    const err = result.errors.find((e) => e.code === 'UNKNOWN_SOURCE_PORT');
    expect(err).toBeDefined();
    expect(err!.message).toContain('Did you mean');
    expect(err!.message).toContain('result');
  });

  it('suggests closest input port name for UNKNOWN_TARGET_PORT', () => {
    const nt = makeNodeType('process', ['execute', 'data'], ['onSuccess']);
    const inst1 = makeInstance('proc', 'process');
    const wf = makeWorkflow(
      [nt],
      [inst1],
      [
        {
          from: { node: 'Start', port: 'execute' },
          to: { node: 'proc', port: 'dat' }, // typo
        } as TWorkflowAST['connections'][0],
      ]
    );

    const validator = new WorkflowValidator();
    const result = validator.validate(wf);
    const err = result.errors.find((e) => e.code === 'UNKNOWN_TARGET_PORT');
    expect(err).toBeDefined();
    expect(err!.message).toContain('Did you mean');
    expect(err!.message).toContain('data');
  });

  it('does not suggest when no close matches exist', () => {
    const nt = makeNodeType('process', ['execute'], ['onSuccess']);
    const instance = makeInstance('validator', 'completelyDifferentName');
    const wf = makeWorkflow([nt], [instance]);

    const validator = new WorkflowValidator();
    const result = validator.validate(wf);
    const unknownTypeErr = result.errors.find((e) => e.code === 'UNKNOWN_NODE_TYPE');
    expect(unknownTypeErr).toBeDefined();
    expect(unknownTypeErr!.message).not.toContain('Did you mean');
  });
});
