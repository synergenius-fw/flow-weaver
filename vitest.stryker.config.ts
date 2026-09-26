import { defineConfig } from 'vitest/config';
import path from 'path';
import { target } from './stryker.config.mjs';

// The Vitest config Stryker runs (see stryker.config.mjs). It is one project,
// not the isolated/shared pair in vitest.config.ts: the Stryker runner drives a
// single worker itself, so this file only carries what every test relies on.
//
// - Only the target's own tests (MUTATION_TARGET, see stryker.config.mjs).
// - A lighter setup file, tests/mutation-setup.ts, since setup is paid once
//   per test file per mutant.
// - No globalSetup: every Stryker worker would regenerate the inlined engine
//   into the same sandbox at once, and a test reading it mid-write compiles a
//   broken workflow. `npm run test:mutation` generates it once, before
//   Stryker copies the project.
// - Retries off, so a killed mutant is reported on the first failure.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    expect: { requireAssertions: true },
    retry: 0,
    onConsoleLog: () => false,
    include: target.testFiles,
    exclude: ['**/node_modules/**', '**/dist/**', ...(target.excludeTestFiles ?? [])],
    setupFiles: ['./tests/mutation-setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
