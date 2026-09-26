# Contributing to Flow Weaver

Contributions are welcome. Before submitting a pull request, please read and
understand the requirements below.

## Contributor License Agreement

All contributors must agree to the [Contributor License Agreement](CLA.md)
before any contribution can be accepted. By submitting a pull request, you agree
to the CLA and assign copyright of your contribution to Ricardo José Horta
Morais.

This means all accepted contributions become the property of the licensor.
You retain the right to use your own contributions under a non-exclusive
grant-back license described in the CLA.

## Submitting Changes

1. Fork the repository and create a branch for your change.
2. Write clear commit messages describing what you changed and why.
3. Include tests for new functionality or bug fixes.
4. Make sure the checks below pass.
5. Open a pull request against the `main` branch and tick the CLA box in the template.

Every change, maintainers' included, lands on `main` through a pull request
with a review and green CI. Maintainers branch in this repository
(`feature/*`) instead of a fork; see [.github/rulesets](.github/rulesets/README.md).

## Setting Up

Node.js 22 or later.

```bash
npm ci
npm run build
```

`npm ci` runs the build through `prepare`, and the build generates a few
gitignored modules (the version, the inlined engine, the built-in node
registry). If a test complains that one is missing, run `npm run build` again.

## Checks

These are what CI runs. Run the ones your change touches before pushing:

```bash
npm run typecheck          # the sources
npm run typecheck:tests    # the tests
npm run typecheck:console  # the console UI
npm run lint               # ESLint with type information, the prose checks, and import cycles
npm run lint:dead          # exports and files nothing uses (knip)
npm run generate:docs:check
```

ESLint reads the TypeScript program, so it takes about half a minute. It
fails on floating promises, misused promises, non-exhaustive switches and
type assertions that change nothing. `lint:dead` fails on an export that
only its own file uses: drop the `export` rather than adding an ignore.

The full test suite is large and runs sharded in CI. Locally, run the files
your change touches:

```bash
npx vitest run tests/unit/parser tests/unit/validation
```

A few things are generated from the code and checked for drift:

- `docs/reference/cli-reference.md`, `error-codes.md`, `scaffold.md` and
  `jsdoc-grammar.md` are partly generated. After changing a CLI command, a
  validation code or a template, run `npm run generate:docs` and commit the
  result.
- `src/doc-metadata/extractors/cli-commands.ts` describes every CLI flag for
  `fw docs` and `fw context`. A test fails when it disagrees with
  `src/cli/index.ts`, so add a new flag in both places.
- Every validation code needs a friendly message in
  `src/validation/friendly-errors.ts`; the docs generator fails without one.
- A test file that calls `vi.mock` at module level must be listed in
  `tests/isolated-files.ts`; `tests/isolated-routing.test.ts` tells you if it
  is not.
- The durable engine (`src/runtime/continuation-core.ts`,
  `durable-execution.ts`, `ExecutionContext.ts`) and `src/built-in-nodes/`
  are copied as text into every compiled workflow. They must stay ES2020 with
  no Node APIs, and any change to them, comments included, changes the
  generated code. Run `npm run generate:engine` and
  `npm run generate:registry` after editing them, and expect the generator
  golden tests to need an update.

## Code Style

Follow the conventions already present in the codebase. The project uses
TypeScript with strict mode enabled. Comments and user-facing text are plain
prose: no emoji, and the lint rejects middle-dot characters.

## Reporting Issues

Open an issue on GitHub. Include enough detail to reproduce the problem: version,
input, expected output, actual output. If you have a fix, feel free to include
a pull request alongside the issue.

Security issues go through [SECURITY.md](SECURITY.md), not a public issue.

## Questions

For questions about the project, licensing, or whether a particular contribution
would be accepted, open a discussion on GitHub or contact support@synergenius.pt.
