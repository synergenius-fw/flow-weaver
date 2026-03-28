/**
 * Postinstall welcome message.
 *
 * Context-aware, shown once after npm install.
 * Silent in CI. No telemetry, no file modifications, no dark patterns.
 */

import * as fs from 'fs';
import * as path from 'path';

export type InstallContext = 'ci' | 'global' | 'typescript' | 'existing' | 'project';

const CI_ENV_VARS = ['CI', 'CONTINUOUS_INTEGRATION', 'BUILD_NUMBER', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_URL', 'CODEBUILD_BUILD_ID'];

/**
 * Scan .ts files in a directory (non-recursive) for @flowWeaver annotations.
 */
function dirHasFlowWeaver(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
      try {
        const content = fs.readFileSync(path.join(dir, entry), 'utf8');
        if (content.includes('@flowWeaver')) return true;
      } catch {
        // Permission error or similar — skip
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  return false;
}

/**
 * Scan .ts files in a directory (non-recursive) for existence.
 */
function dirHasTsFiles(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir);
    return entries.some((e) => e.endsWith('.ts') && !e.endsWith('.d.ts'));
  } catch {
    return false;
  }
}

/**
 * Detect the installation context based on cwd and environment variables.
 */
export function detectContext(cwd: string, env: Record<string, string | undefined>): InstallContext {
  // CI — always silent
  if (CI_ENV_VARS.some((v) => env[v])) {
    return 'ci';
  }

  // No package.json — likely global install or outside a project
  if (!fs.existsSync(path.join(cwd, 'package.json'))) {
    return 'global';
  }

  // Check for TypeScript project (tsconfig.json as proxy)
  const hasTsConfig = fs.existsSync(path.join(cwd, 'tsconfig.json'));
  if (!hasTsConfig) {
    return 'project';
  }

  // Check for existing @flowWeaver usage (top-level and src/ only)
  if (dirHasFlowWeaver(cwd) || dirHasFlowWeaver(path.join(cwd, 'src'))) {
    return 'existing';
  }

  // TypeScript project without @flowWeaver
  if (dirHasTsFiles(cwd) || dirHasTsFiles(path.join(cwd, 'src'))) {
    return 'typescript';
  }

  // Has tsconfig but no .ts files yet
  return 'typescript';
}

/**
 * Format the welcome message for the detected context.
 */
export function formatMessage(context: InstallContext): string {
  switch (context) {
    case 'ci':
      return '';

    case 'global':
      return [
        '',
        '  flow-weaver installed \u2713',
        '',
        '  Create a project:  fw init my-project',
        '  Or try it now:     fw create workflow hello-world',
        '',
      ].join('\n');

    case 'typescript':
      return [
        '',
        '  flow-weaver installed \u2713',
        '',
        '  Add above any function:  /** @flowWeaver nodeType */',
        '  Then compile:            fw compile src/',
        '',
      ].join('\n');

    case 'existing':
      return [
        '',
        '  flow-weaver updated \u2713',
        '',
        '  Check health:  fw doctor',
        '',
      ].join('\n');

    case 'project':
      return [
        '',
        '  flow-weaver installed \u2713',
        '',
        '  Get started:  fw init',
        '',
      ].join('\n');
  }
}

// Entry point logic lives in scripts/postinstall.cjs (standalone CJS, no build step).
// This module is the testable source of truth for the detection/formatting logic.
