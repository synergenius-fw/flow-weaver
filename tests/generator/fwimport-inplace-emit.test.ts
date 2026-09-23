/**
 * In-place compilation must emit an executable `import { fn } from "pkg"`
 * statement for every `@fwImport` node type. The generated body calls the
 * imported function by bare name, so without the import the module throws
 * `<fn> is not defined` at run time. The `@fwImport` JSDoc alone is not
 * enough: it persists intent but is not executable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { parser } from '../../src/parser/annotation-parser';
import { generateInPlace } from '../../src/api/generate-in-place';

const tmp = path.join(os.tmpdir(), `fw-fwimport-inplace-${process.pid}`);

beforeAll(() => fs.mkdirSync(tmp, { recursive: true }));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function setupBarrelPkg(): void {
  const pkg = path.join(tmp, 'node_modules', 'barrel-pkg');
  fs.mkdirSync(path.join(pkg, 'node-types'), { recursive: true });
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: 'barrel-pkg', version: '1.0.0', types: 'index.d.ts' }),
  );
  fs.writeFileSync(path.join(pkg, 'index.d.ts'), `export * from './node-types/index.js';\n`);
  fs.writeFileSync(
    path.join(pkg, 'node-types', 'index.d.ts'),
    `export { gateApproval } from './gate-approval.js';\n`,
  );
  fs.writeFileSync(
    path.join(pkg, 'node-types', 'gate-approval.d.ts'),
    `/**\n * @flowWeaver nodeType\n * @input prompt - q\n * @input approverId - id\n * @output approved - a\n */\nexport declare function gateApproval(execute: boolean, prompt: string, approverId: string): Promise<{ onSuccess: boolean; onFailure: boolean; approved: boolean }>;\n`,
  );
}

describe('in-place @fwImport import emission', () => {
  beforeAll(() => {
    parser.clearCache();
    setupBarrelPkg();
  });

  it('emits a real import statement for an @fwImport node type', () => {
    const wfPath = path.join(tmp, 'wf.ts');
    const source = `/**
 * @flowWeaver workflow
 * @fwImport gateApproval gateApproval from "barrel-pkg"
 * @node gate gateApproval [expr: prompt="'Approve?'", approverId="'rev'"]
 * @path Start -> gate -> Exit
 * @connect gate.approved -> Exit.approved
 * @connect gate.onSuccess -> Exit.onSuccess
 * @connect gate.onFailure -> Exit.onFailure
 * @returns approved
 */
export function wf(
  execute: boolean,
): { onSuccess: boolean; onFailure: boolean; approved: boolean } {
  throw new Error('stub');
}
`;
    fs.writeFileSync(wfPath, source);
    const parsed = parser.parse(wfPath);
    expect(parsed.errors).toEqual([]);
    const result = generateInPlace(source, parsed.workflows[0]);

    // The executable import for the foreign node must be present.
    expect(result.code).toContain("import { gateApproval } from 'barrel-pkg';");
    // The body must call it by name.
    expect(result.code).toContain('gateApproval(');
  });
});
