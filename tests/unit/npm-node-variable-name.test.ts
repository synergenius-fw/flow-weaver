/**
 * Test that npm node IDs with slashes generate valid JavaScript variable names.
 */
import { describe, it, expect } from 'vitest';
import { toValidIdentifier } from '../../src/generator/code-utils';

describe('npm node variable name generation', () => {
  describe('toValidIdentifier', () => {
    it('should sanitize node ID with slashes to valid JavaScript identifier', () => {
      const nodeId = 'npm/autoprefixer/autoprefixer123';
      const sanitized = toValidIdentifier(nodeId);

      expect(sanitized).toBe('npm_autoprefixer_autoprefixer123');

      // Verify it's a valid JS identifier
      const code = `const ${sanitized}Idx = ctx.addExecution('${nodeId}');`;
      const isValidJS = /^const [a-zA-Z_$][a-zA-Z0-9_$]*Idx/.test(code);
      expect(isValidJS).toBe(true);
    });

    it('should handle IDs starting with a digit', () => {
      const nodeId = '123node';
      const sanitized = toValidIdentifier(nodeId);

      expect(sanitized).toBe('_123node');
    });

    it('should preserve valid identifiers unchanged', () => {
      const nodeId = 'myNode123';
      const sanitized = toValidIdentifier(nodeId);

      expect(sanitized).toBe('myNode123');
    });

    it('should handle scoped npm packages', () => {
      const nodeId = 'npm/@scope/package/function';
      const sanitized = toValidIdentifier(nodeId);

      expect(sanitized).toBe('npm__scope_package_function');

      // Verify it's a valid JS identifier
      const isValid = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(sanitized);
      expect(isValid).toBe(true);
    });
  });

  describe('generated code validation', () => {
    it('should generate valid JS code for npm node instance', () => {
      const instanceId = 'npm/lodash/map123';
      const safeId = toValidIdentifier(instanceId);

      // This is the pattern used in unified.ts for variable declarations (JS only, no types)
      const code = `
        var ${safeId}Idx;
        ${safeId}Idx = 1;
        var ${safeId}Result = ${safeId}Idx + 1;
      `;

      // Try to parse it (would throw if invalid)
      expect(() => new Function(code)).not.toThrow();
    });

    it('should NOT work without sanitization (proves the bug)', () => {
      const instanceId = 'npm/lodash/map123';

      // Without sanitization - this would be invalid JS
      const invalidCode = `var ${instanceId}Idx;`;

      // This should throw because npm/lodash/map123 is not a valid identifier
      expect(() => new Function(invalidCode)).toThrow();
    });
  });
});
