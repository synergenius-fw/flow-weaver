/**
 * @module chevrotain-parser/connect-parser.test
 *
 * Tests for parsing @connect declarations.
 * TDD: Write tests before implementing parser.
 */

import { parseConnectLine } from '../../src/chevrotain-parser/connect-parser';

const w: string[] = [];

describe('Chevrotain Connect Parser', () => {
  describe('Basic @connect parsing', () => {
    it('should parse simple @connect', () => {
      const result = parseConnectLine('@connect Start.x -> adder.a', w);
      expect(result).toEqual({
        source: { nodeId: 'Start', portName: 'x', scope: undefined },
        target: { nodeId: 'adder', portName: 'a', scope: undefined },
      });
    });

    it('should parse @connect with source scope', () => {
      const result = parseConnectLine('@connect node.port:iteration -> other.input', w);
      expect(result).toEqual({
        source: { nodeId: 'node', portName: 'port', scope: 'iteration' },
        target: { nodeId: 'other', portName: 'input', scope: undefined },
      });
    });

    it('should parse @connect with target scope', () => {
      const result = parseConnectLine('@connect node.output -> other.port:callback', w);
      expect(result).toEqual({
        source: { nodeId: 'node', portName: 'output', scope: undefined },
        target: { nodeId: 'other', portName: 'port', scope: 'callback' },
      });
    });

    it('should parse @connect with both scopes', () => {
      const result = parseConnectLine('@connect a.x:scope1 -> b.y:scope2', w);
      expect(result).toEqual({
        source: { nodeId: 'a', portName: 'x', scope: 'scope1' },
        target: { nodeId: 'b', portName: 'y', scope: 'scope2' },
      });
    });
  });

  describe('Special node references', () => {
    it('should parse @connect from Start', () => {
      const result = parseConnectLine('@connect Start.input -> processor.in', w);
      expect(result?.source.nodeId).toBe('Start');
    });

    it('should parse @connect to End', () => {
      const result = parseConnectLine('@connect processor.out -> End.output', w);
      expect(result?.target.nodeId).toBe('End');
    });
  });

  describe('Edge cases', () => {
    it('should return null for non-connect lines', () => {
      expect(parseConnectLine('@input myPort', w)).toBeNull();
      expect(parseConnectLine('@node n1 type', w)).toBeNull();
      expect(parseConnectLine('just some text', w)).toBeNull();
    });

    it('should handle whitespace variations', () => {
      const result = parseConnectLine('@connect   A.x   ->   B.y', w);
      expect(result?.source.nodeId).toBe('A');
      expect(result?.target.nodeId).toBe('B');
    });
  });
});
