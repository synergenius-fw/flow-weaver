/**
 * Coverage tests for api/helpers.ts uncovered paths (lines 64-112).
 * Covers withMinimalValidation and withoutValidation.
 */

import {
  withMinimalValidation,
  withoutValidation,
} from '../../src/api/helpers';
import type { TWorkflowAST } from '../../src/ast/types';
import { createMinimalWorkflow } from '../helpers/test-fixtures';

describe('withMinimalValidation', () => {
  it('applies mutation and returns new immutable AST', () => {
    const original = createMinimalWorkflow();

    const result = withMinimalValidation(original, (draft) => {
      draft.description = 'updated via minimal validation';
    });

    expect(result.description).toBe('updated via minimal validation');
    expect(result).not.toBe(original);
    expect(original.description).toBeUndefined();
  });

  it('runs operation-specific checks after mutation', () => {
    const original = createMinimalWorkflow();

    // Check that passes
    const result = withMinimalValidation(
      original,
      (draft) => {
        draft.description = 'checked';
      },
      [(ast) => {
        if (!ast.description) throw new Error('Description is required');
      }],
      'setDescription'
    );

    expect(result.description).toBe('checked');
  });

  it('throws with operation name when check fails', () => {
    const original = createMinimalWorkflow();

    expect(() => {
      withMinimalValidation(
        original,
        (draft) => {
          // intentionally don't set description
        },
        [(ast) => {
          throw new Error('Custom check failed');
        }],
        'myOperation'
      );
    }).toThrow(/Custom check failed.*myOperation/);
  });

  it('throws without operation name context when none provided', () => {
    const original = createMinimalWorkflow();

    expect(() => {
      withMinimalValidation(
        original,
        (draft) => {
          draft.name = 'test';
        },
        [(ast) => {
          throw new Error('Check failed');
        }],
      );
    }).toThrow('Check failed');
  });

  it('succeeds without checks when none provided', () => {
    const original = createMinimalWorkflow();

    const result = withMinimalValidation(
      original,
      (draft) => {
        draft.name = 'no-checks';
      },
      undefined,
      'noChecks'
    );

    expect(result.name).toBe('no-checks');
  });

  it('runs multiple checks in order', () => {
    const original = createMinimalWorkflow();
    const callOrder: string[] = [];

    const result = withMinimalValidation(
      original,
      (draft) => {
        draft.description = 'multi-check';
      },
      [
        () => { callOrder.push('check1'); },
        () => { callOrder.push('check2'); },
      ],
    );

    expect(callOrder).toEqual(['check1', 'check2']);
    expect(result.description).toBe('multi-check');
  });
});

describe('withoutValidation', () => {
  it('applies mutation without any validation', () => {
    const original = createMinimalWorkflow();

    const result = withoutValidation(original, (draft) => {
      draft.description = 'no validation';
    });

    expect(result.description).toBe('no validation');
    expect(result).not.toBe(original);
    expect(original.description).toBeUndefined();
  });

  it('allows mutations that would fail full validation', () => {
    const original = createMinimalWorkflow();

    // Add an invalid connection (to non-existent node) without throwing
    const result = withoutValidation(original, (draft) => {
      draft.connections.push({
        type: 'Connection',
        from: { node: 'Start', port: 'ghost' },
        to: { node: 'nonexistent', port: 'input' },
      });
    });

    // Should succeed despite invalid state
    expect(result.connections.length).toBe(original.connections.length + 1);
  });

  it('preserves structural sharing (unchanged parts are reference-equal)', () => {
    const original = createMinimalWorkflow();

    const result = withoutValidation(original, (draft) => {
      draft.description = 'only description changed';
    });

    // Node types array was not modified, should be structurally shared
    expect(result.nodeTypes).toBe(original.nodeTypes);
  });
});
