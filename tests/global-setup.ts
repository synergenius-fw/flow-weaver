/**
 * Vitest Global Setup
 *
 * Runs once before any test files are loaded.
 * Generates build artifacts that source code imports at module level.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export function setup() {
  const root = path.resolve(__dirname, '..');
  const versionFile = path.join(root, 'src', 'generated-version.ts');
  if (!fs.existsSync(versionFile)) {
    execSync('npx tsx scripts/generate-version.ts', { cwd: root, stdio: 'pipe' });
  }
}
