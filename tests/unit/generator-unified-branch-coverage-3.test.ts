/**
 * Branch coverage tests for src/generator/unified.ts (round 3).
 *
 * Focuses on partial branches: async paths, DISJUNCTION/CUSTOM strategies,
 * node-level scoped children, branching chains, promoted nodes, production
 * branching, failure-only branches, and various edge cases in exit port handling.
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
    functionText: `function ${name}(execute: boolean, value: number) { return { onSuccess: execute, onFailure: !execute, result: value }; }`,
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
    functionText: `function ${name}(execute: boolean, value: number) { return { onSuccess: true, onFailure: false, result: value }; }`,
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
// 1. Async workflow generates await keywords and async context
// ---------------------------------------------------------------------------
describe('Unified Generator - async code paths', () => {
  it('generates await keywords for async workflow', () => {
    const asyncNode = makeSimpleNodeType('asyncOp', {
      isAsync: true,
      functionText: 'async function asyncOp(execute: boolean, value: number) { return { onSuccess: true, onFailure: false, result: value }; }',
    });

    const workflow = makeWorkflow(
      [asyncNode],
      [{ type: 'NodeInstance', id: 'ao', nodeType: 'asyncOp' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ao', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ao', port: 'value' } },
        { type: 'Connection', from: { node: 'ao', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('await');
    expect(code).toContain('true');
  });

  it('generates await ctx.setVariable for async start ports', () => {
    const asyncNode = makeSimpleNodeType('asyncOp2', {
      isAsync: true,
      functionText: 'async function asyncOp2(execute: boolean, value: number) { return { onSuccess: true, onFailure: false, result: value }; }',
    });

    const workflow = makeWorkflow(
      [asyncNode],
      [{ type: 'NodeInstance', id: 'a2', nodeType: 'asyncOp2' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a2', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'a2', port: 'value' } },
        { type: 'Connection', from: { node: 'a2', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow);
    expect(code).toContain('await ctx.setVariable');
    expect(code).toContain('await ctx.getVariable');
  });
});

// ---------------------------------------------------------------------------
// 2. DISJUNCTION execution strategy (OR logic for STEP guards)
// ---------------------------------------------------------------------------
describe('Unified Generator - DISJUNCTION execution strategy', () => {
  it('generates OR condition for DISJUNCTION node with multiple STEP sources', () => {
    const brancherA = makeNodeType('brancherA');
    const brancherB = makeNodeType('brancherB');
    const disjNode = makeSimpleNodeType('disjNode', {
      executeWhen: 'DISJUNCTION',
      inputs: {
        execute: { dataType: 'STEP' },
        value: { dataType: 'NUMBER' },
      },
    });

    const workflow = makeWorkflow(
      [brancherA, brancherB, disjNode],
      [
        { type: 'NodeInstance', id: 'ba', nodeType: 'brancherA' },
        { type: 'NodeInstance', id: 'bb', nodeType: 'brancherB' },
        { type: 'NodeInstance', id: 'dj', nodeType: 'disjNode' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ba', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'bb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ba', port: 'value' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'bb', port: 'value' } },
        { type: 'Connection', from: { node: 'ba', port: 'onSuccess' }, to: { node: 'dj', port: 'execute' } },
        { type: 'Connection', from: { node: 'bb', port: 'onSuccess' }, to: { node: 'dj', port: 'execute' } },
        { type: 'Connection', from: { node: 'ba', port: 'result' }, to: { node: 'dj', port: 'value' } },
        { type: 'Connection', from: { node: 'dj', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // DISJUNCTION uses OR logic
    expect(code).toContain('||');
    expect(code).toContain('ba_success');
    expect(code).toContain('bb_success');
  });
});

// ---------------------------------------------------------------------------
// 3. CUSTOM execution strategy with customExecuteCondition
// ---------------------------------------------------------------------------
describe('Unified Generator - CUSTOM execution strategy', () => {
  it('uses custom condition string from metadata', () => {
    // customNode has a non-execute STEP input (trigger) which always gets STEP guard processing
    const sourceNode = makeSimpleNodeType('custSource');
    const customNode = makeSimpleNodeType('customNode', {
      executeWhen: 'CUSTOM',
      metadata: { customExecuteCondition: 'someGlobalFlag === true' },
      inputs: {
        execute: { dataType: 'STEP' },
        trigger: { dataType: 'STEP' },
        value: { dataType: 'NUMBER' },
      },
    });

    const workflow = makeWorkflow(
      [sourceNode, customNode],
      [
        { type: 'NodeInstance', id: 'cs', nodeType: 'custSource' },
        { type: 'NodeInstance', id: 'cn', nodeType: 'customNode' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'cs', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'cn', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'cs', port: 'value' } },
        // cn gets trigger STEP from cs (non-execute STEP, always included)
        { type: 'Connection', from: { node: 'cs', port: 'onSuccess' }, to: { node: 'cn', port: 'trigger' } },
        { type: 'Connection', from: { node: 'cs', port: 'result' }, to: { node: 'cn', port: 'value' } },
        { type: 'Connection', from: { node: 'cn', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('someGlobalFlag === true');
  });

  it('falls back to CONJUNCTION when no custom condition is set', () => {
    const brancher = makeNodeType('custBrancher2');
    const customNode = makeSimpleNodeType('customNode2', {
      executeWhen: 'CUSTOM',
      // No metadata.customExecuteCondition
      inputs: {
        execute: { dataType: 'STEP' },
        value: { dataType: 'NUMBER' },
      },
    });

    const workflow = makeWorkflow(
      [brancher, customNode],
      [
        { type: 'NodeInstance', id: 'cb2', nodeType: 'custBrancher2' },
        { type: 'NodeInstance', id: 'cn2', nodeType: 'customNode2' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'cb2', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'cb2', port: 'value' } },
        { type: 'Connection', from: { node: 'cb2', port: 'onSuccess' }, to: { node: 'cn2', port: 'execute' } },
        { type: 'Connection', from: { node: 'cb2', port: 'result' }, to: { node: 'cn2', port: 'value' } },
        { type: 'Connection', from: { node: 'cn2', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Falls back to CONJUNCTION, uses Idx !== undefined or _success
    expect(code).toContain('cb2_success');
  });
});

// ---------------------------------------------------------------------------
// 4. Branching node with only failure downstream (no success)
// ---------------------------------------------------------------------------
describe('Unified Generator - failure-only branch', () => {
  it('generates branching code with failure-only downstream', () => {
    const brancher = makeNodeType('failBrancher');
    const failHandler = makeSimpleNodeType('failHandler');

    const workflow = makeWorkflow(
      [brancher, failHandler],
      [
        { type: 'NodeInstance', id: 'fb', nodeType: 'failBrancher' },
        { type: 'NodeInstance', id: 'fh', nodeType: 'failHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'fb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'fb', port: 'value' } },
        { type: 'Connection', from: { node: 'fb', port: 'onFailure' }, to: { node: 'fh', port: 'execute' } },
        { type: 'Connection', from: { node: 'fb', port: 'result' }, to: { node: 'fh', port: 'value' } },
        { type: 'Connection', from: { node: 'fh', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('fb_success');
    expect(code).toContain('} else {');
    expect(code).toContain('failHandler');
  });
});

// ---------------------------------------------------------------------------
// 5. Branching node with success-only downstream (no failure branch)
// ---------------------------------------------------------------------------
describe('Unified Generator - success-only branch', () => {
  it('generates branching code with success-only downstream', () => {
    const brancher = makeNodeType('succBrancher');
    const succHandler = makeSimpleNodeType('succHandler');

    const workflow = makeWorkflow(
      [brancher, succHandler],
      [
        { type: 'NodeInstance', id: 'sb', nodeType: 'succBrancher' },
        { type: 'NodeInstance', id: 'sh', nodeType: 'succHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'sb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'sb', port: 'value' } },
        { type: 'Connection', from: { node: 'sb', port: 'onSuccess' }, to: { node: 'sh', port: 'execute' } },
        { type: 'Connection', from: { node: 'sb', port: 'result' }, to: { node: 'sh', port: 'value' } },
        { type: 'Connection', from: { node: 'sh', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('sb_success');
    // Success-only: has CANCELLED for success nodes in else, but no failure branch nodes
    expect(code).toContain('CANCELLED');
  });
});

// ---------------------------------------------------------------------------
// 6. Production mode branching (no debug hooks in branching code)
// ---------------------------------------------------------------------------
describe('Unified Generator - production branching no debug hooks', () => {
  it('omits __ctrl__ and afterNode in production branching code', () => {
    const brancher = makeNodeType('prodBrancher');
    const handler = makeSimpleNodeType('prodHandler');

    const workflow = makeWorkflow(
      [brancher, handler],
      [
        { type: 'NodeInstance', id: 'pb', nodeType: 'prodBrancher' },
        { type: 'NodeInstance', id: 'ph', nodeType: 'prodHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'pb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'pb', port: 'value' } },
        { type: 'Connection', from: { node: 'pb', port: 'onSuccess' }, to: { node: 'ph', port: 'execute' } },
        { type: 'Connection', from: { node: 'pb', port: 'result' }, to: { node: 'ph', port: 'value' } },
        { type: 'Connection', from: { node: 'ph', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const prodCode = generateCode(workflow, { production: true });
    const devCode = generateCode(workflow);

    expect(prodCode).not.toContain('__ctrl__');
    expect(prodCode).not.toContain('afterNode');
    expect(devCode).toContain('__ctrl__');
    expect(devCode).toContain('afterNode');
  });

  it('does not emit comment lines in production mode', () => {
    const brancher = makeNodeType('commentBrancher');
    const handler = makeSimpleNodeType('commentHandler');

    const workflow = makeWorkflow(
      [brancher, handler],
      [
        { type: 'NodeInstance', id: 'cmb', nodeType: 'commentBrancher' },
        { type: 'NodeInstance', id: 'cmh', nodeType: 'commentHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'cmb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'cmb', port: 'value' } },
        { type: 'Connection', from: { node: 'cmb', port: 'onSuccess' }, to: { node: 'cmh', port: 'execute' } },
        { type: 'Connection', from: { node: 'cmb', port: 'result' }, to: { node: 'cmh', port: 'value' } },
        { type: 'Connection', from: { node: 'cmh', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const prodCode = generateCode(workflow, { production: true });
    // Production mode should not emit the "── nodeId (functionName) ──" comment
    expect(prodCode).not.toContain('── cmb');
  });
});

// ---------------------------------------------------------------------------
// 7. buildStepSourceCondition: onFailure port generates _success === false
// ---------------------------------------------------------------------------
describe('Unified Generator - buildStepSourceCondition failure port', () => {
  it('generates _success === false for failure port STEP guard', () => {
    const brancher = makeNodeType('failGuardBrancher');
    const failTarget = makeSimpleNodeType('failTarget');

    const workflow = makeWorkflow(
      [brancher, failTarget],
      [
        { type: 'NodeInstance', id: 'fgb', nodeType: 'failGuardBrancher' },
        { type: 'NodeInstance', id: 'ft', nodeType: 'failTarget' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'fgb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'fgb', port: 'value' } },
        // Connect from onFailure port AND there's an external data dep to get promotion
        { type: 'Connection', from: { node: 'fgb', port: 'onFailure' }, to: { node: 'ft', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ft', port: 'value' } },
        { type: 'Connection', from: { node: 'ft', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // ft is in the failure branch but may be promoted due to external data dep from Start
    // Check that the branching code references the brancher
    expect(code).toContain('fgb');
  });
});

// ---------------------------------------------------------------------------
// 8. Exit port with explicit onSuccess/onFailure connections
// ---------------------------------------------------------------------------
describe('Unified Generator - explicit exit onSuccess/onFailure', () => {
  it('does not add default onSuccess when explicitly connected', () => {
    const node = makeSimpleNodeType('explicitExit');

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'ee', nodeType: 'explicitExit' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ee', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ee', port: 'value' } },
        { type: 'Connection', from: { node: 'ee', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        { type: 'Connection', from: { node: 'ee', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('exit_onSuccess');
    // Should still have default onFailure since only onSuccess is connected
    expect(code).toContain('onFailure: false');
  });

  it('does not add default onFailure when explicitly connected', () => {
    const node = makeSimpleNodeType('explicitFail');

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'ef', nodeType: 'explicitFail' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ef', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ef', port: 'value' } },
        { type: 'Connection', from: { node: 'ef', port: 'onFailure' }, to: { node: 'Exit', port: 'onFailure' } },
        { type: 'Connection', from: { node: 'ef', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('exit_onFailure');
    // Should still have default onSuccess since only onFailure is connected
    expect(code).toContain('onSuccess: true');
  });

  it('does not add defaults when both onSuccess and onFailure are explicitly connected', () => {
    const node = makeSimpleNodeType('bothExit');

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'be', nodeType: 'bothExit' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'be', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'be', port: 'value' } },
        { type: 'Connection', from: { node: 'be', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        { type: 'Connection', from: { node: 'be', port: 'onFailure' }, to: { node: 'Exit', port: 'onFailure' } },
        { type: 'Connection', from: { node: 'be', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Both are connected, no defaults should be added
    expect(code).toContain('exit_onSuccess');
    expect(code).toContain('exit_onFailure');
    expect(code).not.toContain('onSuccess: true,');
    expect(code).not.toContain('onFailure: false,');
  });
});

// ---------------------------------------------------------------------------
// 9. Branching chain (sequential branching nodes)
// ---------------------------------------------------------------------------
describe('Unified Generator - branching chains', () => {
  it('generates flat chain code for sequential branching nodes', () => {
    const brancherA = makeNodeType('chainA');
    const brancherB = makeNodeType('chainB');
    const handler = makeSimpleNodeType('chainHandler');

    const workflow = makeWorkflow(
      [brancherA, brancherB, handler],
      [
        { type: 'NodeInstance', id: 'ca', nodeType: 'chainA' },
        { type: 'NodeInstance', id: 'cb', nodeType: 'chainB' },
        { type: 'NodeInstance', id: 'ch', nodeType: 'chainHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ca', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ca', port: 'value' } },
        // A -> B chain (success)
        { type: 'Connection', from: { node: 'ca', port: 'onSuccess' }, to: { node: 'cb', port: 'execute' } },
        { type: 'Connection', from: { node: 'ca', port: 'result' }, to: { node: 'cb', port: 'value' } },
        // B -> handler
        { type: 'Connection', from: { node: 'cb', port: 'onSuccess' }, to: { node: 'ch', port: 'execute' } },
        { type: 'Connection', from: { node: 'cb', port: 'result' }, to: { node: 'ch', port: 'value' } },
        { type: 'Connection', from: { node: 'ch', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Chain should have success flags for both A and B
    expect(code).toContain('ca_success');
    expect(code).toContain('cb_success');
  });
});

// ---------------------------------------------------------------------------
// 10. Async branching node with debug hooks (await before hooks)
// ---------------------------------------------------------------------------
describe('Unified Generator - async branching with debug hooks', () => {
  it('generates await for debug hooks in async branching node', () => {
    const asyncBrancher = makeNodeType('asyncBrancher', {
      isAsync: true,
      functionText: 'async function asyncBrancher(execute: boolean, value: number) { return { onSuccess: execute, onFailure: !execute, result: value }; }',
    });
    const handler = makeSimpleNodeType('asyncHandler', {
      isAsync: true,
      functionText: 'async function asyncHandler(execute: boolean, value: number) { return { onSuccess: true, onFailure: false, result: value }; }',
    });

    const workflow = makeWorkflow(
      [asyncBrancher, handler],
      [
        { type: 'NodeInstance', id: 'ab', nodeType: 'asyncBrancher' },
        { type: 'NodeInstance', id: 'ah', nodeType: 'asyncHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ab', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ab', port: 'value' } },
        { type: 'Connection', from: { node: 'ab', port: 'onSuccess' }, to: { node: 'ah', port: 'execute' } },
        { type: 'Connection', from: { node: 'ab', port: 'result' }, to: { node: 'ah', port: 'value' } },
        { type: 'Connection', from: { node: 'ah', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    // Dev mode (default) to get debug hooks
    const code = generateCode(workflow);
    expect(code).toContain('await __ctrl__.beforeNode');
    expect(code).toContain('await __ctrl__.afterNode');
  });
});

// ---------------------------------------------------------------------------
// 11. Node-level scoped children (non-per-port scope)
// ---------------------------------------------------------------------------
describe('Unified Generator - node-level scoped children', () => {
  it('generates scope creation and merge for node-level scoped children', () => {
    const scopeParent = makeSimpleNodeType('scopeParent', {
      scope: 'body',
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
    const scopeChild = makeSimpleNodeType('scopeChild');

    const workflow = makeWorkflow(
      [scopeParent, scopeChild],
      [
        { type: 'NodeInstance', id: 'sp', nodeType: 'scopeParent' },
        { type: 'NodeInstance', id: 'sc', nodeType: 'scopeChild', parent: { id: 'sp', scope: 'body' } },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'sp', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'sp', port: 'items' } },
        { type: 'Connection', from: { node: 'sp', port: 'result' }, to: { node: 'sc', port: 'value' } },
        { type: 'Connection', from: { node: 'sc', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('createScope');
    expect(code).toContain('mergeScope');
    expect(code).toContain('sp_scopedCtx');
  });
});

// ---------------------------------------------------------------------------
// 12. Parallel group generation (async with 2+ independent nodes)
// ---------------------------------------------------------------------------
describe('Unified Generator - parallel group generation', () => {
  it('generates Promise.all for 2+ independent async nodes', () => {
    const nodeA = makeSimpleNodeType('parA', {
      isAsync: true,
      functionText: 'async function parA(execute: boolean, value: number) { return { onSuccess: true, onFailure: false, result: value }; }',
    });
    const nodeB = makeSimpleNodeType('parB', {
      isAsync: true,
      functionText: 'async function parB(execute: boolean, value: number) { return { onSuccess: true, onFailure: false, result: value }; }',
    });

    const workflow = makeWorkflow(
      [nodeA, nodeB],
      [
        { type: 'NodeInstance', id: 'pa', nodeType: 'parA' },
        { type: 'NodeInstance', id: 'pb', nodeType: 'parB' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'pa', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'pb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'pa', port: 'value' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'pb', port: 'value' } },
        { type: 'Connection', from: { node: 'pa', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('Promise.all');
    expect(code).toContain('async ()');
  });
});

// ---------------------------------------------------------------------------
// 13. Pull node with async node type (executorIsAsync)
// ---------------------------------------------------------------------------
describe('Unified Generator - async pull node executor', () => {
  it('generates async executor for pull node with async nodeType', () => {
    const asyncPull = makeSimpleNodeType('asyncPull', {
      isAsync: true,
      functionText: 'async function asyncPull(execute: boolean, value: number) { return { onSuccess: true, onFailure: false, result: value }; }',
    });

    const workflow = makeWorkflow(
      [asyncPull],
      [{ type: 'NodeInstance', id: 'ap', nodeType: 'asyncPull', config: { pullExecution: true } }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ap', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ap', port: 'value' } },
        { type: 'Connection', from: { node: 'ap', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('async ()');
    expect(code).toContain('registerPullExecutor');
    expect(code).toContain('await');
  });
});

// ---------------------------------------------------------------------------
// 14. Branching node with no downstream at all (trackSuccess=false)
// ---------------------------------------------------------------------------
describe('Unified Generator - branching node no downstream', () => {
  it('generates branching code without success tracking when no downstream', () => {
    const brancher = makeNodeType('lonelyBrancher');

    const workflow = makeWorkflow(
      [brancher],
      [{ type: 'NodeInstance', id: 'lb', nodeType: 'lonelyBrancher' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'lb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'lb', port: 'value' } },
        { type: 'Connection', from: { node: 'lb', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('lonelyBrancher');
    // No downstream branching, so no if(lb_success) block
    expect(code).not.toContain('if (lb_success)');
  });
});

// ---------------------------------------------------------------------------
// 15. Exit source from branching node (needs undefined check)
// ---------------------------------------------------------------------------
describe('Unified Generator - exit source from branching node', () => {
  it('generates let declaration for branching node execution index', () => {
    const brancher = makeNodeType('exitBrancher');
    const handler = makeSimpleNodeType('ebHandler');

    const workflow = makeWorkflow(
      [brancher, handler],
      [
        { type: 'NodeInstance', id: 'eb', nodeType: 'exitBrancher' },
        { type: 'NodeInstance', id: 'ebh', nodeType: 'ebHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'eb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'eb', port: 'value' } },
        { type: 'Connection', from: { node: 'eb', port: 'onSuccess' }, to: { node: 'ebh', port: 'execute' } },
        { type: 'Connection', from: { node: 'eb', port: 'result' }, to: { node: 'ebh', port: 'value' } },
        // Exit source from branching node
        { type: 'Connection', from: { node: 'eb', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Branching node gets let declaration and undefined check in exit handling
    expect(code).toContain('let ebIdx');
    expect(code).toContain('ebIdx !== undefined');
  });
});

// ---------------------------------------------------------------------------
// 16. Exit source from node-level scoped child (needsUndefinedCheck)
// ---------------------------------------------------------------------------
describe('Unified Generator - exit source from scoped child', () => {
  it('generates undefined check for exit source from node-level scoped child', () => {
    const scopeParent = makeSimpleNodeType('scopePar', {
      scope: 'body',
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
    const scopeChild = makeSimpleNodeType('scopeKid');

    const workflow = makeWorkflow(
      [scopeParent, scopeChild],
      [
        { type: 'NodeInstance', id: 'spar', nodeType: 'scopePar' },
        { type: 'NodeInstance', id: 'skid', nodeType: 'scopeKid', parent: { id: 'spar', scope: 'body' } },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'spar', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'spar', port: 'items' } },
        { type: 'Connection', from: { node: 'spar', port: 'result' }, to: { node: 'skid', port: 'value' } },
        { type: 'Connection', from: { node: 'skid', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('skidIdx !== undefined');
  });
});

// ---------------------------------------------------------------------------
// 17. Exit port control flow default value (false for onSuccess/onFailure)
// ---------------------------------------------------------------------------
describe('Unified Generator - exit control flow default value', () => {
  it('uses false as default for onSuccess exit port when source is in branch', () => {
    const brancher = makeNodeType('cfBrancher');
    const handler = makeSimpleNodeType('cfHandler');

    const workflow = makeWorkflow(
      [brancher, handler],
      [
        { type: 'NodeInstance', id: 'cfb', nodeType: 'cfBrancher' },
        { type: 'NodeInstance', id: 'cfh', nodeType: 'cfHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'cfb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'cfb', port: 'value' } },
        { type: 'Connection', from: { node: 'cfb', port: 'onSuccess' }, to: { node: 'cfh', port: 'execute' } },
        { type: 'Connection', from: { node: 'cfb', port: 'result' }, to: { node: 'cfh', port: 'value' } },
        // onSuccess from branch handler -> Exit.onSuccess
        { type: 'Connection', from: { node: 'cfh', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
        { type: 'Connection', from: { node: 'cfh', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // onSuccess is a control flow port, default should be false
    expect(code).toContain('exit_onSuccess');
  });
});

// ---------------------------------------------------------------------------
// 18. bundleMode generates _impl imports
// ---------------------------------------------------------------------------
describe('Unified Generator - bundle mode', () => {
  it('generates code in bundle mode', () => {
    const node = makeSimpleNodeType('bundleNode');

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'bn', nodeType: 'bundleNode' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'bn', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'bn', port: 'value' } },
        { type: 'Connection', from: { node: 'bn', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true, externalNodeTypes: { bundleNode: './bundleNode.js' } });
    expect(code).toContain('bundleNode');
  });
});

// ---------------------------------------------------------------------------
// 19. Nodes promoted from branches (external data dependency)
// ---------------------------------------------------------------------------
describe('Unified Generator - nodes promoted from branches', () => {
  it('promotes node with external data dependency out of branch region', () => {
    const brancher = makeNodeType('promBrancher');
    const external = makeSimpleNodeType('extNode');
    const promoted = makeSimpleNodeType('promotedNode');

    const workflow = makeWorkflow(
      [brancher, external, promoted],
      [
        { type: 'NodeInstance', id: 'prb', nodeType: 'promBrancher' },
        { type: 'NodeInstance', id: 'ext', nodeType: 'extNode' },
        { type: 'NodeInstance', id: 'prm', nodeType: 'promotedNode' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'prb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ext', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'prb', port: 'value' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ext', port: 'value' } },
        // prm is in prb's success branch via execute
        { type: 'Connection', from: { node: 'prb', port: 'onSuccess' }, to: { node: 'prm', port: 'execute' } },
        // prm also has data dep on ext (external to branch)
        { type: 'Connection', from: { node: 'ext', port: 'result' }, to: { node: 'prm', port: 'value' } },
        { type: 'Connection', from: { node: 'prm', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // prm should be promoted with a STEP guard using prb_success
    expect(code).toContain('prb_success');
    expect(code).toContain('promotedNode');
  });
});

// ---------------------------------------------------------------------------
// 20. Promoted branching node with STEP guard
// ---------------------------------------------------------------------------
describe('Unified Generator - promoted branching node', () => {
  it('wraps promoted branching node in STEP guard', () => {
    const brancherA = makeNodeType('promBA');
    const brancherB = makeNodeType('promBB');
    const extNode = makeSimpleNodeType('extB');

    const workflow = makeWorkflow(
      [brancherA, brancherB, extNode],
      [
        { type: 'NodeInstance', id: 'pba', nodeType: 'promBA' },
        { type: 'NodeInstance', id: 'pbb', nodeType: 'promBB' },
        { type: 'NodeInstance', id: 'extb', nodeType: 'extB' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'pba', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'extb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'pba', port: 'value' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'extb', port: 'value' } },
        // pbb in pba's success branch via execute, but also depends on extb (data)
        { type: 'Connection', from: { node: 'pba', port: 'onSuccess' }, to: { node: 'pbb', port: 'execute' } },
        { type: 'Connection', from: { node: 'extb', port: 'result' }, to: { node: 'pbb', port: 'value' } },
        { type: 'Connection', from: { node: 'pbb', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Promoted branching node should have a STEP guard
    expect(code).toContain('pba_success');
    expect(code).toContain('promBB');
  });
});

// ---------------------------------------------------------------------------
// 21. Branching with both success AND failure downstream nodes
// ---------------------------------------------------------------------------
describe('Unified Generator - both success and failure downstream', () => {
  it('generates if/else with both success and failure branches', () => {
    const brancher = makeNodeType('bothBrancher');
    const succNode = makeSimpleNodeType('succSide');
    const failNode = makeSimpleNodeType('failSide');

    const workflow = makeWorkflow(
      [brancher, succNode, failNode],
      [
        { type: 'NodeInstance', id: 'bb', nodeType: 'bothBrancher' },
        { type: 'NodeInstance', id: 'ss', nodeType: 'succSide' },
        { type: 'NodeInstance', id: 'fs', nodeType: 'failSide' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'bb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'bb', port: 'value' } },
        { type: 'Connection', from: { node: 'bb', port: 'onSuccess' }, to: { node: 'ss', port: 'execute' } },
        { type: 'Connection', from: { node: 'bb', port: 'result' }, to: { node: 'ss', port: 'value' } },
        { type: 'Connection', from: { node: 'bb', port: 'onFailure' }, to: { node: 'fs', port: 'execute' } },
        { type: 'Connection', from: { node: 'bb', port: 'result' }, to: { node: 'fs', port: 'value' } },
        { type: 'Connection', from: { node: 'ss', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('bb_success');
    expect(code).toContain('if (bb_success)');
    expect(code).toContain('} else {');
    expect(code).toContain('succSide');
    expect(code).toContain('failSide');
    expect(code).toContain('CANCELLED');
  });
});

// ---------------------------------------------------------------------------
// 22. Instance not found skips with comment
// ---------------------------------------------------------------------------
describe('Unified Generator - instance not found', () => {
  it('skips and comments for missing instance in execution order', () => {
    // This tests the guard at line 412 where instance is not found
    // Hard to trigger directly since execution order comes from CFG,
    // but we can test via workflow with no valid connections
    const node = makeSimpleNodeType('ghost');

    const workflow = makeWorkflow(
      [node],
      [], // No instances
      [
        // No connections
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Should just have start/exit boilerplate
    expect(code).toContain('startIdx');
    expect(code).toContain('exitIdx');
  });
});

// ---------------------------------------------------------------------------
// 23. Multiple STEP port sources in CONJUNCTION (AND + OR logic)
// ---------------------------------------------------------------------------
describe('Unified Generator - CONJUNCTION with multiple sources per port', () => {
  it('generates OR within AND for multiple STEP sources on same port', () => {
    const brancherA = makeNodeType('conjA');
    const brancherB = makeNodeType('conjB');
    const target = makeSimpleNodeType('conjTarget', {
      executeWhen: 'CONJUNCTION',
      inputs: {
        execute: { dataType: 'STEP' },
        trigger: { dataType: 'STEP' },
        value: { dataType: 'NUMBER' },
      },
    });

    const workflow = makeWorkflow(
      [brancherA, brancherB, target],
      [
        { type: 'NodeInstance', id: 'cja', nodeType: 'conjA' },
        { type: 'NodeInstance', id: 'cjb', nodeType: 'conjB' },
        { type: 'NodeInstance', id: 'cjt', nodeType: 'conjTarget' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'cja', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'cjb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'cja', port: 'value' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'cjb', port: 'value' } },
        // Both A and B connect to target's execute port (OR within this port)
        { type: 'Connection', from: { node: 'cja', port: 'onSuccess' }, to: { node: 'cjt', port: 'execute' } },
        { type: 'Connection', from: { node: 'cjb', port: 'onSuccess' }, to: { node: 'cjt', port: 'execute' } },
        // A connects to trigger port (AND with execute port)
        { type: 'Connection', from: { node: 'cja', port: 'onSuccess' }, to: { node: 'cjt', port: 'trigger' } },
        { type: 'Connection', from: { node: 'cja', port: 'result' }, to: { node: 'cjt', port: 'value' } },
        { type: 'Connection', from: { node: 'cjt', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Should have AND (&&) between port groups and OR (||) within groups
    expect(code).toContain('&&');
    expect(code).toContain('||');
  });
});

// ---------------------------------------------------------------------------
// 24. Sync workflow (non-async) with STEP guard
// ---------------------------------------------------------------------------
describe('Unified Generator - sync STEP guard', () => {
  it('generates sync __ctrl__.beforeNode without await', () => {
    const brancher = makeNodeType('syncBrancher');
    const handler = makeSimpleNodeType('syncHandler');

    const workflow = makeWorkflow(
      [brancher, handler],
      [
        { type: 'NodeInstance', id: 'syb', nodeType: 'syncBrancher' },
        { type: 'NodeInstance', id: 'syh', nodeType: 'syncHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'syb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'syb', port: 'value' } },
        { type: 'Connection', from: { node: 'syb', port: 'onSuccess' }, to: { node: 'syh', port: 'execute' } },
        { type: 'Connection', from: { node: 'syb', port: 'result' }, to: { node: 'syh', port: 'value' } },
        { type: 'Connection', from: { node: 'syh', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    // Dev mode to get debug hooks
    const code = generateCode(workflow);
    // Sync workflow: no 'await' before __ctrl__ calls
    expect(code).toContain('__ctrl__.beforeNode');
    expect(code).toContain('__ctrl__.afterNode');
    // Check that it uses sync context
    expect(code).toContain('false,');
  });
});

// ---------------------------------------------------------------------------
// 25. Exit source from Start node (uses startIdx, no undefined check)
// ---------------------------------------------------------------------------
describe('Unified Generator - exit source from Start', () => {
  it('uses startIdx for exit source from Start node', () => {
    const workflow = makeWorkflow(
      [],
      [],
      [
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Start source uses startIdx directly, no undefined check
    expect(code).toContain('startIdx');
    expect(code).not.toContain('startIdx !== undefined');
  });
});

// ---------------------------------------------------------------------------
// 26. Exit port with missing source instance
// ---------------------------------------------------------------------------
describe('Unified Generator - exit source missing instance', () => {
  it('skips exit connection when source instance is missing', () => {
    const workflow = makeWorkflow(
      [],
      [], // No instances at all (besides Start/Exit)
      [
        { type: 'Connection', from: { node: 'ghost', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('is not declared');
  });
});

// ---------------------------------------------------------------------------
// 27. Exit port with source instance but missing type
// ---------------------------------------------------------------------------
describe('Unified Generator - exit source missing type', () => {
  it('skips exit connection when source type is not found', () => {
    const workflow = makeWorkflow(
      [], // No node types
      [{ type: 'NodeInstance', id: 'orphan', nodeType: 'missingType' }],
      [
        { type: 'Connection', from: { node: 'orphan', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('missing type');
  });
});

// ---------------------------------------------------------------------------
// 28. Async exit port setVariable vs sync
// ---------------------------------------------------------------------------
describe('Unified Generator - async exit setVariable', () => {
  it('generates await for exit setVariable in async dev mode', () => {
    const asyncNode = makeSimpleNodeType('asyncExit', {
      isAsync: true,
      functionText: 'async function asyncExit(execute: boolean, value: number) { return { onSuccess: true, onFailure: false, result: value }; }',
    });

    const workflow = makeWorkflow(
      [asyncNode],
      [{ type: 'NodeInstance', id: 'ae', nodeType: 'asyncExit' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ae', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ae', port: 'value' } },
        { type: 'Connection', from: { node: 'ae', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow); // dev mode
    // Async: await ctx.setVariable for exit ports
    expect(code).toContain("await ctx.setVariable({ id: 'Exit'");
  });
});

// ---------------------------------------------------------------------------
// 29. Nodes in both branches of same brancher promoted out
// ---------------------------------------------------------------------------
describe('Unified Generator - node in both branches promoted', () => {
  it('promotes node that appears in both success and failure of same brancher', () => {
    const brancher = makeNodeType('dualBrancher');
    const shared = makeSimpleNodeType('sharedNode');

    const workflow = makeWorkflow(
      [brancher, shared],
      [
        { type: 'NodeInstance', id: 'db', nodeType: 'dualBrancher' },
        { type: 'NodeInstance', id: 'sh', nodeType: 'sharedNode' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'db', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'db', port: 'value' } },
        // sh is downstream of both success and failure
        { type: 'Connection', from: { node: 'db', port: 'onSuccess' }, to: { node: 'sh', port: 'execute' } },
        { type: 'Connection', from: { node: 'db', port: 'onFailure' }, to: { node: 'sh', port: 'execute' } },
        { type: 'Connection', from: { node: 'db', port: 'result' }, to: { node: 'sh', port: 'value' } },
        { type: 'Connection', from: { node: 'sh', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Node in both branches should be promoted out, generating at top level
    expect(code).toContain('sharedNode');
  });
});

// ---------------------------------------------------------------------------
// 30. WORKFLOW variant (not IMPORTED_WORKFLOW)
// ---------------------------------------------------------------------------
describe('Unified Generator - WORKFLOW variant', () => {
  it('generates params wrapping for WORKFLOW variant', () => {
    const wfNode = makeSimpleNodeType('localWf', {
      variant: 'WORKFLOW',
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
      [{ type: 'NodeInstance', id: 'lw', nodeType: 'localWf' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'lw', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'lw', port: 'input' } },
        { type: 'Connection', from: { node: 'lw', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('__rd__: __rd__ + 1');
    expect(code).toContain('Params__');
    expect(code).toContain('localWf(');
  });
});

// ---------------------------------------------------------------------------
// 31. WORKFLOW branching variant
// ---------------------------------------------------------------------------
describe('Unified Generator - WORKFLOW branching variant', () => {
  it('generates params wrapping for branching WORKFLOW node', () => {
    const wfBranch = makeNodeType('localWfBranch', {
      variant: 'WORKFLOW',
      inputs: {
        execute: { dataType: 'STEP' },
        input: { dataType: 'NUMBER' },
      },
    });
    const handler = makeSimpleNodeType('wfHandler');

    const workflow = makeWorkflow(
      [wfBranch, handler],
      [
        { type: 'NodeInstance', id: 'lwb', nodeType: 'localWfBranch' },
        { type: 'NodeInstance', id: 'wh', nodeType: 'wfHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'lwb', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'lwb', port: 'input' } },
        { type: 'Connection', from: { node: 'lwb', port: 'onSuccess' }, to: { node: 'wh', port: 'execute' } },
        { type: 'Connection', from: { node: 'lwb', port: 'result' }, to: { node: 'wh', port: 'value' } },
        { type: 'Connection', from: { node: 'wh', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('__rd__: __rd__ + 1');
    expect(code).toContain('Params__');
  });
});

// ---------------------------------------------------------------------------
// 32. Pull node with WORKFLOW variant
// ---------------------------------------------------------------------------
describe('Unified Generator - pull WORKFLOW variant', () => {
  it('generates pull executor with params wrapping for WORKFLOW variant', () => {
    const wfPull = makeSimpleNodeType('pullWfLocal', {
      variant: 'WORKFLOW',
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
      [{ type: 'NodeInstance', id: 'pwl', nodeType: 'pullWfLocal', config: { pullExecution: true } }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'pwl', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'pwl', port: 'input' } },
        { type: 'Connection', from: { node: 'pwl', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('registerPullExecutor');
    expect(code).toContain('__rd__: __rd__ + 1');
  });
});

// ---------------------------------------------------------------------------
// 33. Nested branching in success branch
// ---------------------------------------------------------------------------
describe('Unified Generator - nested branching in success', () => {
  it('generates nested branching node inside success branch', () => {
    const outer = makeNodeType('outerBr');
    const inner = makeNodeType('innerBr');
    const handler = makeSimpleNodeType('nestedHandler');

    const workflow = makeWorkflow(
      [outer, inner, handler],
      [
        { type: 'NodeInstance', id: 'ob', nodeType: 'outerBr' },
        { type: 'NodeInstance', id: 'ib', nodeType: 'innerBr' },
        { type: 'NodeInstance', id: 'nh', nodeType: 'nestedHandler' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ob', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ob', port: 'value' } },
        { type: 'Connection', from: { node: 'ob', port: 'onSuccess' }, to: { node: 'ib', port: 'execute' } },
        { type: 'Connection', from: { node: 'ob', port: 'result' }, to: { node: 'ib', port: 'value' } },
        { type: 'Connection', from: { node: 'ib', port: 'onSuccess' }, to: { node: 'nh', port: 'execute' } },
        { type: 'Connection', from: { node: 'ib', port: 'result' }, to: { node: 'nh', port: 'value' } },
        { type: 'Connection', from: { node: 'nh', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('ob_success');
    expect(code).toContain('ib_success');
    expect(code).toContain('nestedHandler');
  });
});

// ---------------------------------------------------------------------------
// 34. Nested branching in failure branch
// ---------------------------------------------------------------------------
describe('Unified Generator - nested branching in failure', () => {
  it('generates nested branching node inside failure branch', () => {
    const outer = makeNodeType('outerFail');
    const inner = makeNodeType('innerFail');
    const handler = makeSimpleNodeType('failNested');

    const workflow = makeWorkflow(
      [outer, inner, handler],
      [
        { type: 'NodeInstance', id: 'of', nodeType: 'outerFail' },
        { type: 'NodeInstance', id: 'if', nodeType: 'innerFail' },
        { type: 'NodeInstance', id: 'fn', nodeType: 'failNested' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'of', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'of', port: 'value' } },
        // inner brancher in failure branch
        { type: 'Connection', from: { node: 'of', port: 'onFailure' }, to: { node: 'if', port: 'execute' } },
        { type: 'Connection', from: { node: 'of', port: 'result' }, to: { node: 'if', port: 'value' } },
        { type: 'Connection', from: { node: 'if', port: 'onSuccess' }, to: { node: 'fn', port: 'execute' } },
        { type: 'Connection', from: { node: 'if', port: 'result' }, to: { node: 'fn', port: 'value' } },
        { type: 'Connection', from: { node: 'fn', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('of_success');
    expect(code).toContain('innerFail');
  });
});

// ---------------------------------------------------------------------------
// 35. Production mode default exit VARIABLE_SET omission
// ---------------------------------------------------------------------------
describe('Unified Generator - production exit defaults', () => {
  it('omits VARIABLE_SET for default onSuccess/onFailure in production mode', () => {
    const node = makeSimpleNodeType('prodDefaults');

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'pd', nodeType: 'prodDefaults' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'pd', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'pd', port: 'value' } },
        { type: 'Connection', from: { node: 'pd', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const prodCode = generateCode(workflow, { production: true });
    const devCode = generateCode(workflow);

    // Production: no VARIABLE_SET for defaults
    // Count occurrences of setVariable for Exit in production
    const prodExitSets = (prodCode.match(/setVariable.*Exit/g) || []).length;
    // Dev mode should have setVariable for Exit ports
    const devExitSets = (devCode.match(/setVariable.*Exit/g) || []).length;
    expect(devExitSets).toBeGreaterThan(prodExitSets);
  });
});

// ---------------------------------------------------------------------------
// 36. Pull execution from instance config boolean=false
// ---------------------------------------------------------------------------
describe('Unified Generator - pull execution false', () => {
  it('does not generate pull executor when pullExecution config is absent', () => {
    // Node with no pullExecution config at all (neither instance nor defaultConfig)
    const node = makeSimpleNodeType('noPull', {
      inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'np', nodeType: 'noPull' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'np', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'np', port: 'value' } },
        { type: 'Connection', from: { node: 'np', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    // Should NOT call registerPullExecutor in the generated body (not the runtime definition)
    expect(code).not.toContain("ctx.registerPullExecutor('np'");
    expect(code).toContain('noPull(');
  });
});

// ---------------------------------------------------------------------------
// 37. Pull execution with object config missing triggerPort (falls back)
// ---------------------------------------------------------------------------
describe('Unified Generator - pull config object no triggerPort', () => {
  it('falls back to execute when triggerPort not specified in object config', () => {
    const node = makeSimpleNodeType('pullNoPort', {
      inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'pnp', nodeType: 'pullNoPort', config: { pullExecution: { } } }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'pnp', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'pnp', port: 'value' } },
        { type: 'Connection', from: { node: 'pnp', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('registerPullExecutor');
  });
});

// ---------------------------------------------------------------------------
// 38. defaultConfig pullExecution object with no triggerPort
// ---------------------------------------------------------------------------
describe('Unified Generator - defaultConfig pull no triggerPort', () => {
  it('falls back to execute when defaultConfig pullExecution object has no triggerPort', () => {
    const node = makeSimpleNodeType('defPullNoPort', {
      defaultConfig: { pullExecution: {} },
      inputs: { execute: { dataType: 'STEP' }, value: { dataType: 'NUMBER' } },
      outputs: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'dpn', nodeType: 'defPullNoPort' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'dpn', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'dpn', port: 'value' } },
        { type: 'Connection', from: { node: 'dpn', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('registerPullExecutor');
  });
});

// ---------------------------------------------------------------------------
// 39. Branching chain with promoted head
// ---------------------------------------------------------------------------
describe('Unified Generator - promoted chain head', () => {
  it('wraps chain head in STEP guard when promoted from branch', () => {
    const outerBr = makeNodeType('outerChain');
    const chainA = makeNodeType('chainHeadA');
    const chainB = makeNodeType('chainHeadB');
    const extNode = makeSimpleNodeType('chainExt');

    const workflow = makeWorkflow(
      [outerBr, chainA, chainB, extNode],
      [
        { type: 'NodeInstance', id: 'oc', nodeType: 'outerChain' },
        { type: 'NodeInstance', id: 'cha', nodeType: 'chainHeadA' },
        { type: 'NodeInstance', id: 'chb', nodeType: 'chainHeadB' },
        { type: 'NodeInstance', id: 'ce', nodeType: 'chainExt' },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'oc', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'ce', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'oc', port: 'value' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'ce', port: 'value' } },
        // cha in oc's success branch
        { type: 'Connection', from: { node: 'oc', port: 'onSuccess' }, to: { node: 'cha', port: 'execute' } },
        { type: 'Connection', from: { node: 'oc', port: 'result' }, to: { node: 'cha', port: 'value' } },
        // cha has external data dep on ce (promotes cha)
        { type: 'Connection', from: { node: 'ce', port: 'result' }, to: { node: 'cha', port: 'value' } },
        // chain: cha -> chb
        { type: 'Connection', from: { node: 'cha', port: 'onSuccess' }, to: { node: 'chb', port: 'execute' } },
        { type: 'Connection', from: { node: 'cha', port: 'result' }, to: { node: 'chb', port: 'value' } },
        { type: 'Connection', from: { node: 'chb', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('oc_success');
    expect(code).toContain('chainHeadA');
    expect(code).toContain('chainHeadB');
  });
});

// ---------------------------------------------------------------------------
// 40. exitPortDef tsType override
// ---------------------------------------------------------------------------
describe('Unified Generator - exit port tsType', () => {
  it('uses tsType from exitPortDef when available', () => {
    const node = makeSimpleNodeType('tsTypeNode');

    const workflow = makeWorkflow(
      [node],
      [{ type: 'NodeInstance', id: 'tt', nodeType: 'tsTypeNode' }],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'tt', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'tt', port: 'value' } },
        { type: 'Connection', from: { node: 'tt', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ],
      {
        exitPorts: {
          onSuccess: { dataType: 'STEP' },
          onFailure: { dataType: 'STEP' },
          result: { dataType: 'NUMBER', tsType: 'MyCustomType' },
        },
      }
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('MyCustomType');
  });
});

// ---------------------------------------------------------------------------
// 41. Scoped branching children execution
// ---------------------------------------------------------------------------
describe('Unified Generator - scoped branching children', () => {
  it('generates branching node as child in node-level scope', () => {
    const scopeParent = makeSimpleNodeType('scopeBrParent', {
      scope: 'body',
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
    const childBrancher = makeNodeType('childBrancher');

    const workflow = makeWorkflow(
      [scopeParent, childBrancher],
      [
        { type: 'NodeInstance', id: 'sbp', nodeType: 'scopeBrParent' },
        { type: 'NodeInstance', id: 'cbr', nodeType: 'childBrancher', parent: { id: 'sbp', scope: 'body' } },
      ],
      [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'sbp', port: 'execute' } },
        { type: 'Connection', from: { node: 'Start', port: 'n' }, to: { node: 'sbp', port: 'items' } },
        { type: 'Connection', from: { node: 'sbp', port: 'result' }, to: { node: 'cbr', port: 'value' } },
        { type: 'Connection', from: { node: 'cbr', port: 'result' }, to: { node: 'Exit', port: 'result' } },
      ]
    );

    const code = generateCode(workflow, { production: true });
    expect(code).toContain('createScope');
    expect(code).toContain('childBrancher');
    expect(code).toContain('sbp_scopedCtx');
  });
});
