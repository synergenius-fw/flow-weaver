import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    retry: 1,  // Retry flaky tests (resource contention during large runs)

    // Use vmForks to share ts-morph Project across test files
    // vmForks uses node:vm for isolation while sharing module cache
    pool: 'vmForks',
    maxForks: 1,      // Single worker = shared singleton (vitest 4 syntax)
    isolate: false,   // Don't reset modules between tests

    // Suppress console output from tests (debug logs, parser warnings, etc.)
    onConsoleLog: () => false,

    // Setup files
    setupFiles: ['./tests/setup.ts'],

    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/index.ts'],
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
