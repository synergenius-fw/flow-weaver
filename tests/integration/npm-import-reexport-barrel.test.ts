/**
 * Regression: `@fwImport` / `import { x } from 'pkg'` where the package's
 * top-level `.d.ts` is a re-export barrel (`export * from './sub'` or
 * `export { x } from './sub'`) instead of declaring the function inline.
 *
 * The npm-import resolver read ONLY the resolved top-level `.d.ts` and
 * extracted function declarations from it. A barrel has zero function
 * declarations, so the resolver found nothing and fell back to a stub
 * node type with `inputs: {}` and `outputs: { result }`. Downstream the
 * compiler then generated a no-arg call (`fn()`) returning `{ result }`,
 * dropping every real port.
 *
 * This is how `@synergenius/flow-weaver-pack-core` ships: its
 * `dist/index.d.ts` is `export * from './node-types/index.js'`, so a
 * pack referencing `waitForApproval` (inputs prompt/context/approverId,
 * outputs approved/.../onSuccess/onFailure) resolved to the bare
 * `{ result }` stub and could not compile its `@connect`s.
 *
 * The resolver must follow re-exports to the file that actually declares
 * the function.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { AnnotationParser } from '../../src/parser';

const tmpDir = path.join(os.tmpdir(), `fw-reexport-barrel-${process.pid}`);

beforeAll(() => fs.mkdirSync(tmpDir, { recursive: true }));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function writeFile(name: string, content: string): string {
  const p = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

/** A package whose index.d.ts re-exports the real declaration from a subfile. */
function setupBarrelPackage(): void {
  const pkgDir = path.join(tmpDir, 'node_modules', 'barrel-pkg');
  fs.mkdirSync(path.join(pkgDir, 'node-types'), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'barrel-pkg', version: '1.0.0', types: 'index.d.ts' }),
  );
  // Top-level barrel: NO inline declarations, only a star re-export.
  fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), `export * from './node-types/index.js';\n`);
  // Second barrel level (mirrors pack-core's node-types/index.d.ts).
  fs.writeFileSync(
    path.join(pkgDir, 'node-types', 'index.d.ts'),
    `export { gateApproval } from './gate-approval.js';\n`,
  );
  // The file that actually declares the function, with full JSDoc ports.
  fs.writeFileSync(
    path.join(pkgDir, 'node-types', 'gate-approval.d.ts'),
    `/**
 * @flowWeaver nodeType
 * @label Gate Approval
 * @input prompt - Question shown to the approver
 * @input approverId - Logical approver id
 * @output approved - Whether approved
 * @output reason - Reviewer note
 */
export declare function gateApproval(execute: boolean, prompt: string, approverId: string): Promise<{
    onSuccess: boolean;
    onFailure: boolean;
    approved: boolean;
    reason: string;
}>;
`,
  );
}

describe('npm @fwImport through a re-export barrel .d.ts', () => {
  const parser = new AnnotationParser();

  beforeAll(() => {
    parser.clearCache();
    setupBarrelPackage();
  });

  it('resolves the real ports of a function re-exported via barrel (not the {result} stub)', () => {
    const workflowPath = writeFile(
      'workflow-barrel.ts',
      `/**
 * @flowWeaver workflow
 * @fwImport gateApproval gateApproval from "barrel-pkg"
 * @node gate gateApproval [expr: prompt="'Approve?'", approverId="'rev'"]
 * @path Start -> gate -> Exit
 * @connect gate.approved -> Exit.approved
 * @connect gate.reason -> Exit.reason
 * @connect gate.onSuccess -> Exit.onSuccess
 * @connect gate.onFailure -> Exit.onFailure
 * @returns approved
 * @returns reason
 */
export function barrelWorkflow(
  execute: boolean,
): { onSuccess: boolean; onFailure: boolean; approved: boolean; reason: string } {
  throw new Error('stub');
}
`,
    );

    const result = parser.parse(workflowPath);
    // No "node does not have output port" / "not found" validation errors.
    expect(result.errors).toEqual([]);

    // The @fwImport-resolved nodeType is attached to the workflow's
    // nodeTypes (not the top-level file nodeTypes).
    const nt = result.workflows[0].nodeTypes.find((n) => n.name === 'gateApproval');
    expect(nt).toBeDefined();
    expect(nt!.importSource).toBe('barrel-pkg');
    // The real ports must be resolved, NOT the bare `{ result }` stub.
    expect(Object.keys(nt!.inputs)).toEqual(expect.arrayContaining(['prompt', 'approverId']));
    expect(Object.keys(nt!.outputs)).toEqual(expect.arrayContaining(['approved', 'reason']));
    // The stub's fallback output must be gone.
    expect(Object.keys(nt!.outputs)).not.toContain('result');
    expect(nt!.isAsync).toBe(true);
  });
});
