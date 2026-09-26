#!/usr/bin/env npx tsx

/**
 * Build script for CLI - bundles into dist/cli/flow-weaver.mjs, an executable
 * entry, plus the flow-weaver-*.mjs chunks it loads on demand
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const outdir = path.join(__dirname, '../dist/cli');
const outfile = path.join(outdir, 'flow-weaver.mjs');

async function build() {
  console.log('Building CLI bundle...');

  // Chunk names carry a content hash, so a rebuild without `rimraf dist`
  // would leave the previous build's chunks behind.
  if (fs.existsSync(outdir)) {
    for (const file of fs.readdirSync(outdir)) {
      if (/^flow-weaver.*\.mjs$/.test(file)) fs.rmSync(path.join(outdir, file));
    }
  }

  await esbuild.build({
    entryPoints: { 'flow-weaver': path.join(__dirname, '../src/cli/index.ts') },
    bundle: true,
    platform: 'node',
    // Matches package.json engines.node.
    target: 'node22',
    format: 'esm',
    // Each command handler is a dynamic import() in program.ts. Splitting
    // makes those real chunks, so `fw --version` loads only the entry and
    // commander. In one file, every static import of the external
    // typescript/ts-morph would be hoisted to the top and loaded at startup.
    // Chunks sit beside the entry, so `import.meta.url` paths keep their depth.
    splitting: true,
    outdir,
    entryNames: '[name]',
    chunkNames: 'flow-weaver-[name]-[hash]',
    outExtension: { '.js': '.mjs' },
    // Readable output. No sourcemap goes out (package.json `files` already
    // excludes dist/**/*.map). Bundled dependencies keep their licence comments.
    minify: false,
    sourcemap: false,
    legalComments: 'eof',
    external: [
      // Keep these external - they're native/problematic to bundle
      'typescript',
      'ts-morph',
      'chokidar',
      'fsevents',
      // esbuild's lib/main.js reads __filename/__dirname to locate its native
      // binary, which does not exist in an ESM bundle. It is a runtime
      // dependency, so consumers always have it installed.
      'esbuild',
    ],
    // Every chunk gets a `require` for esbuild's CJS interop helper. The
    // hashbang goes on the entry alone, below.
    banner: {
      js: [
        'import { createRequire as __createRequire } from "module";',
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
    define: {
      __CLI_VERSION__: JSON.stringify(require('../package.json').version),
    },
  });

  fs.writeFileSync(outfile, '#!/usr/bin/env node\n' + fs.readFileSync(outfile, 'utf-8'));

  // Make executable (skip on Windows where chmod is not applicable)
  if (process.platform !== 'win32') {
    fs.chmodSync(outfile, '755');
  }

  console.log(`✓ Built: ${outfile}`);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
