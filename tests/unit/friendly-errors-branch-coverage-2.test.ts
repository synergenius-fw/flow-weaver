/**
 * Additional branch coverage tests for src/friendly-errors.ts
 * Targets the "other side" of partial branches (||, ??, ternary fallbacks).
 */

import { getFriendlyError, formatFriendlyDiagnostics } from '../../src/friendly-errors';

describe('extractQuoted - no matches branch', () => {
  // extractQuoted returns [] when no quotes found - triggers fallback chains
  it('UNKNOWN_NODE_TYPE with no quoted values and no node falls back to unknown', () => {
    const r = getFriendlyError({ code: 'UNKNOWN_NODE_TYPE', message: 'no quotes' });
    expect(r!.explanation).toContain('unknown');
  });

  it('UNKNOWN_SOURCE_NODE with no quoted and no node falls back to unknown', () => {
    const r = getFriendlyError({ code: 'UNKNOWN_SOURCE_NODE', message: 'no quotes' });
    expect(r!.explanation).toContain('unknown');
  });

  it('UNKNOWN_TARGET_NODE with no quoted and no node falls back to unknown', () => {
    const r = getFriendlyError({ code: 'UNKNOWN_TARGET_NODE', message: 'no quotes' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('UNKNOWN_SOURCE_PORT fallback branches', () => {
  // When no "does not have output port" AND no quoted values AND no node
  it('without has-output-port message, no quoted, no node -> all unknown', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_SOURCE_PORT',
      message: 'port issue with no details',
    });
    expect(r!.explanation).toContain('unknown');
  });

  // With "does not have output port" but missing second quoted value
  it('with has-output-port message but only one quoted value', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_SOURCE_PORT',
      message: 'Node "myNode" does not have output port somewhere',
    });
    // quoted[0] = myNode, quoted[1] = undefined
    expect(r!.explanation).toContain('myNode');
  });

  // Without "does not have output port", using node fallback for nodeName, and second fallback path for portName
  it('without has-output-port, with node field, one quoted value', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_SOURCE_PORT',
      message: '"portX" is invalid output',
      node: 'nodeY',
    });
    // hasNodeAndPort = false, so displayNode = nodeName = quoted[0] || error.node
    // portName = quoted[1] || quoted[0] = quoted[0] = 'portX'
    expect(r!.explanation).toContain('portX');
  });
});

describe('UNKNOWN_TARGET_PORT fallback branches', () => {
  it('without has-input-port, no quoted, no node -> all unknown', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_TARGET_PORT',
      message: 'port issue with no details',
    });
    expect(r!.explanation).toContain('unknown');
  });

  it('with has-input-port but only one quoted value', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_TARGET_PORT',
      message: 'Node "myNode" does not have input port somewhere',
    });
    expect(r!.explanation).toContain('myNode');
  });

  it('without has-input-port, with quoted value and no node', () => {
    const r = getFriendlyError({
      code: 'UNKNOWN_TARGET_PORT',
      message: '"somePort" is wrong',
    });
    // hasNodeAndPort = false, displayNode = error.node || 'unknown' = 'unknown'
    // displayPort = quoted[0] || 'unknown' = 'somePort'
    expect(r!.explanation).toContain('somePort');
    expect(r!.explanation).toContain('unknown');
  });
});

describe('UNUSED_NODE fallback to unknown', () => {
  it('no quoted, no node -> unknown', () => {
    const r = getFriendlyError({ code: 'UNUSED_NODE', message: 'no info' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('DUPLICATE_NODE_NAME fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'DUPLICATE_NODE_NAME', message: 'duplicate', node: 'fromNode' });
    expect(r!.explanation).toContain('fromNode');
  });

  it('no quoted, no node -> unknown', () => {
    const r = getFriendlyError({ code: 'DUPLICATE_NODE_NAME', message: 'duplicate' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('RESERVED_NODE_NAME fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'RESERVED_NODE_NAME', message: 'reserved', node: 'myNode' });
    expect(r!.fix).toContain('myNode');
  });

  it('no quoted, no node -> unknown', () => {
    const r = getFriendlyError({ code: 'RESERVED_NODE_NAME', message: 'reserved' });
    expect(r!.fix).toContain('unknown');
  });
});

describe('RESERVED_INSTANCE_ID fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'RESERVED_INSTANCE_ID', message: 'reserved', node: 'myInst' });
    expect(r!.explanation).toContain('myInst');
  });

  it('no quoted, no node -> unknown', () => {
    const r = getFriendlyError({ code: 'RESERVED_INSTANCE_ID', message: 'reserved' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('INFERRED_NODE_TYPE fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'INFERRED_NODE_TYPE', message: 'inferred', node: 'myFunc' });
    expect(r!.explanation).toContain('myFunc');
  });

  it('no quoted, no node -> unknown', () => {
    const r = getFriendlyError({ code: 'INFERRED_NODE_TYPE', message: 'inferred' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('UNDEFINED_NODE fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'UNDEFINED_NODE', message: 'undefined node', node: 'nodeX' });
    expect(r!.explanation).toContain('nodeX');
  });

  it('no quoted, no node -> unknown', () => {
    const r = getFriendlyError({ code: 'UNDEFINED_NODE', message: 'undefined node' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('MULTIPLE_CONNECTIONS_TO_INPUT fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'MULTIPLE_CONNECTIONS_TO_INPUT', message: 'multiple', node: 'nodeZ' });
    expect(r!.explanation).toContain('unknown'); // portName = unknown
    expect(r!.explanation).toContain('nodeZ');
  });

  it('one quoted only, no node -> port from quoted, node unknown', () => {
    const r = getFriendlyError({ code: 'MULTIPLE_CONNECTIONS_TO_INPUT', message: '"portA" has multiple' });
    expect(r!.explanation).toContain('portA');
    expect(r!.explanation).toContain('unknown');
  });
});

describe('SCOPE_CONSISTENCY_ERROR fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'SCOPE_CONSISTENCY_ERROR', message: 'consistency', node: 'myScope' });
    expect(r!.explanation).toContain('myScope');
  });

  it('no quoted, no node -> unknown', () => {
    const r = getFriendlyError({ code: 'SCOPE_CONSISTENCY_ERROR', message: 'consistency' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('SCOPE_MISSING_REQUIRED_INPUT partial fallbacks', () => {
  it('no quoted, uses node field for childId', () => {
    const r = getFriendlyError({ code: 'SCOPE_MISSING_REQUIRED_INPUT', message: 'missing input', node: 'childNode' });
    expect(r!.explanation).toContain('childNode');
    expect(r!.explanation).toContain('unknown');
  });
});

describe('SCOPE_UNUSED_INPUT fallbacks', () => {
  it('no quoted, uses node field for parentId', () => {
    const r = getFriendlyError({ code: 'SCOPE_UNUSED_INPUT', message: 'unused', node: 'parent1' });
    expect(r!.explanation).toContain('parent1');
    expect(r!.explanation).toContain('unknown');
  });

  it('no quoted, no node -> all unknown', () => {
    const r = getFriendlyError({ code: 'SCOPE_UNUSED_INPUT', message: 'unused' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('SCOPE_ORPHANED_CHILD fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'SCOPE_ORPHANED_CHILD', message: 'orphaned', node: 'childX' });
    expect(r!.explanation).toContain('childX');
  });

  it('no quoted, no node -> unknown', () => {
    const r = getFriendlyError({ code: 'SCOPE_ORPHANED_CHILD', message: 'orphaned' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('MUTABLE_NODE_TYPE_BINDING - no quoted, no node -> all unknown', () => {
  it('falls back to unknown for both name and binding', () => {
    const r = getFriendlyError({ code: 'MUTABLE_NODE_TYPE_BINDING', message: 'mutable binding' });
    expect(r!.explanation).toContain('unknown');
    // bindingKind fallback is 'let'
    expect(r!.explanation).toContain('let');
  });
});

describe('UNUSED_OUTPUT_PORT fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'UNUSED_OUTPUT_PORT', message: 'unused', node: 'nodeA' });
    expect(r!.explanation).toContain('unknown'); // portName
    expect(r!.explanation).toContain('nodeA');
  });

  it('one quoted, no node -> port from quoted, node unknown', () => {
    const r = getFriendlyError({ code: 'UNUSED_OUTPUT_PORT', message: '"portX" unused' });
    expect(r!.explanation).toContain('portX');
    expect(r!.explanation).toContain('unknown');
  });
});

describe('ANNOTATION_SIGNATURE_MISMATCH fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'ANNOTATION_SIGNATURE_MISMATCH', message: 'mismatch', node: 'nodeB' });
    expect(r!.explanation).toContain('unknown'); // portName
    expect(r!.explanation).toContain('nodeB');
  });

  it('one quoted, no node -> port from quoted, node unknown', () => {
    const r = getFriendlyError({ code: 'ANNOTATION_SIGNATURE_MISMATCH', message: '"portA" mismatch' });
    expect(r!.explanation).toContain('portA');
    expect(r!.explanation).toContain('unknown');
  });
});

describe('ANNOTATION_SIGNATURE_TYPE_MISMATCH fallbacks', () => {
  it('no quoted -> all unknown', () => {
    const r = getFriendlyError({ code: 'ANNOTATION_SIGNATURE_TYPE_MISMATCH', message: 'mismatch' });
    expect(r!.explanation).toContain('unknown');
  });

  it('two quoted only -> port, node from quoted, types unknown', () => {
    const r = getFriendlyError({ code: 'ANNOTATION_SIGNATURE_TYPE_MISMATCH', message: '"portA" in "nodeB"' });
    expect(r!.explanation).toContain('portA');
    expect(r!.explanation).toContain('nodeB');
    expect(r!.explanation).toContain('unknown'); // annotationType and sigType
  });
});

describe('OBJECT_TYPE_MISMATCH fallbacks', () => {
  it('no quoted -> unknown', () => {
    const r = getFriendlyError({ code: 'OBJECT_TYPE_MISMATCH', message: 'shape mismatch' });
    expect(r!.explanation).toContain('unknown');
  });

  it('one quoted -> source from quoted, target unknown', () => {
    const r = getFriendlyError({ code: 'OBJECT_TYPE_MISMATCH', message: '"TypeA" mismatch' });
    expect(r!.explanation).toContain('TypeA');
    expect(r!.explanation).toContain('unknown');
  });
});

describe('COERCE_TYPE_MISMATCH fallbacks', () => {
  it('no as-match and no expects-match -> all unknown', () => {
    const r = getFriendlyError({ code: 'COERCE_TYPE_MISMATCH', message: 'coercion problem' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('REDUNDANT_COERCE fallbacks', () => {
  it('no as-match -> unknown coerceType', () => {
    const r = getFriendlyError({ code: 'REDUNDANT_COERCE', message: 'redundant both STRING' });
    expect(r!.explanation).toContain('unknown');
    expect(r!.explanation).toContain('STRING');
  });
});

describe('buildCoerceSuggestion - OBJECT target type', () => {
  it('coerce suggestion with OBJECT target maps to object', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: '"a.b" to "c.d" from STRING to OBJECT',
    });
    expect(r!.fix).toContain('as object');
  });
});

describe('buildCoerceSuggestion - json target type', () => {
  it('coerce suggestion with json (lowercase) target', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: '"a.b" to "c.d" from STRING to json',
    });
    // json is in the allowed list ['string','number','boolean','json','object']
    expect(r!.fix).toContain('as json');
  });
});

describe('SCOPE_WRONG_SCOPE_NAME fallbacks', () => {
  it('no quoted -> all unknown', () => {
    const r = getFriendlyError({ code: 'SCOPE_WRONG_SCOPE_NAME', message: 'wrong scope' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('SCOPE_PORT_TYPE_MISMATCH fallbacks', () => {
  it('no quoted -> unknown scope', () => {
    const r = getFriendlyError({ code: 'SCOPE_PORT_TYPE_MISMATCH', message: 'type mismatch' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('SCOPE_UNKNOWN_PORT fallbacks', () => {
  it('no quoted -> unknown port', () => {
    const r = getFriendlyError({ code: 'SCOPE_UNKNOWN_PORT', message: 'port issue' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('DUPLICATE_INSTANCE_ID fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'DUPLICATE_INSTANCE_ID', message: 'duplicate', node: 'inst2' });
    expect(r!.explanation).toContain('inst2');
  });

  it('no quoted, no node -> unknown', () => {
    const r = getFriendlyError({ code: 'DUPLICATE_INSTANCE_ID', message: 'duplicate' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('INVALID_COLOR fallbacks', () => {
  it('no quoted -> unknown', () => {
    const r = getFriendlyError({ code: 'INVALID_COLOR', message: 'bad color' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('INVALID_ICON fallbacks', () => {
  it('no quoted -> unknown', () => {
    const r = getFriendlyError({ code: 'INVALID_ICON', message: 'bad icon' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('INVALID_PORT_TYPE fallbacks', () => {
  it('no quoted -> unknown', () => {
    const r = getFriendlyError({ code: 'INVALID_PORT_TYPE', message: 'bad type' });
    expect(r!.explanation).toContain('unknown');
  });

  it('one quoted only -> portName from quoted, typeName unknown', () => {
    const r = getFriendlyError({ code: 'INVALID_PORT_TYPE', message: '"myPort" has bad type' });
    expect(r!.explanation).toContain('myPort');
    // typeName = quoted[2] || quoted[1] || 'unknown' = undefined || undefined || 'unknown'
    expect(r!.explanation).toContain('unknown');
  });

  it('three quoted -> uses third for typeName', () => {
    const r = getFriendlyError({ code: 'INVALID_PORT_TYPE', message: '"port1" on "node1" type "WEIRD"' });
    expect(r!.explanation).toContain('WEIRD');
  });
});

describe('INVALID_PORT_CONFIG_REF fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'INVALID_PORT_CONFIG_REF', message: 'bad ref', node: 'inst1' });
    expect(r!.explanation).toContain('inst1');
  });

  it('no quoted, no node -> unknown', () => {
    const r = getFriendlyError({ code: 'INVALID_PORT_CONFIG_REF', message: 'bad ref' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('INVALID_EXECUTE_WHEN fallbacks', () => {
  it('no quoted -> unknown', () => {
    const r = getFriendlyError({ code: 'INVALID_EXECUTE_WHEN', message: 'bad strategy' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('SCOPE_EMPTY fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'SCOPE_EMPTY', message: 'empty scope', node: 'forEach1' });
    expect(r!.explanation).toContain('forEach1');
    expect(r!.explanation).toContain('unknown'); // scopeName
  });

  it('one quoted, no node -> scopeName from quoted, nodeName unknown', () => {
    const r = getFriendlyError({ code: 'SCOPE_EMPTY', message: '"iterate" is empty' });
    expect(r!.explanation).toContain('iterate');
    expect(r!.explanation).toContain('unknown'); // nodeName
  });
});

describe('SCOPE_INCONSISTENT fallbacks', () => {
  it('no quoted, uses node field', () => {
    const r = getFriendlyError({ code: 'SCOPE_INCONSISTENT', message: 'inconsistent', node: 'child1' });
    expect(r!.explanation).toContain('child1');
  });

  it('no quoted, no node -> unknown', () => {
    const r = getFriendlyError({ code: 'SCOPE_INCONSISTENT', message: 'inconsistent' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('DESIGN_EXIT_DATA_UNREACHABLE fallback', () => {
  it('no quoted -> unknown', () => {
    const r = getFriendlyError({ code: 'DESIGN_EXIT_DATA_UNREACHABLE', message: 'unreachable' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('UNREACHABLE_EXIT_PORT fallback', () => {
  it('no quoted -> unknown', () => {
    const r = getFriendlyError({ code: 'UNREACHABLE_EXIT_PORT', message: 'unreachable' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('MULTIPLE_EXIT_CONNECTIONS fallback', () => {
  it('no quoted -> unknown', () => {
    const r = getFriendlyError({ code: 'MULTIPLE_EXIT_CONNECTIONS', message: 'multiple' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('agent rules without node field', () => {
  it('AGENT_LLM_MISSING_ERROR_HANDLER -> unknown', () => {
    const r = getFriendlyError({ code: 'AGENT_LLM_MISSING_ERROR_HANDLER', message: '' });
    expect(r!.explanation).toContain('unknown');
  });

  it('AGENT_UNGUARDED_TOOL_EXECUTOR -> unknown', () => {
    const r = getFriendlyError({ code: 'AGENT_UNGUARDED_TOOL_EXECUTOR', message: '' });
    expect(r!.explanation).toContain('unknown');
  });

  it('AGENT_LLM_NO_FALLBACK -> unknown', () => {
    const r = getFriendlyError({ code: 'AGENT_LLM_NO_FALLBACK', message: '' });
    expect(r!.explanation).toContain('unknown');
  });

  it('AGENT_TOOL_NO_OUTPUT_HANDLING -> unknown', () => {
    const r = getFriendlyError({ code: 'AGENT_TOOL_NO_OUTPUT_HANDLING', message: '' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('design rules without node field', () => {
  it('DESIGN_ASYNC_NO_ERROR_PATH -> unknown', () => {
    const r = getFriendlyError({ code: 'DESIGN_ASYNC_NO_ERROR_PATH', message: '' });
    expect(r!.explanation).toContain('unknown');
  });

  it('DESIGN_SCOPE_NO_FAILURE_EXIT -> unknown', () => {
    const r = getFriendlyError({ code: 'DESIGN_SCOPE_NO_FAILURE_EXIT', message: '' });
    expect(r!.explanation).toContain('unknown');
  });

  it('DESIGN_UNBOUNDED_RETRY -> unknown', () => {
    const r = getFriendlyError({ code: 'DESIGN_UNBOUNDED_RETRY', message: '' });
    expect(r!.explanation).toContain('unknown');
  });

  it('DESIGN_FANOUT_NO_FANIN -> unknown', () => {
    const r = getFriendlyError({ code: 'DESIGN_FANOUT_NO_FANIN', message: '' });
    expect(r!.explanation).toContain('unknown');
  });

  it('DESIGN_PULL_CANDIDATE -> unknown', () => {
    const r = getFriendlyError({ code: 'DESIGN_PULL_CANDIDATE', message: '' });
    expect(r!.explanation).toContain('unknown');
  });

  it('DESIGN_PULL_UNUSED -> unknown', () => {
    const r = getFriendlyError({ code: 'DESIGN_PULL_UNUSED', message: '' });
    expect(r!.explanation).toContain('unknown');
  });
});

describe('MISSING_REQUIRED_INPUT - quoted[0] present but no quoted[1], no node', () => {
  it('uses quoted[0] for nodeName, unknown for portName', () => {
    const r = getFriendlyError({
      code: 'MISSING_REQUIRED_INPUT',
      message: 'Node "fetchData" has issue',
    });
    expect(r!.explanation).toContain('fetchData');
    expect(r!.explanation).toContain('unknown');
  });
});

describe('formatFriendlyDiagnostics warning for unmapped code', () => {
  it('uses WARNING prefix for unmapped warning', () => {
    const result = formatFriendlyDiagnostics([
      { code: 'TOTALLY_UNKNOWN', message: 'some message', type: 'warning' },
    ]);
    expect(result).toContain('[WARNING] TOTALLY_UNKNOWN');
    expect(result).toContain('some message');
  });
});

describe('buildCoerceSuggestion - target type not in allowed list', () => {
  it('ARRAY target type is not in allowed coerce types', () => {
    const r = getFriendlyError({
      code: 'TYPE_MISMATCH',
      message: '"a.b" to "c.d" from STRING to ARRAY',
    });
    // ARRAY is not in COERCE_TARGET_TYPES, so coerceType = 'array'
    // 'array' is not in ['string','number','boolean','json','object'] => returns null
    expect(r!.fix).toContain('as <type>');
  });
});

describe('TYPE_MISMATCH and TYPE_INCOMPATIBLE without types', () => {
  it('TYPE_INCOMPATIBLE with no types and no coerce suggestion', () => {
    const r = getFriendlyError({
      code: 'TYPE_INCOMPATIBLE',
      message: 'incompatible types found',
    });
    expect(r!.explanation).toContain('unknown');
    expect(r!.fix).toContain('as <type>');
  });
});
