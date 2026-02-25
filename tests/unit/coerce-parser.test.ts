/**
 * @module chevrotain-parser/coerce-parser.test
 *
 * Tests for parsing @coerce declarations via the Chevrotain-based parser.
 */

import { parseCoerceLine } from '../../src/chevrotain-parser/coerce-parser';

describe('@coerce Chevrotain parser', () => {
  describe('valid target types', () => {
    it('parses @coerce with string type', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce c1 fetch.count -> display.label as string', warnings);
      expect(warnings).toHaveLength(0);
      expect(result).not.toBeNull();
      expect(result!.instanceId).toBe('c1');
      expect(result!.source).toEqual({ node: 'fetch', port: 'count' });
      expect(result!.target).toEqual({ node: 'display', port: 'label' });
      expect(result!.targetType).toBe('string');
    });

    it('parses @coerce with number type', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce c2 input.text -> calc.amount as number', warnings);
      expect(warnings).toHaveLength(0);
      expect(result).not.toBeNull();
      expect(result!.instanceId).toBe('c2');
      expect(result!.source).toEqual({ node: 'input', port: 'text' });
      expect(result!.target).toEqual({ node: 'calc', port: 'amount' });
      expect(result!.targetType).toBe('number');
    });

    it('parses @coerce with boolean type', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce c3 config.value -> gate.enabled as boolean', warnings);
      expect(warnings).toHaveLength(0);
      expect(result).not.toBeNull();
      expect(result!.instanceId).toBe('c3');
      expect(result!.source).toEqual({ node: 'config', port: 'value' });
      expect(result!.target).toEqual({ node: 'gate', port: 'enabled' });
      expect(result!.targetType).toBe('boolean');
    });

    it('parses @coerce with json type', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce c4 raw.data -> handler.payload as json', warnings);
      expect(warnings).toHaveLength(0);
      expect(result).not.toBeNull();
      expect(result!.instanceId).toBe('c4');
      expect(result!.source).toEqual({ node: 'raw', port: 'data' });
      expect(result!.target).toEqual({ node: 'handler', port: 'payload' });
      expect(result!.targetType).toBe('json');
    });

    it('parses @coerce with object type', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce c5 serializer.output -> store.record as object', warnings);
      expect(warnings).toHaveLength(0);
      expect(result).not.toBeNull();
      expect(result!.instanceId).toBe('c5');
      expect(result!.source).toEqual({ node: 'serializer', port: 'output' });
      expect(result!.target).toEqual({ node: 'store', port: 'record' });
      expect(result!.targetType).toBe('object');
    });
  });

  describe('field extraction', () => {
    it('returns correct instanceId', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce myCoerce A.x -> B.y as string', warnings);
      expect(result).not.toBeNull();
      expect(result!.instanceId).toBe('myCoerce');
    });

    it('returns correct source node and port', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce c1 sourceNode.outputPort -> target.input as number', warnings);
      expect(result).not.toBeNull();
      expect(result!.source.node).toBe('sourceNode');
      expect(result!.source.port).toBe('outputPort');
    });

    it('returns correct target node and port', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce c1 src.out -> targetNode.inputPort as boolean', warnings);
      expect(result).not.toBeNull();
      expect(result!.target.node).toBe('targetNode');
      expect(result!.target.port).toBe('inputPort');
    });
  });

  describe('invalid target type', () => {
    it('returns null and warns for "as float"', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce c1 A.x -> B.y as float', warnings);
      expect(result).toBeNull();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('invalid target type');
      expect(warnings[0]).toContain('float');
    });

    it('returns null and warns for "as int"', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce c1 A.x -> B.y as int', warnings);
      expect(result).toBeNull();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('invalid target type');
      expect(warnings[0]).toContain('int');
    });
  });

  describe('missing parts', () => {
    it('returns null and warns when arrow is missing', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce c1 A.x B.y as number', warnings);
      expect(result).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('returns null and warns when "as" keyword is missing', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce c1 A.x -> B.y number', warnings);
      expect(result).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('returns null and warns when instanceId is missing', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce A.x -> B.y as string', warnings);
      // The parser will misinterpret tokens but should still fail structurally
      expect(result).toBeNull();
    });

    it('returns null and warns when target type is missing after "as"', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce c1 A.x -> B.y as', warnings);
      expect(result).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe('completely invalid input', () => {
    it('returns null for random text', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('hello world', warnings);
      expect(result).toBeNull();
    });

    it('returns null for a different tag', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@connect A.x -> B.y', warnings);
      expect(result).toBeNull();
    });

    it('returns null for just the tag with no arguments', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('@coerce', warnings);
      expect(result).toBeNull();
    });
  });

  describe('empty input', () => {
    it('returns null for empty string', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('', warnings);
      expect(result).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      const warnings: string[] = [];
      const result = parseCoerceLine('   ', warnings);
      expect(result).toBeNull();
    });
  });
});

// =============================================================================
// @connect ... as <type> coercion parsing (connection-level)
// =============================================================================

import { parseConnectLine } from '../../src/chevrotain-parser/connect-parser';

describe('@connect ... as <type> coercion parsing', () => {
  describe('valid coerce types', () => {
    it('parses @connect with as string', () => {
      const warnings: string[] = [];
      const result = parseConnectLine('@connect fetch.count -> display.label as string', warnings);
      expect(warnings).toHaveLength(0);
      expect(result).not.toBeNull();
      expect(result!.coerce).toBe('string');
    });

    it('parses @connect with as number', () => {
      const warnings: string[] = [];
      const result = parseConnectLine('@connect input.text -> calc.amount as number', warnings);
      expect(warnings).toHaveLength(0);
      expect(result!.coerce).toBe('number');
    });

    it('parses @connect with as boolean', () => {
      const warnings: string[] = [];
      const result = parseConnectLine('@connect config.value -> gate.enabled as boolean', warnings);
      expect(warnings).toHaveLength(0);
      expect(result!.coerce).toBe('boolean');
    });

    it('parses @connect with as json', () => {
      const warnings: string[] = [];
      const result = parseConnectLine('@connect raw.data -> handler.payload as json', warnings);
      expect(warnings).toHaveLength(0);
      expect(result!.coerce).toBe('json');
    });

    it('parses @connect with as object', () => {
      const warnings: string[] = [];
      const result = parseConnectLine('@connect serializer.output -> store.record as object', warnings);
      expect(warnings).toHaveLength(0);
      expect(result!.coerce).toBe('object');
    });
  });

  describe('without coercion', () => {
    it('parses @connect without as clause (coerce is undefined)', () => {
      const warnings: string[] = [];
      const result = parseConnectLine('@connect A.x -> B.y', warnings);
      expect(warnings).toHaveLength(0);
      expect(result!.coerce).toBeUndefined();
    });
  });

  describe('invalid coerce type', () => {
    it('warns and ignores invalid type "float"', () => {
      const warnings: string[] = [];
      const result = parseConnectLine('@connect A.x -> B.y as float', warnings);
      expect(result).not.toBeNull();
      expect(result!.coerce).toBeUndefined();
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('Invalid coerce type');
      expect(warnings[0]).toContain('float');
    });

    it('warns and ignores invalid type "int"', () => {
      const warnings: string[] = [];
      const result = parseConnectLine('@connect A.x -> B.y as int', warnings);
      expect(result).not.toBeNull();
      expect(result!.coerce).toBeUndefined();
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('Invalid coerce type');
      expect(warnings[0]).toContain('int');
    });

    it('lists valid types in the warning message', () => {
      const warnings: string[] = [];
      parseConnectLine('@connect A.x -> B.y as text', warnings);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('string');
      expect(warnings[0]).toContain('number');
      expect(warnings[0]).toContain('boolean');
      expect(warnings[0]).toContain('json');
      expect(warnings[0]).toContain('object');
    });
  });

  describe('with scoped ports', () => {
    it('parses scoped source port with coerce', () => {
      const warnings: string[] = [];
      const result = parseConnectLine('@connect A.x:myScope -> B.y as number', warnings);
      expect(warnings).toHaveLength(0);
      expect(result!.source).toEqual({ nodeId: 'A', portName: 'x', scope: 'myScope' });
      expect(result!.coerce).toBe('number');
    });
  });
});
