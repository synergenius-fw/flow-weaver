# Flow Weaver Migration

## Philosophy

Flow Weaver's migration system is built on one insight: the existing **parse then generate round-trip** handles nearly every migration on its own. The parser is backward-compatible (it adds defaults for missing fields), and the generator always writes current syntax. Custom migrations are only needed for rare edge cases.

This means:
- No `@version` annotations in workflow files
- No per-version migration scripts
- No grammar changes needed for migration support
- Adding a new optional annotation tag just works: old files parse fine, new files get the tag

---

## How It Works

```
  Old workflow file
        |
        v
  parser.parse()          <- backward-compatible, adds defaults
        |
        v
  applyMigrations(ast)    <- edge-case registry (usually empty)
        |
        v
  generateInPlace()       <- writes current syntax, preserves user code
        |
        v
  Updated workflow file
```

## CLI Usage

```bash
fw migrate <glob> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Preview changes without writing files | `false` |
| `--diff` | Show semantic diff before/after | `false` |

```bash
# Preview what would change (no files written)
fw migrate 'src/**/*.ts' --dry-run

# Migrate with semantic diff output
fw migrate 'src/**/*.ts' --diff

# Migrate in place
fw migrate 'src/**/*.ts'
```

`**/node_modules/**` and `**/*.generated.ts` are ignored.

## MCP Tool

The `fw_migrate` tool exposes the same logic to an assistant:

```
fw_migrate(glob: "src/**/*.ts", dryRun: true)
```

## Edge-Case Migration Registry

Located at `src/migration/registry.ts`. Starts **empty**. Only add an entry when the parse then generate round-trip cannot handle a change on its own, for example when a tag was renamed and old files need the AST field moved, or when a feature was removed and old files still reference it.

```ts
// In src/migration/registry.ts
const migrations: Migration[] = [
  {
    name: 'rename-executeWhen-to-branchingStrategy',
    apply: (ast) => {
      // Transform AST here
      return ast;
    },
  },
];
```

---

## Breaking Change Detection

`tests/integration/grammar-compatibility.test.ts` discovers every example file and verifies:

1. **Parse test**: every example parses without errors
2. **Round-trip test**: parse, generate, re-parse produces no structural breaks (no removed instances, connections, or ports)

Files are discovered by glob, so a new example file is covered without a list to maintain. Non-breaking changes (new optional fields, new tags with defaults) pass silently. Only a structural break fails the test.

```bash
npm run test:integration
```
