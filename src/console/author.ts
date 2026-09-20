/**
 * Working on a pack in the console.
 *
 * When the open project is itself a pack, the console can do what
 * `fw market pack` does before it writes anything: generate the manifest
 * from the sources, run the marketplace rules over it, and say what would
 * change in `flowweaver.manifest.json`. Writing and publishing stay
 * commands, put on the command line for the person to run.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateManifest, readManifest } from '../marketplace/manifest.js';
import { validatePackage } from '../marketplace/validator.js';
import type { TMarketplaceManifest, TValidationIssue } from '../marketplace/types.js';
import { describePack, type PackView } from './packs.js';

const PACK_NAME = /^(@[^/]+\/)?flow-weaver-pack-.+$/;
const PACK_KEYWORD = 'flow-weaver-marketplace-pack';

export interface PackProject {
  isPack: boolean;
  name?: string;
  version?: string;
}

/**
 * Whether a directory is a pack: it has a manifest, or its package.json
 * carries the marketplace keyword. The name convention is a last resort,
 * for a pack begun by hand that has neither yet.
 */
export function detectPackProject(projectDir: string): PackProject {
  const file = path.join(projectDir, 'package.json');
  if (!fs.existsSync(file)) return { isPack: false };
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: string; version?: string; keywords?: string[] };
    const isPack = fs.existsSync(path.join(projectDir, 'flowweaver.manifest.json'))
      || (pkg.keywords ?? []).includes(PACK_KEYWORD)
      || (typeof pkg.name === 'string' && PACK_NAME.test(pkg.name));
    return isPack ? { isPack, name: pkg.name, version: pkg.version } : { isPack: false };
  } catch {
    return { isPack: false };
  }
}

export interface PackCheck {
  name: string;
  version: string;
  parsedFiles: number;
  parseErrors: string[];
  valid: boolean;
  issues: TValidationIssue[];
  /** The manifest as it would be written, read the way an installed pack is. */
  manifest: PackView;
  /** Whether `flowweaver.manifest.json` exists yet. */
  hasManifest: boolean;
  /** What writing it would change, in words. Empty when it is up to date. */
  changes: string[];
}

const names = (list: Array<{ name: string }> | undefined): Set<string> => new Set((list ?? []).map((x) => x.name));

/** What differs between the committed manifest and the generated one, as sentences. */
export function manifestChanges(existing: TMarketplaceManifest | null, next: TMarketplaceManifest): string[] {
  if (!existing) return ['No flowweaver.manifest.json yet; fw market pack writes it.'];
  const out: string[] = [];
  if (existing.version !== next.version) out.push(`version ${existing.version} → ${next.version}`);
  if ((existing.description ?? '') !== (next.description ?? '')) out.push('description changed');
  for (const [label, was, now] of [
    ['node type', names(existing.nodeTypes), names(next.nodeTypes)],
    ['workflow', names(existing.workflows), names(next.workflows)],
    ['pattern', names(existing.patterns), names(next.patterns)],
  ] as const) {
    for (const n of now) if (!was.has(n)) out.push(`${label} ${n} added`);
    for (const n of was) if (!now.has(n)) out.push(`${label} ${n} removed`);
  }
  // Ports and descriptions of a kept node type can change without its name changing.
  for (const n of next.nodeTypes ?? []) {
    const e = (existing.nodeTypes ?? []).find((x) => x.name === n.name);
    if (e && JSON.stringify({ i: e.inputs, o: e.outputs, d: e.description }) !== JSON.stringify({ i: n.inputs, o: n.outputs, d: n.description })) out.push(`node type ${n.name} changed`);
  }
  return out;
}

/** Generate, validate and compare, as `fw market pack` would, without writing. */
export async function checkPackProject(projectDir: string): Promise<PackCheck> {
  const { manifest, parsedFiles, errors } = await generateManifest({ directory: projectDir });
  const validation = await validatePackage(projectDir, manifest);
  const existing = readManifest(projectDir);
  return {
    name: manifest.name,
    version: manifest.version,
    parsedFiles: parsedFiles.length,
    parseErrors: errors,
    valid: validation.valid,
    issues: validation.issues,
    manifest: describePack({ name: manifest.name, version: manifest.version, manifest, path: projectDir }),
    hasManifest: existing !== null,
    changes: manifestChanges(existing, manifest),
  };
}
