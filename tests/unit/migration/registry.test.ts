import { describe, it, expect } from 'vitest';
import { applyMigrations, getRegisteredMigrations } from '../../../src/migration/registry.js';
import type { TWorkflowAST } from '../../../src/ast/types.js';

function makeAST(overrides?: Partial<TWorkflowAST>): TWorkflowAST {
  return {
    type: 'Workflow',
    sourceFile: '/test/workflow.ts',
    name: 'testWorkflow',
    functionName: 'testWorkflow',
    nodeTypes: [],
    instances: [],
    connections: [],
    ...overrides,
  } as TWorkflowAST;
}

describe('applyMigrations', () => {
  it('returns the AST unchanged when no migrations are registered', () => {
    const ast = makeAST();
    const result = applyMigrations(ast);

    expect(result).toBe(ast);
  });

  it('preserves all fields on the AST', () => {
    const ast = makeAST({
      name: 'complex-workflow',
      instances: [{ type: 'NodeInstance', id: 'a', nodeType: 'process', config: {} }] as TWorkflowAST['instances'],
      connections: [
        { from: { node: 'a', port: 'onSuccess' }, to: { node: 'b', port: 'execute' } },
      ] as TWorkflowAST['connections'],
    });
    const result = applyMigrations(ast);

    expect(result.name).toBe('complex-workflow');
    expect(result.instances).toHaveLength(1);
    expect(result.connections).toHaveLength(1);
  });
});

describe('getRegisteredMigrations', () => {
  it('returns an empty array', () => {
    const migrations = getRegisteredMigrations();

    expect(migrations).toEqual([]);
  });

  it('returns a readonly array', () => {
    const migrations = getRegisteredMigrations();

    expect(Array.isArray(migrations)).toBe(true);
    expect(migrations.length).toBe(0);
  });
});
