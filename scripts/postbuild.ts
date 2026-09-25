#!/usr/bin/env tsx
/**
 * Postbuild script: rewrites extensionless relative imports in dist/ so the
 * emitted ESM resolves under Node.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const libraryDir = path.resolve(__dirname, '..');
const distDir = path.join(libraryDir, 'dist');

// ---------------------------------------------------------------------------
// ESM import extension rewriter
// ---------------------------------------------------------------------------

function collectFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function resolveSpecifier(specifier: string, containingDir: string): string {
  if (specifier.endsWith('.js')) return specifier;
  // Skip template expressions inside generated code strings (e.g. `./${variable}`)
  if (specifier.includes('${')) return specifier;

  const abs = path.resolve(containingDir, specifier);

  if (fs.existsSync(abs + '.js')) return specifier + '.js';
  if (fs.existsSync(path.join(abs, 'index.js'))) return specifier + '/index.js';

  console.warn(`  Warning: could not resolve: ${specifier}`);
  return specifier;
}

function fixEsmImports(): void {
  if (!fs.existsSync(distDir)) {
    console.log('dist/ not found, skipping ESM import rewrite');
    return;
  }

  const files = collectFiles(distDir, ['.js', '.d.ts']);
  const staticRe = /((?:import|export)\b.+?\bfrom\s+['"])(\.\.?\/[^'"]+)(['"])/g;
  const dynamicRe = /(\bimport\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/g;

  let totalRewrites = 0;

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf-8');
    const dir = path.dirname(file);
    let rewrites = 0;

    const replaced = src
      .replace(staticRe, (_match, pre, spec, post) => {
        const resolved = resolveSpecifier(spec, dir);
        if (resolved !== spec) rewrites++;
        return pre + resolved + post;
      })
      .replace(dynamicRe, (_match, pre, spec, post) => {
        const resolved = resolveSpecifier(spec, dir);
        if (resolved !== spec) rewrites++;
        return pre + resolved + post;
      });

    if (rewrites > 0) {
      fs.writeFileSync(file, replaced);
      console.log(`  ${path.relative(distDir, file)}: ${rewrites} import(s) fixed`);
      totalRewrites += rewrites;
    }
  }

  console.log(
    `ESM import rewrite: ${totalRewrites} specifier(s) fixed across ${files.length} files`
  );
}

fixEsmImports();
