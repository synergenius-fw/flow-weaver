/**
 * Branch coverage tests for src/validator.ts
 * Targets uncovered branches across all validation methods.
 */

import { WorkflowValidator } from '../../src/validator';
import type { TWorkflowAST, TNodeTypeAST, TNodeInstanceAST, TConnectionAST } from '../../src/ast/types';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: 'proc',
    functionName: 'proc',
    inputs: { execute: { dataType: 'STEP', isControlFlow: true } },
    outputs: {
      onSuccess: { dataType: 'STEP', isControlFlow: true },
      onFailure: { dataType: 'STEP', isControlFlow: true, failure: true },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
    ...overrides,
  };
}

function makeInstance(id: string, nodeType: string, config?: any, parent?: any): TNodeInstanceAST {
  return { type: 'NodeInstance', id, nodeType, config, parent };
}

function conn(fromNode: string, fromPort: string, toNode: string, toPort: string, extra: Partial<TConnectionAST> = {}): TConnectionAST {
  return { type: 'Connection', from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort }, ...extra };
}

function makeWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    type: 'Workflow',
    functionName: 'testWf',
    name: 'testWf',
    sourceFile: 'test.ts',
    nodeTypes: [makeNodeType()],
    instances: [makeInstance('p', 'proc')],
    connections: [
      conn('Start', 'execute', 'p', 'execute'),
      conn('p', 'onSuccess', 'Exit', 'onSuccess'),
    ],
    scopes: {},
    startPorts: {},
    exitPorts: {},
    imports: [],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('validator branch coverage', () => {
  let validator: WorkflowValidator;
  beforeEach(() => { validator = new WorkflowValidator(); });

  // 1. Missing workflow name
  it('should error when workflow has no name', () => {
    const wf = makeWorkflow({ name: '' });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'MISSING_WORKFLOW_NAME')).toBe(true);
  });

  // 2. Missing workflow functionName
  it('should error when workflow has no functionName', () => {
    const wf = makeWorkflow({ functionName: '' });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'MISSING_FUNCTION_NAME')).toBe(true);
  });

  // 3. Duplicate node type names
  it('should error on duplicate node type names', () => {
    const nt = makeNodeType();
    const wf = makeWorkflow({ nodeTypes: [nt, { ...nt }] });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'DUPLICATE_NODE_NAME')).toBe(true);
  });

  // 4. Mutable bindings (let/var)
  it('should warn for let declaration kind', () => {
    const nt = makeNodeType({ declarationKind: 'let' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'MUTABLE_NODE_TYPE_BINDING')).toBe(true);
  });

  // 5. Reserved node name
  it('should error for node type with reserved name', () => {
    const nt = makeNodeType({ functionName: 'Start', name: 'Start' });
    const wf = makeWorkflow({
      nodeTypes: [nt],
      instances: [makeInstance('myStart', 'Start')],
      connections: [
        conn('Start', 'execute', 'myStart', 'execute'),
        conn('myStart', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'RESERVED_NODE_NAME')).toBe(true);
  });

  // 6. Reserved instance ID
  it('should error for instance with reserved ID', () => {
    const wf = makeWorkflow({
      instances: [makeInstance('Exit', 'proc')],
      connections: [
        conn('Start', 'execute', 'Exit', 'execute'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'RESERVED_INSTANCE_ID')).toBe(true);
  });

  // 7. Unknown source node with suggestion
  it('should error and suggest for unknown source node', () => {
    const wf = makeWorkflow({
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('procc', 'onSuccess', 'Exit', 'onSuccess'), // typo
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'UNKNOWN_SOURCE_NODE')).toBe(true);
  });

  // 8. Unknown target node with suggestion
  it('should error and suggest for unknown target node', () => {
    const wf = makeWorkflow({
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'procc', 'execute'), // typo
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'UNKNOWN_TARGET_NODE')).toBe(true);
  });

  // 9. Unknown source port on regular node
  it('should error for unknown output port on source node', () => {
    const wf = makeWorkflow({
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'nonExistentPort', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'UNKNOWN_SOURCE_PORT' && e.message.includes('nonExistentPort'))).toBe(true);
  });

  // 10. Unknown Start output port (no suggestions -> hint with @param)
  it('should error for unknown Start output port with @param hint', () => {
    const wf = makeWorkflow({
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('Start', 'zzzNotAPort', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    const err = r.errors.find(e => e.code === 'UNKNOWN_SOURCE_PORT' && e.message.includes('zzzNotAPort'));
    expect(err).toBeDefined();
    expect(err!.message).toContain('@param');
  });

  // 11. Unknown Start port with suggestion (close name)
  it('should suggest for close Start port name', () => {
    const wf = makeWorkflow({
      startPorts: { userId: { dataType: 'STRING' } },
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('Start', 'usrId', 'p', 'execute'), // close to userId
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    const err = r.errors.find(e => e.code === 'UNKNOWN_SOURCE_PORT' && e.message.includes('usrId'));
    expect(err).toBeDefined();
    expect(err!.message).toContain('Did you mean');
  });

  // 12. Unknown Exit input port
  it('should error for unknown Exit input port', () => {
    const wf = makeWorkflow({
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'bogusPort'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'UNKNOWN_TARGET_PORT' && e.message.includes('bogusPort'))).toBe(true);
  });

  // 13. Unknown target port on regular node
  it('should error for unknown input port on target node', () => {
    const wf = makeWorkflow({
      connections: [
        conn('Start', 'execute', 'p', 'badInput'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'UNKNOWN_TARGET_PORT' && e.message.includes('badInput'))).toBe(true);
  });

  // 14. Duplicate connections
  it('should error on duplicate connections', () => {
    const wf = makeWorkflow({
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'DUPLICATE_CONNECTION')).toBe(true);
  });

  // 15. Duplicate instance IDs
  it('should error on duplicate instance IDs', () => {
    const wf = makeWorkflow({
      instances: [makeInstance('p', 'proc'), makeInstance('p', 'proc')],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'DUPLICATE_INSTANCE_ID')).toBe(true);
  });

  // 16. No start connections warning
  it('should warn when workflow has no Start connections', () => {
    const wf = makeWorkflow({
      connections: [conn('p', 'onSuccess', 'Exit', 'onSuccess')],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'NO_START_CONNECTIONS')).toBe(true);
  });

  // 17. No exit connections warning
  it('should warn when workflow has no Exit connections', () => {
    const wf = makeWorkflow({
      connections: [conn('Start', 'execute', 'p', 'execute')],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'NO_EXIT_CONNECTIONS')).toBe(true);
  });

  // 18. Invalid onSuccess exit port type
  it('should error when onSuccess exit port is not STEP', () => {
    const wf = makeWorkflow({
      exitPorts: { onSuccess: { dataType: 'STRING' } },
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'INVALID_EXIT_PORT_TYPE' && e.message.includes('onSuccess'))).toBe(true);
  });

  // 19. Invalid onFailure exit port type
  it('should error when onFailure exit port is not STEP', () => {
    const wf = makeWorkflow({
      exitPorts: { onFailure: { dataType: 'NUMBER' } },
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'INVALID_EXIT_PORT_TYPE' && e.message.includes('onFailure'))).toBe(true);
  });

  // 20. STEP port type mismatch (STEP -> non-STEP)
  it('should error when STEP port connects to non-STEP port', () => {
    const ntA = makeNodeType({
      name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, data: { dataType: 'STEP' } },
    });
    const ntB = makeNodeType({
      name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, data: { dataType: 'STRING' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'data', 'b', 'data'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'STEP_PORT_TYPE_MISMATCH')).toBe(true);
  });

  // 21. Non-STEP -> STEP mismatch
  it('should error when non-STEP port connects to STEP port', () => {
    const ntA = makeNodeType({
      name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, data: { dataType: 'STRING' } },
    });
    const ntB = makeNodeType({
      name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, ctrl: { dataType: 'STEP' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'data', 'b', 'ctrl'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'STEP_PORT_TYPE_MISMATCH')).toBe(true);
  });

  // 22. STEP-to-STEP is valid (no error)
  it('should allow STEP-to-STEP connections', () => {
    const ntA = makeNodeType({
      name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, ctrl: { dataType: 'STEP' } },
    });
    const ntB = makeNodeType({
      name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, ctrl: { dataType: 'STEP' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'ctrl', 'b', 'ctrl'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.filter(e => e.code === 'STEP_PORT_TYPE_MISMATCH')).toHaveLength(0);
  });

  // 23. Coerce on FUNCTION port
  it('should error for coercion on FUNCTION port', () => {
    const ntA = makeNodeType({
      name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, fn: { dataType: 'FUNCTION' } },
    });
    const ntB = makeNodeType({
      name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, fn: { dataType: 'FUNCTION' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'fn', 'b', 'fn', { coerce: 'string' } as any),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'COERCE_ON_FUNCTION_PORT')).toBe(true);
  });

  // 24. Redundant coerce (same type)
  it('should warn for redundant coercion on same-type connection', () => {
    const ntA = makeNodeType({
      name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'STRING' } },
    });
    const ntB = makeNodeType({
      name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'STRING' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val', { coerce: 'string' } as any),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'REDUNDANT_COERCE')).toBe(true);
  });

  // 25. Correct coerce resolves mismatch
  it('should accept correct coerce resolving type mismatch', () => {
    const ntA = makeNodeType({
      name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'NUMBER' } },
    });
    const ntB = makeNodeType({
      name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'STRING' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val', { coerce: 'string' } as any),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.filter(w => w.code === 'COERCE_TYPE_MISMATCH')).toHaveLength(0);
    expect(r.errors.filter(e => e.code === 'COERCE_TYPE_MISMATCH')).toHaveLength(0);
  });

  // 26. Wrong coerce type
  it('should warn for coerce producing wrong type', () => {
    const ntA = makeNodeType({
      name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'NUMBER' } },
    });
    const ntB = makeNodeType({
      name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'BOOLEAN' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val', { coerce: 'string' } as any), // produces STRING, target wants BOOLEAN
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    const issues = [...r.warnings, ...r.errors].filter(e => e.code === 'COERCE_TYPE_MISMATCH');
    expect(issues.length).toBeGreaterThan(0);
  });

  // 27. Lossy coercion (STRING -> NUMBER)
  it('should warn for lossy STRING to NUMBER coercion', () => {
    const ntA = makeNodeType({
      name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'STRING' } },
    });
    const ntB = makeNodeType({
      name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'NUMBER' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'LOSSY_TYPE_COERCION')).toBe(true);
  });

  // 28. Unusual coercion (NUMBER -> BOOLEAN)
  it('should warn for unusual NUMBER to BOOLEAN coercion', () => {
    const ntA = makeNodeType({
      name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'NUMBER' } },
    });
    const ntB = makeNodeType({
      name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'BOOLEAN' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'UNUSUAL_TYPE_COERCION')).toBe(true);
  });

  // 29. General type mismatch (ARRAY -> BOOLEAN - not lossy/unusual)
  it('should warn for general type mismatch', () => {
    const ntA = makeNodeType({
      name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'ARRAY' } },
    });
    const ntB = makeNodeType({
      name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'BOOLEAN' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'TYPE_MISMATCH')).toBe(true);
  });

  // 30. StrictTypes mode promotes type mismatch to error
  it('should error for type mismatch in strictTypes mode', () => {
    const ntA = makeNodeType({
      name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'ARRAY' } },
    });
    const ntB = makeNodeType({
      name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'BOOLEAN' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
      options: { strictTypes: true },
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'TYPE_INCOMPATIBLE')).toBe(true);
  });

  // 31. Unused node warning
  it('should warn for unused node', () => {
    const wf = makeWorkflow({
      instances: [makeInstance('p', 'proc'), makeInstance('q', 'proc')],
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
        // q is not connected
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'UNUSED_NODE' && w.message.includes('q'))).toBe(true);
  });

  // 32. Unused output port
  it('should warn for unused non-control-flow output port', () => {
    const nt = makeNodeType({
      outputs: {
        ...makeNodeType().outputs,
        result: { dataType: 'STRING' },
      },
    });
    const wf = makeWorkflow({
      nodeTypes: [nt],
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
        // p.result never connected
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'UNUSED_OUTPUT_PORT' && w.message.includes('result'))).toBe(true);
  });

  // 33. Unreachable exit port
  it('should warn for unreachable exit port', () => {
    const wf = makeWorkflow({
      exitPorts: { resultVal: { dataType: 'STRING' } },
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
        // Exit.resultVal never connected
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'UNREACHABLE_EXIT_PORT' && w.message.includes('resultVal'))).toBe(true);
  });

  // 34. Draft mode promotes STUB_NODE error to warning
  it('should promote STUB_NODE to warning in draft mode', () => {
    const nt = makeNodeType({ variant: 'STUB' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const r = validator.validate(wf, { mode: 'draft' });
    expect(r.errors.filter(e => e.code === 'STUB_NODE')).toHaveLength(0);
    expect(r.warnings.some(w => w.code === 'STUB_NODE')).toBe(true);
  });

  // 35. Draft mode promotes MISSING_REQUIRED_INPUT for stub instances to warning
  it('should promote MISSING_REQUIRED_INPUT for stub nodes to warning in draft mode', () => {
    const nt = makeNodeType({
      variant: 'STUB',
      inputs: { execute: { dataType: 'STEP' }, data: { dataType: 'STRING' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [nt],
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf, { mode: 'draft' });
    expect(r.errors.filter(e => e.code === 'MISSING_REQUIRED_INPUT')).toHaveLength(0);
    expect(r.warnings.some(w => w.code === 'MISSING_REQUIRED_INPUT')).toBe(true);
  });

  // 36. Suppress warnings via instance config
  it('should suppress warnings using suppressWarnings config', () => {
    const nt = makeNodeType({
      outputs: { ...makeNodeType().outputs, result: { dataType: 'STRING' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [nt],
      instances: [makeInstance('p', 'proc', { suppressWarnings: ['UNUSED_OUTPUT_PORT'] })],
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.filter(w => w.code === 'UNUSED_OUTPUT_PORT' && w.node === 'p')).toHaveLength(0);
  });

  // 37. Inferred node type warning (non-stub)
  it('should warn for inferred non-stub node type', () => {
    const nt = makeNodeType({ inferred: true });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'INFERRED_NODE_TYPE')).toBe(true);
  });

  // 38. Inferred STUB should NOT produce INFERRED_NODE_TYPE warning
  it('should not warn INFERRED_NODE_TYPE for inferred stub', () => {
    const nt = makeNodeType({ inferred: true, variant: 'STUB' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const r = validator.validate(wf);
    expect(r.warnings.filter(w => w.code === 'INFERRED_NODE_TYPE')).toHaveLength(0);
  });

  // 39. Unknown node type with unannotated function hint
  it('should hint about unannotated function for unknown node type', () => {
    const wf = makeWorkflow({
      nodeTypes: [],
      instances: [makeInstance('p', 'myFunc')],
      availableFunctionNames: ['myFunc'],
    });
    const r = validator.validate(wf);
    const err = r.errors.find(e => e.code === 'UNKNOWN_NODE_TYPE');
    expect(err).toBeDefined();
    expect(err!.message).toContain('@flowWeaver nodeType');
  });

  // 40. Cascading error suppression
  it('should suppress cascading errors for unknown-type nodes', () => {
    const wf = makeWorkflow({
      nodeTypes: [],
      instances: [makeInstance('p', 'unknownType')],
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'UNKNOWN_NODE_TYPE')).toBe(true);
    // Cascading UNDEFINED_NODE / UNKNOWN_SOURCE_NODE should be suppressed
    expect(r.errors.filter(e => e.code === 'UNKNOWN_SOURCE_NODE')).toHaveLength(0);
  });

  // 41. docUrl attachment
  it('should attach docUrl to known error codes', () => {
    const wf = makeWorkflow({
      nodeTypes: [],
      instances: [makeInstance('p', 'unknownType')],
    });
    const r = validator.validate(wf);
    const err = r.errors.find(e => e.code === 'UNKNOWN_NODE_TYPE');
    expect(err?.docUrl).toContain('docs.flowweaver.dev');
  });

  // 42. nodeType registered by name (npm-style) and functionName differ
  it('should resolve npm-style node types where name differs from functionName', () => {
    const nt = makeNodeType({ name: 'npm/pkg/func', functionName: 'func' });
    const wf = makeWorkflow({
      nodeTypes: [nt],
      instances: [makeInstance('p', 'npm/pkg/func')],
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.filter(e => e.code === 'UNKNOWN_NODE_TYPE')).toHaveLength(0);
  });

  // 43. Invalid color on node type
  it('should warn for invalid color on node type', () => {
    const nt = makeNodeType({ visuals: { color: 'neon-purple' } });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'INVALID_COLOR' && w.message.includes('neon-purple'))).toBe(true);
  });

  // 44. Invalid color on instance
  it('should warn for invalid color on instance', () => {
    const wf = makeWorkflow({
      instances: [makeInstance('p', 'proc', { color: 'bright-magenta' })],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'INVALID_COLOR' && w.message.includes('bright-magenta'))).toBe(true);
  });

  // 45. Invalid icon on node type
  it('should warn for invalid icon on node type', () => {
    const nt = makeNodeType({ visuals: { icon: 'xyzBadIcon' } });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'INVALID_ICON' && w.message.includes('xyzBadIcon'))).toBe(true);
  });

  // 46. Invalid executeWhen
  it('should warn for invalid executeWhen value', () => {
    const nt = makeNodeType({ executeWhen: 'INVALID_STRATEGY' as any });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'INVALID_EXECUTE_WHEN')).toBe(true);
  });

  // 47. Port config references non-existent port
  it('should warn for portConfig referencing non-existent port', () => {
    const wf = makeWorkflow({
      instances: [makeInstance('p', 'proc', {
        portConfigs: [{ portName: 'nonExistent', order: 1 }],
      })],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'INVALID_PORT_CONFIG_REF')).toBe(true);
  });

  // 48. Cycle detection
  it('should detect a cycle in the graph', () => {
    const ntA = makeNodeType({ name: 'A', functionName: 'A' });
    const ntB = makeNodeType({ name: 'B', functionName: 'B' });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'onSuccess', 'b', 'execute'),
        conn('b', 'onSuccess', 'a', 'execute'), // cycle
        conn('a', 'onFailure', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'CYCLE_DETECTED')).toBe(true);
  });

  // 49. Self-loop is not a cycle
  it('should not report self-loop as cycle', () => {
    const nt = makeNodeType();
    const wf = makeWorkflow({
      nodeTypes: [nt],
      instances: [makeInstance('p', 'proc')],
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'p', 'execute'), // self-loop
        conn('p', 'onFailure', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.filter(e => e.code === 'CYCLE_DETECTED')).toHaveLength(0);
  });

  // 50. Multiple connections to same input port
  it('should error for multiple connections to same non-STEP input port', () => {
    const ntA = makeNodeType({ name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'STRING' } },
    });
    const ntB = makeNodeType({ name: 'B', functionName: 'B',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'STRING' } },
    });
    const ntC = makeNodeType({ name: 'C', functionName: 'C',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'STRING' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB, ntC],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B'), makeInstance('c', 'C')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('Start', 'execute', 'b', 'execute'),
        conn('a', 'val', 'c', 'val'),
        conn('b', 'val', 'c', 'val'),
        conn('c', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.some(e => e.code === 'MULTIPLE_CONNECTIONS_TO_INPUT')).toBe(true);
  });

  // 51. mergeStrategy port allows multiple connections
  it('should allow multiple connections to port with mergeStrategy', () => {
    const ntA = makeNodeType({ name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'STRING' } },
    });
    const ntB = makeNodeType({ name: 'B', functionName: 'B',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'STRING' } },
    });
    const ntC = makeNodeType({ name: 'C', functionName: 'C',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'STRING', mergeStrategy: 'ARRAY' as any } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB, ntC],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B'), makeInstance('c', 'C')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('Start', 'execute', 'b', 'execute'),
        conn('a', 'val', 'c', 'val'),
        conn('b', 'val', 'c', 'val'),
        conn('c', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.filter(e => e.code === 'MULTIPLE_CONNECTIONS_TO_INPUT')).toHaveLength(0);
  });

  // 52. OBJECT structural type mismatch warning
  it('should warn on OBJECT structural type mismatch', () => {
    const ntA = makeNodeType({ name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'OBJECT', tsType: '{ name: string }' } },
    });
    const ntB = makeNodeType({ name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'OBJECT', tsType: '{ age: number }' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'OBJECT_TYPE_MISMATCH')).toBe(true);
  });

  // 53. ANY type always compatible
  it('should not warn when source or target is ANY type', () => {
    const ntA = makeNodeType({ name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'ANY' } },
    });
    const ntB = makeNodeType({ name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'STRING' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.filter(w => w.code === 'TYPE_MISMATCH')).toHaveLength(0);
  });

  // 54. Safe coercion NUMBER -> STRING (no warning)
  it('should not warn for safe NUMBER to STRING coercion', () => {
    const ntA = makeNodeType({ name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'NUMBER' } },
    });
    const ntB = makeNodeType({ name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'STRING' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    const typeWarnings = r.warnings.filter(w =>
      ['LOSSY_TYPE_COERCION', 'UNUSUAL_TYPE_COERCION', 'TYPE_MISMATCH'].includes(w.code)
    );
    expect(typeWarnings).toHaveLength(0);
  });

  // 55. validateNodeType: invalid scope name
  it('should report invalid scope name on scoped port', () => {
    const nt = makeNodeType({
      outputs: {
        ...makeNodeType().outputs,
        item: { dataType: 'STRING', scope: '123-invalid' },
      },
    });
    const errors = validator.validateNodeType(nt);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('invalid scope name');
  });

  // 56. validateNodeType: valid scope name passes
  it('should not error for valid scope name', () => {
    const nt = makeNodeType({
      outputs: {
        ...makeNodeType().outputs,
        item: { dataType: 'STRING', scope: 'iteration' },
      },
    });
    const errors = validator.validateNodeType(nt);
    expect(errors).toHaveLength(0);
  });

  // 57. Lossy OBJECT->STRING
  it('should warn for lossy OBJECT to STRING coercion', () => {
    const ntA = makeNodeType({ name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'OBJECT' } },
    });
    const ntB = makeNodeType({ name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'STRING' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'LOSSY_TYPE_COERCION')).toBe(true);
  });

  // 58. Unusual STRING->OBJECT
  it('should warn for unusual STRING to OBJECT coercion', () => {
    const ntA = makeNodeType({ name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'STRING' } },
    });
    const ntB = makeNodeType({ name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'OBJECT' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.some(w => w.code === 'UNUSUAL_TYPE_COERCION')).toBe(true);
  });

  // 59. Required input satisfied by port expression
  it('should not error for required input with expression on port def', () => {
    const nt = makeNodeType({
      inputs: {
        execute: { dataType: 'STEP' },
        val: { dataType: 'STRING', expression: '"hello"' },
      },
    });
    const wf = makeWorkflow({
      nodeTypes: [nt],
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.filter(e => e.code === 'MISSING_REQUIRED_INPUT' && e.message.includes('val'))).toHaveLength(0);
  });

  // 60. Required input satisfied by instance portConfig expression
  it('should not error for required input with instance portConfig expression', () => {
    const nt = makeNodeType({
      inputs: {
        execute: { dataType: 'STEP' },
        val: { dataType: 'STRING' },
      },
    });
    const wf = makeWorkflow({
      nodeTypes: [nt],
      instances: [makeInstance('p', 'proc', {
        portConfigs: [{ portName: 'val', direction: 'INPUT', expression: '"world"' }],
      })],
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.errors.filter(e => e.code === 'MISSING_REQUIRED_INPUT' && e.message.includes('val'))).toHaveLength(0);
  });

  // 61. formatType with tsType
  it('should format type with tsType in error messages', () => {
    const ntA = makeNodeType({ name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'OBJECT', tsType: 'User' } },
    });
    const ntB = makeNodeType({ name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'STRING', tsType: 'string' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    const warning = [...r.warnings, ...r.errors].find(w =>
      w.message.includes('User (OBJECT)') && w.message.includes('string (STRING)')
    );
    expect(warning).toBeDefined();
  });

  // 62. Scoped output port skipped from unused output check
  it('should not warn for scoped output port being unconnected externally', () => {
    const nt = makeNodeType({
      outputs: {
        ...makeNodeType().outputs,
        item: { dataType: 'STRING', scope: 'iteration' },
      },
    });
    const wf = makeWorkflow({
      nodeTypes: [nt],
      connections: [
        conn('Start', 'execute', 'p', 'execute'),
        conn('p', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf);
    expect(r.warnings.filter(w => w.code === 'UNUSED_OUTPUT_PORT' && w.message.includes('item'))).toHaveLength(0);
  });

  // 63. strictMode option promotes type issues
  it('should promote type issues with strictMode option', () => {
    const ntA = makeNodeType({ name: 'A', functionName: 'A',
      outputs: { ...makeNodeType().outputs, val: { dataType: 'STRING' } },
    });
    const ntB = makeNodeType({ name: 'B', functionName: 'B',
      inputs: { ...makeNodeType().inputs, val: { dataType: 'NUMBER' } },
    });
    const wf = makeWorkflow({
      nodeTypes: [ntA, ntB],
      instances: [makeInstance('a', 'A'), makeInstance('b', 'B')],
      connections: [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'val', 'b', 'val'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ],
    });
    const r = validator.validate(wf, { strictMode: true });
    expect(r.errors.some(e => e.code === 'TYPE_INCOMPATIBLE')).toBe(true);
  });
});
