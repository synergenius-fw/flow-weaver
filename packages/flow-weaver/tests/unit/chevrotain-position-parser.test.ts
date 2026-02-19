/**
 * @module chevrotain-parser/position-parser.test
 *
 * Tests for parsing @position declarations.
 */

import { parsePositionLine } from '../../src/chevrotain-parser/position-parser';

const w: string[] = [];

describe('Chevrotain Position Parser', () => {
  describe('Basic @position parsing', () => {
    it('should parse @position with positive coordinates', () => {
      const result = parsePositionLine('@position adder1 100 200', w);
      expect(result).toEqual({
        nodeId: 'adder1',
        x: 100,
        y: 200,
      });
    });

    it('should parse @position with negative coordinates', () => {
      const result = parsePositionLine('@position node1 -50 -100', w);
      expect(result).toEqual({
        nodeId: 'node1',
        x: -50,
        y: -100,
      });
    });

    it('should parse @position with zero coordinates', () => {
      const result = parsePositionLine('@position center 0 0', w);
      expect(result).toEqual({
        nodeId: 'center',
        x: 0,
        y: 0,
      });
    });

    it('should parse @position with mixed coordinates', () => {
      const result = parsePositionLine('@position node 150 -75', w);
      expect(result).toEqual({
        nodeId: 'node',
        x: 150,
        y: -75,
      });
    });
  });

  describe('Edge cases', () => {
    it('should return null for non-position lines', () => {
      expect(parsePositionLine('@input myPort', w)).toBeNull();
      expect(parsePositionLine('@node n1 type', w)).toBeNull();
      expect(parsePositionLine('just some text', w)).toBeNull();
    });

    it('should handle whitespace variations', () => {
      const result = parsePositionLine('@position   node1   50   100', w);
      expect(result?.nodeId).toBe('node1');
      expect(result?.x).toBe(50);
      expect(result?.y).toBe(100);
    });
  });
});
