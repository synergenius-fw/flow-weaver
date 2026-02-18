/**
 * Package validation — checks that a marketplace package meets
 * all requirements before publishing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseWorkflow, validateWorkflow } from '../api/index.js';
import type { TMarketplaceManifest } from './types.js';
import type { TPackageValidationResult, TValidationIssue, TValidationSeverity } from './types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function issue(code: string, severity: TValidationSeverity, message: string): TValidationIssue {
  return { code, severity, message };
}

const PACK_NAME_RE = /^(@[^/]+\/)?flowweaver-pack-.+$/;
const MARKETPLACE_KEYWORD = 'flowweaver-marketplace-pack';

// ── Package-level rules ──────────────────────────────────────────────────────

function validatePackageJson(
  pkg: Record<string, unknown>,
  directory: string
): TValidationIssue[] {
  const issues: TValidationIssue[] = [];

  // PKG-005: Name must match flowweaver-pack-* or @*/flowweaver-pack-*
  const name = pkg.name as string | undefined;
  if (!name || !PACK_NAME_RE.test(name)) {
    issues.push(
      issue(
        'PKG-005',
        'error',
        `Package name must match "flowweaver-pack-*" or "@<scope>/flowweaver-pack-*", got "${name ?? ''}"`,
      )
    );
  }

  // PKG-001: keywords must include flowweaver-marketplace-pack
  const keywords = (pkg.keywords ?? []) as string[];
  if (!keywords.includes(MARKETPLACE_KEYWORD)) {
    issues.push(
      issue(
        'PKG-001',
        'error',
        `"keywords" must include "${MARKETPLACE_KEYWORD}"`,
      )
    );
  }

  // PKG-002: flowWeaver.engineVersion must be set
  const fw = pkg.flowWeaver as Record<string, unknown> | undefined;
  if (!fw?.engineVersion) {
    issues.push(
      issue('PKG-002', 'error', '"flowWeaver.engineVersion" must be set in package.json')
    );
  }

  // PKG-003: peerDependencies must include @synergenius/flow-weaver
  const peers = (pkg.peerDependencies ?? {}) as Record<string, string>;
  if (!peers['@synergenius/flow-weaver']) {
    issues.push(
      issue(
        'PKG-003',
        'error',
        '"peerDependencies" must include "@synergenius/flow-weaver"',
      )
    );
  }

  // PKG-004: Must not be private
  if (pkg.private === true) {
    issues.push(issue('PKG-004', 'error', 'Package must not be "private: true"'));
  }

  // PKG-007: README.md should exist
  if (!fs.existsSync(path.join(directory, 'README.md'))) {
    issues.push(issue('PKG-007', 'warning', 'README.md should exist'));
  }

  return issues;
}

// ── Manifest-level rules ─────────────────────────────────────────────────────

function validateManifestContents(manifest: TMarketplaceManifest): TValidationIssue[] {
  const issues: TValidationIssue[] = [];

  const totalUnits =
    manifest.nodeTypes.length + manifest.workflows.length + manifest.patterns.length;

  // PKG-006: Must contain at least one unit
  if (totalUnits === 0) {
    issues.push(
      issue(
        'PKG-006',
        'error',
        'Package must contain at least one node type, workflow, or pattern',
      )
    );
  }

  // UNIT-002: Node type names must be unique within the package
  const ntNames = new Set<string>();
  for (const nt of manifest.nodeTypes) {
    if (ntNames.has(nt.name)) {
      issues.push(
        issue('UNIT-002', 'error', `Duplicate node type name: "${nt.name}"`)
      );
    }
    ntNames.add(nt.name);
  }

  // PKG-008: All node types should have descriptions
  for (const nt of manifest.nodeTypes) {
    if (!nt.description) {
      issues.push(
        issue('PKG-008', 'warning', `Node type "${nt.name}" should have a description`)
      );
    }
  }

  // PKG-009: All node types should have visuals
  for (const nt of manifest.nodeTypes) {
    if (!nt.visuals || (!nt.visuals.color && !nt.visuals.icon && !nt.visuals.tags)) {
      issues.push(
        issue('PKG-009', 'warning', `Node type "${nt.name}" should have visuals (color, icon, or tags)`)
      );
    }
  }

  // UNIT-003: Patterns must have at least one IN or OUT port
  for (const pat of manifest.patterns) {
    const inCount = Object.keys(pat.inputPorts).length;
    const outCount = Object.keys(pat.outputPorts).length;
    if (inCount === 0 && outCount === 0) {
      issues.push(
        issue('UNIT-003', 'error', `Pattern "${pat.name}" must have at least one IN or OUT port`)
      );
    }
  }

  return issues;
}

// ── Workflow validation (UNIT-001) ───────────────────────────────────────────

async function validateWorkflows(
  manifest: TMarketplaceManifest,
  directory: string
): Promise<TValidationIssue[]> {
  const issues: TValidationIssue[] = [];

  for (const wf of manifest.workflows) {
    // Resolve source file from dist path back to src
    const srcFile = path.join(
      directory,
      wf.file.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts')
    );

    if (!fs.existsSync(srcFile)) continue;

    try {
      const parseResult = await parseWorkflow(srcFile, { workflowName: wf.functionName });
      if (parseResult.errors.length > 0) continue; // Parse errors reported by pack command

      const result = validateWorkflow(parseResult.ast);
      if (result.errors.length > 0) {
        issues.push(
          issue(
            'UNIT-001',
            'error',
            `Workflow "${wf.name}" has validation errors: ${result.errors.map((e) => e.message).join('; ')}`,
          )
        );
      }
    } catch {
      // If parsing fails entirely, the pack command will already have reported the error
    }
  }

  return issues;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a marketplace package directory.
 *
 * Checks package.json fields, manifest contents, and individual workflow validity.
 */
export async function validatePackage(
  directory: string,
  manifest: TMarketplaceManifest
): Promise<TPackageValidationResult> {
  const pkgPath = path.join(directory, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    return {
      valid: false,
      issues: [issue('PKG-000', 'error', 'package.json not found')],
    };
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  const issues: TValidationIssue[] = [
    ...validatePackageJson(pkg, directory),
    ...validateManifestContents(manifest),
    ...(await validateWorkflows(manifest, directory)),
  ];

  const valid = !issues.some((i) => i.severity === 'error');
  return { valid, issues };
}
