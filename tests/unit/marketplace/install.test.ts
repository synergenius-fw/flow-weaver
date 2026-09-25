/**
 * `npm install` and `npm publish` run through execFile with an argument list,
 * never through a shell, and a package spec that is not a package spec is
 * refused before npm sees it. The spec can come from an MCP client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFileSync = vi.fn();
vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>();
  return { ...orig, execFileSync: (...args: unknown[]) => mockExecFileSync(...args) };
});

import { isPackageSpec, npmInstall, runNpm } from '../../../src/marketplace/install';

beforeEach(() => {
  mockExecFileSync.mockReset().mockReturnValue(Buffer.from(''));
});

describe('isPackageSpec', () => {
  it('accepts names, scoped names, versions, tags, ranges and local paths', () => {
    for (const spec of [
      'flow-weaver-pack-openai',
      'flow-weaver-pack-openai@1.0.0',
      '@acme/flow-weaver-pack-audio',
      '@acme/flow-weaver-pack-audio@^2.1.0',
      'pack@latest',
      'pack@>=1.0.0',
      './flow-weaver-pack-test-1.0.0.tgz',
      '../packs/thing.tgz',
      '/abs/path/pack.tgz',
      'file:../packs/thing',
    ]) {
      expect(isPackageSpec(spec), spec).toBe(true);
    }
  });

  it('refuses anything a shell would read as more than one word', () => {
    for (const spec of [
      'x; rm -rf ~',
      'x && echo pwned',
      'x | cat',
      'x `id`',
      'x $(id)',
      'x > out',
      'x\nrm -rf ~',
      '',
      ' ',
      'has space',
      '-g',
      '--registry=https://evil.example',
      'file:../packs/thing;id',
    ]) {
      expect(isPackageSpec(spec), JSON.stringify(spec)).toBe(false);
    }
  });
});

describe('npmInstall', () => {
  it('passes the spec as one argument and never a shell string', () => {
    npmInstall('@acme/pack@1.2.3', { cwd: '/proj', stdio: 'pipe' });
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mockExecFileSync.mock.calls[0] as [string, string[], { cwd: string; stdio: string }];
    expect(cmd).toMatch(/^npm(\.cmd)?$/);
    expect(args).toEqual(['install', '@acme/pack@1.2.3']);
    expect(opts).toMatchObject({ cwd: '/proj', stdio: 'pipe' });
  });

  it('refuses an invalid spec before running npm', () => {
    expect(() => npmInstall('x; rm -rf ~')).toThrow(/not a package name/);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});

describe('runNpm', () => {
  it('runs publish with its flags as separate arguments', () => {
    runNpm(['publish', '--dry-run', '--tag', 'beta'], { cwd: '/pack', stdio: 'inherit' });
    const [, args] = mockExecFileSync.mock.calls[0] as [string, string[]];
    expect(args).toEqual(['publish', '--dry-run', '--tag', 'beta']);
  });
});
