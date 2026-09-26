import type { TValidationError } from '../../ast/types';

/**
 * Mutable state shared across validation rules.
 */
export interface ValidationContext {
  errors: TValidationError[];
  warnings: TValidationError[];
  strictMode: boolean;
  draftMode: boolean;
}
