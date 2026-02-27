import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { resolvePath, toVirtualPath } from '../../../../src/cli/tunnel/path-resolver.js';

const ROOT = '/workspace/my-project';

describe('resolvePath', () => {
  it('resolves a simple virtual path', () => {
    expect(resolvePath(ROOT, '/workflow.ts')).toBe(path.join(ROOT, 'workflow.ts'));
  });

  it('strips /cloud prefix', () => {
    expect(resolvePath(ROOT, '/cloud/workflow.ts')).toBe(path.join(ROOT, 'workflow.ts'));
  });

  it('strips /cloud with nested path', () => {
    expect(resolvePath(ROOT, '/cloud/src/index.ts')).toBe(path.join(ROOT, 'src', 'index.ts'));
  });

  it('blocks path traversal with ..', () => {
    expect(() => resolvePath(ROOT, '/../../../etc/passwd')).toThrow('Path traversal blocked');
  });

  it('blocks null bytes', () => {
    expect(() => resolvePath(ROOT, '/workflow\0.ts')).toThrow('Path traversal blocked');
  });

  it('allows absolute path inside workspace', () => {
    const abs = path.join(ROOT, 'src', 'file.ts');
    expect(resolvePath(ROOT, abs)).toBe(abs);
  });

  it('treats absolute paths not matching workspace as relative', () => {
    // /other/project/file.ts is NOT matching workspaceRoot, so leading / is stripped
    // and it becomes a relative path inside the workspace
    const result = resolvePath(ROOT, '/other/project/file.ts');
    expect(result).toBe(path.join(ROOT, 'other', 'project', 'file.ts'));
  });

  it('returns workspace root for empty path', () => {
    expect(resolvePath(ROOT, '/')).toBe(ROOT);
  });

  it('returns workspace root for /cloud alone', () => {
    expect(resolvePath(ROOT, '/cloud')).toBe(ROOT);
  });
});

describe('toVirtualPath', () => {
  it('converts absolute path to virtual path', () => {
    const real = path.join(ROOT, 'src', 'workflow.ts');
    expect(toVirtualPath(ROOT, real)).toBe('/src/workflow.ts');
  });

  it('returns root for workspace root itself', () => {
    expect(toVirtualPath(ROOT, ROOT)).toBe('/');
  });

  it('returns /basename for path outside workspace', () => {
    expect(toVirtualPath(ROOT, '/other/project/file.ts')).toBe('/file.ts');
  });
});
