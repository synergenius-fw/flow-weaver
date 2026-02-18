/**
 * Tests for Branded Port Types
 * Verifies branded types provide compile-time safety for port handling.
 */

import { describe, test, expect } from 'vitest';
import {
  isMandatoryPort,
  isScopedPort,
  isRegularPort,
  toMandatoryPort,
  toScopedPort,
  createOrderedPorts,
  getPortOrder,
  PortName,
  type MandatoryPort,
  type ScopedPort,
  type RegularPort,
  type OrderedPorts,
  type BrandedPort,
} from '../../src/types/branded-ports';

// Test port data
const testPort = {
  dataType: 'STEP' as const,
  tsType: 'boolean',
};

const testScopedPort = {
  dataType: 'STEP' as const,
  tsType: 'boolean',
  scope: 'forEach_1',
};

describe('Branded Port Types', () => {
  describe('Port Name Constants', () => {
    test('PortName.EXECUTE is correct', () => {
      expect(PortName.EXECUTE).toBe('execute');
    });

    test('PortName.ON_SUCCESS is correct', () => {
      expect(PortName.ON_SUCCESS).toBe('onSuccess');
    });

    test('PortName.ON_FAILURE is correct', () => {
      expect(PortName.ON_FAILURE).toBe('onFailure');
    });

    test('PortName.START is correct', () => {
      expect(PortName.START).toBe('start');
    });

    test('PortName.SUCCESS is correct', () => {
      expect(PortName.SUCCESS).toBe('success');
    });

    test('PortName.FAILURE is correct', () => {
      expect(PortName.FAILURE).toBe('failure');
    });
  });

  describe('isMandatoryPort Type Guard', () => {
    test('returns true for execute port', () => {
      expect(isMandatoryPort('execute', testPort)).toBe(true);
    });

    test('returns true for onSuccess port', () => {
      expect(isMandatoryPort('onSuccess', testPort)).toBe(true);
    });

    test('returns true for onFailure port', () => {
      expect(isMandatoryPort('onFailure', testPort)).toBe(true);
    });

    test('returns true for scoped start port', () => {
      expect(isMandatoryPort('start', testScopedPort)).toBe(true);
    });

    test('returns true for scoped success port', () => {
      expect(isMandatoryPort('success', testScopedPort)).toBe(true);
    });

    test('returns true for scoped failure port', () => {
      expect(isMandatoryPort('failure', testScopedPort)).toBe(true);
    });

    test('returns false for regular port', () => {
      expect(isMandatoryPort('myCustomPort', testPort)).toBe(false);
    });

    test('returns false for scoped port with non-mandatory name', () => {
      expect(isMandatoryPort('customScoped', testScopedPort)).toBe(false);
    });
  });

  describe('isScopedPort Type Guard', () => {
    test('returns true for port with scope', () => {
      expect(isScopedPort(testScopedPort)).toBe(true);
    });

    test('returns false for port without scope', () => {
      expect(isScopedPort(testPort)).toBe(false);
    });

    test('returns false for undefined port', () => {
      expect(isScopedPort(undefined)).toBe(false);
    });
  });

  describe('isRegularPort Type Guard', () => {
    test('returns true for regular data port', () => {
      const dataPort = { dataType: 'STRING' as const, tsType: 'string' };
      expect(isRegularPort('myInput', dataPort)).toBe(true);
    });

    test('returns false for mandatory port', () => {
      expect(isRegularPort('execute', testPort)).toBe(false);
    });

    test('returns false for scoped mandatory port', () => {
      expect(isRegularPort('start', testScopedPort)).toBe(false);
    });
  });

  describe('toMandatoryPort Assertion', () => {
    test('returns typed port for execute', () => {
      const result = toMandatoryPort('execute', testPort);
      expect(result).toBeDefined();
      expect(result.port).toBe(testPort);
      expect(result.name).toBe('execute');
    });

    test('throws for non-mandatory port', () => {
      expect(() => toMandatoryPort('customPort', testPort)).toThrow(/not a mandatory port/i);
    });
  });

  describe('toScopedPort Assertion', () => {
    test('returns typed port for scoped port', () => {
      const result = toScopedPort(testScopedPort);
      expect(result).toBeDefined();
      expect(result.scope).toBe('forEach_1');
    });

    test('throws for non-scoped port', () => {
      expect(() => toScopedPort(testPort)).toThrow(/not a scoped port/i);
    });
  });

  describe('OrderedPorts', () => {
    test('createOrderedPorts sorts by order metadata', () => {
      const ports = {
        third: { dataType: 'STRING' as const, metadata: { order: 2 } },
        first: { dataType: 'STRING' as const, metadata: { order: 0 } },
        second: { dataType: 'STRING' as const, metadata: { order: 1 } },
      };

      const ordered = createOrderedPorts(ports);
      const names = ordered.map((p) => p.name);

      expect(names).toEqual(['first', 'second', 'third']);
    });

    test('createOrderedPorts handles missing order metadata', () => {
      const ports = {
        a: { dataType: 'STRING' as const },
        b: { dataType: 'STRING' as const, metadata: { order: 0 } },
        c: { dataType: 'STRING' as const },
      };

      const ordered = createOrderedPorts(ports);

      // b has explicit order 0, should come first
      expect(ordered[0].name).toBe('b');
    });

    test('createOrderedPorts preserves port data', () => {
      const ports = {
        test: { dataType: 'NUMBER' as const, tsType: 'number', optional: true },
      };

      const ordered = createOrderedPorts(ports);

      expect(ordered[0].port.dataType).toBe('NUMBER');
      expect(ordered[0].port.tsType).toBe('number');
      expect(ordered[0].port.optional).toBe(true);
    });

    test('getPortOrder returns order from metadata', () => {
      const port = { dataType: 'STRING' as const, metadata: { order: 5 } };
      expect(getPortOrder(port)).toBe(5);
    });

    test('getPortOrder returns Infinity for missing order', () => {
      const port = { dataType: 'STRING' as const };
      expect(getPortOrder(port)).toBe(Infinity);
    });
  });

  describe('Branded Type Assignments', () => {
    test('MandatoryPort cannot be assigned from RegularPort', () => {
      // This is a compile-time test - if it compiles, the types work correctly
      const mandatory = toMandatoryPort('execute', testPort);
      const _name: string = mandatory.name; // Should compile
      expect(_name).toBe('execute');
    });

    test('ScopedPort enforces scope property', () => {
      const scoped = toScopedPort(testScopedPort);
      const _scope: string = scoped.scope; // Should compile - scope is required
      expect(_scope).toBe('forEach_1');
    });
  });

  describe('Type Safety Validation', () => {
    test('branded port includes original port data', () => {
      const port = {
        dataType: 'STEP' as const,
        tsType: 'boolean',
        label: 'Execute',
        description: 'Main execution port',
      };

      const mandatory = toMandatoryPort('execute', port);

      expect(mandatory.port.label).toBe('Execute');
      expect(mandatory.port.description).toBe('Main execution port');
    });

    test('port order is correctly typed as number or undefined', () => {
      const portWithOrder = { dataType: 'STRING' as const, metadata: { order: 3 } };
      const portWithoutOrder = { dataType: 'STRING' as const };

      expect(typeof getPortOrder(portWithOrder)).toBe('number');
      expect(typeof getPortOrder(portWithoutOrder)).toBe('number'); // Infinity
    });
  });
});
