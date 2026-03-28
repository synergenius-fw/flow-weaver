/**
 * TDD tests for the postinstall welcome message.
 *
 * Context-aware message shown after npm install:
 * - Silent in CI
 * - Detects: global install, TypeScript project, existing @flowWeaver usage
 * - Shows the single best next step for the user's situation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectContext, formatMessage, type InstallContext } from '../../src/cli/postinstall';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-postinstall-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Context detection
// ---------------------------------------------------------------------------

describe('detectContext', () => {
  it('detects CI environment', () => {
    const ctx = detectContext(tmpDir, { CI: 'true' });
    expect(ctx).toBe('ci');
  });

  it('detects CI via CONTINUOUS_INTEGRATION', () => {
    const ctx = detectContext(tmpDir, { CONTINUOUS_INTEGRATION: 'true' });
    expect(ctx).toBe('ci');
  });

  it('detects CI via BUILD_NUMBER', () => {
    const ctx = detectContext(tmpDir, { BUILD_NUMBER: '42' });
    expect(ctx).toBe('ci');
  });

  it('detects global install (no package.json)', () => {
    // tmpDir has no package.json
    const ctx = detectContext(tmpDir, {});
    expect(ctx).toBe('global');
  });

  it('detects TypeScript project with existing @flowWeaver annotations', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'workflow.ts'), '/** @flowWeaver workflow */\nexport function myWf() {}');

    const ctx = detectContext(tmpDir, {});
    expect(ctx).toBe('existing');
  });

  it('detects TypeScript project without @flowWeaver annotations', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'utils.ts'), 'export function add(a: number, b: number) { return a + b; }');

    const ctx = detectContext(tmpDir, {});
    expect(ctx).toBe('typescript');
  });

  it('detects TypeScript project via src/ directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export const x = 1;');

    const ctx = detectContext(tmpDir, {});
    expect(ctx).toBe('typescript');
  });

  it('detects project without TypeScript', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    // No tsconfig.json, no .ts files

    const ctx = detectContext(tmpDir, {});
    expect(ctx).toBe('project');
  });

  it('checks .ts files in src/ for @flowWeaver', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'my-workflow.ts'), '/** @flowWeaver nodeType */\nfunction greet() {}');

    const ctx = detectContext(tmpDir, {});
    expect(ctx).toBe('existing');
  });

  it('does not recurse deeply (only top-level and src/)', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, 'src', 'deep', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'deep', 'nested', 'wf.ts'), '/** @flowWeaver workflow */');

    // Should NOT find the deeply nested file — only checks top-level and src/
    const ctx = detectContext(tmpDir, {});
    expect(ctx).toBe('typescript');
  });
});

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

describe('formatMessage', () => {
  it('returns empty string for CI', () => {
    expect(formatMessage('ci')).toBe('');
  });

  it('shows init and create for global install', () => {
    const msg = formatMessage('global');
    expect(msg).toContain('fw init');
    expect(msg).toContain('fw create workflow');
  });

  it('shows annotation hint for TypeScript projects', () => {
    const msg = formatMessage('typescript');
    expect(msg).toContain('@flowWeaver nodeType');
    expect(msg).toContain('fw compile');
  });

  it('shows doctor for existing flow-weaver projects', () => {
    const msg = formatMessage('existing');
    expect(msg).toContain('fw doctor');
    expect(msg).toContain('updated');
  });

  it('shows fw init for non-TypeScript projects', () => {
    const msg = formatMessage('project');
    expect(msg).toContain('fw init');
  });

  it('never contains telemetry or signup prompts', () => {
    const contexts: InstallContext[] = ['ci', 'global', 'typescript', 'existing', 'project'];
    for (const ctx of contexts) {
      const msg = formatMessage(ctx);
      expect(msg.toLowerCase()).not.toContain('telemetry');
      expect(msg.toLowerCase()).not.toContain('sign up');
      expect(msg.toLowerCase()).not.toContain('analytics');
      expect(msg.toLowerCase()).not.toContain('subscribe');
    }
  });
});
