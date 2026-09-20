/**
 * Grouping a project's workflows by the folders they live in.
 *
 * A flat list flattens away the organisation an author already did, and it
 * cannot tell apart two workflows that share a name -- `reviewFile` exists
 * twice in the use cases, distinguished only by its path.
 */
import { describe, it, expect } from 'vitest';
import { buildTree, pathTo, type TreeFolder, type TreeNode } from '../../../console-ui/src/tree';
import type { WorkflowSummary } from '../../../console-ui/src/state';

const wf = (rel: string, name: string, over: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  file: `/project/${rel}`, rel, name, steps: 1, gates: 0, errors: 0, warnings: 0, waiting: 0, checked: true, codes: [], uses: [], ...over,
});

const labels = (nodes: TreeNode[]): string[] => nodes.map((n) => n.label);
const folder = (nodes: TreeNode[], label: string): TreeFolder =>
  nodes.find((n) => n.kind === 'folder' && n.label === label) as TreeFolder;

describe('buildTree', () => {
  it('leaves a flat project flat', () => {
    const tree = buildTree([wf('a.ts', 'alpha'), wf('b.ts', 'beta')]);
    expect(tree.every((n) => n.kind === 'workflow')).toBe(true);
    expect(labels(tree)).toEqual(['alpha', 'beta']);
  });

  it('groups by directory, folders before workflows', () => {
    const tree = buildTree([
      wf('loose.ts', 'loose'),
      wf('gates/one.ts', 'one'),
      wf('gates/two.ts', 'two'),
    ]);
    expect(labels(tree)).toEqual(['gates', 'loose']);
    expect(labels(folder(tree, 'gates').children)).toEqual(['one', 'two']);
  });

  it('puts a file holding several workflows above them', () => {
    // Two sibling rows both reading `notify · …` repeat the file name and
    // hide that they are one file; the file is a container, so it nests.
    const tree = buildTree([wf('notify.ts', 'emailAlert'), wf('notify.ts', 'chatAlert')]);
    expect(labels(tree)).toEqual(['notify.ts']);
    const file = tree[0] as TreeFolder;
    expect(file.kind).toBe('file');
    expect(labels(file.children)).toEqual(['chatAlert', 'emailAlert']);
  });

  it('sorts folders, then files, then workflows', () => {
    const tree = buildTree([
      wf('solo.ts', 'solo'),
      wf('pair.ts', 'one'),
      wf('pair.ts', 'two'),
      wf('dir/nested.ts', 'nested'),
    ]);
    expect(tree.map((n) => n.kind)).toEqual(['folder', 'file', 'workflow']);
    expect(labels(tree)).toEqual(['dir', 'pair.ts', 'solo']);
  });

  it('keeps the bare name when a file holds only one', () => {
    expect(labels(buildTree([wf('notify.ts', 'emailAlert')]))).toEqual(['emailAlert']);
  });

  it('joins a folder that only holds another folder', () => {
    // `a` containing only `b` is a column of one-child rows otherwise.
    const tree = buildTree([wf('a/b/flow.ts', 'deep')]);
    expect(labels(tree)).toEqual(['a/b']);
    expect(labels(folder(tree, 'a/b').children)).toEqual(['deep']);
  });

  it('reports what a collapsed folder holds', () => {
    const tree = buildTree([
      wf('pack/ok.ts', 'ok'),
      wf('pack/bad.ts', 'bad', { errors: 2 }),
      wf('pack/waits.ts', 'waits', { waiting: 1, warnings: 3 }),
    ]);
    expect(folder(tree, 'pack')).toMatchObject({ errors: 2, warnings: 3, waiting: 1 });
  });

  it('rolls counts up through nested folders', () => {
    const tree = buildTree([wf('top/a.ts', 'a'), wf('top/deep/b.ts', 'b', { waiting: 2 })]);
    expect(folder(tree, 'top').waiting).toBe(2);
  });

  it('is unchecked while anything beneath it still is', () => {
    // The rail shows a spinner rather than a verdict it does not have yet.
    const tree = buildTree([wf('pack/a.ts', 'a'), wf('pack/b.ts', 'b', { checked: false })]);
    expect(folder(tree, 'pack').checked).toBe(false);
    expect(buildTree([wf('pack/a.ts', 'a')])[0]).toMatchObject({ checked: true });
  });

  it('returns nothing for an empty project', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('pathTo', () => {
  it('names each folder a workflow sits under', () => {
    expect(pathTo('a/b/flow.ts')).toEqual(['a', 'a/b']);
  });

  it('is empty at the top level', () => {
    expect(pathTo('flow.ts')).toEqual([]);
  });
});
