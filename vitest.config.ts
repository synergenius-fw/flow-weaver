import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'src/extensions/**/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // CI runners under load can take >30s on async/generated-code heavy
    // tests (e.g. e2e/generated-code-execution async-nodes,
    // generator/unified-parallel). 60s gives headroom without masking real
    // deadlocks; genuine hangs still surface quickly enough.
    testTimeout: 60000,
    hookTimeout: 60000,
    // 2 retries (3 attempts total). The sharded CI occasionally fails a
    // test plus its retry back-to-back when the shard runner is saturated;
    // one more attempt turns those false-positives into pass. Cheap
    // insurance, still catches real regressions.
    retry: 2,

    // Use vmForks to share ts-morph Project across test files
    // vmForks uses node:vm for isolation while sharing module cache
    pool: 'vmForks',
    maxForks: 1,      // Single worker = shared singleton (vitest 4 syntax)
    isolate: false,   // Don't reset modules between tests

    // Suppress console output from tests (debug logs, parser warnings, etc.)
    onConsoleLog: () => false,

    // Global setup (runs before any imports - generates build artifacts)
    globalSetup: ['./tests/global-setup.ts'],
    // Per-file setup
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
