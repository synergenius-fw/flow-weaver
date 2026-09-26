import { defineConfig } from 'vitest/config';
import path from 'path';
import { isolatedTestFiles } from './tests/isolated-files';

// Shared timeouts. CI runners under load can take >30s on async/generated-code
// heavy tests (e.g. e2e/generated-code-execution async-nodes,
// generator/unified-parallel). 60s gives headroom without masking real
// deadlocks; genuine hangs still surface quickly enough.
const TEST_TIMEOUT = 60000;

// Per-worker V8 heap ceilings. The self-hosted runners are 2 CPU / 8 GB
// containers that also host prod, so the ceiling has to leave room for the OS,
// base RSS, and the ts-morph working set. 8 GB (the old global value)
// equalled the whole box and let a single worker OOM the container during
// collection (exit 137).
//
// The shared project holds the big ts-morph Project, so it keeps a generous
// ceiling. The isolated project's files mostly mock their dependencies away and
// never build a real Program, so they get a smaller ceiling, which matters
// because that project may run 2 workers at once.
//
// The two projects run sequentially (see sequence.groupOrder below), so peak
// RAM in a shard is one project's footprint at a time, not the sum.
const sharedExecArgv = ['--max-old-space-size=3072'];
const isolatedExecArgv = ['--max-old-space-size=1536'];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: TEST_TIMEOUT,
    hookTimeout: TEST_TIMEOUT,

    // A test that makes no assertion fails. Without this, a test that only runs
    // code passes unless it throws, which adds coverage without checking
    // anything. Both projects inherit it through `extends: true`.
    expect: { requireAssertions: true },

    // 2 retries (3 attempts total). The sharded CI occasionally fails a test
    // plus its retry back-to-back when the runner is saturated; one more
    // attempt turns those false-positives into pass. Cheap insurance, still
    // catches real regressions. Note: retry reuses the same worker/module
    // registry, so it does NOT recover from module-mock pollution or an
    // OOM-killed worker; those are fixed structurally by the projects below.
    retry: 2,

    // Suppress console output from tests (debug logs, parser warnings, etc.)
    onConsoleLog: () => false,

    // Global setup runs once, before any project, and generates build artifacts
    // that source code imports at module level.
    globalSetup: ['./tests/global-setup.ts'],

    // The suite is split into two projects with opposite isolation needs.
    //
    // Most tests exercise the real parser/compiler and benefit from reusing one
    // expensive ts-morph Project across files, which wants a shared module
    // registry (`isolate: false`, single worker). But ~68 files use
    // `vi.mock(...)`, which needs a fresh module registry per file or the mocks
    // bleed across files (the CI-only mock-pollution failures). One global
    // config cannot serve both, so each group gets its own project.
    //
    // `--shard=N/M` distributes files across BOTH projects, so the existing
    // 3-shard CI matrix keeps balancing total work.
    projects: [
      {
        // Isolated: every file that calls vi.mock at module level.
        // forks + isolate:true gives each file its own process and module
        // registry, so vi.mock hoisting works and mocks can't leak. (vmForks +
        // isolate:true is buggy for vi.mock hoisting in vitest 4, so this uses
        // the plain forks pool.) These files mostly mock their dependencies
        // away, so they're light; allow limited parallelism but cap it to the
        // 2-CPU box.
        extends: true,
        test: {
          name: 'isolated',
          include: [...isolatedTestFiles],
          pool: 'forks',
          isolate: true,
          maxWorkers: 2,
          execArgv: isolatedExecArgv,
          setupFiles: ['./tests/setup.ts'],
          // Run after the shared project (groupOrder 0) so the two don't hold
          // memory at the same time on the shared box.
          sequence: { groupOrder: 1 },
        },
      },
      {
        // Shared: everything that doesn't use vi.mock. forks + isolate:true runs
        // each file in its own short-lived child process with a fresh module
        // registry and a fresh ts-morph Project, then discards it.
        //
        // This started as vmForks + isolate:false (one long-lived process reusing
        // a ts-morph singleton across files) and was walked back to here over
        // several CI rounds, because isolate:false made the shared tests depend on
        // process-wide state that the runner couldn't reproduce:
        //   - vmForks runs tests inside a node:vm context whose timer queue wedges
        //     under load, so async tests' setTimeout never fired and they hung to
        //     the 60s timeout. The plain forks pool uses the host event loop.
        //   - A shared, periodically-reset Project left the type checker in a
        //     state that depended on file ordering, so scoped-port type inference
        //     intermittently dropped ports ("expected undefined to be defined").
        //   - The accumulated state grew the long-lived worker until the OS
        //     OOM-killed it ("Worker exited unexpectedly", no V8 message).
        // isolate:true removes all three at the root: no shared timer queue, no
        // carried-over checker state, no unbounded accumulation. vi.mock files
        // (which need isolate:true but break hoisting only under vmForks) live in
        // the separate isolated project, so nothing here relies on a shared
        // registry. The cost is re-importing src/ per file (~0.8s/file); two
        // workers absorb it, and it buys determinism, which is the point.
        extends: true,
        test: {
          name: 'shared',
          include: ['tests/**/*.test.ts', 'src/extensions/**/tests/**/*.test.ts'],
          // e2e/ is Playwright's (`npm run test:e2e`), never Vitest's.
          exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', ...isolatedTestFiles],
          pool: 'forks',
          isolate: true,
          // One worker at a time. isolate:true re-imports src/ and ts-morph into
          // a fresh process per file (~300 MB resident each); running two of
          // those concurrently on the 8 GB box it shares with prod intermittently
          // OOM-killed a shard (exit 137, the heavy npm-import dts-resolution
          // tests thrashing as RAM ran out). A single worker halves the peak so
          // the box never tips over. The other shards already passed at this pace.
          maxWorkers: 1,
          execArgv: sharedExecArgv,
          setupFiles: ['./tests/setup.ts'],
          // Run first; the isolated project (groupOrder 1) waits for it.
          sequence: { groupOrder: 0 },
        },
      },
    ],

    // Coverage (used by the un-sharded coverage job, which runs both projects).
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
