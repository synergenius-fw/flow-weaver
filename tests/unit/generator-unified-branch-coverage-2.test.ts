/**
 * Branch coverage tests for src/generator/unified.ts (round 2).
 *
 * Targets uncovered branches in variant dispatch (STUB, COERCION, expression,
 * MAP_ITERATOR, IMPORTED_WORKFLOW, scoped nodes), exit port edge cases,
 * pull execution config paths, and parallel group fallbacks.
 */

import { generateCode } from '../../src/api/generate';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNodeType(
  name: string,
  overrides: Partial<TNodeTypeAST> = {}
): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' },
      value: { dataType: 'NUMBER' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    variant: 'FUNCTION',
    functionText: `function ${name}(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: execute, onFailure: !execute, result: value }; }`,
    ...overrides,
  };
}

function makeSimpleNodeType(
  name: string,
  overrides: Partial<TNodeTypeAST> = {}
): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName: name,
    inputs: {
      execute: { dataType: 'STEP' },
      value: { dataType: 'NUMBER' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
    },
    hasSuccessPort: false,
    hasFailurePort: false,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    variant: 'FUNCTION',
    functionText: `function ${name}(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; result: number } { return { onSuccess: true, onFailure: false, result: value }; }`,
    ...overrides,
  };
}

function makeWorkflow(
  nodeTypes: TNodeTypeAST[],
  instances: TWorkflowAST['instances'],
  connections: TWorkflowAST['connections'],
  overrides: Partial<TWorkflowAST> = {}
): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    sourceFile: 'test.ts',
    nodeTypes,
    instances,
    connections,
    scopes: {},
    startPorts: { execute: { dataType: 'STEP' }, n: { dataType: 'NUMBER' } },
    exitPorts: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
    },
    imports: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. STUB variant: runtime throw in generateNodeCallWithContext (line ~2140)
// ---------------------------------------------------------------------------
describe('Unified Generator - STUB variant', () => {
  it('generates a runtime throw for STUB node type', () => {
    const stubNode = makeSimpleNodeType('stubFunc', {
      variant: 'STUB',
    });

    const workflow = makeWorkflow(
      [stubNode],
      [{ type: 'NodeInstance', id: 's', nodeType: 'stubFunc' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 's', port: 'execute' } },
        { type: 'Connection', from: { node: 's', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true, generateStubs: true });
    expect(code).toContain('throw new Error');
    expect(code).toContain('stub type');
    expect(code).toContain('stubFunc');
  });
});

// ---------------------------------------------------------------------------
// 2. COERCION variant: inline expression (line ~2145-2164)
// ---------------------------------------------------------------------------
describe('Unified Generator - COERCION variant', () => {
  it('generates inline coercion for __fw_toString', () => {
    const coerceNode = makeSimpleNodeType('__fw_toString', {
      variant: 'COERCION',
      expression: true,
      inputs: { value: { dataType: 'NUMBER' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'STRING' },
      },
    });

    const workflow = makeWorkflow(
      [coerceNode],
      [{ type: 'NodeInstance', id: 'c', nodeType: '__fw_toString' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'c', port: 'value' } },
        { type: 'Connection', from: { node: 'c', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
      { exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'STRING' } } }
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('String(');
  });

  it('generates inline coercion for __fw_toNumber', () => {
    const coerceNode = makeSimpleNodeType('__fw_toNumber', {
      variant: 'COERCION',
      expression: true,
      inputs: { value: { dataType: 'STRING' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'NUMBER' },
      },
    });

    const workflow = makeWorkflow(
      [coerceNode],
      [{ type: 'NodeInstance', id: 'c', nodeType: '__fw_toNumber' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'c', port: 'value' } },
        { type: 'Connection', from: { node: 'c', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
      { exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } } }
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('Number(');
  });

  it('uses default String coercion for unknown coercion function name', () => {
    const coerceNode = makeSimpleNodeType('__fw_unknownCoerce', {
      variant: 'COERCION',
      expression: true,
      inputs: { value: { dataType: 'NUMBER' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'STRING' },
      },
    });

    const workflow = makeWorkflow(
      [coerceNode],
      [{ type: 'NodeInstance', id: 'c', nodeType: '__fw_unknownCoerce' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'c', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'c', port: 'value' } },
        { type: 'Connection', from: { node: 'c', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
      { exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'STRING' } } }
    );

    const code = generateCode(workflow, { production: true });
    // Falls back to String
    expect(code).toContain('String(');
  });
});

// ---------------------------------------------------------------------------
// 3. Expression node: single vs multiple data outputs (lines ~2173-2216)
// ---------------------------------------------------------------------------
describe('Unified Generator - expression node output branches', () => {
  it('generates single-output expression node with raw value extraction', () => {
    const exprNode = makeSimpleNodeType('isPositive', {
      expression: true,
      inputs: { value: { dataType: 'NUMBER' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'BOOLEAN' },
      },
    });

    const workflow = makeWorkflow(
      [exprNode],
      [{ type: 'NodeInstance', id: 'e', nodeType: 'isPositive' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'e', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'e', port: 'value' } },
        { type: 'Connection', from: { node: 'e', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Single output uses raw value extraction (typeof check)
    expect(code).toContain('_raw');
    expect(code).toContain("typeof");
    expect(code).toContain("'result' in");
  });

  it('generates multi-output expression node with direct destructuring', () => {
    const exprNode = makeSimpleNodeType('splitValue', {
      expression: true,
      inputs: { value: { dataType: 'NUMBER' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        low: { dataType: 'NUMBER' },
        high: { dataType: 'NUMBER' },
      },
    });

    const workflow = makeWorkflow(
      [exprNode],
      [{ type: 'NodeInstance', id: 'e', nodeType: 'splitValue' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'e', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'e', port: 'value' } },
        { type: 'Connection', from: { node: 'e', port: 'low' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Multiple outputs use direct property access
    expect(code).toContain('Result.low');
    expect(code).toContain('Result.high');
    // Should NOT have raw value extraction
    expect(code).not.toContain('_raw');
  });
});

// ---------------------------------------------------------------------------
// 4. IMPORTED_WORKFLOW variant in generateNodeCallWithContext (lines ~2242-2272)
// ---------------------------------------------------------------------------
describe('Unified Generator - IMPORTED_WORKFLOW variant', () => {
  it('wraps data args in params object with recursion depth for workflow calls', () => {
    const wfNode = makeSimpleNodeType('subWorkflow', {
      variant: 'IMPORTED_WORKFLOW',
      inputs: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'NUMBER' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'NUMBER' },
      },
    });

    const workflow = makeWorkflow(
      [wfNode],
      [{ type: 'NodeInstance', id: 'sub', nodeType: 'subWorkflow' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'sub', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'sub', port: 'input' } },
        { type: 'Connection', from: { node: 'sub', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('__rd__: __rd__ + 1');
    expect(code).toContain('Params__');
  });
});

// ---------------------------------------------------------------------------
// 5. Scoped node variant in generateNodeCallWithContext (lines ~2273-2289)
// ---------------------------------------------------------------------------
describe('Unified Generator - scoped node variant', () => {
  it('generates positional args call for nodes with scope', () => {
    const scopedNode = makeSimpleNodeType('forEach', {
      scope: 'body',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'ARRAY' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'ARRAY' },
        item: { dataType: 'ANY', scope: 'body' },
      },
    });

    const workflow = makeWorkflow(
      [scopedNode],
      [{ type: 'NodeInstance', id: 'fe', nodeType: 'forEach' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'fe', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'fe', port: 'items' } },
        { type: 'Connection', from: { node: 'fe', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Scoped nodes use positional args directly
    expect(code).toContain('forEach(');
    // Should not wrap in params object (that's for workflow variant)
    expect(code).not.toContain('Params__');
  });

  it('generates positional args call for nodes with scopes array', () => {
    const scopedNode = makeSimpleNodeType('multiScope', {
      scopes: ['bodyA', 'bodyB'],
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'ARRAY' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'ARRAY' },
      },
    });

    const workflow = makeWorkflow(
      [scopedNode],
      [{ type: 'NodeInstance', id: 'ms', nodeType: 'multiScope' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ms', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ms', port: 'items' } },
        { type: 'Connection', from: { node: 'ms', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('multiScope(');
  });
});

// ---------------------------------------------------------------------------
// 6. Exit port edge cases: undeclared port, source not found, no valid conns
// ---------------------------------------------------------------------------
describe('Unified Generator - exit port edge cases', () => {
  it('skips connections to undeclared exit ports', () => {
    const node = makeSimpleNodeType('double', {
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'd', nodeType: 'double' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'd', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'd', port: 'value' } },
        // typo: 'resultx' is not a declared exit port
        { type: 'Connection', from: { node: 'd', port: 'result' }, to: { node: 'Exit', port: 'resultx' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Should contain a skip comment for the typo
    expect(code).toContain('not a declared @returns port');
    // The declared 'result' port should get default undefined
    expect(code).toContain('undefined');
  });

  it('handles unconnected declared exit ports with default undefined', () => {
    const node = makeSimpleNodeType('noop', {
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, out: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'n', nodeType: 'noop' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'n', port: 'execute' } },
        // 'result' exit port is declared but never connected
      ],
      {
        exitPorts: {
          onSuccess: { dataType: 'STEP' },
          onFailure: { dataType: 'STEP' },
          result: { dataType: 'NUMBER' },
          extra: { dataType: 'STRING' },
        },
      }
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('has no valid connection');
  });
});

// ---------------------------------------------------------------------------
// 7. Pull execution config: boolean vs object, instance vs nodeType default
// ---------------------------------------------------------------------------
describe('Unified Generator - pull execution config branches', () => {
  it('handles pull execution from instance config as boolean true', () => {
    const node = makeSimpleNodeType('lazyNode', {
      inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'lazy', nodeType: 'lazyNode', config: { pullExecution: true } }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'lazy', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'lazy', port: 'value' } },
        { type: 'Connection', from: { node: 'lazy', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('registerPullExecutor');
    expect(code).toContain('lazy_executor');
  });

  it('handles pull execution from instance config as object with triggerPort', () => {
    const node = makeSimpleNodeType('lazyNode2', {
      inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'lazy2', nodeType: 'lazyNode2', config: { pullExecution: { triggerPort: 'myPort' } } }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'lazy2', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'lazy2', port: 'value' } },
        { type: 'Connection', from: { node: 'lazy2', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('registerPullExecutor');
  });

  it('handles pull execution from nodeType defaultConfig as boolean', () => {
    const node = makeSimpleNodeType('defaultPull', {
      defaultConfig: { pullExecution: true },
      inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'dp', nodeType: 'defaultPull' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'dp', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'dp', port: 'value' } },
        { type: 'Connection', from: { node: 'dp', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('registerPullExecutor');
  });

  it('handles pull execution from nodeType defaultConfig as object', () => {
    const node = makeSimpleNodeType('defaultPullObj', {
      defaultConfig: { pullExecution: { triggerPort: 'load' } },
      inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'dpo', nodeType: 'defaultPullObj' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'dpo', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'dpo', port: 'value' } },
        { type: 'Connection', from: { node: 'dpo', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('registerPullExecutor');
  });
});

// ---------------------------------------------------------------------------
// 8. MAP_ITERATOR variant in generateNodeCallWithContext (lines ~2217-2242)
// ---------------------------------------------------------------------------
describe('Unified Generator - MAP_ITERATOR variant', () => {
  it('generates inline iteration code for MAP_ITERATOR node', () => {
    const mapNode = makeSimpleNodeType('mapItems', {
      variant: 'MAP_ITERATOR',
      scope: 'body',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'ARRAY' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        results: { dataType: 'ARRAY' },
        item: { dataType: 'ANY', scope: 'body' },
      },
    });

    const workflow = makeWorkflow(
      [mapNode],
      [{ type: 'NodeInstance', id: 'mi', nodeType: 'mapItems' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'mi', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'mi', port: 'items' } },
        { type: 'Connection', from: { node: 'mi', port: 'results' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('__results');
    expect(code).toContain('for (const __item');
  });
});

// ---------------------------------------------------------------------------
// 9. Expression branching node (single output) in generateBranchingNodeCode
// ---------------------------------------------------------------------------
describe('Unified Generator - expression branching node', () => {
  it('generates expression branching node with single data output', () => {
    const exprBranch = makeNodeType('checkValue', {
      expression: true,
      inputs: { value: { dataType: 'NUMBER' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'BOOLEAN' },
      },
    });
    const handler = makeSimpleNodeType('handler', {
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, out: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [exprBranch, handler],
      [
        { type: 'NodeInstance', id: 'chk', nodeType: 'checkValue' },
        { type: 'NodeInstance', id: 'h', nodeType: 'handler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'chk', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'chk', port: 'value' } },
        { type: 'Connection', from: { node: 'chk', port: 'onSuccess' }, to: { node: 'h', port: 'execute' } },
        { type: 'Connection', from: { node: 'chk', port: 'result' }, to: { node: 'h', port: 'value' } },
        { type: 'Connection', from: { node: 'h', port: 'out' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Expression branching: onSuccess auto-set, raw value extraction for single output
    expect(code).toContain('_raw');
    expect(code).toContain('_success = true');
  });

  it('generates expression branching node with multiple data outputs', () => {
    const exprBranch = makeNodeType('splitCheck', {
      expression: true,
      inputs: { value: { dataType: 'NUMBER' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        low: { dataType: 'NUMBER' },
        high: { dataType: 'NUMBER' },
      },
    });
    const handler = makeSimpleNodeType('handler2', {
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, out: { dataType: 'NUMBER' } },
    });

    const handler2 = makeSimpleNodeType('handler2', {
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, out: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [exprBranch, handler2],
      [
        { type: 'NodeInstance', id: 'sc', nodeType: 'splitCheck' },
        { type: 'NodeInstance', id: 'h2', nodeType: 'handler2' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'sc', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'sc', port: 'value' } },
        { type: 'Connection', from: { node: 'sc', port: 'onSuccess' }, to: { node: 'h2', port: 'execute' } },
        { type: 'Connection', from: { node: 'sc', port: 'low' }, to: { node: 'h2', port: 'value' } },
        { type: 'Connection', from: { node: 'h2', port: 'out' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Multiple outputs: direct destructuring
    expect(code).toContain('Result.low');
    expect(code).toContain('Result.high');
  });
});

// ---------------------------------------------------------------------------
// 10. IMPORTED_WORKFLOW variant in branching node code (lines ~1461-1490)
// ---------------------------------------------------------------------------
describe('Unified Generator - IMPORTED_WORKFLOW branching variant', () => {
  it('generates workflow params wrapping for branching IMPORTED_WORKFLOW node', () => {
    const wfBranch = makeNodeType('subWf', {
      variant: 'IMPORTED_WORKFLOW',
      inputs: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'NUMBER' },
      },
    });
    const handler = makeSimpleNodeType('okHandler');

    const workflow = makeWorkflow(
      [wfBranch, handler],
      [
        { type: 'NodeInstance', id: 'sw', nodeType: 'subWf' },
        { type: 'NodeInstance', id: 'ok', nodeType: 'okHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'sw', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'sw', port: 'input' } },
        { type: 'Connection', from: { node: 'sw', port: 'onSuccess' }, to: { node: 'ok', port: 'execute' } },
        { type: 'Connection', from: { node: 'sw', port: 'result' }, to: { node: 'ok', port: 'value' } },
        { type: 'Connection', from: { node: 'ok', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('__rd__: __rd__ + 1');
    expect(code).toContain('Params__');
  });
});

// ---------------------------------------------------------------------------
// 11. Scoped branching node variant (lines ~1491-1506)
// ---------------------------------------------------------------------------
describe('Unified Generator - scoped branching node variant', () => {
  it('generates positional args for branching node with scope', () => {
    const scopedBranch = makeNodeType('scopedBranch', {
      scope: 'body',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'ARRAY' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'ARRAY' },
        item: { dataType: 'ANY', scope: 'body' },
      },
    });
    const handler = makeSimpleNodeType('resultHandler');

    const workflow = makeWorkflow(
      [scopedBranch, handler],
      [
        { type: 'NodeInstance', id: 'sb', nodeType: 'scopedBranch' },
        { type: 'NodeInstance', id: 'rh', nodeType: 'resultHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'sb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'sb', port: 'items' } },
        { type: 'Connection', from: { node: 'sb', port: 'onSuccess' }, to: { node: 'rh', port: 'execute' } },
        { type: 'Connection', from: { node: 'sb', port: 'result' }, to: { node: 'rh', port: 'value' } },
        { type: 'Connection', from: { node: 'rh', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('scopedBranch(');
  });
});

// ---------------------------------------------------------------------------
// 12. MAP_ITERATOR branching variant (lines ~1436-1460)
// ---------------------------------------------------------------------------
describe('Unified Generator - MAP_ITERATOR branching variant', () => {
  it('generates inline iteration for branching MAP_ITERATOR', () => {
    const mapBranch = makeNodeType('mapBranch', {
      variant: 'MAP_ITERATOR',
      scope: 'body',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'ARRAY' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        results: { dataType: 'ARRAY' },
        item: { dataType: 'ANY', scope: 'body' },
      },
    });
    const handler = makeSimpleNodeType('mapHandler');

    const workflow = makeWorkflow(
      [mapBranch, handler],
      [
        { type: 'NodeInstance', id: 'mb', nodeType: 'mapBranch' },
        { type: 'NodeInstance', id: 'mh', nodeType: 'mapHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'mb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'mb', port: 'items' } },
        { type: 'Connection', from: { node: 'mb', port: 'onSuccess' }, to: { node: 'mh', port: 'execute' } },
        { type: 'Connection', from: { node: 'mb', port: 'results' }, to: { node: 'mh', port: 'value' } },
        { type: 'Connection', from: { node: 'mh', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('__results');
    expect(code).toContain('for (const __item');
  });
});

// ---------------------------------------------------------------------------
// 13. Pull execution node with IMPORTED_WORKFLOW variant (lines ~1866-1882)
// ---------------------------------------------------------------------------
describe('Unified Generator - pull node variants', () => {
  it('generates pull executor for IMPORTED_WORKFLOW variant', () => {
    const wfPull = makeSimpleNodeType('pullWf', {
      variant: 'IMPORTED_WORKFLOW',
      inputs: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'NUMBER' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'NUMBER' },
      },
    });

    const workflow = makeWorkflow(
      [wfPull],
      [{ type: 'NodeInstance', id: 'pw', nodeType: 'pullWf', config: { pullExecution: true } }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'pw', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'pw', port: 'input' } },
        { type: 'Connection', from: { node: 'pw', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('registerPullExecutor');
    expect(code).toContain('__rd__: __rd__ + 1');
    expect(code).toContain('Params__');
  });

  it('generates pull executor for scoped node variant', () => {
    const scopedPull = makeSimpleNodeType('pullScoped', {
      scope: 'body',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'ARRAY' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'ARRAY' },
        item: { dataType: 'ANY', scope: 'body' },
      },
    });

    const workflow = makeWorkflow(
      [scopedPull],
      [{ type: 'NodeInstance', id: 'ps', nodeType: 'pullScoped', config: { pullExecution: true } }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ps', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ps', port: 'items' } },
        { type: 'Connection', from: { node: 'ps', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('registerPullExecutor');
    expect(code).toContain('pullScoped(');
  });

  it('generates pull executor for MAP_ITERATOR variant', () => {
    const mapPull = makeSimpleNodeType('pullMap', {
      variant: 'MAP_ITERATOR',
      scope: 'body',
      inputs: {
        execute: { dataType: 'STEP' },
        items: { dataType: 'ARRAY' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        results: { dataType: 'ARRAY' },
        item: { dataType: 'ANY', scope: 'body' },
      },
    });

    const workflow = makeWorkflow(
      [mapPull],
      [{ type: 'NodeInstance', id: 'pm', nodeType: 'pullMap', config: { pullExecution: true } }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'pm', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'pm', port: 'items' } },
        { type: 'Connection', from: { node: 'pm', port: 'results' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('registerPullExecutor');
    expect(code).toContain('__results');
  });
});

// ---------------------------------------------------------------------------
// 14. Expression node in catch block sets failure flags (line ~2334)
// ---------------------------------------------------------------------------
describe('Unified Generator - expression node catch block', () => {
  it('generates failure flag auto-set in catch block for expression nodes', () => {
    const exprNode = makeSimpleNodeType('exprCatch', {
      expression: true,
      inputs: { value: { dataType: 'NUMBER' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'NUMBER' },
      },
    });

    const workflow = makeWorkflow(
      [exprNode],
      [{ type: 'NodeInstance', id: 'ec', nodeType: 'exprCatch' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ec', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ec', port: 'value' } },
        { type: 'Connection', from: { node: 'ec', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    // Use non-production mode to get full debug hooks including catch block
    const code = generateCode(workflow);
    // In catch block for expression nodes, auto-set onSuccess=false, onFailure=true
    expect(code).toContain("'onSuccess'");
    expect(code).toContain("'onFailure'");
    expect(code).toContain('catch');
  });
});

// ---------------------------------------------------------------------------
// 15. Exit source from pull node and branch node (lines ~716-722)
// ---------------------------------------------------------------------------
describe('Unified Generator - exit source from pull and branch nodes', () => {
  it('generates undefined check for exit source from node in a branch', () => {
    // brancher is a branching node. handler is in brancher's success branch.
    // handler connects to Exit.result, so it needs an undefined check.
    const brancher = makeNodeType('brancher');
    const handler = makeSimpleNodeType('handler3', {
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [brancher, handler],
      [
        { type: 'NodeInstance', id: 'br', nodeType: 'brancher' },
        { type: 'NodeInstance', id: 'h3', nodeType: 'handler3' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'br', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'br', port: 'value' } },
        { type: 'Connection', from: { node: 'br', port: 'onSuccess' }, to: { node: 'h3', port: 'execute' } },
        { type: 'Connection', from: { node: 'br', port: 'result' }, to: { node: 'h3', port: 'value' } },
        { type: 'Connection', from: { node: 'h3', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // h3 is in a branch, so exit source needs undefined check
    expect(code).toContain('h3Idx !== undefined');
  });

  it('generates pull node access (getVariable) for exit source from pull node', () => {
    const pullNode = makeSimpleNodeType('pullExit', {
      inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [pullNode],
      [{ type: 'NodeInstance', id: 'pe', nodeType: 'pullExit', config: { pullExecution: true } }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'pe', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'pe', port: 'value' } },
        { type: 'Connection', from: { node: 'pe', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Pull node exit source uses getVariable with ! (non-null assertion)
    expect(code).toContain('peIdx!');
    expect(code).toContain('getVariable');
  });
});

// ---------------------------------------------------------------------------
// 16. Multiple connections to same exit port (coalescing with ||/??)
// ---------------------------------------------------------------------------
describe('Unified Generator - multiple connections to same exit port', () => {
  it('coalesces multiple connections to onSuccess exit port with ||', () => {
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB');

    const workflow = makeWorkflow(
      [nodeA, nodeB],
      [
        { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
        { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'b', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'a', port: 'value' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'b', port: 'value' } },
        // Both connect to Exit.onSuccess
        { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        { type: 'Connection', from: { node: 'b', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Control flow ports use || for coalescing
    expect(code).toContain('exit_onSuccess');
    expect(code).toContain(' || ');
  });

  it('coalesces multiple connections to data exit port with ??', () => {
    const nodeA = makeNodeType('nodeA');
    const nodeB = makeNodeType('nodeB');

    const workflow = makeWorkflow(
      [nodeA, nodeB],
      [
        { type: 'NodeInstance', id: 'a', nodeType: 'nodeA' },
        { type: 'NodeInstance', id: 'b', nodeType: 'nodeB' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'b', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'a', port: 'value' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'b', port: 'value' } },
        // Both connect to Exit.result (data port)
        { type: 'Connection', from: { node: 'a', port: 'result' }, to: { node: 'Exit', port: 'result' } },
        { type: 'Connection', from: { node: 'b', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Data ports use ?? for coalescing
    expect(code).toContain('exit_result');
    expect(code).toContain(' ?? ');
  });
});

// ---------------------------------------------------------------------------
// 17. Expression node STEP guard for promoted expression node (line ~1981-1988)
// ---------------------------------------------------------------------------
describe('Unified Generator - expression node STEP guard promotion', () => {
  it('adds STEP guard for promoted expression node with execute connection', () => {
    const brancher = makeNodeType('brancher');
    const exprNode = makeSimpleNodeType('exprPromoted', {
      expression: true,
      inputs: { value: { dataType: 'NUMBER' } },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'NUMBER' },
      },
    });
    const helper = makeSimpleNodeType('helper', {
      inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [brancher, exprNode, helper],
      [
        { type: 'NodeInstance', id: 'br', nodeType: 'brancher' },
        { type: 'NodeInstance', id: 'ep', nodeType: 'exprPromoted' },
        { type: 'NodeInstance', id: 'hlp', nodeType: 'helper' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'br', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'hlp', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'br', port: 'value' } },
        // ep is in br's success branch via execute...
        { type: 'Connection', from: { node: 'br', port: 'onSuccess' }, to: { node: 'ep', port: 'execute' } },
        { type: 'Connection', from: { node: 'br', port: 'result' }, to: { node: 'ep', port: 'value' } },
        // ...but also has data dep on hlp (external), so gets promoted
        { type: 'Connection', from: { node: 'hlp', port: 'result' }, to: { node: 'ep', port: 'value' } },
        { type: 'Connection', from: { node: 'ep', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Promoted expression node should get a STEP guard
    expect(code).toContain('br_success');
  });
});

// ---------------------------------------------------------------------------
// 18. Production mode: exit VARIABLE_SET omission (line ~739)
// ---------------------------------------------------------------------------
describe('Unified Generator - production vs dev exit variable_set', () => {
  it('emits VARIABLE_SET for exit ports in dev mode', () => {
    const node = makeSimpleNodeType('simple');

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 's', nodeType: 'simple' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 's', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 's', port: 'value' } },
        { type: 'Connection', from: { node: 's', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const devCode = generateCode(workflow);
    const prodCode = generateCode(workflow, { production: true });

    // Dev mode emits setVariable for Exit ports
    const devSetVarCount = (devCode.match(/setVariable.*Exit/g) || []).length;
    const prodSetVarCount = (prodCode.match(/setVariable.*Exit/g) || []).length;
    expect(devSetVarCount).toBeGreaterThan(prodSetVarCount);
  });
});

// ---------------------------------------------------------------------------
// 19. Async pull node executor (line ~1807-1808)
// ---------------------------------------------------------------------------
describe('Unified Generator - async pull node executor', () => {
  it('generates async executor when node is async', () => {
    const asyncPull = makeSimpleNodeType('asyncPullNode', {
      isAsync: true,
      inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [asyncPull],
      [{ type: 'NodeInstance', id: 'ap', nodeType: 'asyncPullNode', config: { pullExecution: true } }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ap', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ap', port: 'value' } },
        { type: 'Connection', from: { node: 'ap', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    // Sync workflow but async node: executor should still be async
    const code = generateCode(workflow, { production: true });
    expect(code).toContain('async ()');
    expect(code).toContain('registerPullExecutor');
  });
});

// ---------------------------------------------------------------------------
// 20. WORKFLOW variant (non-imported) in generateNodeCallWithContext
// ---------------------------------------------------------------------------
describe('Unified Generator - WORKFLOW variant', () => {
  it('wraps params with recursion depth for WORKFLOW variant nodes', () => {
    const wfNode = makeSimpleNodeType('localWf', {
      variant: 'WORKFLOW',
      inputs: {
        execute: { dataType: 'STEP' },
        data: { dataType: 'NUMBER' },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'NUMBER' },
      },
    });

    const workflow = makeWorkflow(
      [wfNode],
      [{ type: 'NodeInstance', id: 'lw', nodeType: 'localWf' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'lw', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'lw', port: 'data' } },
        { type: 'Connection', from: { node: 'lw', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('__rd__: __rd__ + 1');
    expect(code).toContain('localWf(');
  });
});

// ---------------------------------------------------------------------------
// 21. WORKFLOW variant in branching node context (vs IMPORTED_WORKFLOW)
// ---------------------------------------------------------------------------
describe('Unified Generator - WORKFLOW variant branching', () => {
  it('generates params wrapping for branching WORKFLOW variant node', () => {
    const wfBranch = makeNodeType('localBranchWf', {
      variant: 'WORKFLOW',
      inputs: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'NUMBER' },
      },
    });
    const handler = makeSimpleNodeType('after');

    const workflow = makeWorkflow(
      [wfBranch, handler],
      [
        { type: 'NodeInstance', id: 'lbw', nodeType: 'localBranchWf' },
        { type: 'NodeInstance', id: 'aft', nodeType: 'after' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'lbw', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'lbw', port: 'input' } },
        { type: 'Connection', from: { node: 'lbw', port: 'onSuccess' }, to: { node: 'aft', port: 'execute' } },
        { type: 'Connection', from: { node: 'lbw', port: 'result' }, to: { node: 'aft', port: 'value' } },
        { type: 'Connection', from: { node: 'aft', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('__rd__: __rd__ + 1');
    expect(code).toContain('Params__');
    expect(code).toContain('_success');
  });
});
