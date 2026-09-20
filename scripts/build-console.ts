#!/usr/bin/env npx tsx

/**
 * Build the console client (console-ui/) into dist/console/.
 * The server (`src/console/server.ts`) serves that directory.
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.join(__dirname, '../console-ui');
const outDir = path.join(__dirname, '../dist/console');

async function build() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of ['index.html', 'styles.css']) fs.copyFileSync(path.join(uiDir, f), path.join(outDir, f));
  fs.cpSync(path.join(uiDir, 'assets'), path.join(outDir, 'assets'), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(uiDir, 'src/main.tsx')],
    bundle: true,
    outfile: path.join(outDir, 'app.js'),
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: true,
    sourcemap: false,
    absWorkingDir: uiDir,
  });
  console.log(`✓ Built console: ${outDir}`);
}

build().catch((err) => {
  console.error('Console build failed:', err);
  process.exit(1);
});
