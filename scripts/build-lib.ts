#!/usr/bin/env npx tsx

/**
 * Build the library entry points into bundles.
 *
 * Why this exists: the package ships one bundle per `package.json` `exports`
 * entry instead of per-file `tsc` output. This step replaces the per-file
 * JavaScript with readable (unminified) bundles while keeping every `.d.ts` so
 * the public type surface still resolves.
 *
 * How it works:
 *   1. tsc has already emitted `dist/**` (JS + .d.ts) and postbuild rewrote
 *      the ESM import extensions. We reuse the .d.ts as-is.
 *   2. esbuild bundles each exports entry from `src/`, with `splitting: true`
 *      so code shared between entries lands in shared chunks rather than being
 *      duplicated (which would also break singletons / instanceof identity).
 *      `outbase: src` keeps each entry at its original dist path, so any
 *      `import.meta.url`-relative path resolution keeps its depth.
 *   3. The per-file `tsc` `.js` (and `.js.map`) that are not entry outputs or
 *      shared chunks are deleted — only the bundles remain.
 *
 * Externals: esbuild, typescript, ts-morph, chokidar, fsevents stay external
 * (native or problematic to bundle, and always installed alongside the
 * package). Optional runtime deps (fastify) stay external too.
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');

const EXTERNAL = [
  'typescript',
  'ts-morph',
  'chokidar',
  'fsevents',
  'esbuild',
  // Optional deps, dynamically imported at runtime.
  'fastify',
  '@fastify/cors',
];

/**
 * Every `exports` entry, mapped to its source file. Kept in sync with
 * package.json `exports`. `mcp-tool-server` is not an export but is spawned as
 * a sibling `.js` child process by `agent/mcp-bridge.ts`, so it must survive as
 * its own emitted file.
 */
const ENTRY_SOURCES = [
  'index.ts',
  'runtime/index.ts',
  'compiler/index.ts',
  'built-in-nodes/index.ts',
  'diagram/index.ts',
  'cli/commands/describe.ts',
  'doc-metadata/index.ts',
  'docs/index.ts',
  'ast/index.ts',
  'api/index.ts',
  'diff/index.ts',
  'editor-completions/index.ts',
  'jsdoc-port-sync/index.ts',
  'generated-branding.ts',
  'npm-packages.ts',
  'deployment/index.ts',
  'marketplace/index.ts',
  'testing/index.ts',
  'generator/index.ts',
  'constants.ts',
  'cli/exports.ts',
  'generated-version.ts',
  'context/index.ts',
  'agent/index.ts',
  'console/index.ts',
  'coordinator/index.ts',
  'server/index.ts',
  // Spawned as a sibling child process, not an export.
  'agent/mcp-tool-server.ts',
];

/**
 * Modules that resolve paths relative to their own location via
 * `import.meta.url` / `__dirname` (package root, a sibling `.js`, or a fixed
 * number of levels up). Code splitting would hoist a module shared between
 * entries into `dist/chunks/`, changing its depth and breaking that math.
 * Pinning each as its own entry keeps it at its original dist path (via
 * `outbase: src`), so the relative resolution stays correct. Kept in sync with
 * `grep -rl 'import.meta.url\|__dirname' src`.
 */
const PATH_ANCHORED = [
  'service-registry.ts',
  'agent/cli-session.ts',
  'agent/mcp-bridge.ts',
  'docs/index.ts', // also an export entry; listed there
  'cli/commands/doctor.ts',
  'mcp/auto-registration.ts',
  'console/cli-run.ts',
  'console/server.ts',
];

/** Recursively list files under `dir` matching any of `exts`. */
function collect(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

const COMMON: esbuild.BuildOptions = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  minify: false,
  sourcemap: false,
  // Keep bundled dependencies' licence comments (MIT and similar require it).
  legalComments: 'eof',
  external: EXTERNAL,
  define: {
    __CLI_VERSION__: JSON.stringify(require('../package.json').version),
  },
};

/** Absolute source paths of the path-anchored modules. */
const anchoredAbs = new Set(
  PATH_ANCHORED.map((rel) => path.join(srcDir, rel.replace(/\.ts$/, '')))
);

/**
 * A sentinel prefix for externalised anchored imports. esbuild leaves these
 * specifiers untouched in the output; a post-processing pass rewrites each to a
 * relative path computed from the ACTUAL output file's location. This matters
 * because esbuild hoists shared code into `dist/chunks/`, so the importer's
 * output location is not knowable at resolve time (only its source is).
 */
const ANCHOR_SENTINEL = 'fw-anchor:';

/**
 * esbuild plugin: keep the path-anchored modules external in the main build so
 * they are NOT pulled into `dist/chunks/` (which would change their depth and
 * break `import.meta.url`-relative resolution). Each stays at its own dist path
 * — emitted by the separate anchored pass — and importers reference it via a
 * sentinel specifier rewritten to the correct relative path post-build.
 */
function externalizeAnchored(): esbuild.Plugin {
  return {
    name: 'externalize-anchored',
    setup(b) {
      b.onResolve({ filter: /^[.]/ }, (args) => {
        if (args.kind === 'entry-point' || !args.importer) return null;
        const resolved = path
          .resolve(path.dirname(args.importer), args.path)
          .replace(/\.(ts|tsx|js|jsx)$/, '');
        if (!anchoredAbs.has(resolved)) return null;
        // Encode the target's dist-relative path (POSIX) in the sentinel.
        const targetRel = path.relative(srcDir, resolved).split(path.sep).join('/');
        return { path: ANCHOR_SENTINEL + targetRel + '.js', external: true };
      });
    },
  };
}

/**
 * External CommonJS packages that source imports as a default
 * (`import ts from 'typescript'`) but only ever uses as a namespace
 * (`ts.ScriptTarget`). Under tsc's `esModuleInterop` the default binding is the
 * whole module; but esbuild leaves an EXTERNAL import verbatim, and Node's
 * native ESM gives the CJS default binding WITHOUT the named members hung off
 * it, so `ts.ScriptTarget` is `undefined` at runtime. Rewriting the default
 * import to a namespace import (`import * as ts`) restores the members. Safe
 * because these are used only for member access, never as a callable value.
 */
const CJS_NAMESPACE_EXTERNALS = ['typescript', 'ts-morph'];

/**
 * In every emitted file, turn `import <id> from"<pkg>"` into
 * `import*as <id> from"<pkg>"` for the CJS externals above. esbuild emits the
 * default-import form only when the source used a default import and the module
 * was NOT merged into a namespace (which happens under code splitting).
 */
function normalizeCjsExternals(outputs: string[]): void {
  const pkgAlt = CJS_NAMESPACE_EXTERNALS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // Matches `import <id> from "<pkg>"` with a single default binding, in both
  // esbuild's minified (`from"x"`) and readable (`from "x"`) forms.
  const re = new RegExp(`import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*"(${pkgAlt})"`, 'g');
  for (const rel of outputs) {
    const file = path.resolve(root, rel);
    if (!file.endsWith('.js') || !fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf-8');
    if (!re.test(src)) continue;
    re.lastIndex = 0;
    fs.writeFileSync(file, src.replace(re, (_m, id, pkg) => `import * as ${id} from "${pkg}"`));
  }
}

/**
 * esbuild's ESM output keeps a `require`-based interop helper for any CJS
 * dependency it bundles (e.g. `require('fs')` inside a bundled package). In an
 * ES module there is no `require`, so the helper's fallback throws "Dynamic
 * require of 'x' is not supported". The CLI bundle avoids this with a banner
 * that defines `require` via `createRequire`; the split library needs the same
 * in EVERY output, because the helper can live in a shared chunk (which gets no
 * banner). Prepend a `createRequire` shim to each emitted file that lacks one.
 */
const REQUIRE_SHIM =
  'import{createRequire as __fwCreateRequire}from"module";' +
  'var require=__fwCreateRequire(import.meta.url);';

function addRequireShim(outputs: string[]): void {
  for (const rel of outputs) {
    const file = path.resolve(root, rel);
    if (!file.endsWith('.js') || !fs.existsSync(file)) continue;
    let src = fs.readFileSync(file, 'utf-8');
    if (src.includes('__fwCreateRequire')) continue; // already shimmed
    // Only add it where esbuild actually needs a runtime `require` — either the
    // dynamic-require helper or a direct require call survives in the output.
    if (!src.includes('typeof require') && !/\brequire\(/.test(src)) continue;
    // Keep a leading hashbang (none expected in library outputs) intact.
    if (src.startsWith('#!')) {
      const nl = src.indexOf('\n');
      src = src.slice(0, nl + 1) + REQUIRE_SHIM + src.slice(nl + 1);
    } else {
      src = REQUIRE_SHIM + src;
    }
    fs.writeFileSync(file, src);
  }
}

/**
 * Rewrite every sentinel import in the emitted files to a relative specifier
 * from that file's own location to the anchored module's dist path.
 */
function rewriteSentinels(outputs: string[]): void {
  const re = new RegExp(ANCHOR_SENTINEL + '([^"\']+)', 'g');
  for (const rel of outputs) {
    const file = path.resolve(root, rel);
    if (!file.endsWith('.js') || !fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf-8');
    if (!src.includes(ANCHOR_SENTINEL)) continue;
    const fileDir = path.dirname(file);
    const rewritten = src.replace(re, (_m, targetRel: string) => {
      const target = path.join(distDir, targetRel);
      let spec = path.relative(fileDir, target).split(path.sep).join('/');
      if (!spec.startsWith('.')) spec = './' + spec;
      return spec;
    });
    fs.writeFileSync(file, rewritten);
  }
}

async function build() {
  if (!fs.existsSync(distDir)) {
    throw new Error('dist/ not found — run `tsc` before build:lib');
  }

  const resolveEntry = (rel: string) => {
    const abs = path.join(srcDir, rel);
    if (!fs.existsSync(abs)) throw new Error(`entry source missing: ${abs}`);
    return abs;
  };

  // Pass 1: the path-anchored modules, each a self-contained file at
  // its original dist path. No splitting — a shared chunk would relocate their
  // `import.meta.url` math. Some duplication of small helpers is acceptable;
  // these are leaf CLI/agent utilities, not shared singletons.
  const anchoredResult = await esbuild.build({
    ...COMMON,
    entryPoints: PATH_ANCHORED.map(resolveEntry),
    splitting: false,
    outdir: distDir,
    outbase: srcDir,
    metafile: true,
    logLevel: 'warning',
  });

  // Pass 2: the export entries (plus the spawned mcp-tool-server), with
  // splitting so genuinely shared modules (registries, singletons) live in one
  // chunk. The path-anchored modules are externalised so they resolve to the
  // files pass 1 emitted.
  console.log(`Bundling ${ENTRY_SOURCES.length} library entries...`);
  const result = await esbuild.build({
    ...COMMON,
    entryPoints: ENTRY_SOURCES.map(resolveEntry),
    splitting: true,
    outdir: distDir,
    outbase: srcDir,
    outExtension: { '.js': '.js' },
    chunkNames: 'chunks/[name]-[hash]',
    metafile: true,
    logLevel: 'warning',
    plugins: [externalizeAnchored()],
  });

  // Rewrite the sentinel specifiers in pass-2 outputs to real relative paths.
  rewriteSentinels(Object.keys(result.metafile.outputs));

  // Fix CJS-default-import interop for external `typescript` / `ts-morph` in
  // both passes' outputs (default binding lacks named members under native ESM).
  normalizeCjsExternals(Object.keys(anchoredResult.metafile.outputs));
  normalizeCjsExternals(Object.keys(result.metafile.outputs));

  // Give every output a `require` so esbuild's CJS-interop helper never hits its
  // "Dynamic require not supported" fallback under native ESM.
  addRequireShim(Object.keys(anchoredResult.metafile.outputs));
  addRequireShim(Object.keys(result.metafile.outputs));

  // The set of .js files esbuild just wrote across both passes (entry outputs +
  // shared chunks), as absolute paths. Everything else's readable tsc .js is
  // stale and gets deleted below.
  const written = new Set(
    [
      ...Object.keys(anchoredResult.metafile.outputs),
      ...Object.keys(result.metafile.outputs),
    ].map((rel) => path.resolve(root, rel))
  );

  // Only delete `dist` JS that tsc emitted from a `src` TypeScript file — i.e.
  // the readable per-file library output that the bundles/chunks now replace.
  // JS produced by OTHER build steps (notably `dist/console/app.js` and its
  // asset bundles, built from `console-ui/`, which have no `src` counterpart)
  // must survive. Map each candidate `dist/x/y.js` back to `src/x/y.ts|tsx`.
  const srcHasCounterpart = (distFile: string): boolean => {
    const rel = path.relative(distDir, distFile).replace(/\.js$/, '');
    return (
      fs.existsSync(path.join(srcDir, rel + '.ts')) ||
      fs.existsSync(path.join(srcDir, rel + '.tsx'))
    );
  };

  let deletedJs = 0;
  let deletedMaps = 0;
  for (const file of collect(distDir, ['.js'])) {
    if (written.has(file)) continue;
    if (!srcHasCounterpart(file)) continue; // keep non-tsc assets (console UI, etc.)
    fs.rmSync(file);
    deletedJs++;
  }
  // Remove leftover JS sourcemaps that tsc emitted (publish excludes them, but
  // keep dist clean and consistent). Same counterpart guard, so any map beside
  // a non-tsc asset is left alone.
  for (const file of collect(distDir, ['.js.map'])) {
    const jsSibling = file.replace(/\.map$/, '');
    if (!srcHasCounterpart(jsSibling)) continue;
    fs.rmSync(file);
    deletedMaps++;
  }

  console.log(
    `✓ Library bundled: ${written.size} bundle file(s) kept, ` +
      `${deletedJs} per-file .js removed, ${deletedMaps} .map removed`
  );
}

build().catch((err) => {
  console.error('Library build failed:', err);
  process.exit(1);
});
