/**
 * A pack that ships TypeScript source for parsing but only compiled
 * JavaScript under dist/: when the executor runs a workflow from its src/,
 * a relative import that has no file under src/ but has one under dist/ is
 * pointed at dist/. The specifier is written with forward slashes, which
 * ESM requires, even when the paths are Windows paths.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { rewriteSrcImportsToDist } from '../../../src/mcp/dist-imports.js';

/** A file system that has exactly these files. */
const only = (...files: string[]) => (p: string) => files.includes(p);

describe('rewriteSrcImportsToDist', () => {
  const srcDir = '/pack/src/workflows';

  it('points an import with no src file at its dist file', () => {
    const code = `import { upper } from '../node-types/upper.js';`;
    expect(rewriteSrcImportsToDist(code, srcDir, only('/pack/dist/node-types/upper.js')))
      .toBe(`import { upper } from '../../dist/node-types/upper.js';`);
  });

  it('keeps the import when the src file exists, or when there is no dist file', () => {
    const code = `import { upper } from '../node-types/upper.js';`;
    expect(rewriteSrcImportsToDist(code, srcDir, only('/pack/src/node-types/upper.js', '/pack/dist/node-types/upper.js'))).toBe(code);
    expect(rewriteSrcImportsToDist(code, srcDir, only())).toBe(code);
  });

  it('rewrites for a workflow directly in src/, not only in a folder below it', () => {
    const code = `import { x } from './node-types/x.js';`;
    expect(rewriteSrcImportsToDist(code, '/pack/src', only('/pack/dist/node-types/x.js')))
      .toBe(`import { x } from '../dist/node-types/x.js';`);
  });

  it('leaves a directory that is not under src/ alone', () => {
    const code = `import { upper } from './upper.js';`;
    expect(rewriteSrcImportsToDist(code, '/pack/lib', only('/pack/dist/upper.js'))).toBe(code);
  });

  it('rewrites every relative import, in either quote style, and never a bare specifier', () => {
    const code = [
      `import { a } from './a.js';`,
      `import { b } from "./b.js";`,
      `import { z } from 'zod';`,
    ].join('\n');
    const out = rewriteSrcImportsToDist(code, srcDir, only('/pack/dist/workflows/a.js', '/pack/dist/workflows/b.js'));
    expect(out).toBe([
      `import { a } from '../../dist/workflows/a.js';`,
      `import { b } from '../../dist/workflows/b.js';`,
      `import { z } from 'zod';`,
    ].join('\n'));
  });

  it('writes forward slashes for Windows paths', () => {
    const code = `import { upper } from '../node-types/upper.js';`;
    const out = rewriteSrcImportsToDist(code, 'C:\\pack\\src\\workflows', only('C:\\pack\\dist\\node-types\\upper.js'), path.win32);
    expect(out).toBe(`import { upper } from '../../dist/node-types/upper.js';`);
  });

});
