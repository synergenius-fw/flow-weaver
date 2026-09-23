/**
 * Tests for generateInPlace @color/@icon update bug.
 *
 * Root cause: when updateNodeType receives a full node type object as updates
 * (from client JSON roundtrip), Object.assign overwrites sourceLocation.file
 * with the client's virtual path. generateInPlace then skips the node type
 * because path.resolve(virtualPath) !== path.resolve(ast.sourceFile).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parser } from '../../../src/parser';
import { updateNodeType } from '../../../src/api';
import { generateInPlace } from '../../../src/api/generate-in-place';
import type { TNodeTypeAST } from '../../../src/ast/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

const WORKFLOW_SOURCE = `/**
 * @flowWeaver nodeType
 * @expression
 * @color teal
 * @icon ai
 * @input text [order:0] - Text
 * @output result [order:0] - Result
 */
function shout(text: string): { result: string } {
  return { result: text.toUpperCase() + '!!!' };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @input name [order:0] - Name
 * @output greeting [order:0] - Greeting
 */
function greet(name: string): { greeting: string } {
  return { greeting: \`Hello, \${name}!\` };
}

// @flow-weaver-runtime-start
// generated
// @flow-weaver-runtime-end

// @flow-weaver-body-start
// generated
// @flow-weaver-body-end

/**
 * @flowWeaver workflow
 * @node s shout
 * @node g greet
 * @path Start -> g -> s -> Exit
 * @connect g.greeting -> s.text
 * @connect s.result -> Exit.message
 */
export function helloWorld(
  execute: boolean,
  params: { name: string }
): { onSuccess: boolean; onFailure: boolean; message: string } {
  throw new Error('Compile with: fw compile <file>');
}
`;

describe('generateInPlace sourceLocation.file mismatch', () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-visuals-sl-'));
    tmpFile = path.join(tmpDir, 'testing.ts');
    fs.writeFileSync(tmpFile, WORKFLOW_SOURCE);
    parser.clearCache();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reproduces: virtual sourceLocation.file causes generateInPlace to skip node type', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];
    const shout = wf.nodeTypes.find(nt => nt.functionName === 'shout')!;

    // Simulate client roundtrip: full spread with virtual path
    const clientUpdates = {
      ...JSON.parse(JSON.stringify(shout)),
      visuals: { color: 'green', icon: 'ai' },
      sourceLocation: { ...shout.sourceLocation, file: '/testing.ts' },
    };

    const updated = updateNodeType(wf, 'shout', clientUpdates);
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    // BUG: generateInPlace skips shout because sourceLocation.file mismatch
    expect(result.code).toContain('@color green');
    expect(result.code).not.toContain('@color teal');
  });

  it('reproduces: empty string sourceLocation.file causes skip', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];
    const shout = wf.nodeTypes.find(nt => nt.functionName === 'shout')!;

    const clientUpdates = {
      ...JSON.parse(JSON.stringify(shout)),
      visuals: { color: 'pink', icon: 'biotech' },
      sourceLocation: { line: shout.sourceLocation?.line, column: 0 },
    };

    const updated = updateNodeType(wf, 'shout', clientUpdates);
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@color pink');
    expect(result.code).toContain('@icon biotech');
  });

  it('reproduces: undefined sourceLocation causes skip', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    const clientUpdates = {
      ...JSON.parse(JSON.stringify(wf.nodeTypes.find(nt => nt.functionName === 'shout')!)),
      visuals: { color: 'orange' },
      sourceLocation: undefined,
    };

    const updated = updateNodeType(wf, 'shout', clientUpdates);
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@color orange');
  });

  it('works correctly when sourceLocation.file matches', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    // Only pass visuals update (not the full spread)
    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'ai' },
    });
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@color green');
    expect(result.code).not.toContain('@color teal');
  });

  it('updates @icon independently', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'teal', icon: 'biotech' },
    });
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@icon biotech');
    expect(result.code).not.toContain('@icon ai');
    expect(result.code).toContain('@color teal');
  });

  it('removes @color when set to undefined', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    const updated = updateNodeType(wf, 'shout', {
      visuals: { icon: 'ai' },
    });
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).not.toContain('@color');
    expect(result.code).toContain('@icon ai');
  });

  it('removes @icon when set to undefined', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'teal' },
    });
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@color teal');
    expect(result.code).not.toContain('@icon');
  });

  it('adds @color to nodeType that had none', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    const updated = updateNodeType(wf, 'greet', {
      visuals: { color: 'cyan', icon: 'code' },
    });
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    // greet's JSDoc should now include @color and @icon
    const greetIdx = result.code.indexOf('function greet');
    const jsdocStart = result.code.lastIndexOf('/**', greetIdx);
    const jsdocBlock = result.code.slice(jsdocStart, greetIdx);

    expect(jsdocBlock).toContain('@color cyan');
    expect(jsdocBlock).toContain('@icon code');
  });

  it('handles multiple nodeType visual updates in same workflow', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    let updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'biotech' },
    });
    updated = updateNodeType(updated, 'greet', {
      visuals: { color: 'pink', icon: 'code' },
    });

    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    // shout should have green/biotech
    const shoutIdx = result.code.indexOf('function shout');
    const shoutJsdoc = result.code.slice(result.code.lastIndexOf('/**', shoutIdx), shoutIdx);
    expect(shoutJsdoc).toContain('@color green');
    expect(shoutJsdoc).toContain('@icon biotech');

    // greet should have pink/code
    const greetIdx = result.code.indexOf('function greet');
    const greetJsdoc = result.code.slice(result.code.lastIndexOf('/**', greetIdx), greetIdx);
    expect(greetJsdoc).toContain('@color pink');
    expect(greetJsdoc).toContain('@icon code');
  });

  it('reproduces: relative virtual path causes skip', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];
    const shout = wf.nodeTypes.find(nt => nt.functionName === 'shout')!;

    const clientUpdates = {
      ...JSON.parse(JSON.stringify(shout)),
      visuals: { color: 'green', icon: 'ai' },
      sourceLocation: { ...shout.sourceLocation, file: 'testing.ts' },
    };

    const updated = updateNodeType(wf, 'shout', clientUpdates);
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@color green');
    expect(result.code).not.toContain('@color teal');
  });

  it('reproduces: cloud workspace path prefix mismatch', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];
    const shout = wf.nodeTypes.find(nt => nt.functionName === 'shout')!;

    // Cloud: sourceLocation has /cloud/testing.ts, ast has /workspace/uuid/testing.ts
    const clientUpdates = {
      ...JSON.parse(JSON.stringify(shout)),
      visuals: { color: 'orange' },
      sourceLocation: { ...shout.sourceLocation, file: '/cloud/testing.ts' },
    };

    const updated = updateNodeType(wf, 'shout', clientUpdates);
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@color orange');
    expect(result.code).not.toContain('@color teal');
  });

  it('updateNodeType with partial updates preserves sourceLocation', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    // Only send visuals, no sourceLocation override
    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'biotech' },
    } as Partial<TNodeTypeAST>);

    const shout = updated.nodeTypes.find(nt => nt.functionName === 'shout')!;
    // sourceLocation should still have the real file path
    expect(shout.sourceLocation?.file).toBe(tmpFile);
  });

  it('label change via full roundtrip also updates JSDoc', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];
    const shout = wf.nodeTypes.find(nt => nt.functionName === 'shout')!;

    const clientUpdates = {
      ...JSON.parse(JSON.stringify(shout)),
      label: 'Screamer',
      sourceLocation: { ...shout.sourceLocation, file: '/testing.ts' },
    };

    const updated = updateNodeType(wf, 'shout', clientUpdates);
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@label Screamer');
  });

  it('description change via full roundtrip also updates JSDoc', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];
    const shout = wf.nodeTypes.find(nt => nt.functionName === 'shout')!;

    const clientUpdates = {
      ...JSON.parse(JSON.stringify(shout)),
      description: 'Makes text loud',
      sourceLocation: { ...shout.sourceLocation, file: '/testing.ts' },
    };

    const updated = updateNodeType(wf, 'shout', clientUpdates);
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('Makes text loud');
  });

  it('tag change via full roundtrip updates JSDoc', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];
    const shout = wf.nodeTypes.find(nt => nt.functionName === 'shout')!;

    const clientUpdates = {
      ...JSON.parse(JSON.stringify(shout)),
      visuals: { color: 'teal', icon: 'ai', tags: [{ label: 'BETA' }] },
      sourceLocation: { ...shout.sourceLocation, file: '/testing.ts' },
    };

    const updated = updateNodeType(wf, 'shout', clientUpdates);
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@tag BETA');
  });

  it('still skips node types from genuinely different files with different basenames', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    // Simulate an imported node type from a completely different file
    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'ai' },
      sourceLocation: { file: '/some/other/directory/other-file.ts', line: 1, column: 0 },
    } as Partial<TNodeTypeAST>);

    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    // shout should be SKIPPED (different basename), original @color teal preserved
    expect(result.code).toContain('@color teal');
    expect(result.code).not.toContain('@color green');
  });

  it('same basename from different directory still processes (matches by basename)', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    // Same basename (testing.ts) but different directory. This is the roundtrip scenario
    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'ai' },
      sourceLocation: { file: '/virtual/workspace/testing.ts', line: 1, column: 0 },
    } as Partial<TNodeTypeAST>);

    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    // Should process because basename matches
    expect(result.code).toContain('@color green');
    expect(result.code).not.toContain('@color teal');
  });

  // --- Path format edge cases ---

  it('Windows-style backslash path matches after normalization', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    // Backslashes are normalized to forward slashes before comparison
    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'ai' },
      sourceLocation: { file: '\\workspace\\testing.ts', line: 1, column: 0 },
    } as Partial<TNodeTypeAST>);

    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@color green');
    expect(result.code).not.toContain('@color teal');
  });

  it('path with trailing slash still matches by basename', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    // path.basename('/testing.ts/') returns 'testing.ts' on POSIX
    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'ai' },
      sourceLocation: { file: '/testing.ts/', line: 1, column: 0 },
    } as Partial<TNodeTypeAST>);

    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@color green');
    expect(result.code).not.toContain('@color teal');
  });

  it('null sourceLocation.file is treated as local (not skipped)', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'ai' },
      sourceLocation: { file: null as any, line: 1, column: 0 },
    } as Partial<TNodeTypeAST>);

    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    // null file should not trigger the skip (falsy check at line 100)
    expect(result.code).toContain('@color green');
  });

  // --- Multiple node types in same file ---

  it('skips imported node type but processes local one in same workflow', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    // greet has virtual path (roundtripped), shout has different-file path (imported)
    let updated = updateNodeType(wf, 'greet', {
      visuals: { color: 'cyan' },
      sourceLocation: { file: '/testing.ts', line: 1, column: 0 },
    } as Partial<TNodeTypeAST>);
    updated = updateNodeType(updated, 'shout', {
      visuals: { color: 'red' },
      sourceLocation: { file: '/other/different-module.ts', line: 1, column: 0 },
    } as Partial<TNodeTypeAST>);

    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    // greet: same basename -> processed
    const greetIdx = result.code.indexOf('function greet');
    const greetJsdoc = result.code.slice(result.code.lastIndexOf('/**', greetIdx), greetIdx);
    expect(greetJsdoc).toContain('@color cyan');

    // shout: different basename -> skipped, original preserved
    expect(result.code).toContain('@color teal');
  });

  // --- Color value edge cases ---

  it('handles all valid color values', () => {
    const colors = ['blue', 'purple', 'cyan', 'orange', 'pink', 'green', 'red', 'yellow', 'teal'];
    const parsed = parser.parse(tmpFile);

    for (const color of colors) {
      const wf = parsed.workflows[0];
      const updated = updateNodeType(wf, 'shout', {
        visuals: { color },
      });
      const result = generateInPlace(WORKFLOW_SOURCE, updated);
      expect(result.code).toContain(`@color ${color}`);
    }
  });

  it('handles icon names with special characters', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'teal', icon: 'autoAwesome' },
    });
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@icon autoAwesome');
  });

  it('clears all visuals when set to empty object', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    const updated = updateNodeType(wf, 'shout', {
      visuals: {},
    });
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).not.toContain('@color');
    expect(result.code).not.toContain('@icon');
  });

  it('clears all visuals when set to undefined', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    const updated = updateNodeType(wf, 'shout', {
      visuals: undefined,
    });
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).not.toContain('@color');
    expect(result.code).not.toContain('@icon');
  });

  // --- Tags edge cases ---

  it('adds multiple tags', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    const updated = updateNodeType(wf, 'shout', {
      visuals: {
        color: 'teal',
        icon: 'ai',
        tags: [
          { label: 'BETA' },
          { label: 'AI', tooltip: 'Uses artificial intelligence' },
        ],
      },
    });
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    expect(result.code).toContain('@tag BETA');
    expect(result.code).toContain('@tag AI "Uses artificial intelligence"');
  });

  it('removes tags when visuals.tags is empty array', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    // First add a tag
    let updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'teal', icon: 'ai', tags: [{ label: 'BETA' }] },
    });
    const withTag = generateInPlace(WORKFLOW_SOURCE, updated);
    expect(withTag.code).toContain('@tag BETA');

    // Then remove it
    const wf2 = parser.parseFromString(withTag.code).workflows[0];
    updated = updateNodeType(wf2, 'shout', {
      visuals: { color: 'teal', icon: 'ai', tags: [] },
    });
    const withoutTag = generateInPlace(withTag.code, updated);

    expect(withoutTag.code).not.toContain('@tag');
  });

  // --- Idempotency ---

  it('applying same visuals twice produces identical output', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];

    const updated = updateNodeType(wf, 'shout', {
      visuals: { color: 'green', icon: 'biotech' },
    });

    const result1 = generateInPlace(WORKFLOW_SOURCE, updated);
    const result2 = generateInPlace(result1.code, updated);

    expect(result1.code).toBe(result2.code);
  });

  it('roundtrip: parse -> update visuals via full spread -> generate -> parse -> verify', () => {
    const parsed = parser.parse(tmpFile);
    const wf = parsed.workflows[0];
    const shout = wf.nodeTypes.find(nt => nt.functionName === 'shout')!;

    // Client roundtrip with virtual path (the bug scenario)
    const clientUpdates = {
      ...JSON.parse(JSON.stringify(shout)),
      visuals: { color: 'green', icon: 'biotech' },
      sourceLocation: { file: '/testing.ts', line: 20, column: 0 },
    };

    const updated = updateNodeType(wf, 'shout', clientUpdates);
    const result = generateInPlace(WORKFLOW_SOURCE, updated);

    // Write and re-parse to verify persistence
    fs.writeFileSync(tmpFile, result.code);
    parser.clearCache();
    const reparsed = parser.parse(tmpFile);
    const shoutReparsed = reparsed.nodeTypes.find(nt => nt.functionName === 'shout');

    expect(shoutReparsed?.visuals?.color).toBe('green');
    expect(shoutReparsed?.visuals?.icon).toBe('biotech');
  });
});
