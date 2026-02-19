/**
 * Tests for type-mappings.ts
 * Specifically tests the inferDataTypeFromTS function that maps
 * TypeScript types to Flow Weaver semantic types.
 */

import { inferDataTypeFromTS, mapToTypeScript, isValidPortType } from '../../src/type-mappings';

describe('inferDataTypeFromTS', () => {
  describe('Primitive types', () => {
    it("should map 'string' to STRING", () => {
      expect(inferDataTypeFromTS('string')).toBe('STRING');
    });

    it("should map 'number' to NUMBER", () => {
      expect(inferDataTypeFromTS('number')).toBe('NUMBER');
    });

    it("should map 'boolean' to BOOLEAN", () => {
      expect(inferDataTypeFromTS('boolean')).toBe('BOOLEAN');
    });
  });

  describe('Any/unknown types', () => {
    it("should map 'any' to ANY", () => {
      expect(inferDataTypeFromTS('any')).toBe('ANY');
    });

    it("should map 'unknown' to ANY", () => {
      expect(inferDataTypeFromTS('unknown')).toBe('ANY');
    });

    it("should map 'never' to ANY", () => {
      expect(inferDataTypeFromTS('never')).toBe('ANY');
    });

    it("should map 'void' to ANY", () => {
      expect(inferDataTypeFromTS('void')).toBe('ANY');
    });

    it("should map 'undefined' to ANY", () => {
      expect(inferDataTypeFromTS('undefined')).toBe('ANY');
    });

    it("should map 'null' to ANY", () => {
      expect(inferDataTypeFromTS('null')).toBe('ANY');
    });
  });

  describe('Array types', () => {
    it("should map 'string[]' to ARRAY", () => {
      expect(inferDataTypeFromTS('string[]')).toBe('ARRAY');
    });

    it("should map 'number[]' to ARRAY", () => {
      expect(inferDataTypeFromTS('number[]')).toBe('ARRAY');
    });

    it("should map 'User[]' to ARRAY", () => {
      expect(inferDataTypeFromTS('User[]')).toBe('ARRAY');
    });

    it("should map 'Array<string>' to ARRAY", () => {
      expect(inferDataTypeFromTS('Array<string>')).toBe('ARRAY');
    });

    it("should map 'Array<User>' to ARRAY", () => {
      expect(inferDataTypeFromTS('Array<User>')).toBe('ARRAY');
    });

    it("should map 'ReadonlyArray<number>' to ARRAY", () => {
      expect(inferDataTypeFromTS('ReadonlyArray<number>')).toBe('ARRAY');
    });
  });

  describe('Function types', () => {
    it("should map '() => void' to FUNCTION", () => {
      expect(inferDataTypeFromTS('() => void')).toBe('FUNCTION');
    });

    it("should map '(x: number) => string' to FUNCTION", () => {
      expect(inferDataTypeFromTS('(x: number) => string')).toBe('FUNCTION');
    });

    it("should map '(...args: any[]) => any' to FUNCTION", () => {
      expect(inferDataTypeFromTS('(...args: any[]) => any')).toBe('FUNCTION');
    });

    it("should map 'Function' to FUNCTION", () => {
      expect(inferDataTypeFromTS('Function')).toBe('FUNCTION');
    });
  });

  describe('Promise types (unwrapping)', () => {
    it("should map 'Promise<string>' to STRING", () => {
      expect(inferDataTypeFromTS('Promise<string>')).toBe('STRING');
    });

    it("should map 'Promise<number>' to NUMBER", () => {
      expect(inferDataTypeFromTS('Promise<number>')).toBe('NUMBER');
    });

    it("should map 'Promise<User[]>' to ARRAY", () => {
      expect(inferDataTypeFromTS('Promise<User[]>')).toBe('ARRAY');
    });

    it("should map 'Promise<any>' to ANY", () => {
      expect(inferDataTypeFromTS('Promise<any>')).toBe('ANY');
    });
  });

  describe('Union types', () => {
    it("should map 'string | number' to ANY (true union)", () => {
      expect(inferDataTypeFromTS('string | number')).toBe('ANY');
    });

    it("should map 'User | Admin' to ANY (true union)", () => {
      expect(inferDataTypeFromTS('User | Admin')).toBe('ANY');
    });
  });

  describe('Optional types (T | undefined, T | null)', () => {
    // These are NOT true unions - they represent optional values
    // The underlying type should be preserved

    it("should map 'number | undefined' to NUMBER (optional number)", () => {
      expect(inferDataTypeFromTS('number | undefined')).toBe('NUMBER');
    });

    it("should map 'string | undefined' to STRING (optional string)", () => {
      expect(inferDataTypeFromTS('string | undefined')).toBe('STRING');
    });

    it("should map 'boolean | undefined' to BOOLEAN (optional boolean)", () => {
      expect(inferDataTypeFromTS('boolean | undefined')).toBe('BOOLEAN');
    });

    it("should map 'number | null' to NUMBER (nullable number)", () => {
      expect(inferDataTypeFromTS('number | null')).toBe('NUMBER');
    });

    it("should map 'string | null' to STRING (nullable string)", () => {
      expect(inferDataTypeFromTS('string | null')).toBe('STRING');
    });

    it("should map 'number | undefined | null' to NUMBER (optional nullable)", () => {
      expect(inferDataTypeFromTS('number | undefined | null')).toBe('NUMBER');
    });

    it("should map 'User[] | undefined' to ARRAY (optional array)", () => {
      expect(inferDataTypeFromTS('User[] | undefined')).toBe('ARRAY');
    });

    it("should map 'object | undefined' to OBJECT (optional object)", () => {
      expect(inferDataTypeFromTS('object | undefined')).toBe('OBJECT');
    });
  });

  describe('Intersection types', () => {
    it("should map 'User & Admin' to OBJECT", () => {
      expect(inferDataTypeFromTS('User & Admin')).toBe('OBJECT');
    });
  });

  describe('Complex/Object types', () => {
    it("should map 'User' to OBJECT", () => {
      expect(inferDataTypeFromTS('User')).toBe('OBJECT');
    });

    it("should map 'Map<string, number>' to OBJECT", () => {
      expect(inferDataTypeFromTS('Map<string, number>')).toBe('OBJECT');
    });

    it("should map 'Set<User>' to OBJECT", () => {
      expect(inferDataTypeFromTS('Set<User>')).toBe('OBJECT');
    });

    it("should map 'Record<string, any>' to OBJECT", () => {
      expect(inferDataTypeFromTS('Record<string, any>')).toBe('OBJECT');
    });

    it("should map '{ id: number; name: string }' to OBJECT", () => {
      expect(inferDataTypeFromTS('{ id: number; name: string }')).toBe('OBJECT');
    });
  });

  describe('Whitespace handling', () => {
    it('should trim whitespace from type string', () => {
      expect(inferDataTypeFromTS('  string  ')).toBe('STRING');
      expect(inferDataTypeFromTS('\tnumber\n')).toBe('NUMBER');
    });
  });
});

describe('mapToTypeScript', () => {
  it("should map STRING to 'string'", () => {
    expect(mapToTypeScript('STRING')).toBe('string');
  });

  it("should map NUMBER to 'number'", () => {
    expect(mapToTypeScript('NUMBER')).toBe('number');
  });

  it("should map BOOLEAN to 'boolean'", () => {
    expect(mapToTypeScript('BOOLEAN')).toBe('boolean');
  });

  it("should map ARRAY to 'unknown[]'", () => {
    expect(mapToTypeScript('ARRAY')).toBe('unknown[]');
  });

  it("should map OBJECT to 'Record<string, unknown>'", () => {
    expect(mapToTypeScript('OBJECT')).toBe('Record<string, unknown>');
  });

  it('should map FUNCTION to function signature', () => {
    expect(mapToTypeScript('FUNCTION')).toBe('(...args: unknown[]) => unknown');
  });

  it("should map ANY to 'unknown'", () => {
    expect(mapToTypeScript('ANY')).toBe('unknown');
  });

  it("should map STEP to 'boolean'", () => {
    expect(mapToTypeScript('STEP')).toBe('boolean');
  });

  describe('with tsType parameter', () => {
    it('should use tsType when available for OBJECT', () => {
      expect(mapToTypeScript('OBJECT', 'MyCustomType')).toBe('MyCustomType');
    });

    it('should use tsType when available for ANY', () => {
      expect(mapToTypeScript('ANY', 'SpecificType')).toBe('SpecificType');
    });

    it('should use tsType when available for ARRAY', () => {
      expect(mapToTypeScript('ARRAY', 'User[]')).toBe('User[]');
    });

    it('should use tsType when available for FUNCTION', () => {
      expect(mapToTypeScript('FUNCTION', '(x: number) => string')).toBe('(x: number) => string');
    });

    it('should ignore tsType for primitive types', () => {
      expect(mapToTypeScript('STRING', 'CustomString')).toBe('string');
      expect(mapToTypeScript('NUMBER', 'CustomNumber')).toBe('number');
      expect(mapToTypeScript('BOOLEAN', 'CustomBoolean')).toBe('boolean');
    });
  });
});

describe('isValidPortType', () => {
  it('should return true for valid port types', () => {
    expect(isValidPortType('STRING')).toBe(true);
    expect(isValidPortType('NUMBER')).toBe(true);
    expect(isValidPortType('BOOLEAN')).toBe(true);
    expect(isValidPortType('ARRAY')).toBe(true);
    expect(isValidPortType('OBJECT')).toBe(true);
    expect(isValidPortType('FUNCTION')).toBe(true);
    expect(isValidPortType('ANY')).toBe(true);
    expect(isValidPortType('STEP')).toBe(true);
  });

  it('should return false for invalid port types', () => {
    expect(isValidPortType('INVALID')).toBe(false);
    expect(isValidPortType('string')).toBe(false);
    expect(isValidPortType('')).toBe(false);
  });
});
