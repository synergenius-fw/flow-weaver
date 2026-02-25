import { describe, it, expect } from 'vitest';
import {
  WorkflowBuilder,
  NodeTypeBuilder,
  NodeInstanceBuilder,
  ConnectionBuilder,
  portRef,
  port,
  importDecl,
  namedImport,
  defaultImport,
  namespaceImport,
  workflow,
  nodeType,
  nodeInstance,
  connection,
  connect,
} from '../../../src/ast/builder.js';
import { EXECUTION_STRATEGIES } from '../../../src/constants.js';

// ---------------------------------------------------------------------------
// WorkflowBuilder
// ---------------------------------------------------------------------------

describe('WorkflowBuilder', () => {
  it('creates a minimal workflow with required fields', () => {
    const ast = new WorkflowBuilder('myWf', 'myWf', './src/wf.ts').build();

    expect(ast).toEqual({
      type: 'Workflow',
      sourceFile: './src/wf.ts',
      name: 'myWf',
      functionName: 'myWf',
      nodeTypes: [],
      instances: [],
      connections: [],
      startPorts: {},
      exitPorts: {},
      imports: [],
    });
  });

  it('sets description', () => {
    const ast = new WorkflowBuilder('w', 'w', 'w.ts')
      .description('A workflow')
      .build();

    expect(ast.description).toBe('A workflow');
  });

  it('sets generatedFile', () => {
    const ast = new WorkflowBuilder('w', 'w', 'w.ts')
      .generatedFile('./out/w.generated.ts')
      .build();

    expect(ast.generatedFile).toBe('./out/w.generated.ts');
  });

  it('accumulates node types', () => {
    const nt1 = new NodeTypeBuilder('A', 'a').build();
    const nt2 = new NodeTypeBuilder('B', 'b').build();

    const ast = new WorkflowBuilder('w', 'w', 'w.ts')
      .addNodeType(nt1)
      .addNodeType(nt2)
      .build();

    expect(ast.nodeTypes).toHaveLength(2);
    expect(ast.nodeTypes[0].name).toBe('A');
    expect(ast.nodeTypes[1].name).toBe('B');
  });

  it('accumulates node instances', () => {
    const inst = new NodeInstanceBuilder('n1', 'A').build();

    const ast = new WorkflowBuilder('w', 'w', 'w.ts')
      .addNodeInstance(inst)
      .build();

    expect(ast.instances).toHaveLength(1);
    expect(ast.instances[0].id).toBe('n1');
  });

  it('accumulates connections', () => {
    const conn = new ConnectionBuilder(
      { node: 'Start', port: 'x' },
      { node: 'n1', port: 'a' },
    ).build();

    const ast = new WorkflowBuilder('w', 'w', 'w.ts')
      .addConnection(conn)
      .build();

    expect(ast.connections).toHaveLength(1);
    expect(ast.connections[0].from.node).toBe('Start');
  });

  it('creates scopes lazily on first addScope call', () => {
    const builder = new WorkflowBuilder('w', 'w', 'w.ts');
    const before = builder.build();
    expect(before.scopes).toBeUndefined();

    // Build a fresh builder since we already consumed the first one's state.
    const ast = new WorkflowBuilder('w', 'w', 'w.ts')
      .addScope('loop.iteration', ['proc1', 'proc2'])
      .build();

    expect(ast.scopes).toEqual({ 'loop.iteration': ['proc1', 'proc2'] });
  });

  it('accumulates multiple scopes', () => {
    const ast = new WorkflowBuilder('w', 'w', 'w.ts')
      .addScope('loop.iter', ['a'])
      .addScope('cond.branch', ['b', 'c'])
      .build();

    expect(ast.scopes).toEqual({
      'loop.iter': ['a'],
      'cond.branch': ['b', 'c'],
    });
  });

  it('accumulates imports', () => {
    const imp = importDecl([namedImport('foo')], './foo');

    const ast = new WorkflowBuilder('w', 'w', 'w.ts')
      .addImport(imp)
      .build();

    expect(ast.imports).toHaveLength(1);
    expect(ast.imports[0].source).toBe('./foo');
  });

  it('creates metadata lazily on first metadata call', () => {
    const bare = new WorkflowBuilder('w', 'w', 'w.ts').build();
    expect(bare.metadata).toBeUndefined();

    const ast = new WorkflowBuilder('w', 'w', 'w.ts')
      .metadata('version', '1.0')
      .build();

    expect(ast.metadata).toEqual({ version: '1.0' });
  });

  it('accumulates multiple metadata entries', () => {
    const ast = new WorkflowBuilder('w', 'w', 'w.ts')
      .metadata('a', 1)
      .metadata('b', true)
      .metadata('c', null)
      .build();

    expect(ast.metadata).toEqual({ a: 1, b: true, c: null });
  });

  it('returns this from every chainable method', () => {
    const b = new WorkflowBuilder('w', 'w', 'w.ts');

    expect(b.description('d')).toBe(b);
    expect(b.generatedFile('g')).toBe(b);
    expect(b.addNodeType(new NodeTypeBuilder('T', 't').build())).toBe(b);
    expect(b.addNodeInstance(new NodeInstanceBuilder('i', 'T').build())).toBe(b);
    expect(b.addConnection(connect('a', 'p', 'b', 'q'))).toBe(b);
    expect(b.addScope('s', ['x'])).toBe(b);
    expect(b.addImport(importDecl([], 'x'))).toBe(b);
    expect(b.metadata('k', 'v')).toBe(b);
  });

  it('supports a full chained build', () => {
    const nt = new NodeTypeBuilder('Add', 'add')
      .input('a', { dataType: 'NUMBER' })
      .output('sum', { dataType: 'NUMBER' })
      .successPort()
      .build();

    const inst = new NodeInstanceBuilder('add1', 'Add').build();
    const conn = connect('Start', 'a', 'add1', 'a');
    const imp = importDecl([namedImport('add')], './math');

    const ast = new WorkflowBuilder('calc', 'calculate', './calc.ts')
      .description('Math workflow')
      .generatedFile('./calc.generated.ts')
      .addNodeType(nt)
      .addNodeInstance(inst)
      .addConnection(conn)
      .addScope('loop.iter', ['add1'])
      .addImport(imp)
      .metadata('author', 'test')
      .build();

    expect(ast.type).toBe('Workflow');
    expect(ast.name).toBe('calc');
    expect(ast.functionName).toBe('calculate');
    expect(ast.sourceFile).toBe('./calc.ts');
    expect(ast.generatedFile).toBe('./calc.generated.ts');
    expect(ast.description).toBe('Math workflow');
    expect(ast.nodeTypes).toHaveLength(1);
    expect(ast.instances).toHaveLength(1);
    expect(ast.connections).toHaveLength(1);
    expect(ast.scopes).toEqual({ 'loop.iter': ['add1'] });
    expect(ast.imports).toHaveLength(1);
    expect(ast.metadata).toEqual({ author: 'test' });
  });
});

// ---------------------------------------------------------------------------
// NodeTypeBuilder
// ---------------------------------------------------------------------------

describe('NodeTypeBuilder', () => {
  it('creates a minimal node type with defaults', () => {
    const nt = new NodeTypeBuilder('Fetch', 'fetch').build();

    expect(nt).toEqual({
      type: 'NodeType',
      name: 'Fetch',
      functionName: 'fetch',
      inputs: {},
      outputs: {},
      hasSuccessPort: false,
      hasFailurePort: false,
      executeWhen: EXECUTION_STRATEGIES.CONJUNCTION,
      isAsync: false,
    });
  });

  it('sets label', () => {
    const nt = new NodeTypeBuilder('F', 'f').label('Fetch Data').build();
    expect(nt.label).toBe('Fetch Data');
  });

  it('sets description', () => {
    const nt = new NodeTypeBuilder('F', 'f').description('Fetches data').build();
    expect(nt.description).toBe('Fetches data');
  });

  it('sets scope', () => {
    const nt = new NodeTypeBuilder('ForEach', 'forEach').scope('iteration').build();
    expect(nt.scope).toBe('iteration');
  });

  it('adds input ports', () => {
    const nt = new NodeTypeBuilder('Add', 'add')
      .input('a', { dataType: 'NUMBER' })
      .input('b', { dataType: 'NUMBER', optional: true })
      .build();

    expect(Object.keys(nt.inputs)).toEqual(['a', 'b']);
    expect(nt.inputs.a.dataType).toBe('NUMBER');
    expect(nt.inputs.b.optional).toBe(true);
  });

  it('adds output ports', () => {
    const nt = new NodeTypeBuilder('Add', 'add')
      .output('sum', { dataType: 'NUMBER' })
      .build();

    expect(nt.outputs.sum.dataType).toBe('NUMBER');
  });

  it('enables success port with default true', () => {
    const nt = new NodeTypeBuilder('N', 'n').successPort().build();
    expect(nt.hasSuccessPort).toBe(true);
  });

  it('explicitly disables success port', () => {
    const nt = new NodeTypeBuilder('N', 'n')
      .successPort(true)
      .successPort(false)
      .build();
    expect(nt.hasSuccessPort).toBe(false);
  });

  it('enables failure port with default true', () => {
    const nt = new NodeTypeBuilder('N', 'n').failurePort().build();
    expect(nt.hasFailurePort).toBe(true);
  });

  it('explicitly disables failure port', () => {
    const nt = new NodeTypeBuilder('N', 'n')
      .failurePort(true)
      .failurePort(false)
      .build();
    expect(nt.hasFailurePort).toBe(false);
  });

  it('sets executeWhen strategy', () => {
    const nt = new NodeTypeBuilder('N', 'n')
      .executeWhen('DISJUNCTION')
      .build();

    expect(nt.executeWhen).toBe('DISJUNCTION');
  });

  it('sets branchingStrategy without field', () => {
    const nt = new NodeTypeBuilder('N', 'n')
      .branchingStrategy('exception-based')
      .build();

    expect(nt.branchingStrategy).toBe('exception-based');
    expect(nt.branchField).toBeUndefined();
  });

  it('sets branchingStrategy with field', () => {
    const nt = new NodeTypeBuilder('N', 'n')
      .branchingStrategy('value-based', 'status')
      .build();

    expect(nt.branchingStrategy).toBe('value-based');
    expect(nt.branchField).toBe('status');
  });

  it('sets defaultConfig', () => {
    const nt = new NodeTypeBuilder('N', 'n')
      .defaultConfig({ pullExecution: { triggerPort: 'execute' } })
      .build();

    expect(nt.defaultConfig).toEqual({ pullExecution: { triggerPort: 'execute' } });
  });

  it('creates metadata lazily', () => {
    const bare = new NodeTypeBuilder('N', 'n').build();
    expect(bare.metadata).toBeUndefined();

    const nt = new NodeTypeBuilder('N', 'n')
      .metadata('color', 'blue')
      .build();

    expect(nt.metadata).toEqual({ color: 'blue' });
  });

  it('accumulates multiple metadata entries', () => {
    const nt = new NodeTypeBuilder('N', 'n')
      .metadata('a', 1)
      .metadata('b', 'x')
      .build();

    expect(nt.metadata).toEqual({ a: 1, b: 'x' });
  });

  it('returns this from every chainable method', () => {
    const b = new NodeTypeBuilder('N', 'n');

    expect(b.label('l')).toBe(b);
    expect(b.description('d')).toBe(b);
    expect(b.scope('s')).toBe(b);
    expect(b.input('i', { dataType: 'ANY' })).toBe(b);
    expect(b.output('o', { dataType: 'ANY' })).toBe(b);
    expect(b.successPort()).toBe(b);
    expect(b.failurePort()).toBe(b);
    expect(b.executeWhen('CUSTOM')).toBe(b);
    expect(b.branchingStrategy('none')).toBe(b);
    expect(b.defaultConfig({ label: 'x' })).toBe(b);
    expect(b.metadata('k', 'v')).toBe(b);
  });

  it('supports a full chained build', () => {
    const nt = new NodeTypeBuilder('Transform', 'transform')
      .label('Transform Data')
      .description('Transforms input data')
      .scope('iteration')
      .input('data', { dataType: 'OBJECT' })
      .input('format', { dataType: 'STRING', optional: true, default: 'json' })
      .output('result', { dataType: 'OBJECT' })
      .output('count', { dataType: 'NUMBER' })
      .successPort()
      .failurePort()
      .executeWhen('DISJUNCTION')
      .branchingStrategy('value-based', 'status')
      .defaultConfig({ label: 'Custom Transform' })
      .metadata('category', 'data')
      .build();

    expect(nt.type).toBe('NodeType');
    expect(nt.name).toBe('Transform');
    expect(nt.functionName).toBe('transform');
    expect(nt.label).toBe('Transform Data');
    expect(nt.description).toBe('Transforms input data');
    expect(nt.scope).toBe('iteration');
    expect(Object.keys(nt.inputs)).toEqual(['data', 'format']);
    expect(nt.inputs.format.default).toBe('json');
    expect(Object.keys(nt.outputs)).toEqual(['result', 'count']);
    expect(nt.hasSuccessPort).toBe(true);
    expect(nt.hasFailurePort).toBe(true);
    expect(nt.executeWhen).toBe('DISJUNCTION');
    expect(nt.branchingStrategy).toBe('value-based');
    expect(nt.branchField).toBe('status');
    expect(nt.defaultConfig).toEqual({ label: 'Custom Transform' });
    expect(nt.metadata).toEqual({ category: 'data' });
  });
});

// ---------------------------------------------------------------------------
// NodeInstanceBuilder
// ---------------------------------------------------------------------------

describe('NodeInstanceBuilder', () => {
  it('creates a minimal instance', () => {
    const inst = new NodeInstanceBuilder('add1', 'Add').build();

    expect(inst).toEqual({
      type: 'NodeInstance',
      id: 'add1',
      nodeType: 'Add',
    });
  });

  it('sets config', () => {
    const inst = new NodeInstanceBuilder('n1', 'T')
      .config({ pullExecution: { triggerPort: 'execute' }, label: 'My Node' })
      .build();

    expect(inst.config).toEqual({
      pullExecution: { triggerPort: 'execute' },
      label: 'My Node',
    });
  });

  it('parses parentScope with dot separator', () => {
    const inst = new NodeInstanceBuilder('proc1', 'Proc')
      .parentScope('forEach1.iteration')
      .build();

    expect(inst.parent).toEqual({ id: 'forEach1', scope: 'iteration' });
  });

  it('parses parentScope with multiple dots (splits on first dot only)', () => {
    const inst = new NodeInstanceBuilder('proc1', 'Proc')
      .parentScope('parent.scope.with.dots')
      .build();

    expect(inst.parent).toEqual({ id: 'parent', scope: 'scope.with.dots' });
  });

  it('parses parentScope without dot', () => {
    const inst = new NodeInstanceBuilder('proc1', 'Proc')
      .parentScope('parentOnly')
      .build();

    // dotIndex is -1 so it falls through to the > 0 check, both go to else
    expect(inst.parent).toEqual({ id: 'parentOnly', scope: '' });
  });

  it('parses parentScope with dot at position 0', () => {
    // Edge case: ".scopeName" where dot is at index 0
    const inst = new NodeInstanceBuilder('proc1', 'Proc')
      .parentScope('.scopeName')
      .build();

    // dotIndex is 0, which is NOT > 0, so both branches take the else path
    expect(inst.parent).toEqual({ id: '.scopeName', scope: '' });
  });

  it('creates metadata lazily', () => {
    const bare = new NodeInstanceBuilder('n1', 'T').build();
    expect(bare.metadata).toBeUndefined();

    const inst = new NodeInstanceBuilder('n1', 'T')
      .metadata('x', 100)
      .build();

    expect(inst.metadata).toEqual({ x: 100 });
  });

  it('accumulates multiple metadata entries', () => {
    const inst = new NodeInstanceBuilder('n1', 'T')
      .metadata('x', 10)
      .metadata('y', 20)
      .build();

    expect(inst.metadata).toEqual({ x: 10, y: 20 });
  });

  it('returns this from every chainable method', () => {
    const b = new NodeInstanceBuilder('n1', 'T');

    expect(b.config({ label: 'x' })).toBe(b);
    expect(b.parentScope('p.s')).toBe(b);
    expect(b.metadata('k', 'v')).toBe(b);
  });

  it('supports a full chained build', () => {
    const inst = new NodeInstanceBuilder('proc1', 'Processor')
      .config({ label: 'My Processor', x: 100, y: 200 })
      .parentScope('loop1.iteration')
      .metadata('custom', true)
      .metadata('priority', 5)
      .build();

    expect(inst.type).toBe('NodeInstance');
    expect(inst.id).toBe('proc1');
    expect(inst.nodeType).toBe('Processor');
    expect(inst.config).toEqual({ label: 'My Processor', x: 100, y: 200 });
    expect(inst.parent).toEqual({ id: 'loop1', scope: 'iteration' });
    expect(inst.metadata).toEqual({ custom: true, priority: 5 });
  });
});

// ---------------------------------------------------------------------------
// ConnectionBuilder
// ---------------------------------------------------------------------------

describe('ConnectionBuilder', () => {
  it('creates a minimal connection', () => {
    const conn = new ConnectionBuilder(
      { node: 'Start', port: 'x' },
      { node: 'n1', port: 'a' },
    ).build();

    expect(conn).toEqual({
      type: 'Connection',
      from: { node: 'Start', port: 'x' },
      to: { node: 'n1', port: 'a' },
    });
  });

  it('sets controlFlow, creating metadata lazily', () => {
    const conn = new ConnectionBuilder(
      { node: 'A', port: 'onSuccess' },
      { node: 'B', port: 'execute' },
    ).controlFlow().build();

    expect(conn.metadata).toEqual({ isControlFlow: true });
  });

  it('sets controlFlow with explicit false', () => {
    const conn = new ConnectionBuilder(
      { node: 'A', port: 'p' },
      { node: 'B', port: 'q' },
    ).controlFlow(false).build();

    expect(conn.metadata).toEqual({ isControlFlow: false });
  });

  it('sets dataFlow, creating metadata lazily', () => {
    const conn = new ConnectionBuilder(
      { node: 'A', port: 'out' },
      { node: 'B', port: 'in' },
    ).dataFlow().build();

    expect(conn.metadata).toEqual({ isDataFlow: true });
  });

  it('sets dataFlow with explicit false', () => {
    const conn = new ConnectionBuilder(
      { node: 'A', port: 'out' },
      { node: 'B', port: 'in' },
    ).dataFlow(false).build();

    expect(conn.metadata).toEqual({ isDataFlow: false });
  });

  it('combines controlFlow and dataFlow in the same metadata object', () => {
    const conn = new ConnectionBuilder(
      { node: 'A', port: 'p' },
      { node: 'B', port: 'q' },
    )
      .controlFlow(true)
      .dataFlow(true)
      .build();

    expect(conn.metadata).toEqual({ isControlFlow: true, isDataFlow: true });
  });

  it('creates generic metadata lazily', () => {
    const bare = new ConnectionBuilder(
      { node: 'A', port: 'p' },
      { node: 'B', port: 'q' },
    ).build();
    expect(bare.metadata).toBeUndefined();

    const conn = new ConnectionBuilder(
      { node: 'A', port: 'p' },
      { node: 'B', port: 'q' },
    ).metadata('label', 'my-conn').build();

    expect(conn.metadata).toEqual({ label: 'my-conn' });
  });

  it('accumulates metadata entries', () => {
    const conn = new ConnectionBuilder(
      { node: 'A', port: 'p' },
      { node: 'B', port: 'q' },
    )
      .metadata('a', 1)
      .metadata('b', 2)
      .build();

    expect(conn.metadata).toEqual({ a: 1, b: 2 });
  });

  it('mixes controlFlow/dataFlow with custom metadata', () => {
    const conn = new ConnectionBuilder(
      { node: 'A', port: 'p' },
      { node: 'B', port: 'q' },
    )
      .controlFlow()
      .metadata('weight', 3)
      .dataFlow(false)
      .build();

    expect(conn.metadata).toEqual({
      isControlFlow: true,
      weight: 3,
      isDataFlow: false,
    });
  });

  it('returns this from every chainable method', () => {
    const b = new ConnectionBuilder(
      { node: 'A', port: 'p' },
      { node: 'B', port: 'q' },
    );

    expect(b.controlFlow()).toBe(b);
    expect(b.dataFlow()).toBe(b);
    expect(b.metadata('k', 'v')).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// portRef()
// ---------------------------------------------------------------------------

describe('portRef()', () => {
  it('creates a port reference', () => {
    expect(portRef('Start', 'x')).toEqual({ node: 'Start', port: 'x' });
  });

  it('works with empty strings', () => {
    expect(portRef('', '')).toEqual({ node: '', port: '' });
  });
});

// ---------------------------------------------------------------------------
// port()
// ---------------------------------------------------------------------------

describe('port()', () => {
  it('creates a port definition with just dataType', () => {
    expect(port('NUMBER')).toEqual({ dataType: 'NUMBER' });
  });

  it('creates a port definition with all options', () => {
    const p = port('STRING', {
      optional: true,
      default: 'hello',
      label: 'Name',
      description: 'User name',
    });

    expect(p).toEqual({
      dataType: 'STRING',
      optional: true,
      default: 'hello',
      label: 'Name',
      description: 'User name',
    });
  });

  it('creates a port definition with partial options', () => {
    const p = port('BOOLEAN', { optional: true });
    expect(p).toEqual({ dataType: 'BOOLEAN', optional: true });
  });

  it('creates a port definition with undefined options (no spread effect)', () => {
    const p = port('ANY', undefined);
    expect(p).toEqual({ dataType: 'ANY' });
  });

  it('handles null as a default value', () => {
    const p = port('OBJECT', { default: null });
    expect(p.default).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// importDecl()
// ---------------------------------------------------------------------------

describe('importDecl()', () => {
  it('creates a value import by default', () => {
    const imp = importDecl([namedImport('foo')], './foo');

    expect(imp).toEqual({
      type: 'Import',
      specifiers: [{ imported: 'foo', local: 'foo', kind: 'named' }],
      source: './foo',
      importKind: 'value',
    });
  });

  it('creates a type import when specified', () => {
    const imp = importDecl([namedImport('MyType')], './types', 'type');

    expect(imp.importKind).toBe('type');
  });

  it('works with empty specifiers', () => {
    const imp = importDecl([], 'side-effect-module');

    expect(imp.specifiers).toEqual([]);
    expect(imp.source).toBe('side-effect-module');
  });

  it('works with multiple specifiers', () => {
    const imp = importDecl(
      [namedImport('a'), namedImport('b', 'aliasB'), defaultImport('C')],
      'my-lib',
    );

    expect(imp.specifiers).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// namedImport()
// ---------------------------------------------------------------------------

describe('namedImport()', () => {
  it('creates a named import with same local name', () => {
    expect(namedImport('useState')).toEqual({
      imported: 'useState',
      local: 'useState',
      kind: 'named',
    });
  });

  it('creates a named import with alias', () => {
    expect(namedImport('default', 'myDefault')).toEqual({
      imported: 'default',
      local: 'myDefault',
      kind: 'named',
    });
  });
});

// ---------------------------------------------------------------------------
// defaultImport()
// ---------------------------------------------------------------------------

describe('defaultImport()', () => {
  it('creates a default import specifier', () => {
    expect(defaultImport('React')).toEqual({
      imported: 'default',
      local: 'React',
      kind: 'default',
    });
  });
});

// ---------------------------------------------------------------------------
// namespaceImport()
// ---------------------------------------------------------------------------

describe('namespaceImport()', () => {
  it('creates a namespace import specifier', () => {
    expect(namespaceImport('utils')).toEqual({
      imported: '*',
      local: 'utils',
      kind: 'namespace',
    });
  });
});

// ---------------------------------------------------------------------------
// workflow() factory
// ---------------------------------------------------------------------------

describe('workflow()', () => {
  it('returns a WorkflowBuilder instance', () => {
    const b = workflow('w', 'w', 'w.ts');
    expect(b).toBeInstanceOf(WorkflowBuilder);
  });

  it('passes arguments through to the constructor', () => {
    const ast = workflow('myFlow', 'runFlow', './flow.ts').build();

    expect(ast.name).toBe('myFlow');
    expect(ast.functionName).toBe('runFlow');
    expect(ast.sourceFile).toBe('./flow.ts');
  });
});

// ---------------------------------------------------------------------------
// nodeType() factory
// ---------------------------------------------------------------------------

describe('nodeType()', () => {
  it('returns a NodeTypeBuilder instance', () => {
    const b = nodeType('Add', 'add');
    expect(b).toBeInstanceOf(NodeTypeBuilder);
  });

  it('passes arguments through to the constructor', () => {
    const nt = nodeType('Add', 'add').build();

    expect(nt.name).toBe('Add');
    expect(nt.functionName).toBe('add');
  });
});

// ---------------------------------------------------------------------------
// nodeInstance() factory
// ---------------------------------------------------------------------------

describe('nodeInstance()', () => {
  it('returns a NodeInstanceBuilder instance', () => {
    const b = nodeInstance('a1', 'Add');
    expect(b).toBeInstanceOf(NodeInstanceBuilder);
  });

  it('passes arguments through to the constructor', () => {
    const inst = nodeInstance('a1', 'Add').build();

    expect(inst.id).toBe('a1');
    expect(inst.nodeType).toBe('Add');
  });
});

// ---------------------------------------------------------------------------
// connection() factory
// ---------------------------------------------------------------------------

describe('connection()', () => {
  it('returns a ConnectionBuilder instance', () => {
    const b = connection({ node: 'A', port: 'p' }, { node: 'B', port: 'q' });
    expect(b).toBeInstanceOf(ConnectionBuilder);
  });

  it('passes arguments through to the constructor', () => {
    const conn = connection(
      { node: 'Start', port: 'x' },
      { node: 'n1', port: 'a' },
    ).build();

    expect(conn.from).toEqual({ node: 'Start', port: 'x' });
    expect(conn.to).toEqual({ node: 'n1', port: 'a' });
  });
});

// ---------------------------------------------------------------------------
// connect() convenience function
// ---------------------------------------------------------------------------

describe('connect()', () => {
  it('returns a built TConnectionAST directly', () => {
    const conn = connect('Start', 'x', 'n1', 'a');

    expect(conn).toEqual({
      type: 'Connection',
      from: { node: 'Start', port: 'x' },
      to: { node: 'n1', port: 'a' },
    });
  });

  it('does not include metadata (bare connection)', () => {
    const conn = connect('A', 'out', 'B', 'in');
    expect(conn.metadata).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration: composing builders together
// ---------------------------------------------------------------------------

describe('builder composition', () => {
  it('builds a complete workflow using all factories', () => {
    const addType = nodeType('Add', 'add')
      .input('a', port('NUMBER'))
      .input('b', port('NUMBER'))
      .output('sum', port('NUMBER'))
      .successPort()
      .build();

    const mulType = nodeType('Multiply', 'multiply')
      .input('x', port('NUMBER'))
      .input('factor', port('NUMBER'))
      .output('product', port('NUMBER'))
      .successPort()
      .failurePort()
      .build();

    const add1 = nodeInstance('add1', 'Add').build();
    const mul1 = nodeInstance('mul1', 'Multiply')
      .config({ label: 'Multiplier' })
      .build();

    const ast = workflow('calc', 'calculate', './calc.ts')
      .description('A calculation pipeline')
      .addNodeType(addType)
      .addNodeType(mulType)
      .addNodeInstance(add1)
      .addNodeInstance(mul1)
      .addConnection(connect('Start', 'a', 'add1', 'a'))
      .addConnection(connect('Start', 'b', 'add1', 'b'))
      .addConnection(connect('add1', 'sum', 'mul1', 'x'))
      .addConnection(connect('Start', 'factor', 'mul1', 'factor'))
      .addConnection(connect('mul1', 'product', 'Exit', 'result'))
      .addImport(importDecl([namedImport('add'), namedImport('multiply')], './math'))
      .metadata('version', '2.0')
      .build();

    expect(ast.nodeTypes).toHaveLength(2);
    expect(ast.instances).toHaveLength(2);
    expect(ast.connections).toHaveLength(5);
    expect(ast.imports).toHaveLength(1);
    expect(ast.description).toBe('A calculation pipeline');
    expect(ast.metadata?.version).toBe('2.0');
  });

  it('builds a scoped workflow with parent instances', () => {
    const forEachType = nodeType('ForEach', 'forEach')
      .scope('iteration')
      .input('items', port('ARRAY'))
      .output('results', port('ARRAY'))
      .successPort()
      .build();

    const procType = nodeType('Process', 'process')
      .input('item', port('ANY'))
      .output('result', port('ANY'))
      .successPort()
      .build();

    const forEach1 = nodeInstance('forEach1', 'ForEach').build();
    const proc1 = nodeInstance('proc1', 'Process')
      .parentScope('forEach1.iteration')
      .build();

    const ast = workflow('pipeline', 'runPipeline', './pipeline.ts')
      .addNodeType(forEachType)
      .addNodeType(procType)
      .addNodeInstance(forEach1)
      .addNodeInstance(proc1)
      .addScope('forEach1.iteration', ['proc1'])
      .addConnection(connect('Start', 'items', 'forEach1', 'items'))
      .addConnection(connect('forEach1', 'results', 'Exit', 'results'))
      .build();

    expect(ast.scopes).toEqual({ 'forEach1.iteration': ['proc1'] });
    expect(proc1.parent).toEqual({ id: 'forEach1', scope: 'iteration' });
  });

  it('uses portRef with connection builder for scoped port references', () => {
    const from = portRef('forEach1', 'item');
    const to = portRef('proc1', 'input');

    const conn = connection(from, to)
      .dataFlow()
      .metadata('scope', 'iteration')
      .build();

    expect(conn.from).toEqual({ node: 'forEach1', port: 'item' });
    expect(conn.to).toEqual({ node: 'proc1', port: 'input' });
    expect(conn.metadata?.isDataFlow).toBe(true);
    expect(conn.metadata?.scope).toBe('iteration');
  });
});

// ---------------------------------------------------------------------------
// Edge cases and metadata overwrite behavior
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('metadata overwrites same key', () => {
    const nt = nodeType('N', 'n')
      .metadata('key', 'first')
      .metadata('key', 'second')
      .build();

    expect(nt.metadata).toEqual({ key: 'second' });
  });

  it('workflow metadata overwrites same key', () => {
    const ast = workflow('w', 'w', 'w.ts')
      .metadata('key', 1)
      .metadata('key', 2)
      .build();

    expect(ast.metadata).toEqual({ key: 2 });
  });

  it('instance metadata overwrites same key', () => {
    const inst = nodeInstance('n', 'T')
      .metadata('key', 'a')
      .metadata('key', 'b')
      .build();

    expect(inst.metadata).toEqual({ key: 'b' });
  });

  it('connection metadata overwrites same key', () => {
    const conn = connection(portRef('A', 'p'), portRef('B', 'q'))
      .metadata('key', 10)
      .metadata('key', 20)
      .build();

    expect(conn.metadata).toEqual({ key: 20 });
  });

  it('metadata can store complex objects', () => {
    const nt = nodeType('N', 'n')
      .metadata('nested', { a: [1, 2, 3], b: { c: true } })
      .build();

    expect(nt.metadata?.nested).toEqual({ a: [1, 2, 3], b: { c: true } });
  });

  it('metadata can store undefined values', () => {
    const nt = nodeType('N', 'n')
      .metadata('explicit', undefined)
      .build();

    expect(nt.metadata).toHaveProperty('explicit');
    expect(nt.metadata?.explicit).toBeUndefined();
  });

  it('input port with all TPortDefinition options', () => {
    const nt = nodeType('N', 'n')
      .input('data', {
        dataType: 'OBJECT',
        optional: true,
        default: { key: 'value' },
        label: 'Input Data',
        description: 'The data to process',
      })
      .build();

    expect(nt.inputs.data).toEqual({
      dataType: 'OBJECT',
      optional: true,
      default: { key: 'value' },
      label: 'Input Data',
      description: 'The data to process',
    });
  });

  it('port() spreads no extra keys when options is empty object', () => {
    const p = port('STEP', {});
    expect(p).toEqual({ dataType: 'STEP' });
  });

  it('nodeType default executeWhen matches EXECUTION_STRATEGIES.CONJUNCTION', () => {
    const nt = nodeType('N', 'n').build();
    expect(nt.executeWhen).toBe('CONJUNCTION');
    expect(nt.executeWhen).toBe(EXECUTION_STRATEGIES.CONJUNCTION);
  });

  it('import declarations with all specifier kinds', () => {
    const imp = importDecl(
      [
        namedImport('useState'),
        namedImport('useEffect', 'effect'),
        defaultImport('React'),
        namespaceImport('ReactDOM'),
      ],
      'react',
      'value',
    );

    expect(imp.specifiers).toEqual([
      { imported: 'useState', local: 'useState', kind: 'named' },
      { imported: 'useEffect', local: 'effect', kind: 'named' },
      { imported: 'default', local: 'React', kind: 'default' },
      { imported: '*', local: 'ReactDOM', kind: 'namespace' },
    ]);
  });

  it('addScope with empty instance array', () => {
    const ast = workflow('w', 'w', 'w.ts')
      .addScope('empty.scope', [])
      .build();

    expect(ast.scopes).toEqual({ 'empty.scope': [] });
  });

  it('addScope overwrites same scope name', () => {
    const ast = workflow('w', 'w', 'w.ts')
      .addScope('s', ['a'])
      .addScope('s', ['b', 'c'])
      .build();

    expect(ast.scopes).toEqual({ s: ['b', 'c'] });
  });

  it('connection with scope on port references', () => {
    const conn = new ConnectionBuilder(
      { node: 'loop', port: 'item', scope: 'iteration' },
      { node: 'proc', port: 'input', scope: 'iteration' },
    ).build();

    expect(conn.from.scope).toBe('iteration');
    expect(conn.to.scope).toBe('iteration');
  });

  it('branchingStrategy with empty string field is not set', () => {
    const nt = nodeType('N', 'n')
      .branchingStrategy('value-based', '')
      .build();

    // Empty string is falsy, so branchField should not be set
    expect(nt.branchingStrategy).toBe('value-based');
    expect(nt.branchField).toBeUndefined();
  });
});
