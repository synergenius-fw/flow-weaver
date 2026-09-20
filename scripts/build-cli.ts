#!/usr/bin/env npx tsx

/**
 * Build script for CLI - bundles into a single executable file
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const outfile = path.join(__dirname, '../dist/cli/flow-weaver.mjs');

async function build() {
  console.log('Building CLI bundle...');

  await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/cli/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outfile,
    minify: false, // Keep readable for debugging
    sourcemap: true,
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
      // Optional dependencies - dynamically imported at runtime
      'fastify',
      '@fastify/cors',
    ],
    banner: {
      js: [
        '#!/usr/bin/env node',
        'import { createRequire as __createRequire } from "module";',
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
    define: {
      __CLI_VERSION__: JSON.stringify(require('../package.json').version),
    },
  });

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
