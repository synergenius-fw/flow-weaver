/**
 * Canonical list of test files that must run in the "isolated" vitest project.
 *
 * These files call `vi.mock(...)` at module level. The rest of the suite runs
 * under `pool: 'vmForks'` + `isolate: false`, which shares one module registry
 * across every file so an expensive ts-morph Project can be reused. That sharing
 * is fundamentally incompatible with `vi.mock`: a factory that replaces a module
 * wholesale (e.g. `vi.mock('fs', () => ({ existsSync: vi.fn() }))`) leaks into
 * every other file that imports the same module, so whichever mock loaded last
 * wins and unrelated tests read the wrong implementation. That is the source of
 * the CI-only `expected [] to have a length of 1` failures.
 *
 * Routing these files into a project with `pool: 'forks'` + `isolate: true`
 * gives each one its own module registry, so `vi.mock` hoisting works and
 * mocks can't bleed across files.
 *
 * This list is the single source of truth, imported by both `vitest.config.ts`
 * (to build the project include globs) and `tests/isolated-routing.test.ts`
 * (which fails if a file calls `vi.mock` but is missing here). When you add a
 * test that uses `vi.mock`, add it here too; the guard test will tell you if you
 * forget. Regenerate from scratch with:
 *
 *   grep -rlE '^\s*vi\.mock\(' tests src/extensions | sort
 */
export const isolatedTestFiles: readonly string[] = [
  'tests/cli/artifact.test.ts',
  'tests/cli/diagram.test.ts',
  'tests/cli/docs.test.ts',
  'tests/cli/export.test.ts',
  'tests/cli/implement.test.ts',
  'tests/cli/index.test.ts',
  'tests/cli/init.test.ts',
  'tests/cli/migrate.test.ts',
  'tests/cli/openapi.test.ts',
  'tests/continuation/non-coordinator-yield-a2.test.ts',
  'tests/deployment/core/executor.test.ts',
  'tests/unit/ast/serialization-node.test.ts',
  'tests/unit/cli-export-coverage-2.test.ts',
  'tests/unit/cli-init-branch-coverage-2.test.ts',
  'tests/unit/cli-init-branch-coverage-3.test.ts',
  'tests/unit/cli-init-coverage-2.test.ts',
  'tests/unit/cli-market-coverage-2.test.ts',
  'tests/unit/cli-mcp-setup-coverage.test.ts',
  'tests/unit/cli-pack-commands-coverage.test.ts',
  'tests/unit/cli-pack-loader-coverage.test.ts',
  'tests/unit/cli-run-coverage-2.test.ts',
  'tests/unit/cli-run-coverage-3.test.ts',
  'tests/unit/cli-validate-coverage-3.test.ts',
  'tests/unit/cli-zero-coverage-commands.test.ts',
  'tests/unit/deployment-executor-coverage.test.ts',
  'tests/unit/deployment-index-coverage-2.test.ts',
  'tests/unit/deployment-index-coverage.test.ts',
  'tests/unit/diagram-index-coverage.test.ts',
  'tests/unit/doc-metadata/extractors.test.ts',
  'tests/unit/docs/index.test.ts',
  'tests/unit/export/index.test.ts',
  'tests/unit/issue-fixes.test.ts',
  'tests/unit/marketplace/manifest.test.ts',
  'tests/unit/marketplace/registry.test.ts',
  'tests/unit/marketplace/validator.test.ts',
  'tests/unit/mcp-pack-tools.test.ts',
  'tests/unit/mcp-server-coverage.test.ts',
  'tests/unit/mcp-tools-context-coverage.test.ts',
  'tests/unit/mcp-tools-debug-coverage-2.test.ts',
  'tests/unit/mcp-tools-diagram-coverage.test.ts',
  'tests/unit/mcp-tools-export-coverage.test.ts',
  'tests/unit/mcp/tools-diagram.test.ts',
  'tests/unit/mcp/tools-docs.test.ts',
  'tests/unit/mcp/tools-export.test.ts',
  'tests/unit/mcp/tools-marketplace.test.ts',
  'tests/unit/mcp/tools-workflow.test.ts',
  'tests/unit/mcp/tools-query.test.ts',
  'tests/unit/mcp/tools-resources.test.ts',
  'tests/unit/mcp/tools-template.test.ts',
  'tests/unit/pack-commands-path-url.test.ts',
  'tests/unit/pack-commands.test.ts',
  'tests/unit/pack-tools.test.ts',
  'tests/unit/server-registry-coverage.test.ts',
];
