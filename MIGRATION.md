# Flow Weaver Migration & Versioning

## Philosophy

Flow Weaver's migration system is built on a key insight: the existing **parse → generate round-trip** handles ~95% of migrations automatically. The parser is backward-compatible (adds defaults for missing fields), and the generator always writes current syntax. Custom migrations are only needed for rare edge cases.

This means:
- No `@version` annotations in workflow files
- No per-version migration scripts
- No grammar changes needed for migration support
- Adding a new optional annotation tag "just works": old files parse fine, new files get the tag

---

## Quick Reference

```bash
# Migrate workflow files to current syntax
flow-weaver migrate '**/*.ts'
flow-weaver migrate '**/*.ts' --dry-run
flow-weaver migrate 'src/**/*.ts' --diff

# Generate a changelog from git history
flow-weaver changelog --last-tag
flow-weaver changelog --range v0.1.0..HEAD
flow-weaver changelog --since 2024-01-01

# Package the app for distribution
npm run package
npm run package -- v0.2.0

# Run grammar compatibility tests
npm run test:integration
```

---

## Migration

### How It Works

```
  Old workflow file
        |
        v
  parser.parse()          ← backward-compatible, adds defaults
        |
        v
  applyMigrations(ast)    ← edge-case registry (usually empty)
        |
        v
  generateInPlace()       ← writes current syntax, preserves user code
        |
        v
  Updated workflow file
```

### CLI Usage

```bash
# Preview what would change (no files written)
flow-weaver migrate 'src/**/*.ts' --dry-run

# Migrate with semantic diff output
flow-weaver migrate 'src/**/*.ts' --diff

# Migrate in-place
flow-weaver migrate 'src/**/*.ts'
```

### MCP Tool

The `fw_migrate` tool exposes the same logic for Claude Code:

```
fw_migrate(glob: "src/**/*.ts", dryRun: true)
```

### Edge-Case Migration Registry

Located at `src/migration/registry.ts`. Starts **empty**. Only add entries when the parse → generate round-trip can't handle a change automatically.

Example of when you'd add one:
- A tag was renamed (e.g., `@executeWhen` → `@branchingStrategy`) and old files need the AST field moved
- A feature was removed and old files reference it

Expected growth: ~1-2 entries per year.

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

### What It Tests

`tests/integration/grammar-compatibility.test.ts` automatically discovers all example files and verifies:

1. **Parse test** — every example parses without errors
2. **Round-trip test** — parse → generate → re-parse produces no structural breaks (no removed instances, connections, or ports)

### Zero Maintenance

- Files discovered via glob — no list to maintain
- Adding new example files = automatic test coverage
- Non-breaking changes (new optional fields, new tags with defaults) pass silently
- Only actual structural breaks trigger failures

### Running

```bash
npm run test:integration
```

---

## Changelog

Generates a categorized changelog from git history using file-path heuristics. No conventional commit discipline needed.

### Categories

Commits are categorized by which files they touch:

| Category | File Pattern |
|----------|-------------|
| Grammar | `parser`, `chevrotain`, `grammar` |
| Code Generation | `generator`, `body-generator`, `generate` |
| Differ | `diff/` |
| CLI | `cli/commands/` |
| MCP Tools | `mcp/` |
| Deployment | `deployment`, `export` |
| Runtime | `runtime/` |
| Migration | `migration/` |
| Tests | `tests/`, `.test.` |
| Documentation | `doc`, `readme`, `changelog` |

### Example Output

```markdown
## Changes (last tag)

### Grammar (2 commits)

- e15cc39 Fix parser handling of optional ports
- 7987f81 Add @async annotation support

### CLI (1 commit)

- 8d83048 Add migrate command
```

