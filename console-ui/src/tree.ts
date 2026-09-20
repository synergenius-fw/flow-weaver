/**
 * The project's workflows as a tree.
 *
 * A flat list stops working on two counts as a project grows: the folders
 * an author already organised by (`agent-gate-demo`, `batch-invoices`) are
 * flattened away, and two workflows may share a name -- `reviewFile` exists
 * twice in the use cases -- so the path is the only thing telling them
 * apart.
 */
import type { WorkflowSummary } from './state';

export interface TreeLeaf {
  kind: 'workflow';
  key: string;
  /** The workflow's name, or `file · name` where a file holds several. */
  label: string;
  workflow: WorkflowSummary;
}

export interface TreeFolder {
  /** A directory, or a file that holds more than one workflow. */
  kind: 'folder' | 'file';
  key: string;
  label: string;
  children: TreeNode[];
  /** Everything beneath, so a collapsed folder can still report what it holds. */
  errors: number;
  warnings: number;
  waiting: number;
  /** False while anything beneath is still being parsed. */
  checked: boolean;
}

export type TreeNode = TreeFolder | TreeLeaf;

/** Depth-first, folders before workflows, each alphabetical. */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  const rank = (n: TreeNode) => (n.kind === 'folder' ? 0 : n.kind === 'file' ? 1 : 2);
  return nodes.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

function rollUp(folder: TreeFolder): void {
  for (const child of folder.children) {
    if (child.kind !== 'workflow') {
      rollUp(child);
      folder.errors += child.errors;
      folder.warnings += child.warnings;
      folder.waiting += child.waiting;
      folder.checked &&= child.checked;
    } else {
      folder.errors += child.workflow.errors;
      folder.warnings += child.workflow.warnings;
      folder.waiting += child.workflow.waiting;
      folder.checked &&= child.workflow.checked;
    }
  }
  sortNodes(folder.children);
}

/**
 * Group workflows by the directories they live in.
 *
 * A directory that only ever contains one directory is joined to it
 * (`a/b/flow.ts` shows as `a/b`), so a deep tree does not become a column
 * of one-child folders.
 */
export function buildTree(workflows: WorkflowSummary[]): TreeNode[] {
  const root: TreeFolder = { kind: 'folder', key: '', label: '', children: [], errors: 0, warnings: 0, waiting: 0, checked: true };
  const folders = new Map<string, TreeFolder>([['', root]]);

  // A file is a container too, so a file holding several workflows becomes
  // a node with them beneath it rather than a row repeated per workflow.
  const perFile = new Map<string, number>();
  for (const w of workflows) perFile.set(w.rel, (perFile.get(w.rel) ?? 0) + 1);

  for (const w of workflows) {
    const parts = w.rel.split('/');
    const fileName = parts.pop()!;
    let dir = '';
    let parent = root;
    for (const part of parts) {
      dir = dir ? `${dir}/${part}` : part;
      let folder = folders.get(dir);
      if (!folder) {
        folder = { kind: 'folder', key: dir, label: part, children: [], errors: 0, warnings: 0, waiting: 0, checked: true };
        folders.set(dir, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }

    if ((perFile.get(w.rel) ?? 0) > 1) {
      let file = folders.get(w.rel);
      if (!file) {
        file = { kind: 'file', key: w.rel, label: fileName, children: [], errors: 0, warnings: 0, waiting: 0, checked: true };
        folders.set(w.rel, file);
        parent.children.push(file);
      }
      parent = file;
    }

    parent.children.push({
      kind: 'workflow',
      key: `${w.file}|${w.name}`,
      label: w.name,
      workflow: w,
    });
  }

  rollUp(root);
  return collapseSingleFolders(root.children);
}

/** `a` containing only `b` becomes `a/b`. */
function collapseSingleFolders(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind !== 'folder') return node;
    let folder = { ...node, children: collapseSingleFolders(node.children) };
    while (folder.kind === 'folder' && folder.children.length === 1 && folder.children[0].kind === 'folder') {
      const only = folder.children[0];
      folder = { ...folder, key: only.key, label: `${folder.label}/${only.label}`, children: only.children };
    }
    return folder;
  });
}

/** Folder keys holding a workflow, so the tree opens showing where you are. */
export function pathTo(rel: string): string[] {
  const parts = rel.split('/');
  parts.pop();
  const keys: string[] = [];
  let dir = '';
  for (const part of parts) {
    dir = dir ? `${dir}/${part}` : part;
    keys.push(dir);
  }
  return keys;
}
