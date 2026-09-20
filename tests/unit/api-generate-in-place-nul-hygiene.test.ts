/**
 * Characterization tests for the NUL-byte hazard in
 * src/api/generate-in-place.ts (debt item #1).
 *
 * Two guarantees are pinned here BEFORE the fix, so the fix can be proven
 * behavior-neutral:
 *
 *  1. File hygiene: the source file must be valid UTF-8 with no NUL (0x00)
 *     bytes. A stray NUL at line 340 previously caused `file(1)` to classify
 *     the file as `data` and made NUL-unaware tools (grep, some editors)
 *     silently misread it.
 *
 *  2. Behavioral pin: `ensureFwImportStatements` (invoked from generateInPlace)
 *     de-dupes generated import lines by a `(functionName, importSource)` key.
 *     The NUL was the *separator* inside that key. Replacing it with a space
 *     must not change dedup behavior. These tests exercise that dedup through
 *     the public API: same (fn, source) => one import line, differing => two.
 *
 * NOTE: part (1) is expected to FAIL on the unmodified (NUL-containing) file
 * and pass once the NUL is replaced. Part (2) must pass both before and after.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generateInPlace } from '../../src/api/generate-in-place';
import type { TWorkflowAST, TNodeTypeAST } from '../../src/ast/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = resolve(HERE, '../../src/api/generate-in-place.ts');

const IMPORTS_START = '// @flow-weaver-imports-start';
const IMPORTS_END = '// @flow-weaver-imports-end';

function makeImportedNodeType(
  name: string,
  functionName: string,
  importSource: string,
): TNodeTypeAST {
  return {
    type: 'NodeType',
    name,
    functionName,
    importSource,
    inputs: {
      execute: { dataType: 'STEP' },
      value: { dataType: 'NUMBER' },
    },
    outputs: {
      onSuccess: { dataType: 'STEP' },
      onFailure: { dataType: 'STEP' },
      result: { dataType: 'NUMBER' },
    },
    hasSuccessPort: true,
    hasFailurePort: true,
    isAsync: false,
    executeWhen: 'CONJUNCTION',
    variant: 'FUNCTION',
  } as TNodeTypeAST;
}

const SOURCE_WITH_MARKERS = [
  '/**',
  ' * @flowWeaver workflow',
  ' * @node a doThing',
  ' * @connect Start.execute -> a.execute',
  ' * @connect a.onSuccess -> Exit.onSuccess',
  ' */',
  IMPORTS_START,
  IMPORTS_END,
  'export async function myWorkflow(',
  '  execute: boolean = true,',
  '): Promise<{ onSuccess: boolean; onFailure: boolean }> {',
  "  throw new Error('Not implemented');",
  '}',
].join('\n');

function astWith(nodeTypes: TNodeTypeAST[]): TWorkflowAST {
  return {
    type: 'Workflow',
    name: 'myWorkflow',
    functionName: 'myWorkflow',
    sourceFile: 'test.ts',
    nodeTypes,
    instances: [{ type: 'NodeInstance', id: 'a', nodeType: nodeTypes[0].name }],
    connections: [
      { type: 'Connection', from: { node: 'Start', port: 'execute' }, to: { node: 'a', port: 'execute' } },
      { type: 'Connection', from: { node: 'a', port: 'onSuccess' }, to: { node: 'Exit', port: 'onSuccess' } },
    ],
    scopes: {},
    startPorts: { execute: { dataType: 'STEP' } },
    exitPorts: { onSuccess: { dataType: 'STEP' }, onFailure: { dataType: 'STEP' } },
    imports: [],
  } as TWorkflowAST;
}

function countImportLines(code: string, source: string): number {
  const needle = "from '" + source + "'";
  return code.split('\n').filter((l) => l.includes(needle)).length;
}

describe('generate-in-place.ts NUL-byte hygiene (debt #1)', () => {
  it('source file contains no NUL byte and decodes as valid UTF-8', () => {
    const bytes = readFileSync(SOURCE_PATH);
    // The load-bearing check: a NUL is valid UTF-8 and round-trips cleanly, so
    // only an explicit byte scan catches it. This is what flips old→new.
    expect(bytes.includes(0x00)).toBe(false);
    // And the file is genuinely valid UTF-8 (round-trips without loss).
    const text = bytes.toString('utf-8');
    expect(Buffer.from(text, 'utf-8').equals(bytes)).toBe(true);
  });

  it('dedupes identical (functionName, importSource) to one import line', () => {
    const nt1 = makeImportedNodeType('doThing', 'doThing', 'pkg-a');
    const nt2 = makeImportedNodeType('doThingDup', 'doThing', 'pkg-a');
    const { code } = generateInPlace(SOURCE_WITH_MARKERS, astWith([nt1, nt2]), {
      skipParamReturns: true,
    });
    expect(countImportLines(code, 'pkg-a')).toBe(1);
  });

  it('keeps distinct import sources as separate import lines', () => {
    const nt1 = makeImportedNodeType('doThing', 'doThing', 'pkg-a');
    const nt2 = makeImportedNodeType('doThing2', 'doThing', 'pkg-b');
    const { code } = generateInPlace(SOURCE_WITH_MARKERS, astWith([nt1, nt2]), {
      skipParamReturns: true,
    });
    expect(countImportLines(code, 'pkg-a')).toBe(1);
    expect(countImportLines(code, 'pkg-b')).toBe(1);
  });
});
