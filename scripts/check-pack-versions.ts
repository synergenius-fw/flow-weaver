#!/usr/bin/env tsx
/**
 * Check that sibling flow-weaver-pack-* repos have peerDependencies satisfiable
 * by the current flow-weaver core version.
 *
 * Usage:
 *   npx tsx scripts/check-pack-versions.ts
 *
 * Exits 0 if all peerDeps are satisfied, 1 if any mismatch is found.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const parentDir = path.resolve(rootDir, '..');

// Simple semver range checker for the range formats packs actually use:
// ">=x.y.z", "^x.y.z", "x.y.z", ">=x.y.z <a.b.c"
function parseVersion(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function satisfiesRange(version: string, range: string): boolean {
  const ver = parseVersion(version);
  if (!ver) return false;

  // Handle ">=x.y.z" (most common for peerDeps)
  const gteMatch = range.match(/^>=\s*(\d+\.\d+\.\d+)/);
  if (gteMatch) {
    const min = parseVersion(gteMatch[1]);
    if (!min) return false;
    return compareVersions(ver, min) >= 0;
  }

  // Handle "^x.y.z" (compatible with)
  const caretMatch = range.match(/^\^(\d+\.\d+\.\d+)/);
  if (caretMatch) {
    const base = parseVersion(caretMatch[1]);
    if (!base) return false;
    if (compareVersions(ver, base) < 0) return false;
    // ^x.y.z means <(x+1).0.0 for x>0, <x.(y+1).0 for x==0&&y>0
    if (base[0] > 0) return ver[0] === base[0];
    if (base[1] > 0) return ver[0] === 0 && ver[1] === base[1];
    return ver[0] === 0 && ver[1] === 0 && ver[2] === base[2];
  }

  // Handle exact "x.y.z"
  const exact = parseVersion(range);
  if (exact) return compareVersions(ver, exact) === 0;

  // Unknown range format, assume not satisfied
  return false;
}

const corePkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
const coreVersion = corePkg.version;
const coreName = corePkg.name;

// Find sibling pack directories
const siblings = fs.readdirSync(parentDir).filter((name) => name.startsWith('flow-weaver-pack-'));

if (siblings.length === 0) {
  console.log('No sibling flow-weaver-pack-* directories found.');
  process.exit(0);
}

console.log(`Core: ${coreName}@${coreVersion}\n`);

let mismatches = 0;

for (const dir of siblings) {
  const pkgPath = path.join(parentDir, dir, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const peerDeps = pkg.peerDependencies || {};

  for (const [dep, range] of Object.entries(peerDeps) as [string, string][]) {
    // Only check flow-weaver core and other sibling packs
    if (dep !== coreName && !dep.includes('flow-weaver-pack-')) continue;

    let targetVersion: string;
    if (dep === coreName) {
      targetVersion = coreVersion;
    } else {
      // Find the sibling pack version
      const sibName = dep.replace('@synergenius/', '');
      const sibPkgPath = path.join(parentDir, sibName, 'package.json');
      if (!fs.existsSync(sibPkgPath)) {
        console.log(`  ? ${pkg.name}: ${dep} ${range} (sibling not found locally)`);
        continue;
      }
      const sibPkg = JSON.parse(fs.readFileSync(sibPkgPath, 'utf-8'));
      targetVersion = sibPkg.version;
    }

    const satisfied = satisfiesRange(targetVersion, range);

    if (satisfied) {
      console.log(`  ok ${pkg.name}: ${dep} ${range} (${targetVersion} satisfies)`);
    } else {
      console.log(`  FAIL ${pkg.name}: ${dep} ${range} (${targetVersion} does NOT satisfy)`);
      mismatches++;
    }
  }
}

console.log('');
if (mismatches > 0) {
  console.error(`Found ${mismatches} peerDependency mismatch${mismatches === 1 ? '' : 'es'}.`);
  process.exit(1);
} else {
  console.log('All pack peerDependencies are satisfiable.');
}
