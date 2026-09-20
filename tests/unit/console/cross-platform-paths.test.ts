/**
 * Paths the console hands to the browser.
 *
 * `path.relative` yields `a\b\flow.ts` on Windows, and the client splits
 * `rel` to build the tree and puts it in the URL hash. Left native, the
 * tree would collapse to one flat level there and nowhere else -- the kind
 * of difference that only shows up on someone else's machine.
 */
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { toPosix } from '../../../src/console/scan';
import { editorLink } from '../../../console-ui/src/format';

describe('toPosix', () => {
  it('leaves a POSIX relative path alone', () => {
    expect(toPosix('a/b/flow.ts')).toBe('a/b/flow.ts');
  });

  it('converts the platform separator', () => {
    // On Windows `path.sep` is `\`. Elsewhere this is already a no-op.
    const native = ['a', 'b', 'flow.ts'].join(path.sep);
    expect(toPosix(native)).toBe('a/b/flow.ts');
  });

  it('keeps a bare file name intact', () => {
    expect(toPosix('flow.ts')).toBe('flow.ts');
  });
});

describe('editorLink', () => {
  it('links a POSIX path', () => {
    expect(editorLink('/home/me/flow.ts', 12)).toBe('vscode://file/home/me/flow.ts:12');
  });

  it('links a Windows path the way VS Code expects', () => {
    // `C:\a\flow.ts` has to become `/C:/a/flow.ts`, or the editor opens
    // nothing at all.
    expect(editorLink('C:\\a\\flow.ts', 7)).toBe('vscode://file/C:/a/flow.ts:7');
  });

  it('omits the line when there is none', () => {
    expect(editorLink('/home/me/flow.ts')).toBe('vscode://file/home/me/flow.ts');
  });

  it('does not double the leading slash', () => {
    expect(editorLink('/a/b.ts')).toBe('vscode://file/a/b.ts');
  });
});
