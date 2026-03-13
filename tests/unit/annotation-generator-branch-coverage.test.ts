/**
 * Branch coverage tests for src/annotation-generator.ts
 * Targets uncovered branches in generate(), generateNodeTypeAnnotation(),
 * generateWorkflowAnnotation(), generateNodeInstanceTag(), generateJSDocPortTag(),
 * generateFunctionSignature(), and isConnectionCoveredByMacroStatic().
 */
import { describe, it, expect } from 'vitest';
import {
  AnnotationGenerator,
  generateJSDocPortTag,
  generateNodeInstanceTag,
  generateFunctionSignature,
  assignPortOrders,
} from '../../src/annotation-generator';
import type {
  TWorkflowAST,
  TNodeTypeAST,
  TNodeInstanceAST,
  TPortDefinition,
} from '../../src/ast/types';

// Helpers for building minimal ASTs
function makeNodeType(overrides: Partial<TNodeTypeAST> = {}): TNodeTypeAST {
  return {
    type: 'NodeType',
    name: 'TestNode',
    functionName: 'testNode',
    inputs: { execute: { dataType: 'STEP' } },
    outputs: { onSuccess: { dataType: 'STEP' } },
    hasSuccessPort: true,
    hasFailurePort: false,
    executeWhen: 'CONJUNCTION',
    isAsync: false,
    ...overrides,
  };
}

function makeWorkflow(overrides: Partial<TWorkflowAST> = {}): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: './test.ts',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    nodeTypes: [],
    instances: [],
    connections: [],
    startPorts: {},
    exitPorts: {},
    imports: [],
    ...overrides,
  };
}

const gen = new AnnotationGenerator();

// ──────────────────────────────────────────────────────────
// generate() top-level branches
// ──────────────────────────────────────────────────────────

describe('AnnotationGenerator.generate() branches', () => {
  it('should skip includeComments header lines when includeComments=false', () => {
    const wf = makeWorkflow();
    const result = gen.generate(wf, { includeComments: false });
    // Should NOT start with two empty lines
    const lines = result.split('\n');
    expect(lines[0]).not.toBe('');
  });

  it('should skip IMPORTED_WORKFLOW nodeType matching own functionName', () => {
    const nt = makeNodeType({
      variant: 'IMPORTED_WORKFLOW',
      functionName: 'testWorkflow',
    });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).not.toContain('@flowWeaver nodeType');
    expect(result).not.toContain('testNode');
  });

  it('should skip MAP_ITERATOR variant nodeTypes', () => {
    const nt = makeNodeType({ variant: 'MAP_ITERATOR' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).not.toContain('@flowWeaver nodeType');
  });

  it('should skip COERCION variant nodeTypes', () => {
    const nt = makeNodeType({ variant: 'COERCION' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).not.toContain('@flowWeaver nodeType');
  });

  it('should skip inferred STUB variant nodeTypes', () => {
    const nt = makeNodeType({ variant: 'STUB', inferred: true });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).not.toContain('@flowWeaver node');
  });

  it('should NOT skip non-inferred STUB variant', () => {
    const nt = makeNodeType({ variant: 'STUB', name: 'myStub', functionName: 'myStub' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).toContain('@flowWeaver node');
  });

  it('should use custom indentSize', () => {
    const wf = makeWorkflow();
    // indentSize is used internally but doesn't show in the output directly for this case
    const result = gen.generate(wf, { indentSize: 4 });
    expect(result).toContain('@flowWeaver workflow');
  });

  it('should skip @param/@returns when skipParamReturns=true', () => {
    const wf = makeWorkflow({
      startPorts: { execute: { dataType: 'STEP' }, input1: { dataType: 'STRING' } },
      exitPorts: { onSuccess: { dataType: 'STEP' }, result: { dataType: 'NUMBER' } },
    });
    const result = gen.generate(wf, { skipParamReturns: true });
    expect(result).not.toContain('@param');
    expect(result).not.toContain('@returns');
  });
});

// ──────────────────────────────────────────────────────────
// generateNodeTypeAnnotation() branches
// ──────────────────────────────────────────────────────────

describe('generateNodeTypeAnnotation branches', () => {
  it('should use functionText directly when present', () => {
    const nt = makeNodeType({ functionText: '// my custom function text' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).toContain('// my custom function text');
    // The nodeType annotation should use functionText directly (no separate JSDoc for it)
    // but the workflow annotation will still have /** */
    const nodeSection = result.split('/**')[0];
    expect(nodeSection).toContain('// my custom function text');
  });

  it('should include multi-line description', () => {
    const nt = makeNodeType({ description: 'Line one\nLine two\nLine three' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).toContain(' * Line one');
    expect(result).toContain(' * Line two');
    expect(result).toContain(' * Line three');
  });

  it('should omit description when includeComments=false', () => {
    const nt = makeNodeType({ description: 'Some description' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf, { includeComments: false });
    expect(result).not.toContain('Some description');
  });

  it('should use @flowWeaver node for STUB variant', () => {
    const nt = makeNodeType({ variant: 'STUB' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).toContain('@flowWeaver node');
    expect(result).not.toContain('@flowWeaver nodeType');
  });

  it('should use @flowWeaver node for expression nodeType', () => {
    const nt = makeNodeType({ expression: true });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).toContain('@flowWeaver node');
  });

  it('should use @flowWeaver nodeType for normal FUNCTION variant', () => {
    const nt = makeNodeType({ variant: 'FUNCTION' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).toContain('@flowWeaver nodeType');
  });

  it('should include @label when includeMetadata and label present', () => {
    const nt = makeNodeType({ label: 'My Label' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf, { includeMetadata: true });
    expect(result).toContain('@label My Label');
  });

  it('should omit @label when includeMetadata=false', () => {
    const nt = makeNodeType({ label: 'My Label' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf, { includeMetadata: false });
    expect(result).not.toContain('@label');
  });

  it('should include @name when name differs from functionName', () => {
    const nt = makeNodeType({ name: 'DisplayName', functionName: 'internalName' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).toContain('@name DisplayName');
  });

  it('should omit @name when name equals functionName', () => {
    const nt = makeNodeType({ name: 'sameName', functionName: 'sameName' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).not.toContain('@name ');
  });

  it('should include @scope when scope present', () => {
    const nt = makeNodeType({ scope: 'iteration' });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).toContain('@scope iteration');
  });

  it('should include @pullExecution when defaultConfig has it', () => {
    const nt = makeNodeType({ defaultConfig: { pullExecution: { triggerPort: 'myPort' } } });
    const wf = makeWorkflow({ nodeTypes: [nt] });
    const result = gen.generate(wf);
    expect(result).toContain('@pullExecution myPort');
  });
});

// ──────────────────────────────────────────────────────────
// generateWorkflowAnnotation() branches
// ──────────────────────────────────────────────────────────

describe('generateWorkflowAnnotation branches', () => {
  it('should include @strictTypes when option is set', () => {
    const wf = makeWorkflow({ options: { strictTypes: true } });
    const result = gen.generate(wf);
    expect(result).toContain('@strictTypes');
  });

  it('should include @autoConnect and skip connections', () => {
    const wf = makeWorkflow({
      options: { autoConnect: true },
      connections: [{
        type: 'Connection',
        from: { node: 'A', port: 'onSuccess' },
        to: { node: 'B', port: 'execute' },
      }],
    });
    const result = gen.generate(wf);
    expect(result).toContain('@autoConnect');
    expect(result).not.toContain('@connect');
  });

  it('should include @trigger with event', () => {
    const wf = makeWorkflow({ options: { trigger: { event: 'push' } } });
    const result = gen.generate(wf);
    expect(result).toContain('@trigger event="push"');
  });

  it('should include @trigger with cron', () => {
    const wf = makeWorkflow({ options: { trigger: { cron: '0 * * * *' } } });
    const result = gen.generate(wf);
    expect(result).toContain('@trigger cron="0 * * * *"');
  });

  it('should include @trigger with both event and cron', () => {
    const wf = makeWorkflow({ options: { trigger: { event: 'push', cron: '0 0 * * *' } } });
    const result = gen.generate(wf);
    expect(result).toContain('event="push"');
    expect(result).toContain('cron="0 0 * * *"');
  });

  it('should include @cancelOn with all fields', () => {
    const wf = makeWorkflow({
      options: { cancelOn: { event: 'cancel', match: 'id=123', timeout: '30m' } },
    });
    const result = gen.generate(wf);
    expect(result).toContain('@cancelOn event="cancel" match="id=123" timeout="30m"');
  });

  it('should include @cancelOn with only event', () => {
    const wf = makeWorkflow({
      options: { cancelOn: { event: 'stop' } },
    });
    const result = gen.generate(wf);
    expect(result).toContain('@cancelOn event="stop"');
    expect(result).not.toContain('match=');
  });

  it('should include @retries', () => {
    const wf = makeWorkflow({ options: { retries: 3 } });
    const result = gen.generate(wf);
    expect(result).toContain('@retries 3');
  });

  it('should include @timeout', () => {
    const wf = makeWorkflow({ options: { timeout: '1h' } });
    const result = gen.generate(wf);
    expect(result).toContain('@timeout "1h"');
  });

  it('should include @throttle with limit and period', () => {
    const wf = makeWorkflow({ options: { throttle: { limit: 10, period: '1m' } } });
    const result = gen.generate(wf);
    expect(result).toContain('@throttle limit=10 period="1m"');
  });

  it('should include @throttle with limit only', () => {
    const wf = makeWorkflow({ options: { throttle: { limit: 5 } } });
    const result = gen.generate(wf);
    expect(result).toContain('@throttle limit=5');
    expect(result).not.toContain('period=');
  });

  it('should include workflow @name when different from functionName', () => {
    const wf = makeWorkflow({ name: 'Display Name', functionName: 'internalFn' });
    const result = gen.generate(wf);
    expect(result).toContain('@name Display Name');
  });

  it('should include workflow @description when includeComments', () => {
    const wf = makeWorkflow({ description: 'My workflow description' });
    const result = gen.generate(wf, { includeComments: true });
    expect(result).toContain('@description My workflow description');
  });

  it('should omit workflow @description when includeComments=false', () => {
    const wf = makeWorkflow({ description: 'My description' });
    const result = gen.generate(wf, { includeComments: false });
    expect(result).not.toContain('@description');
  });

  it('should generate @position for Start and Exit nodes', () => {
    const wf = makeWorkflow({
      ui: {
        startNode: { x: 100.4, y: 200.6 },
        exitNode: { x: 500.1, y: 300.9 },
      },
    });
    const result = gen.generate(wf);
    expect(result).toContain('@position Start 100 201');
    expect(result).toContain('@position Exit 500 301');
  });

  it('should skip Start position when x is undefined', () => {
    const wf = makeWorkflow({
      ui: { startNode: { y: 200 }, exitNode: { x: 500, y: 300 } },
    });
    const result = gen.generate(wf);
    expect(result).not.toContain('@position Start');
    expect(result).toContain('@position Exit');
  });

  it('should generate connections with scope', () => {
    const wf = makeWorkflow({
      connections: [{
        type: 'Connection',
        from: { node: 'A', port: 'item', scope: 'iterate' },
        to: { node: 'B', port: 'input', scope: 'iterate' },
      }],
    });
    const result = gen.generate(wf);
    expect(result).toContain('@connect A.item:iterate -> B.input:iterate');
  });

  it('should generate scopes and skip macro-covered ones', () => {
    const wf = makeWorkflow({
      scopes: {
        'loop.iterate': ['child1'],
        'manual.scope': ['child2'],
      },
      macros: [{
        type: 'map',
        instanceId: 'loop',
        childId: 'child1',
        sourcePort: 'src.items',
      }],
    });
    const result = gen.generate(wf);
    expect(result).not.toContain('@scope loop.iterate');
    expect(result).toContain('@scope manual.scope [child2]');
  });

  it('should strip parent from macro child instances', () => {
    const wf = makeWorkflow({
      instances: [
        { type: 'NodeInstance', id: 'child1', nodeType: 'Proc', parent: { id: 'loop', scope: 'iterate' } },
      ],
      macros: [{
        type: 'map',
        instanceId: 'loop',
        childId: 'child1',
        sourcePort: 'src.items',
      }],
    });
    const result = gen.generate(wf);
    // child1 should appear without parent scope
    expect(result).toContain('@node child1 Proc');
    expect(result).not.toContain('loop.iterate');
  });

  it('should skip macro instance IDs and coerce instance IDs from @node output', () => {
    const wf = makeWorkflow({
      instances: [
        { type: 'NodeInstance', id: 'loop', nodeType: 'MapIterator' },
        { type: 'NodeInstance', id: 'coerce1', nodeType: 'Coercion' },
        { type: 'NodeInstance', id: 'real', nodeType: 'RealNode' },
      ],
      macros: [
        { type: 'map', instanceId: 'loop', childId: 'child1', sourcePort: 'src.items' },
        { type: 'coerce', instanceId: 'coerce1', source: { node: 'A', port: 'out' }, target: { node: 'B', port: 'in' }, targetType: 'string' },
      ],
    });
    const result = gen.generate(wf);
    expect(result).not.toContain('@node loop ');
    expect(result).not.toContain('@node coerce1 ');
    expect(result).toContain('@node real RealNode');
  });

  it('should generate stub workflow signature', () => {
    const wf = makeWorkflow({ stub: true });
    const result = gen.generate(wf);
    expect(result).toContain("export const testWorkflow = 'flowWeaver:draft';");
  });
});

// ──────────────────────────────────────────────────────────
// Macro generation branches (@map, @path, @fanOut, @fanIn, @coerce)
// ──────────────────────────────────────────────────────────

describe('macro annotation generation', () => {
  it('should generate @map with input/output ports', () => {
    const wf = makeWorkflow({
      macros: [{
        type: 'map',
        instanceId: 'loop',
        childId: 'proc',
        sourcePort: 'src.items',
        inputPort: 'data',
        outputPort: 'result',
      }],
    });
    const result = gen.generate(wf);
    expect(result).toContain('@map loop proc(data -> result) over src.items');
  });

  it('should generate @map without input/output ports', () => {
    const wf = makeWorkflow({
      macros: [{
        type: 'map',
        instanceId: 'loop',
        childId: 'proc',
        sourcePort: 'src.items',
      }],
    });
    const result = gen.generate(wf);
    expect(result).toContain('@map loop proc over src.items');
    // The @map line itself should not have parentheses (no input/output ports)
    const mapLine = result.split('\n').find(l => l.includes('@map'));
    expect(mapLine).not.toContain('(');
  });

  it('should generate @fanOut with port on targets', () => {
    const wf = makeWorkflow({
      instances: [
        { type: 'NodeInstance', id: 'A', nodeType: 'T' },
        { type: 'NodeInstance', id: 'B', nodeType: 'T' },
        { type: 'NodeInstance', id: 'C', nodeType: 'T' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'A', port: 'data' }, to: { node: 'B', port: 'input' } },
        { type: 'Connection', from: { node: 'A', port: 'data' }, to: { node: 'C', port: 'data' } },
      ],
      macros: [{
        type: 'fanOut',
        source: { node: 'A', port: 'data' },
        targets: [
          { node: 'B', port: 'input' },
          { node: 'C' },
        ],
      }],
    });
    const result = gen.generate(wf);
    expect(result).toContain('@fanOut A.data -> B.input, C');
  });

  it('should generate @fanIn with port on sources', () => {
    const wf = makeWorkflow({
      instances: [
        { type: 'NodeInstance', id: 'A', nodeType: 'T' },
        { type: 'NodeInstance', id: 'B', nodeType: 'T' },
        { type: 'NodeInstance', id: 'C', nodeType: 'T' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'A', port: 'out' }, to: { node: 'C', port: 'input' } },
        { type: 'Connection', from: { node: 'B', port: 'input' }, to: { node: 'C', port: 'input' } },
      ],
      macros: [{
        type: 'fanIn',
        sources: [
          { node: 'A', port: 'out' },
          { node: 'B' },
        ],
        target: { node: 'C', port: 'input' },
      }],
    });
    const result = gen.generate(wf);
    expect(result).toContain('@fanIn A.out, B -> C.input');
  });

  it('should generate @coerce macro', () => {
    const wf = makeWorkflow({
      instances: [
        { type: 'NodeInstance', id: 'A', nodeType: 'T' },
        { type: 'NodeInstance', id: 'B', nodeType: 'T' },
        { type: 'NodeInstance', id: 'c1', nodeType: 'Coercion' },
      ],
      connections: [
        { type: 'Connection', from: { node: 'A', port: 'out' }, to: { node: 'c1', port: 'value' } },
        { type: 'Connection', from: { node: 'c1', port: 'result' }, to: { node: 'B', port: 'in' } },
      ],
      macros: [{
        type: 'coerce',
        instanceId: 'c1',
        source: { node: 'A', port: 'out' },
        target: { node: 'B', port: 'in' },
        targetType: 'number',
      }],
    });
    const result = gen.generate(wf);
    expect(result).toContain('@coerce c1 A.out -> B.in as number');
  });

  it('should generate @path with route suffixes', () => {
    // We need to inject path macros via the detected sugar patterns.
    // Simpler: just put connections that form a path and let detection work,
    // or test generateNodeInstanceTag with existing macros.
    // Actually the path macros come from detectSugarPatterns. Let's test with
    // connections that will be auto-detected as a path.
    const wf = makeWorkflow({
      instances: [
        { type: 'NodeInstance', id: 'A', nodeType: 'TypeA' },
        { type: 'NodeInstance', id: 'B', nodeType: 'TypeB' },
      ],
      nodeTypes: [
        makeNodeType({ name: 'TypeA', functionName: 'typeA' }),
        makeNodeType({ name: 'TypeB', functionName: 'typeB' }),
      ],
      connections: [
        { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'A', port: 'execute' } },
        { type: 'Connection', from: { node: 'A', port: 'onSuccess' }, to: { node: 'B', port: 'execute' } },
        { type: 'Connection', from: { node: 'B', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
      ],
      startPorts: { execute: { dataType: 'STEP' } },
      exitPorts: { onSuccess: { dataType: 'STEP' } },
    });
    const result = gen.generate(wf);
    expect(result).toContain('@path Start -> A -> B -> Exit');
  });
});

// ──────────────────────────────────────────────────────────
// generateNodeInstanceTag() branches
// ──────────────────────────────────────────────────────────

describe('generateNodeInstanceTag branches', () => {
  it('should generate parent scope reference', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'child', nodeType: 'MyType',
      parent: { id: 'forEach1', scope: 'iteration' },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('@node child MyType forEach1.iteration');
  });

  it('should generate [label: "..."] when label differs from id', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { label: 'Custom Label' },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('[label: "Custom Label"]');
  });

  it('should escape quotes in label', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { label: 'Say "hello"' },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('[label: "Say \\"hello\\""]');
  });

  it('should NOT generate label when it matches id', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { label: 'n1' },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).not.toContain('[label:');
  });

  it('should generate [portOrder: ...]', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { portConfigs: [{ portName: 'a', order: 1 }, { portName: 'b', order: 2 }] },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('[portOrder: a=1,b=2]');
  });

  it('should generate [portLabel: ...]', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { portConfigs: [{ portName: 'a', label: 'Alpha' }] },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('[portLabel: a="Alpha"]');
  });

  it('should generate [expr: ...] with escaped content', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { portConfigs: [{ portName: 'x', expression: 'a + b /* comment */' }] },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('[expr: x="a + b /* comment *\\/"]');
  });

  it('should generate [pullExecution: ...]', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { pullExecution: { triggerPort: 'trigger' } },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('[pullExecution: trigger]');
  });

  it('should generate [minimized]', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { minimized: true },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('[minimized]');
  });

  it('should generate [color: "..."]', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { color: 'blue' },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('[color: "blue"]');
  });

  it('should generate [icon: "..."]', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { icon: 'database' },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('[icon: "database"]');
  });

  it('should generate [tags: ...] with tooltip', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { tags: [{ label: 'beta', tooltip: 'Experimental' }, { label: 'fast' }] },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('[tags: "beta" "Experimental", "fast"]');
  });

  it('should generate [suppress: ...]', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { suppressWarnings: ['UNUSED_PORT', 'MISSING_CONNECTION'] },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('[suppress: "UNUSED_PORT", "MISSING_CONNECTION"]');
  });

  it('should generate [position: x y]', () => {
    const inst: TNodeInstanceAST = {
      type: 'NodeInstance', id: 'n1', nodeType: 'NT',
      config: { x: 123.7, y: 456.2 },
    };
    const result = generateNodeInstanceTag(inst);
    expect(result).toContain('[position: 124 456]');
  });
});

// ──────────────────────────────────────────────────────────
// generateJSDocPortTag() branches
// ──────────────────────────────────────────────────────────

describe('generateJSDocPortTag branches', () => {
  it('should use @step tag for custom STEP port', () => {
    const port: TPortDefinition = { dataType: 'STEP' };
    const result = generateJSDocPortTag('customStep', port, 'output');
    expect(result).toMatch(/^@step customStep/);
  });

  it('should use @output for onSuccess (reserved)', () => {
    const port: TPortDefinition = { dataType: 'STEP' };
    const result = generateJSDocPortTag('onSuccess', port, 'output');
    expect(result).toMatch(/^@output onSuccess/);
  });

  it('should format optional with default', () => {
    const port: TPortDefinition = { dataType: 'STRING', optional: true, default: 'hello' };
    const result = generateJSDocPortTag('name', port, 'input');
    expect(result).toContain('[name="hello"]');
  });

  it('should format optional without default', () => {
    const port: TPortDefinition = { dataType: 'STRING', optional: true };
    const result = generateJSDocPortTag('name', port, 'input');
    expect(result).toContain('[name]');
  });

  it('should format required with default', () => {
    const port: TPortDefinition = { dataType: 'NUMBER', default: 42 };
    const result = generateJSDocPortTag('count', port, 'input');
    expect(result).toContain('count=42');
  });

  it('should include scope attribute', () => {
    const port: TPortDefinition = { dataType: 'STRING', scope: 'loop' };
    const result = generateJSDocPortTag('item', port, 'output');
    expect(result).toContain('scope:loop');
  });

  it('should include order metadata', () => {
    const port: TPortDefinition = { dataType: 'NUMBER', metadata: { order: 3 } };
    const result = generateJSDocPortTag('val', port, 'input');
    expect(result).toContain('[order:3]');
  });

  it('should include placement metadata', () => {
    const port: TPortDefinition = { dataType: 'STRING', metadata: { placement: 'left' } };
    const result = generateJSDocPortTag('label', port, 'input');
    expect(result).toContain('[placement:left]');
  });

  it('should include expression', () => {
    const port: TPortDefinition = { dataType: 'STRING', expression: '(ctx) => ctx.val' };
    const result = generateJSDocPortTag('computed', port, 'output');
    expect(result).toContain('- Expression: (ctx) => ctx.val');
  });

  it('should include label when different from name', () => {
    const port: TPortDefinition = { dataType: 'STRING', label: 'Full Name' };
    const result = generateJSDocPortTag('name', port, 'input');
    expect(result).toContain('- Full Name');
  });

  it('should NOT include label when same as name', () => {
    const port: TPortDefinition = { dataType: 'STRING', label: 'name' };
    const result = generateJSDocPortTag('name', port, 'input');
    expect(result).not.toContain(' - ');
  });
});

// ──────────────────────────────────────────────────────────
// generateFunctionSignature() branches
// ──────────────────────────────────────────────────────────

describe('generateFunctionSignature branches', () => {
  it('should generate declare function for STUB', () => {
    const nt = makeNodeType({
      variant: 'STUB',
      inputs: { execute: { dataType: 'STEP' }, a: { dataType: 'NUMBER' } },
      outputs: { onSuccess: { dataType: 'STEP' }, result: { dataType: 'STRING' } },
    });
    const lines = generateFunctionSignature(nt);
    expect(lines[0]).toContain('declare function testNode');
    expect(lines[0]).toContain('a: number');
    expect(lines[0]).toContain(': string');
  });

  it('should generate expression function with multiple outputs', () => {
    const nt = makeNodeType({
      expression: true,
      inputs: { execute: { dataType: 'STEP' }, x: { dataType: 'NUMBER' } },
      outputs: { onSuccess: { dataType: 'STEP' }, a: { dataType: 'STRING' }, b: { dataType: 'NUMBER' } },
    });
    const lines = generateFunctionSignature(nt);
    expect(lines[0]).toContain('function testNode');
    expect(lines[0]).toContain('): { a: string; b: number }');
  });

  it('should generate normal function with execute param and defaults', () => {
    const nt = makeNodeType({
      variant: 'FUNCTION',
      inputs: {
        execute: { dataType: 'STEP' },
        threshold: { dataType: 'NUMBER', default: 10 },
        name: { dataType: 'STRING', optional: true },
      },
      outputs: {
        onSuccess: { dataType: 'STEP' },
        onFailure: { dataType: 'STEP' },
        result: { dataType: 'STRING' },
      },
      hasFailurePort: true,
    });
    const lines = generateFunctionSignature(nt);
    const sig = lines.join('\n');
    expect(sig).toContain('execute: boolean');
    expect(sig).toContain('threshold: number = 10');
    expect(sig).toContain('name?: string');
    expect(sig).toContain('onSuccess: true, onFailure: false');
  });
});

// ──────────────────────────────────────────────────────────
// assignPortOrders() passthrough
// ──────────────────────────────────────────────────────────

describe('assignPortOrders', () => {
  it('should return ports unchanged', () => {
    const ports: [string, TPortDefinition][] = [
      ['a', { dataType: 'STRING' }],
      ['b', { dataType: 'NUMBER' }],
    ];
    expect(assignPortOrders(ports, 'input')).toBe(ports);
  });
});

// ──────────────────────────────────────────────────────────
// Workflow function signature branches
// ──────────────────────────────────────────────────────────

describe('workflow function signature', () => {
  it('should generate async function with params and returns', () => {
    const wf = makeWorkflow({
      startPorts: {
        execute: { dataType: 'STEP' },
        input1: { dataType: 'STRING' },
        input2: { dataType: 'NUMBER', optional: true },
      },
      exitPorts: {
        onSuccess: { dataType: 'STEP' },
        result: { dataType: 'STRING' },
      },
    });
    const result = gen.generate(wf);
    expect(result).toContain('export async function testWorkflow(');
    expect(result).toContain('execute: boolean');
    expect(result).toContain('input1: string');
    expect(result).toContain('input2?: number');
    expect(result).toContain('result: string');
  });
});

// ──────────────────────────────────────────────────────────
// @retries 0 edge case (falsy but defined)
// ──────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('should include @retries 0 (falsy value)', () => {
    const wf = makeWorkflow({ options: { retries: 0 } });
    const result = gen.generate(wf);
    // retries check is `!== undefined`, so 0 should be included
    expect(result).toContain('@retries 0');
  });

  it('should handle empty macros array', () => {
    const wf = makeWorkflow({ macros: [] });
    const result = gen.generate(wf);
    expect(result).toContain('@flowWeaver workflow');
  });

  it('should handle port with hidden and failure flags (generateTPortDefinition coverage)', () => {
    // The private method generateTPortDefinition isn't directly exposed,
    // but we can verify the port tag generation handles these correctly
    const port: TPortDefinition = { dataType: 'STEP', hidden: true, failure: true };
    const result = generateJSDocPortTag('errorOut', port, 'output');
    expect(result).toContain('@step errorOut');
  });
});
