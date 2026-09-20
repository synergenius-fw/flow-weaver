/**
 * Find the workflows in a project directory.
 *
 * Two passes, because they cost three orders of magnitude apart. Listing
 * what exists is a syntax-only parse of each file -- no type checker, no
 * program -- and takes under a second across six hundred files. Knowing
 * whether a workflow is *valid* means a full parse and a validation run,
 * which on this repo's own tests directory took thirty seconds.
 *
 * So the rail is filled from the first pass and the verdicts arrive from
 * the second, rather than a project being unusable until every workflow in
 * it has been checked.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseWorkflow } from '../api/parse.js';
import { validateWorkflow } from '../api/validate.js';
import { getAvailableWorkflows } from '../api/workflow-file-operations.js';
import { installedRefs, packForFile, packForSpecifier, type InstalledRef } from './packs.js';

export interface WorkflowSummary {
  /** Absolute path, in the platform's own form. */
  file: string;
  /**
   * Path within the project, always `/`-separated.
   *
   * The client splits this to build the tree and puts it in the URL hash,
   * so it is one convention everywhere rather than `\` on Windows and `/`
   * elsewhere. `file` stays native, because that is what gets opened.
   */
  rel: string;
  name: string;
  steps: number;
  gates: number;
  errors: number;
  warnings: number;
  /** False until the full parse has run; the rail shows it as still loading. */
  checked: boolean;
  /** Every validation code raised, once each. */
  codes: string[];
  /**
   * What the workflow makes use of, as facets the guide can match a topic
   * against: `gate:approval`, `builtin:waitForAgent`, `pack:<name>`, `pull`, `expr`,
   * `scope`, `effect`, `pure`, `expression`.
   */
  uses: string[];
}

const SKIP = new Set(['node_modules', 'dist', '.git', '.fw', 'coverage']);

/** A project-relative path the client can split on `/` on any platform. */
export const toPosix = (p: string): string => p.split(path.sep).join('/');

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory: not this tool's business to complain
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    // `.fw-diff-*` is an older version of a file, written beside it for a moment to be parsed for the Changes pane.
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.startsWith('.fw-diff-')) out.push(full);
  }
}

interface Listed {
  file: string;
  rel: string;
  names: string[];
  mtimeMs: number;
}

/**
 * Which workflows a project holds, by name.
 *
 * A text match alone is not enough: test files build workflow sources
 * inside template literals, and matching the annotation anywhere listed two
 * hundred of them as nameless rows. `getAvailableWorkflows` parses the
 * syntax, so it sees declarations rather than strings.
 */
function listOne(file: string, projectDir: string, mtimeMs: number): Listed | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (!text.includes('@flowWeaver workflow')) return null;
  const names = getAvailableWorkflows(text).map((w) => w.functionName).filter(Boolean);
  return names.length ? { file, rel: toPosix(path.relative(projectDir, file)), names, mtimeMs } : null;
}

/** Verdicts, keyed by `file|name` and invalidated when the file changes. */
const checked = new Map<string, { mtimeMs: number; summary: WorkflowSummary }>();

/**
 * The listing itself, per project.
 *
 * Even the syntax pass reads every `.ts` file in the tree, which is most of
 * a second on a large project -- and the console asks for the list on every
 * file change. Reusing it needs care: a cache that only the file watcher
 * invalidates goes stale for any caller without one. So the walk is always
 * done (5ms) and its file identities compared; only the reading and parsing
 * is skipped, and only for files that have not changed.
 */
const listings = new Map<string, { byFile: Map<string, Listed>; signature: string }>();

/** Forget a project's listing, so the next scan re-reads every file. */
export function invalidateListing(projectDir?: string): void {
  if (projectDir) listings.delete(path.resolve(projectDir));
  else listings.clear();
}

function listCached(projectDir: string): Listed[] {
  const key = path.resolve(projectDir);
  const files: string[] = [];
  walk(key, files);

  const stats = new Map<string, number>();
  for (const file of files) {
    try { stats.set(file, fs.statSync(file).mtimeMs); } catch { /* vanished mid-walk */ }
  }
  const signature = [...stats].map(([f, m]) => `${f}:${m}`).join('|');

  const hit = listings.get(key);
  if (hit && hit.signature === signature) return [...hit.byFile.values()];

  const byFile = new Map<string, Listed>();
  for (const [file, mtimeMs] of stats) {
    const previous = hit?.byFile.get(file);
    if (previous && previous.mtimeMs === mtimeMs) { byFile.set(file, previous); continue; }
    const listed = listOne(file, key, mtimeMs);
    if (listed) byFile.set(file, listed);
  }
  listings.set(key, { byFile, signature });
  return [...byFile.values()];
}

async function check(entry: Listed, name: string, packs: InstalledRef[]): Promise<WorkflowSummary> {
  const base: WorkflowSummary = {
    file: entry.file, rel: entry.rel, name,
    steps: 0, gates: 0, errors: 0, warnings: 0, checked: true, codes: [], uses: [],
  };
  try {
    const parsed = await parseWorkflow(entry.file, { workflowName: name, projectDir: path.dirname(entry.file) });
    if (parsed.errors.length || !parsed.ast) return { ...base, errors: Math.max(1, parsed.errors.length) };
    const ast = parsed.ast;
    const v = validateWorkflow(ast);
    const uses = new Set<string>();
    let gates = 0;
    for (const i of ast.instances) {
      const nt = ast.nodeTypes.find((n) => n.name === i.nodeType) ?? ast.nodeTypes.find((n) => n.functionName === i.nodeType);
      if (nt?.durableGate !== undefined) { gates++; uses.add(`gate:${nt.durableGate}`); }
      if (nt && !nt.functionText) uses.add(`builtin:${nt.functionName}`);
      const pack = (nt?.sourceLocation?.file ? packForFile(nt.sourceLocation.file, packs) : null) ?? packForSpecifier(nt?.importSource, packs);
      if (pack) uses.add(`pack:${pack}`);
      if (nt?.durableEffect) uses.add('effect');
      if (nt?.durablePure) uses.add('pure');
      if (nt?.expression) uses.add('expression');
      if (i.config?.pullExecution !== undefined) uses.add('pull');
      if (i.config?.portConfigs?.some((c) => c.expression)) uses.add('expr');
    }
    if (Object.keys(ast.scopes ?? {}).length) uses.add('scope');
    const codes = [...new Set([...v.errors, ...v.warnings].map((e) => e.code))];
    return { ...base, steps: ast.instances.length, gates, errors: v.errors.length, warnings: v.warnings.length, codes, uses: [...uses] };
  } catch {
    return { ...base, errors: 1 };
  }
}

const sortSummaries = (rows: WorkflowSummary[]): WorkflowSummary[] =>
  rows.sort((a, b) => a.rel.localeCompare(b.rel) || a.name.localeCompare(b.name));

/**
 * Every workflow in the project, with whatever verdicts are already known.
 *
 * Returns without parsing: a workflow not yet checked comes back with
 * `checked: false` and zeroed counts. Call {@link checkWorkflows} to fill
 * them in.
 */
export function scanWorkflowNames(projectDir: string): WorkflowSummary[] {
  const rows: WorkflowSummary[] = [];
  for (const entry of listCached(projectDir)) {
    for (const name of entry.names) {
      const hit = checked.get(`${entry.file}|${name}`);
      rows.push(hit && hit.mtimeMs === entry.mtimeMs
        ? hit.summary
        : { file: entry.file, rel: entry.rel, name, steps: 0, gates: 0, errors: 0, warnings: 0, checked: false, codes: [], uses: [] });
    }
  }
  return sortSummaries(rows);
}

/**
 * Parse and validate whatever is not yet checked, reporting as each lands.
 *
 * @param projectDir - The project being shown.
 * @param onChecked - Called after each workflow, so the rail can fill in.
 */
export async function checkWorkflows(
  projectDir: string,
  onChecked?: (summary: WorkflowSummary) => void,
): Promise<WorkflowSummary[]> {
  const rows: WorkflowSummary[] = [];
  const packs = await installedRefs(projectDir);
  for (const entry of listCached(projectDir)) {
    for (const name of entry.names) {
      const key = `${entry.file}|${name}`;
      const hit = checked.get(key);
      if (hit && hit.mtimeMs === entry.mtimeMs) { rows.push(hit.summary); continue; }
      const summary = await check(entry, name, packs);
      checked.set(key, { mtimeMs: entry.mtimeMs, summary });
      rows.push(summary);
      onChecked?.(summary);
    }
  }
  return sortSummaries(rows);
}

/** Names and verdicts together. Convenient, but as slow as the full check. */
export async function scanWorkflows(projectDir: string): Promise<WorkflowSummary[]> {
  return checkWorkflows(projectDir);
}
