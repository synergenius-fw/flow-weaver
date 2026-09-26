import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'src/**/*.generated.ts', 'src/generated-*.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Type-aware correctness rules.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      // require-await stays off: most async functions without an await implement
      // an async interface (RunStore, MCP tool handlers, providers, built-in nodes)
      // or are exported commands, where dropping async would turn a rejection
      // into a synchronous throw for callers.

      // No `any` in the sources: use `unknown` and narrow. (Scaffolding
      // templates write `any` into user code as text, which this does not see.)
      '@typescript-eslint/no-explicit-any': 'error',
      // A leading underscore marks a parameter or binding kept on purpose.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // A `let` read by a closure before its one assignment cannot become `const`.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    },
  },
  {
    // These files are copied as text into every compiled workflow, which must
    // type-check at ES2020, where Error takes no options. A rethrow there puts
    // the cause in its message instead of in `cause`.
    files: [
      'src/runtime/continuation-core.ts',
      'src/runtime/durable-execution.ts',
      'src/runtime/ExecutionContext.ts',
      'src/built-in-nodes/*.ts',
    ],
    rules: {
      'preserve-caught-error': 'off',
      // Compiled workflows carry this text, so a cast the checker finds
      // redundant here stays: removing it would change every compiled file.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    // ExecutionContext.setVariable is synchronous and hands the debugger each
    // VARIABLE_SET event without waiting for it. Awaiting it would make every
    // variable write async; catching it would change the text that compiled
    // workflows carry. Every debugger in this repo sends synchronously, so no
    // rejection can arise today.
    files: ['src/runtime/ExecutionContext.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
);
