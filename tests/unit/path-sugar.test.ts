/**
 * @path Sugar Tests
 *
 * Tests the @path annotation that provides syntactic sugar for multi-step
 * execution routes with scope walking (backward ancestor resolution for data ports).
 * Covers: Chevrotain parser, JSDoc integration, parser expansion, round-trip,
 * node deletion/rename, and coverage checking.
 */

import { describe, it, expect } from 'vitest';
import { parsePathLine } from '../../src/chevrotain-parser/path-parser';
import { AnnotationParser } from '../../src/parser';
import { annotationGenerator } from '../../src/annotation-generator';
import { removeNode, renameNode } from '../../src/api/manipulation/nodes';

// =============================================================================
// Source helpers
// =============================================================================

/**
 * Simple 3-node linear path: Start -> validator -> transformer -> Exit
 * validator outputs: message, score
 * transformer inputs: message, score; outputs: message, score
 */
function simplePathSource(extra = '') {
  return `
/**
 * @flowWeaver nodeType
 * @input message
 * @output message
 * @output score
 */
function validate(execute: boolean, message: string): {
  onSuccess: boolean;
  onFailure: boolean;
  message: string;
  score: number;
} {
  if (!execute) return { onSuccess: false, onFailure: false, message: '', score: 0 };
  return { onSuccess: true, onFailure: false, message, score: 1 };
}

/**
 * @flowWeaver nodeType
 * @input message
 * @input score
 * @output message
 * @output score
 */
function transform(execute: boolean, message: string, score: number): {
  onSuccess: boolean;
  onFailure: boolean;
  message: string;
  score: number;
} {
  if (!execute) return { onSuccess: false, onFailure: false, message: '', score: 0 };
  return { onSuccess: true, onFailure: false, message: message.toUpperCase(), score: score * 2 };
}

/**
 * @flowWeaver workflow
 * @node validator validate
 * @node transformer transform
 * @path Start -> validator -> transformer -> Exit
 * ${extra}
 */
export function simplePath(
  execute: boolean,
  params: { message: string }
): { onSuccess: boolean; onFailure: boolean; message: string; score: number } {
  throw new Error('Not implemented');
}
`;
}

/**
 * Branching path with :ok/:fail suffixes.
 * Models a message-triage-like topology:
 *   Start -> validator -> classifier -> urgencyRouter -> handler -> Exit
 *   Start -> validator -> classifier -> urgencyRouter:fail -> escalate -> Exit
 *
 * validator outputs: message, priority
 * classifier inputs: message; outputs: message, category, priority
 * urgencyRouter inputs: priority; outputs: priority
 * handler inputs: message, category; outputs: result
 * escalate inputs: message, priority; outputs: result
 */
function branchingPathSource(extra = '') {
  return `
/**
 * @flowWeaver nodeType
 * @input message
 * @output message
 * @output priority
 */
function validate(execute: boolean, message: string): {
  onSuccess: boolean;
  onFailure: boolean;
  message: string;
  priority: number;
} {
  if (!execute) return { onSuccess: false, onFailure: false, message: '', priority: 0 };
  return { onSuccess: true, onFailure: false, message, priority: 1 };
}

/**
 * @flowWeaver nodeType
 * @input message
 * @output message
 * @output category
 * @output priority
 */
function classify(execute: boolean, message: string): {
  onSuccess: boolean;
  onFailure: boolean;
  message: string;
  category: string;
  priority: number;
} {
  if (!execute) return { onSuccess: false, onFailure: false, message: '', category: '', priority: 0 };
  return { onSuccess: true, onFailure: false, message, category: 'general', priority: 1 };
}

/**
 * @flowWeaver nodeType
 * @input priority
 * @output priority
 */
function routeUrgency(execute: boolean, priority: number): {
  onSuccess: boolean;
  onFailure: boolean;
  priority: number;
} {
  if (!execute) return { onSuccess: false, onFailure: false, priority: 0 };
  if (priority > 5) return { onSuccess: false, onFailure: true, priority };
  return { onSuccess: true, onFailure: false, priority };
}

/**
 * @flowWeaver nodeType
 * @input message
 * @input category
 * @output result
 */
function handle(execute: boolean, message: string, category: string): {
  onSuccess: boolean;
  onFailure: boolean;
  result: string;
} {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: category + ': ' + message };
}

/**
 * @flowWeaver nodeType
 * @input message
 * @input priority
 * @output result
 */
function escalate(execute: boolean, message: string, priority: number): {
  onSuccess: boolean;
  onFailure: boolean;
  result: string;
} {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: 'URGENT(' + priority + '): ' + message };
}

/**
 * @flowWeaver workflow
 * @node validator validate
 * @node classifier classify
 * @node urgencyRouter routeUrgency
 * @node handler handle
 * @node esc escalate
 * @path Start -> validator -> classifier -> urgencyRouter -> handler -> Exit
 * @path Start -> validator -> classifier -> urgencyRouter:fail -> esc -> Exit
 * ${extra}
 */
export function triageWorkflow(
  execute: boolean,
  params: { message: string }
): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error('Not implemented');
}
`;
}

// ============================================================================
// 1. Chevrotain Parser — parsePathLine
// ============================================================================

describe('@path Chevrotain parser', () => {
  it('should parse basic @path with 3 steps', () => {
    const warnings: string[] = [];
    const results = parsePathLine('@path Start -> A -> Exit', warnings);

    expect(warnings).toHaveLength(0);
    expect(results).not.toBeNull();
    expect(results!).toHaveLength(1);
    expect(results![0].steps).toHaveLength(3);
    expect(results![0].steps[0]).toEqual({ node: 'Start' });
    expect(results![0].steps[1]).toEqual({ node: 'A' });
    expect(results![0].steps[2]).toEqual({ node: 'Exit' });
  });

  it('should parse route suffixes :ok and :fail', () => {
    const warnings: string[] = [];
    const results = parsePathLine('@path Start -> A:ok -> B:fail -> Exit', warnings);

    expect(warnings).toHaveLength(0);
    expect(results).not.toBeNull();
    expect(results![0].steps).toHaveLength(4);
    expect(results![0].steps[1]).toEqual({ node: 'A', route: 'ok' });
    expect(results![0].steps[2]).toEqual({ node: 'B', route: 'fail' });
  });

  it('should reject single-step path', () => {
    const warnings: string[] = [];
    const result = parsePathLine('@path Start', warnings);
    expect(result).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('should return null for non-@path input', () => {
    const warnings: string[] = [];
    const result = parsePathLine('@pipeline A -> B', warnings);
    expect(result).toBeNull();
  });

  it('should return null for empty input', () => {
    const warnings: string[] = [];
    const result = parsePathLine('', warnings);
    expect(result).toBeNull();
  });

  it('should warn on invalid suffix and ignore it', () => {
    const warnings: string[] = [];
    const results = parsePathLine('@path Start -> A:nope -> Exit', warnings);

    expect(results).not.toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('invalid route suffix');
    // The node should still be parsed, just without a route
    expect(results![0].steps[1]).toEqual({ node: 'A' });
  });
});

// ============================================================================
// 2. JSDoc Parser Integration
// ============================================================================

describe('@path JSDoc parser integration', () => {
  it('should parse @path tag in workflow config', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(simplePathSource());

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    expect(workflow).toBeDefined();
    expect(workflow.macros).toBeDefined();
    expect(workflow.macros).toHaveLength(1);
    expect(workflow.macros![0].type).toBe('path');
  });

  it('should parse multiple @path tags', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(branchingPathSource());

    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    expect(workflow.macros).toBeDefined();

    const pathMacros = workflow.macros!.filter(m => m.type === 'path');
    expect(pathMacros).toHaveLength(2);
  });
});

// ============================================================================
// 3. Parser Expansion
// ============================================================================

describe('@path parser expansion', () => {
  const parser = new AnnotationParser();

  it('should generate control flow for simple linear path', () => {
    const result = parser.parseFromString(simplePathSource());
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    // Start.execute -> validator.execute
    expect(workflow.connections.find(c =>
      c.from.node === 'Start' && c.from.port === 'execute' &&
      c.to.node === 'validator' && c.to.port === 'execute'
    )).toBeDefined();

    // validator.onSuccess -> transformer.execute
    expect(workflow.connections.find(c =>
      c.from.node === 'validator' && c.from.port === 'onSuccess' &&
      c.to.node === 'transformer' && c.to.port === 'execute'
    )).toBeDefined();

    // transformer.onSuccess -> Exit.onSuccess
    expect(workflow.connections.find(c =>
      c.from.node === 'transformer' && c.from.port === 'onSuccess' &&
      c.to.node === 'Exit' && c.to.port === 'onSuccess'
    )).toBeDefined();
  });

  it('should generate adjacent data port connections (same-name matching)', () => {
    const result = parser.parseFromString(simplePathSource());
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    // validator.message -> transformer.message
    expect(workflow.connections.find(c =>
      c.from.node === 'validator' && c.from.port === 'message' &&
      c.to.node === 'transformer' && c.to.port === 'message'
    )).toBeDefined();

    // validator.score -> transformer.score
    expect(workflow.connections.find(c =>
      c.from.node === 'validator' && c.from.port === 'score' &&
      c.to.node === 'transformer' && c.to.port === 'score'
    )).toBeDefined();
  });

  it('should generate :fail control flow connections', () => {
    const result = parser.parseFromString(branchingPathSource());
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    // urgencyRouter:fail -> esc: onFailure -> execute
    expect(workflow.connections.find(c =>
      c.from.node === 'urgencyRouter' && c.from.port === 'onFailure' &&
      c.to.node === 'esc' && c.to.port === 'execute'
    )).toBeDefined();

    // urgencyRouter:ok -> handler (default): onSuccess -> execute
    expect(workflow.connections.find(c =>
      c.from.node === 'urgencyRouter' && c.from.port === 'onSuccess' &&
      c.to.node === 'handler' && c.to.port === 'execute'
    )).toBeDefined();
  });

  it('should perform scope walking for non-adjacent data ports', () => {
    const result = parser.parseFromString(branchingPathSource());
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    // Path: Start -> validator -> classifier -> urgencyRouter:fail -> esc -> Exit
    // esc needs 'message' — classifier outputs 'message', so classifier.message -> esc.message
    expect(workflow.connections.find(c =>
      c.from.node === 'classifier' && c.from.port === 'message' &&
      c.to.node === 'esc' && c.to.port === 'message'
    )).toBeDefined();

    // esc needs 'priority' — urgencyRouter outputs 'priority', so urgencyRouter.priority -> esc.priority
    expect(workflow.connections.find(c =>
      c.from.node === 'urgencyRouter' && c.from.port === 'priority' &&
      c.to.node === 'esc' && c.to.port === 'priority'
    )).toBeDefined();
  });

  it('should scope-walk for handler: message from classifier, category from classifier', () => {
    const result = parser.parseFromString(branchingPathSource());
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    // Path: Start -> validator -> classifier -> urgencyRouter -> handler -> Exit
    // handler needs 'message' — walk back: urgencyRouter (no), classifier (yes!)
    expect(workflow.connections.find(c =>
      c.from.node === 'classifier' && c.from.port === 'message' &&
      c.to.node === 'handler' && c.to.port === 'message'
    )).toBeDefined();

    // handler needs 'category' — walk back: urgencyRouter (no), classifier (yes!)
    expect(workflow.connections.find(c =>
      c.from.node === 'classifier' && c.from.port === 'category' &&
      c.to.node === 'handler' && c.to.port === 'category'
    )).toBeDefined();
  });

  it('should deduplicate connections from overlapping paths', () => {
    const result = parser.parseFromString(branchingPathSource());
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    // Both paths share Start -> validator -> classifier -> urgencyRouter
    // Start.execute -> validator.execute should appear only once
    const startToValidator = workflow.connections.filter(c =>
      c.from.node === 'Start' && c.from.port === 'execute' &&
      c.to.node === 'validator' && c.to.port === 'execute'
    );
    expect(startToValidator).toHaveLength(1);

    // validator.onSuccess -> classifier.execute should appear only once
    const valToClass = workflow.connections.filter(c =>
      c.from.node === 'validator' && c.from.port === 'onSuccess' &&
      c.to.node === 'classifier' && c.to.port === 'execute'
    );
    expect(valToClass).toHaveLength(1);
  });

  it('should resolve Exit data ports by name from the nearest ancestor in the path', () => {
    const result = parser.parseFromString(simplePathSource());
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    // Exit's @returns ports resolve like any other step's inputs; a port with
    // no same-name ancestor output stays unconnected.
    const dataToExit = workflow.connections.filter(c =>
      c.to.node === 'Exit' &&
      c.to.port !== 'onSuccess' && c.to.port !== 'onFailure'
    );
    for (const conn of dataToExit) {
      expect(conn.from.port).toBe(conn.to.port);
      expect(conn.from.node).not.toBe('Start');
      expect(Object.keys(workflow.exitPorts ?? {})).toContain(conn.to.port);
    }
  });

  it('should error on unknown node in path', () => {
    const source = `
/**
 * @flowWeaver nodeType
 * @input msg
 * @output msg
 */
function validate(execute: boolean, msg: string): {
  onSuccess: boolean;
  onFailure: boolean;
  msg: string;
} {
  if (!execute) return { onSuccess: false, onFailure: false, msg: '' };
  return { onSuccess: true, onFailure: false, msg };
}

/**
 * @flowWeaver workflow
 * @node validator validate
 * @path Start -> validator -> nonExistent -> Exit
 */
export function badPath(
  execute: boolean,
  params: { msg: string }
): { onSuccess: boolean; onFailure: boolean; msg: string } {
  throw new Error('Not implemented');
}
`;
    const result = parser.parseFromString(source);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('nonExistent'))).toBe(true);
  });
});

// ============================================================================
// 4. Round-Trip Preservation
// ============================================================================

describe('@path round-trip preservation', () => {
  it('should preserve @path through annotation generation', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(simplePathSource());
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    const generated = annotationGenerator.generate(workflow);

    // Should contain @path annotation
    expect(generated).toContain('@path Start -> validator -> transformer -> Exit');

    // Pipeline-covered connections should NOT appear as @connect
    const connectLines = generated.split('\n').filter(l => l.includes('@connect'));
    expect(connectLines).toHaveLength(0);
  });

  it('should preserve @path with route suffixes', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(branchingPathSource());
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    const generated = annotationGenerator.generate(workflow);

    // Should contain path with :fail suffix
    expect(generated).toContain('@path Start -> validator -> classifier -> urgencyRouter:fail -> esc -> Exit');
  });

  it('should preserve explicit @connect lines not covered by path', () => {
    const parser = new AnnotationParser();
    // Add a cross-named connection that @path can't cover
    const result = parser.parseFromString(simplePathSource(
      '@connect validator.score -> Exit.onFailure'
    ));
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    const generated = annotationGenerator.generate(workflow);

    // Path annotation preserved
    expect(generated).toContain('@path');
    // The manual cross-named connection should still be in @connect
    expect(generated).toContain('@connect validator.score -> Exit.onFailure');
  });

  it('should round-trip: parse → generate → re-parse yields same connections', () => {
    const parser = new AnnotationParser();
    const result1 = parser.parseFromString(simplePathSource());
    expect(result1.errors).toHaveLength(0);
    const workflow1 = result1.workflows[0];

    // Generate annotation text
    const generated = annotationGenerator.generate(workflow1);

    // Re-parse: wrap generated annotation in the same source
    const reSource = `
/**
 * @flowWeaver nodeType
 * @input message
 * @output message
 * @output score
 */
function validate(execute: boolean, message: string): {
  onSuccess: boolean;
  onFailure: boolean;
  message: string;
  score: number;
} {
  if (!execute) return { onSuccess: false, onFailure: false, message: '', score: 0 };
  return { onSuccess: true, onFailure: false, message, score: 1 };
}

/**
 * @flowWeaver nodeType
 * @input message
 * @input score
 * @output message
 * @output score
 */
function transform(execute: boolean, message: string, score: number): {
  onSuccess: boolean;
  onFailure: boolean;
  message: string;
  score: number;
} {
  if (!execute) return { onSuccess: false, onFailure: false, message: '', score: 0 };
  return { onSuccess: true, onFailure: false, message: message.toUpperCase(), score: score * 2 };
}

${generated}
export function simplePath(
  execute: boolean,
  params: { message: string }
): { onSuccess: boolean; onFailure: boolean; message: string; score: number } {
  throw new Error('Not implemented');
}
`;

    const result2 = parser.parseFromString(reSource);
    expect(result2.errors).toHaveLength(0);
    const workflow2 = result2.workflows[0];

    // Same number of connections
    expect(workflow2.connections.length).toBe(workflow1.connections.length);

    // Same macros
    expect(workflow2.macros?.length).toBe(workflow1.macros?.length);
    expect(workflow2.macros?.[0].type).toBe('path');
  });
});

// ============================================================================
// 5. Node Delete/Rename Macro Cleanup
// ============================================================================

describe('@path macro cleanup', () => {
  const parser = new AnnotationParser();

  it('should remove @path macro when a node in the path is deleted', () => {
    const result = parser.parseFromString(simplePathSource());
    const workflow = result.workflows[0];
    expect(workflow.macros).toHaveLength(1);

    const updated = removeNode(workflow, 'validator');
    // Path should be removed since it references the deleted node
    expect(updated.macros).toBeUndefined();
  });

  it('should remove only the affected @path macro when one of multiple paths has a node deleted', () => {
    const result = parser.parseFromString(branchingPathSource());
    const workflow = result.workflows[0];

    const pathMacros = workflow.macros!.filter(m => m.type === 'path');
    expect(pathMacros).toHaveLength(2);

    // Delete 'esc' — only in the second path
    const updated = removeNode(workflow, 'esc');
    const remainingPaths = updated.macros?.filter(m => m.type === 'path');
    expect(remainingPaths).toHaveLength(1);
  });

  it('should update @path macro when a node in the path is renamed', () => {
    const result = parser.parseFromString(simplePathSource());
    const workflow = result.workflows[0];

    const updated = renameNode(workflow, 'validator', 'checker');
    expect(updated.macros).toHaveLength(1);
    if (updated.macros![0].type === 'path') {
      const nodeNames = updated.macros![0].steps.map(s => s.node);
      expect(nodeNames).toContain('checker');
      expect(nodeNames).not.toContain('validator');
    }
  });
});

// ============================================================================
// 6. Coverage Checking
// ============================================================================

describe('@path coverage checking', () => {
  it('should suppress @connect for control flow covered by path', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(simplePathSource());
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    const generated = annotationGenerator.generate(workflow);

    // All connections in this simple path should be covered
    const connectLines = generated.split('\n').filter(l => l.includes('@connect'));
    expect(connectLines).toHaveLength(0);
  });

  it('should suppress @connect for scope-walked data covered by path', () => {
    const parser = new AnnotationParser();
    const result = parser.parseFromString(branchingPathSource());
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    const generated = annotationGenerator.generate(workflow);

    // All connections should be covered by the two @path macros
    const connectLines = generated.split('\n').filter(l => l.includes('@connect'));
    expect(connectLines).toHaveLength(0);
  });

  it('should NOT suppress @connect for cross-named connections', () => {
    const parser = new AnnotationParser();
    // Add a cross-named connection (different port names)
    const result = parser.parseFromString(simplePathSource(
      '@connect validator.message -> Exit.onFailure'
    ));
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];
    const generated = annotationGenerator.generate(workflow);

    // The cross-named connection should still appear as @connect
    expect(generated).toContain('@connect validator.message -> Exit.onFailure');
  });
});

// ============================================================================
// 7. @path + @connect conflict resolution
// ============================================================================

/**
 * Two-node path where both nodes share a "result" port AND a "data" port.
 * nodeA outputs: result, data
 * nodeB inputs: result, data; outputs: result, data
 *
 * @path A -> B would auto-wire both result and data.
 * We test that a manual @connect targeting B.result takes priority over
 * the @path auto-wire, avoiding MULTIPLE_CONNECTIONS_TO_INPUT.
 */
function conflictPathSource(extra = '') {
  return `
/**
 * @flowWeaver nodeType
 * @input data
 * @output result
 * @output data
 */
function produce(execute: boolean, data: string): {
  onSuccess: boolean;
  onFailure: boolean;
  result: string;
  data: string;
} {
  if (!execute) return { onSuccess: false, onFailure: false, result: '', data: '' };
  return { onSuccess: true, onFailure: false, result: 'ok', data };
}

/**
 * @flowWeaver nodeType
 * @input result
 * @input data
 * @output result
 * @output data
 */
function consume(execute: boolean, result: string, data: string): {
  onSuccess: boolean;
  onFailure: boolean;
  result: string;
  data: string;
} {
  if (!execute) return { onSuccess: false, onFailure: false, result: '', data: '' };
  return { onSuccess: true, onFailure: false, result, data };
}

/**
 * @flowWeaver workflow
 * @node A produce
 * @node B consume
 * @path Start -> A -> B -> Exit
 * ${extra}
 */
export function conflictWorkflow(
  execute: boolean,
  params: { data: string }
): { onSuccess: boolean; onFailure: boolean; result: string; data: string } {
  throw new Error('Not implemented');
}
`;
}

/**
 * Three-node chain: A -> B -> C, all sharing a "result" port.
 */
function threeNodeConflictSource(extra = '') {
  return `
/**
 * @flowWeaver nodeType
 * @input data
 * @output result
 * @output data
 */
function stepA(execute: boolean, data: string): {
  onSuccess: boolean;
  onFailure: boolean;
  result: string;
  data: string;
} {
  if (!execute) return { onSuccess: false, onFailure: false, result: '', data: '' };
  return { onSuccess: true, onFailure: false, result: 'a-result', data };
}

/**
 * @flowWeaver nodeType
 * @input data
 * @output result
 * @output data
 */
function stepB(execute: boolean, data: string): {
  onSuccess: boolean;
  onFailure: boolean;
  result: string;
  data: string;
} {
  if (!execute) return { onSuccess: false, onFailure: false, result: '', data: '' };
  return { onSuccess: true, onFailure: false, result: 'b-result', data };
}

/**
 * @flowWeaver nodeType
 * @input result
 * @input data
 */
function stepC(execute: boolean, result: string, data: string): {
  onSuccess: boolean;
  onFailure: boolean;
} {
  if (!execute) return { onSuccess: false, onFailure: false };
  return { onSuccess: true, onFailure: false };
}

/**
 * @flowWeaver workflow
 * @node A stepA
 * @node B stepB
 * @node C stepC
 * @path Start -> A -> B -> C -> Exit
 * ${extra}
 */
export function chainWorkflow(
  execute: boolean,
  params: { data: string }
): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('Not implemented');
}
`;
}

describe('@path + @connect conflict resolution', () => {
  const parser = new AnnotationParser();

  it('manual @connect should take priority over @path auto-wire for same target port', () => {
    // @path A -> B would auto-wire A.result -> B.result (same-name match)
    // But @connect A.data -> B.result overrides: manual connect to B.result wins
    const result = parser.parseFromString(conflictPathSource(
      '@connect A.data -> B.result'
    ));

    // Must not produce errors (no MULTIPLE_CONNECTIONS)
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    // The manual @connect A.data -> B.result must exist
    expect(workflow.connections.find(c =>
      c.from.node === 'A' && c.from.port === 'data' &&
      c.to.node === 'B' && c.to.port === 'result'
    )).toBeDefined();

    // The auto-wire A.result -> B.result must NOT exist (manual connect took the port)
    expect(workflow.connections.find(c =>
      c.from.node === 'A' && c.from.port === 'result' &&
      c.to.node === 'B' && c.to.port === 'result'
    )).toBeUndefined();

    // Only one connection targeting B.result
    const toBResult = workflow.connections.filter(c =>
      c.to.node === 'B' && c.to.port === 'result'
    );
    expect(toBResult).toHaveLength(1);
  });

  it('@path auto-wiring still works when no manual @connect conflicts', () => {
    // No extra @connect — @path should auto-wire both A.result -> B.result
    // and A.data -> B.data
    const result = parser.parseFromString(conflictPathSource());
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    expect(workflow.connections.find(c =>
      c.from.node === 'A' && c.from.port === 'result' &&
      c.to.node === 'B' && c.to.port === 'result'
    )).toBeDefined();

    expect(workflow.connections.find(c =>
      c.from.node === 'A' && c.from.port === 'data' &&
      c.to.node === 'B' && c.to.port === 'data'
    )).toBeDefined();
  });

  it('@path A -> B -> C with manual @connect B.result -> C.result should not duplicate', () => {
    // @path would auto-wire B.result -> C.result (same-name match)
    // Manual @connect B.result -> C.result is the same connection — no duplicate
    const result = parser.parseFromString(threeNodeConflictSource(
      '@connect B.result -> C.result'
    ));
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    // Only one connection targeting C.result
    const toCResult = workflow.connections.filter(c =>
      c.to.node === 'C' && c.to.port === 'result'
    );
    expect(toCResult).toHaveLength(1);
  });

  it('@path still auto-wires control flow even when manual @connect exists for data ports', () => {
    // Manual @connect on data port should not affect control flow auto-wiring
    const result = parser.parseFromString(conflictPathSource(
      '@connect A.data -> B.result'
    ));
    expect(result.errors).toHaveLength(0);
    const workflow = result.workflows[0];

    // Control flow must still be auto-wired by @path
    expect(workflow.connections.find(c =>
      c.from.node === 'Start' && c.from.port === 'execute' &&
      c.to.node === 'A' && c.to.port === 'execute'
    )).toBeDefined();

    expect(workflow.connections.find(c =>
      c.from.node === 'A' && c.from.port === 'onSuccess' &&
      c.to.node === 'B' && c.to.port === 'execute'
    )).toBeDefined();

    expect(workflow.connections.find(c =>
      c.from.node === 'B' && c.from.port === 'onSuccess' &&
      c.to.node === 'Exit' && c.to.port === 'onSuccess'
    )).toBeDefined();

    // A.data -> B.data should still be auto-wired (only B.result was overridden)
    expect(workflow.connections.find(c =>
      c.from.node === 'A' && c.from.port === 'data' &&
      c.to.node === 'B' && c.to.port === 'data'
    )).toBeDefined();
  });
});
