#!/usr/bin/env node
/**
 * Postinstall welcome message — context-aware, shown after npm install.
 *
 * This is a standalone CJS script (no build step, no ESM, no dependencies).
 * The logic is duplicated from src/cli/postinstall.ts which has full test coverage.
 *
 * Silent in CI. No telemetry. No file modifications. No dark patterns.
 * Never fails the install.
 */
'use strict';

try {
  const fs = require('fs');
  const path = require('path');

  const CI_VARS = ['CI', 'CONTINUOUS_INTEGRATION', 'BUILD_NUMBER', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_URL', 'CODEBUILD_BUILD_ID'];
  if (CI_VARS.some(v => process.env[v])) process.exit(0);

  const cwd = process.env.INIT_CWD || process.cwd();

  function hasPkg() { try { return fs.existsSync(path.join(cwd, 'package.json')); } catch { return false; } }
  function hasTsConfig() { try { return fs.existsSync(path.join(cwd, 'tsconfig.json')); } catch { return false; } }

  function dirHasTs(dir) {
    try { return fs.readdirSync(dir).some(f => f.endsWith('.ts') && !f.endsWith('.d.ts')); }
    catch { return false; }
  }

  function dirHasFlowWeaver(dir) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.ts') || f.endsWith('.d.ts')) continue;
        try { if (fs.readFileSync(path.join(dir, f), 'utf8').includes('@flowWeaver')) return true; }
        catch { /* skip */ }
      }
    } catch { /* skip */ }
    return false;
  }

  let msg;

  if (!hasPkg()) {
    // Global install or outside a project
    msg = [
      '',
      '  flow-weaver installed \u2713',
      '',
      '  Create a project:  fw init my-project',
      '  Or try it now:     fw create workflow hello-world',
      '',
    ].join('\n');
  } else if (!hasTsConfig()) {
    // Project without TypeScript
    msg = [
      '',
      '  flow-weaver installed \u2713',
      '',
      '  Get started:  fw init',
      '',
    ].join('\n');
  } else if (dirHasFlowWeaver(cwd) || dirHasFlowWeaver(path.join(cwd, 'src'))) {
    // Existing flow-weaver project
    msg = [
      '',
      '  flow-weaver updated \u2713',
      '',
      '  Check health:  fw doctor',
      '',
    ].join('\n');
  } else {
    // TypeScript project, no @flowWeaver yet
    msg = [
      '',
      '  flow-weaver installed \u2713',
      '',
      '  Add above any function:  /** @flowWeaver nodeType */',
      '  Then compile:            fw compile src/',
      '',
    ].join('\n');
  }

  process.stderr.write(msg);
} catch {
  // Never fail the install
}
