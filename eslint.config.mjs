import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'src/**/*.generated.ts', 'src/generated-*.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      // Parser and generator code handles loosely typed ASTs; flag `any`, don't block on it.
      '@typescript-eslint/no-explicit-any': 'warn',
      // A leading underscore marks a parameter or binding kept on purpose.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // A `let` read by a closure before its one assignment cannot become `const`.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    },
  },
);
