/**
 * Tests for Chevrotain parser warnings parameter.
 * Verifies that all parsers push warnings to the array on error
 * and do NOT call console.warn.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { parsePortLine } from '../../src/chevrotain-parser/port-parser';
import { parseConnectLine } from '../../src/chevrotain-parser/connect-parser';
import { parseNodeLine } from '../../src/chevrotain-parser/node-parser';
import { parsePositionLine } from '../../src/chevrotain-parser/position-parser';
import { parseScopeLine } from '../../src/chevrotain-parser/scope-parser';

describe('Chevrotain Parser Warnings', () => {
  let warnSpy: MockInstance;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('port-parser', () => {
    it('should push warning on malformed input, not console.warn', () => {
      const warnings: string[] = [];
      const result = parsePortLine('@input [name', warnings);
      expect(result).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Failed to parse port line');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should leave warnings empty for valid input', () => {
      const warnings: string[] = [];
      const result = parsePortLine('@input myPort', warnings);
      expect(result).not.toBeNull();
      expect(warnings).toEqual([]);
    });
  });

  describe('connect-parser', () => {
    it('should push warning on incomplete connect, not console.warn', () => {
      const warnings: string[] = [];
      const result = parseConnectLine('@connect foo ->', warnings);
      expect(result).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Failed to parse connect line');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should leave warnings empty for valid connect', () => {
      const warnings: string[] = [];
      const result = parseConnectLine('@connect Start.x -> n1.execute', warnings);
      expect(result).not.toBeNull();
      expect(warnings).toEqual([]);
    });
  });

  describe('node-parser', () => {
    it('should push warning on node missing type, not console.warn', () => {
      const warnings: string[] = [];
      const result = parseNodeLine('@node n1', warnings);
      expect(result).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Failed to parse node line');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should leave warnings empty for valid node', () => {
      const warnings: string[] = [];
      const result = parseNodeLine('@node n1 MyType', warnings);
      expect(result).not.toBeNull();
      expect(warnings).toEqual([]);
    });
  });

  describe('position-parser', () => {
    it('should push warning on non-numeric coords, not console.warn', () => {
      const warnings: string[] = [];
      const result = parsePositionLine('@position n1 abc def', warnings);
      expect(result).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Failed to parse position line');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should push warning on missing coordinates', () => {
      const warnings: string[] = [];
      const result = parsePositionLine('@position n1', warnings);
      expect(result).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Failed to parse position line');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should leave warnings empty for valid position', () => {
      const warnings: string[] = [];
      const result = parsePositionLine('@position n1 100 200', warnings);
      expect(result).not.toBeNull();
      expect(warnings).toEqual([]);
    });
  });

  describe('scope-parser', () => {
    it('should push warning on missing children, not console.warn', () => {
      const warnings: string[] = [];
      const result = parseScopeLine('@scope myScope', warnings);
      expect(result).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Failed to parse scope line');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should push warning on malformed scope', () => {
      const warnings: string[] = [];
      const result = parseScopeLine('@scope', warnings);
      expect(result).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should leave warnings empty for valid scope', () => {
      const warnings: string[] = [];
      const result = parseScopeLine('@scope myScope [child1, child2]', warnings);
      expect(result).not.toBeNull();
      expect(warnings).toEqual([]);
    });
  });
});
