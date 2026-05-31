/**
 * Guards the isolated/shared project split (see tests/isolated-files.ts).
 *
 * A test file that calls `vi.mock(...)` MUST run in the isolated project, or its
 * mocks leak into the shared module registry and fail unrelated tests on CI.
 * The routing is an explicit list, so a newly added mock test won't self-route.
 * This test makes that omission a loud, deterministic failure instead of a
 * future flake.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { isolatedTestFiles } from './isolated-files';

const repoRoot = path.resolve(__dirname, '..');

/** Every tracked *.test.ts under tests/ and src/extensions, repo-relative, sorted. */
function allTestFiles(): string[] {
  // git ls-files keeps this fast and ignores untracked scratch files / dist.
  const out = execSync(
    "git ls-files 'tests/**/*.test.ts' 'src/extensions/**/*.test.ts'",
    { cwd: repoRoot, encoding: 'utf-8' }
  );
  return out.split('\n').map((l) => l.trim()).filter(Boolean).sort();
}

/** True if the file calls vi.mock(...) at the start of a line (module-level, hoisted). */
function usesModuleMock(relPath: string): boolean {
  const src = readFileSync(path.join(repoRoot, relPath), 'utf-8');
  return /^\s*vi\.mock\(/m.test(src);
}

describe('isolated/shared project routing', () => {
  const files = allTestFiles();
  const isolatedSet = new Set(isolatedTestFiles);

  it('routes every vi.mock test into the isolated project', () => {
    const mockingFiles = files.filter(usesModuleMock);
    const missing = mockingFiles.filter((f) => !isolatedSet.has(f));
    expect(
      missing,
      `These files call vi.mock(...) but are not in tests/isolated-files.ts, so they\n` +
        `would run in the shared project and pollute the module registry. Add them:\n` +
        missing.map((f) => `  '${f}',`).join('\n')
    ).toEqual([]);
  });

  it('has no stale entries in the isolated list', () => {
    // Entries that no longer exist, or no longer use vi.mock, should be removed
    // so the split stays honest (a dead path would silently match nothing).
    const tracked = new Set(files);
    const stale = isolatedTestFiles.filter(
      (f) => !tracked.has(f) || !usesModuleMock(f)
    );
    expect(
      stale,
      `These entries in tests/isolated-files.ts are stale (missing file or no\n` +
        `longer call vi.mock). Remove them:\n` +
        stale.map((f) => `  '${f}',`).join('\n')
    ).toEqual([]);
  });

  it('keeps the isolated list sorted and unique', () => {
    const sorted = [...isolatedTestFiles].sort();
    expect(isolatedTestFiles).toEqual(sorted);
    expect(new Set(isolatedTestFiles).size).toBe(isolatedTestFiles.length);
  });
});
