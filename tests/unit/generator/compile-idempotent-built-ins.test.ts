/**
 * Compiling a compiled file again changes nothing. A workflow that uses a
 * built-in node carries a copy of that node's source after its first
 * compile, and the next compile reads the node type from that copy instead
 * of the registry. The two must agree, port order included, or the second
 * compile rewrites the file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { compileWorkflow } from '../../../src/api/compile.js';
import { BUILT_IN_NODE_TYPES } from '../../../src/built-in-nodes/generated-registry.js';

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-idempotent-')); });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const LITERAL: Record<string, string> = { STRING: "'x'", NUMBER: '1', BOOLEAN: 'true', OBJECT: '({})', ARRAY: '[]', ANY: "'x'" };

/** A workflow that runs one built-in, its required inputs given as expressions. */
function workflowFor(nt: (typeof BUILT_IN_NODE_TYPES)[number]): string {
  const exprs = Object.entries(nt.inputs)
    .filter(([name, port]) => name !== 'execute' && port.dataType !== 'STEP' && !port.optional)
    .map(([name, port]) => `${name}="${LITERAL[port.dataType] ?? "'x'"}"`);
  const attrs = exprs.length ? ` [expr: ${exprs.join(', ')}]` : '';
  return `
/**
 * @flowWeaver workflow
 * @node n ${nt.functionName}${attrs}
 * @connect Start.execute -> n.execute
 * @connect n.onSuccess -> Exit.onSuccess
 */
export async function uses_${nt.functionName}(execute: boolean): Promise<{ onSuccess: boolean; onFailure: boolean }> {
  throw new Error('not compiled');
}
`;
}

describe('recompiling a workflow that uses a built-in node', () => {
  for (const nt of BUILT_IN_NODE_TYPES) {
    it(`leaves the file unchanged for ${nt.functionName}`, async () => {
      const file = path.join(dir, `${nt.functionName}.ts`);
      fs.writeFileSync(file, workflowFor(nt));
      await compileWorkflow(file);
      const first = fs.readFileSync(file, 'utf8');
      expect(first).toContain(`function ${nt.functionName}(`);
      await compileWorkflow(file);
      expect(fs.readFileSync(file, 'utf8')).toBe(first);
    }, 60000);
  }
});
