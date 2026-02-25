/**
 * Tests for sugar-optimizer.ts
 * Path detection, validation, and sugar coverage checks.
 */

import {
  validatePathMacro,
  filterStaleMacros,
  detectSugarPatterns,
  isConnectionCoveredBySugar,
} from '../../src/sugar-optimizer';
import type {
  TConnectionAST,
  TNodeInstanceAST,
  TNodeTypeAST,
  TPathMacro,
  TWorkflowMacro,
  TPortDefinition,
} from '../../src/ast/types';

// Helpers to build test data
function conn(fromNode: string, fromPort: string, toNode: string, toPort: string): TConnectionAST {
  return {
    from: { node: fromNode, port: fromPort },
    to: { node: toNode, port: toPort },
  };
}

function inst(id: string, nodeType: string): TNodeInstanceAST {
  return { id, nodeType } as TNodeInstanceAST;
}

function pathMacro(steps: Array<{ node: string; route?: 'ok' | 'fail' }>): TPathMacro {
  return { type: 'path', steps };
}

function nodeType(name: string, inputs: Record<string, TPortDefinition> = {}, outputs: Record<string, TPortDefinition> = {}): TNodeTypeAST {
  return {
    name,
    functionName: name,
    inputs,
    outputs,
  } as TNodeTypeAST;
}

function port(dataType: string = 'string'): TPortDefinition {
  return { dataType } as TPortDefinition;
}

describe('sugar-optimizer', () => {
  describe('validatePathMacro', () => {
    const instances = [inst('a', 'TypeA'), inst('b', 'TypeB'), inst('c', 'TypeC')];

    it('should validate a simple Start -> a -> Exit path', () => {
      const path = pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'Exit' }]);
      const connections = [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'onSuccess', 'Exit', 'onSuccess'),
      ];
      expect(validatePathMacro(path, connections, instances)).toBe(true);
    });

    it('should validate a path with fail route to Exit', () => {
      const path = pathMacro([{ node: 'a', route: 'fail' }, { node: 'Exit' }]);
      const connections = [conn('a', 'onFailure', 'Exit', 'onFailure')];
      expect(validatePathMacro(path, connections, instances)).toBe(true);
    });

    it('should validate a multi-step path', () => {
      const path = pathMacro([
        { node: 'Start' },
        { node: 'a' },
        { node: 'b' },
        { node: 'c' },
        { node: 'Exit' },
      ]);
      const connections = [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'onSuccess', 'b', 'execute'),
        conn('b', 'onSuccess', 'c', 'execute'),
        conn('c', 'onSuccess', 'Exit', 'onSuccess'),
      ];
      expect(validatePathMacro(path, connections, instances)).toBe(true);
    });

    it('should return false when a node instance is missing', () => {
      const path = pathMacro([{ node: 'Start' }, { node: 'missing' }, { node: 'Exit' }]);
      const connections = [
        conn('Start', 'execute', 'missing', 'execute'),
        conn('missing', 'onSuccess', 'Exit', 'onSuccess'),
      ];
      expect(validatePathMacro(path, connections, instances)).toBe(false);
    });

    it('should return false when a connection is missing', () => {
      const path = pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'b' }, { node: 'Exit' }]);
      const connections = [
        conn('Start', 'execute', 'a', 'execute'),
        // missing a.onSuccess -> b.execute
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ];
      expect(validatePathMacro(path, connections, instances)).toBe(false);
    });

    it('should ignore scoped connections', () => {
      const path = pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'Exit' }]);
      const connections = [
        { from: { node: 'Start', port: 'execute', scope: 'myScope' }, to: { node: 'a', port: 'execute' } },
        conn('a', 'onSuccess', 'Exit', 'onSuccess'),
      ] as TConnectionAST[];
      // Start->a connection is scoped so not found in unscoped lookup
      expect(validatePathMacro(path, connections, instances)).toBe(false);
    });

    it('should validate fail route between non-Exit nodes', () => {
      const path = pathMacro([
        { node: 'a', route: 'fail' },
        { node: 'b' },
        { node: 'Exit' },
      ]);
      const connections = [
        conn('a', 'onFailure', 'b', 'execute'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ];
      expect(validatePathMacro(path, connections, instances)).toBe(true);
    });
  });

  describe('filterStaleMacros', () => {
    const instances = [inst('a', 'TypeA'), inst('b', 'TypeB')];
    const connections = [
      conn('Start', 'execute', 'a', 'execute'),
      conn('a', 'onSuccess', 'b', 'execute'),
      conn('b', 'onSuccess', 'Exit', 'onSuccess'),
    ];

    it('should keep valid path macros', () => {
      const macros: TWorkflowMacro[] = [
        pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'b' }, { node: 'Exit' }]),
      ];
      const result = filterStaleMacros(macros, connections, instances);
      expect(result).toHaveLength(1);
    });

    it('should remove path macros with missing instances', () => {
      const macros: TWorkflowMacro[] = [
        pathMacro([{ node: 'Start' }, { node: 'missing' }, { node: 'Exit' }]),
      ];
      const result = filterStaleMacros(macros, connections, instances);
      expect(result).toHaveLength(0);
    });

    it('should remove path macros with missing connections', () => {
      const macros: TWorkflowMacro[] = [
        pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'Exit' }]),
      ];
      // connection a->Exit is a.onSuccess->b.execute, not a.onSuccess->Exit.onSuccess
      const result = filterStaleMacros(macros, connections, instances);
      expect(result).toHaveLength(0);
    });

    it('should keep fanOut macros when all nodes exist', () => {
      const macros: TWorkflowMacro[] = [
        {
          type: 'fanOut',
          source: { node: 'a', port: 'onSuccess' },
          targets: [{ node: 'b', port: 'execute' }],
        } as TWorkflowMacro,
      ];
      const result = filterStaleMacros(macros, connections, instances);
      expect(result).toHaveLength(1);
    });

    it('should remove fanOut macros when source node is missing', () => {
      const macros: TWorkflowMacro[] = [
        {
          type: 'fanOut',
          source: { node: 'missing', port: 'onSuccess' },
          targets: [{ node: 'b', port: 'execute' }],
        } as TWorkflowMacro,
      ];
      const result = filterStaleMacros(macros, connections, instances);
      expect(result).toHaveLength(0);
    });

    it('should remove fanOut macros when a target node is missing', () => {
      const macros: TWorkflowMacro[] = [
        {
          type: 'fanOut',
          source: { node: 'a', port: 'onSuccess' },
          targets: [{ node: 'missing', port: 'execute' }],
        } as TWorkflowMacro,
      ];
      const result = filterStaleMacros(macros, connections, instances);
      expect(result).toHaveLength(0);
    });

    it('should keep fanIn macros when all nodes exist', () => {
      const macros: TWorkflowMacro[] = [
        {
          type: 'fanIn',
          sources: [{ node: 'a', port: 'onSuccess' }],
          target: { node: 'b', port: 'execute' },
        } as TWorkflowMacro,
      ];
      const result = filterStaleMacros(macros, connections, instances);
      expect(result).toHaveLength(1);
    });

    it('should remove fanIn macros when target node is missing', () => {
      const macros: TWorkflowMacro[] = [
        {
          type: 'fanIn',
          sources: [{ node: 'a', port: 'onSuccess' }],
          target: { node: 'missing', port: 'execute' },
        } as TWorkflowMacro,
      ];
      const result = filterStaleMacros(macros, connections, instances);
      expect(result).toHaveLength(0);
    });

    it('should pass through non-path/fan macros', () => {
      const macros: TWorkflowMacro[] = [
        { type: 'map', instanceId: 'a', childId: 'b' } as TWorkflowMacro,
      ];
      const result = filterStaleMacros(macros, connections, instances);
      expect(result).toHaveLength(1);
    });
  });

  describe('detectSugarPatterns', () => {
    const startPorts: Record<string, TPortDefinition> = {
      execute: port('STEP'),
      data: port('string'),
    };
    const exitPorts: Record<string, TPortDefinition> = {
      onSuccess: port('STEP'),
      onFailure: port('STEP'),
      result: port('string'),
    };

    it('should detect a simple linear path', () => {
      const connections = [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'onSuccess', 'Exit', 'onSuccess'),
        conn('Start', 'data', 'a', 'data'),
        conn('a', 'result', 'Exit', 'result'),
      ];
      const instances = [inst('a', 'TypeA')];
      const nodeTypes = [nodeType('TypeA', { execute: port('STEP'), data: port('string') }, { onSuccess: port('STEP'), onFailure: port('STEP'), result: port('string') })];

      const result = detectSugarPatterns(connections, instances, [], nodeTypes, startPorts, exitPorts);
      expect(result.paths.length).toBeGreaterThan(0);
      expect(result.paths[0].steps[0].node).toBe('Start');
    });

    it('should detect multi-step paths', () => {
      const connections = [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'onSuccess', 'b', 'execute'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
      ];
      const instances = [inst('a', 'TypeA'), inst('b', 'TypeB')];
      const nodeTypes = [
        nodeType('TypeA', { execute: port('STEP') }, { onSuccess: port('STEP'), onFailure: port('STEP') }),
        nodeType('TypeB', { execute: port('STEP') }, { onSuccess: port('STEP'), onFailure: port('STEP') }),
      ];

      const result = detectSugarPatterns(connections, instances, [], nodeTypes, startPorts, exitPorts);
      expect(result.paths.length).toBeGreaterThan(0);
      const longestPath = result.paths.reduce((a, b) => a.steps.length > b.steps.length ? a : b);
      expect(longestPath.steps.length).toBe(4); // Start -> a -> b -> Exit
    });

    it('should not detect paths when Start is covered by existing macros', () => {
      const connections = [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'onSuccess', 'Exit', 'onSuccess'),
      ];
      const instances = [inst('a', 'TypeA')];
      const nodeTypes = [nodeType('TypeA', { execute: port('STEP') }, { onSuccess: port('STEP'), onFailure: port('STEP') })];
      const existingMacros: TWorkflowMacro[] = [
        pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'Exit' }]),
      ];

      const result = detectSugarPatterns(connections, instances, existingMacros, nodeTypes, startPorts, exitPorts);
      expect(result.paths).toHaveLength(0);
    });

    it('should skip scoped connections', () => {
      const connections: TConnectionAST[] = [
        { from: { node: 'Start', port: 'execute', scope: 'myScope' }, to: { node: 'a', port: 'execute' } },
        conn('a', 'onSuccess', 'Exit', 'onSuccess'),
      ];
      const instances = [inst('a', 'TypeA')];
      const nodeTypes = [nodeType('TypeA', { execute: port('STEP') }, { onSuccess: port('STEP'), onFailure: port('STEP') })];

      const result = detectSugarPatterns(connections, instances, [], nodeTypes, startPorts, exitPorts);
      expect(result.paths).toHaveLength(0);
    });

    it('should return empty when no control-flow connections exist', () => {
      const connections = [conn('Start', 'data', 'a', 'data')];
      const instances = [inst('a', 'TypeA')];
      const nodeTypes = [nodeType('TypeA', { data: port('string') }, { result: port('string') })];

      const result = detectSugarPatterns(connections, instances, [], nodeTypes, startPorts, exitPorts);
      expect(result.paths).toHaveLength(0);
    });

    it('should handle fail routes in paths', () => {
      const connections = [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'onFailure', 'Exit', 'onFailure'),
      ];
      const instances = [inst('a', 'TypeA')];
      const nodeTypes = [nodeType('TypeA', { execute: port('STEP') }, { onSuccess: port('STEP'), onFailure: port('STEP') })];

      const result = detectSugarPatterns(connections, instances, [], nodeTypes, startPorts, exitPorts);
      expect(result.paths.length).toBeGreaterThan(0);
    });

    it('should not create paths for multi-target ports', () => {
      // a.onSuccess goes to both b and c - not pathable
      const connections = [
        conn('Start', 'execute', 'a', 'execute'),
        conn('a', 'onSuccess', 'b', 'execute'),
        conn('a', 'onSuccess', 'c', 'execute'),
        conn('b', 'onSuccess', 'Exit', 'onSuccess'),
        conn('c', 'onSuccess', 'Exit', 'onSuccess'),
      ];
      const instances = [inst('a', 'TypeA'), inst('b', 'TypeB'), inst('c', 'TypeC')];
      const nodeTypes = [
        nodeType('TypeA', { execute: port('STEP') }, { onSuccess: port('STEP'), onFailure: port('STEP') }),
        nodeType('TypeB', { execute: port('STEP') }, { onSuccess: port('STEP'), onFailure: port('STEP') }),
        nodeType('TypeC', { execute: port('STEP') }, { onSuccess: port('STEP'), onFailure: port('STEP') }),
      ];

      const result = detectSugarPatterns(connections, instances, [], nodeTypes, startPorts, exitPorts);
      // No path can go through a since a.onSuccess is multi-target
      for (const p of result.paths) {
        const steps = p.steps.map(s => s.node);
        if (steps.includes('a')) {
          // If a is included, it should not use onSuccess as that's multi-target
          const aIdx = steps.indexOf('a');
          const aStep = p.steps[aIdx];
          expect(aStep.route).not.toBe('ok');
        }
      }
    });
  });

  describe('isConnectionCoveredBySugar', () => {
    it('should detect control-flow coverage for Start -> node', () => {
      const sugar = { paths: [pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'Exit' }])] };
      const c = conn('Start', 'execute', 'a', 'execute');
      expect(isConnectionCoveredBySugar(c, sugar)).toBe(true);
    });

    it('should detect control-flow coverage for node -> Exit (ok route)', () => {
      const sugar = { paths: [pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'Exit' }])] };
      const c = conn('a', 'onSuccess', 'Exit', 'onSuccess');
      expect(isConnectionCoveredBySugar(c, sugar)).toBe(true);
    });

    it('should detect control-flow coverage for node -> Exit (fail route)', () => {
      const sugar = { paths: [pathMacro([{ node: 'a', route: 'fail' }, { node: 'Exit' }])] };
      const c = conn('a', 'onFailure', 'Exit', 'onFailure');
      expect(isConnectionCoveredBySugar(c, sugar)).toBe(true);
    });

    it('should detect control-flow coverage for node -> node (ok)', () => {
      const sugar = { paths: [pathMacro([{ node: 'a' }, { node: 'b' }, { node: 'Exit' }])] };
      const c = conn('a', 'onSuccess', 'b', 'execute');
      expect(isConnectionCoveredBySugar(c, sugar)).toBe(true);
    });

    it('should detect control-flow coverage for node -> node (fail)', () => {
      const sugar = { paths: [pathMacro([{ node: 'a', route: 'fail' }, { node: 'b' }, { node: 'Exit' }])] };
      const c = conn('a', 'onFailure', 'b', 'execute');
      expect(isConnectionCoveredBySugar(c, sugar)).toBe(true);
    });

    it('should detect same-name data port coverage', () => {
      const sugar = { paths: [pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'b' }, { node: 'Exit' }])] };
      const c = conn('a', 'data', 'b', 'data');
      expect(isConnectionCoveredBySugar(c, sugar)).toBe(true);
    });

    it('should not cover scoped connections', () => {
      const sugar = { paths: [pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'Exit' }])] };
      const c = {
        from: { node: 'Start', port: 'execute', scope: 'myScope' },
        to: { node: 'a', port: 'execute' },
      } as TConnectionAST;
      expect(isConnectionCoveredBySugar(c, sugar)).toBe(false);
    });

    it('should not cover connections not in any path', () => {
      const sugar = { paths: [pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'Exit' }])] };
      const c = conn('b', 'onSuccess', 'c', 'execute');
      expect(isConnectionCoveredBySugar(c, sugar)).toBe(false);
    });

    it('should not cover data connections to Exit', () => {
      const sugar = { paths: [pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'Exit' }])] };
      // data connection to Exit - not covered by scope walking
      const c = conn('a', 'result', 'Exit', 'result');
      expect(isConnectionCoveredBySugar(c, sugar)).toBe(false);
    });

    it('should not cover different-name data connections', () => {
      const sugar = { paths: [pathMacro([{ node: 'Start' }, { node: 'a' }, { node: 'b' }, { node: 'Exit' }])] };
      const c = conn('a', 'output', 'b', 'input');
      expect(isConnectionCoveredBySugar(c, sugar)).toBe(false);
    });

    it('should handle empty sugar paths', () => {
      const sugar = { paths: [] };
      const c = conn('a', 'onSuccess', 'b', 'execute');
      expect(isConnectionCoveredBySugar(c, sugar)).toBe(false);
    });
  });
});
