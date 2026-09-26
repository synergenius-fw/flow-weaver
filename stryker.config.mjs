// Mutation testing with Stryker. Line coverage says a test ran the code; a
// mutation score says whether the tests notice when the code is wrong.
//
// One target at a time, each run only against its own test directories, so a
// run stays tractable on a laptop:
//
//   MUTATION_TARGET=validation npm run test:mutation
//
// Targets are listed below. Reports land in reports/mutation/<target>/ (HTML
// and JSON), and the incremental file there lets a re-run skip mutants whose
// code and covering tests have not changed. CONTRIBUTING.md records the score
// each target reached.

export const targets = {
  validation: {
    mutate: ['src/validation/**/*.ts'],
    testFiles: ['tests/unit/validation/**/*.test.ts', 'tests/validation/**/*.test.ts'],
  },
  coordinator: {
    mutate: ['src/coordinator/**/*.ts', '!src/coordinator/index.ts'],
    testFiles: ['tests/unit/coordinator/**/*.test.ts', 'tests/continuation/**/*.test.ts'],
    // Runs a compiled workflow in a plain Node child process, where the
    // mutated (instrumented) source cannot run and no mutant is observed.
    excludeTestFiles: ['tests/continuation/node-portability-baseline.test.ts'],
  },
  parser: {
    mutate: ['src/parser/**/*.ts'],
    testFiles: ['tests/unit/parser/**/*.test.ts'],
  },
  // Small modules that guard a trust boundary: route parameters, callback
  // URLs, the console's request guard and the file run store's paths. The
  // workflow-api integration test is left out: its sleep-and-wake test is
  // timing-sensitive and fails the initial run once four runners share the
  // machine. route-params has a unit test of its own instead.
  boundaries: {
    mutate: [
      'src/server/route-params.ts',
      'src/server/callback-url.ts',
      'src/console/request-guard.ts',
      'src/coordinator/file-store.ts',
    ],
    testFiles: [
      'tests/unit/server/route-params.test.ts',
      'tests/unit/server/callback-url.test.ts',
      'tests/unit/server/callback-url-policy.test.ts',
      'tests/unit/server/callback-delivery.test.ts',
      'tests/unit/console/request-guard.test.ts',
      'tests/unit/coordinator/file-store-run-id.test.ts',
      'tests/unit/coordinator/file-store-claims.test.ts',
      'tests/unit/coordinator/coordinator-stores.test.ts',
      'tests/unit/coordinator/coordinator-run-store.test.ts',
    ],
  },
};

export const name = process.env.MUTATION_TARGET ?? 'validation';
export const target = targets[name];
if (!target) {
  throw new Error(`Unknown MUTATION_TARGET "${name}". Use one of: ${Object.keys(targets).join(', ')}`);
}

// The inlined durable engine and the built-in nodes are copied as text into
// compiled workflows, and generated files are rebuilt on every test run, so
// mutating them measures nothing about the target's tests.
const neverMutate = [
  '!src/runtime/continuation-core.ts',
  '!src/runtime/durable-execution.ts',
  '!src/runtime/ExecutionContext.ts',
  '!src/built-in-nodes/**',
  '!src/**/*.generated.ts',
  '!src/generated-version.ts',
];

// A target's test files are chosen by vitest.stryker.config.ts, which imports
// `target` from here, not by Stryker's `testFiles` option: with that option
// Stryker activates a mutant in module-level code only after the module has
// loaded, so every such mutant survives whatever the tests check.
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.stryker.config.ts', related: false },
  coverageAnalysis: 'perTest',
  mutate: [...target.mutate, ...neverMutate],
  ignorePatterns: ['/reports', '/coverage', '/console-ui', '/docs/api', '/.claude', '/.fw'],
  // Vitest transpiles without type checking, so Stryker need not add
  // `// @ts-nocheck` to files; added to a fixture, it moves the line numbers
  // the parser tests pin.
  disableTypeChecks: false,
  incremental: true,
  incrementalFile: `reports/mutation/${name}/stryker-incremental.json`,
  concurrency: Number(process.env.MUTATION_CONCURRENCY ?? 2),
  timeoutMS: 20000,
  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: { fileName: `reports/mutation/${name}/index.html` },
  jsonReporter: { fileName: `reports/mutation/${name}/mutation.json` },
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
