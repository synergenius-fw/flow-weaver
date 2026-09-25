/**
 * Tests for port-parser.ts error handling
 * Ensures parse errors are pushed to warnings array, not console.warn
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { parsePortLine } from '../../../src/chevrotain-parser/port-parser';

describe('Port Parser Error Handling', () => {
  let warnSpy: MockInstance;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('parsePortLine warnings array', () => {
    it('should push warning for malformed @input syntax', () => {
      const warnings: string[] = [];
      const result = parsePortLine('@input', warnings);
      expect(result).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Failed to parse port line');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should push warning for unclosed bracket', () => {
      const warnings: string[] = [];
      const input = '@input [name=unclosed';
      parsePortLine(input, warnings);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('@input');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should push warning for @input [name (missing closing bracket)', () => {
      const warnings: string[] = [];
      const result = parsePortLine('@input [name', warnings);
      expect(result).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Failed to parse port line');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should not push warning for valid @input lines', () => {
      const warnings: string[] = [];
      const result = parsePortLine('@input myPort', warnings);
      expect(result).not.toBeNull();
      expect(warnings).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should not push warning for valid @output lines', () => {
      const warnings: string[] = [];
      const result = parsePortLine('@output result', warnings);
      expect(result).not.toBeNull();
      expect(warnings).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should not push warning for valid @step lines', () => {
      const warnings: string[] = [];
      const result = parsePortLine('@step onComplete', warnings);
      expect(result).not.toBeNull();
      expect(warnings).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should not push warning for non-port lines (returns null normally)', () => {
      const warnings: string[] = [];
      const result = parsePortLine('@node n1 MyType', warnings);
      expect(result).toBeNull();
      expect(warnings).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should not push warning for param lines', () => {
      const warnings: string[] = [];
      const result = parsePortLine('@param execute boolean', warnings);
      expect(result).toBeNull();
      expect(warnings).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should handle valid port with description', () => {
      const warnings: string[] = [];
      const result = parsePortLine('@input myPort - This is a description', warnings);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('myPort');
      expect(result?.description).toBe('This is a description');
      expect(warnings).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should handle valid port with scope', () => {
      const warnings: string[] = [];
      const result = parsePortLine('@input myPort scope:iteration', warnings);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('myPort');
      expect(result?.scope).toBe('iteration');
      expect(warnings).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('port names that are also option keys elsewhere', () => {
    // `timeout=`, `event=`, `limit=` are @trigger/@cancelOn/@throttle options.
    // A port may still be called timeout, event, match, cron, limit or period.
    it.each(['timeout', 'event', 'match', 'cron', 'limit', 'period'])(
      'parses `@input [%s=5000]` as an optional port with a default',
      (name) => {
        const warnings: string[] = [];
        const result = parsePortLine(`@input [${name}=5000]`, warnings);
        expect(warnings).toEqual([]);
        expect(result).toMatchObject({ name, isOptional: true, defaultValue: '5000' });
      },
    );

    it('parses `@input timeout [order:1]` and custom metadata `[timeout:5000]`', () => {
      const warnings: string[] = [];
      expect(parsePortLine('@input timeout [order:1]', warnings)).toMatchObject({ name: 'timeout', order: 1 });
      expect(parsePortLine('@input x [timeout:5000]', warnings)).toMatchObject({
        name: 'x',
        customMetadata: { timeout: 5000 },
      });
      expect(warnings).toEqual([]);
    });

    it('rejects `[timeout=5000]` as metadata: metadata attributes are key:value', () => {
      const warnings: string[] = [];
      expect(parsePortLine('@input x [timeout=5000]', warnings)).toBeNull();
      expect(warnings[0]).toContain('Failed to parse port line');
    });
  });
});
