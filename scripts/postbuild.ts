#!/usr/bin/env tsx
/**
 * Postbuild script
 * 1. Rewrites extensionless relative imports in dist/ for Node.js ESM compat
 * 2. Refreshes bin symlinks in monorepo context
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const libraryDir = path.resolve(__dirname, '..');
const monorepoRoot = path.resolve(libraryDir, '..');
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

  console.warn(`  ⚠ Could not resolve: ${specifier}`);
  return specifier;
}

function fixEsmImports(): void {
  if (!fs.existsSync(distDir)) {
    console.log('dist/ not found — skipping ESM import rewrite');
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

function isMonorepoContext(): boolean {
  // Check if we're in a monorepo by looking for:
  // 1. Parent directory has package.json with workspaces
  // 2. Parent's node_modules has symlink to this library
  const parentPackageJson = path.join(monorepoRoot, 'package.json');
  const symlinkPath = path.join(monorepoRoot, 'node_modules', '@synergenius', 'flow-weaver');

  if (!fs.existsSync(parentPackageJson)) {
    return false;
  }

  try {
    const parentPkg = JSON.parse(fs.readFileSync(parentPackageJson, 'utf-8'));
    if (!parentPkg.workspaces) {
      return false;
    }

    // Check if the symlink exists and points to this library
    if (fs.existsSync(symlinkPath)) {
      const linkTarget = fs.readlinkSync(symlinkPath);
      const resolvedTarget = path.resolve(path.dirname(symlinkPath), linkTarget);
      return resolvedTarget === libraryDir;
    }
  } catch {
    return false;
  }

  return false;
}

function refreshBinSymlinks(): void {
  console.log('📦 Refreshing bin symlinks in monorepo...');

  try {
    // Run npm rebuild from monorepo root to update bin links
    execSync('npm rebuild @synergenius/flow-weaver --ignore-scripts', {
      cwd: monorepoRoot,
      stdio: 'inherit',
    });
    console.log('✅ Bin symlinks updated successfully');
  } catch (error) {
    console.error('⚠️  Failed to refresh bin symlinks:', error);
    // Don't fail the build - this is a nice-to-have
  }
}

// Main
fixEsmImports();

if (isMonorepoContext()) {
  refreshBinSymlinks();
}
