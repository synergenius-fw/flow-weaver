/**
 * Marketplace types for Flow Weaver package distribution.
 *
 * Packages follow the naming convention `flowweaver-pack-*` and use
 * npm as the distribution backbone. The manifest is auto-generated
 * from source annotations via the parser.
 */

import type { TDataType } from '../ast/types.js';

// ── Manifest ─────────────────────────────────────────────────────────────────

/** Auto-generated manifest describing a marketplace package's contents. */
export type TMarketplaceManifest = {
  /** Manifest schema version */
  manifestVersion: 1 | 2;
  /** npm package name */
  name: string;
  /** Semver version */
  version: string;
  /** Human-readable description */
  description?: string;
  /** Minimum Flow Weaver engine version required */
  engineVersion?: string;
  /** Discovery categories */
  categories?: string[];
  /** Node types included in this package */
  nodeTypes: TManifestNodeType[];
  /** Workflows included in this package */
  workflows: TManifestWorkflow[];
  /** Patterns included in this package */
  patterns: TManifestPattern[];
  /** Export targets provided by this package */
  exportTargets?: TManifestExportTarget[];
  /** Tag handlers contributed by this pack (v2) */
  tagHandlers?: TManifestTagHandler[];
  /** Validation rule sets contributed by this pack (v2) */
  validationRuleSets?: TManifestValidationRuleSet[];
  /** Documentation topics contributed by this pack (v2) */
  docs?: TManifestDocTopic[];
  /** Init contributions: use cases and templates (v2) */
  initContributions?: TManifestInitContribution;
  /** External dependency information */
  dependencies?: {
    /** Flow Weaver peer dependency constraints */
    flowweaver?: Record<string, string>;
    /** npm runtime dependencies */
    npm?: Record<string, string>;
  };
};

// ── Export targets ────────────────────────────────────────────────────────────

/** An export target provided by a marketplace package. */
export type TManifestExportTarget = {
  /** Target identifier (e.g. "lambda", "azure-pipelines") */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Relative path to the compiled JS file that exports the target class */
  file: string;
  /** Named export from the file (default: "default") */
  exportName?: string;
};

// ── Manifest units ───────────────────────────────────────────────────────────

export type TManifestPort = {
  dataType: TDataType;
  description?: string;
  optional?: boolean;
};

export type TManifestNodeType = {
  /** Node type name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Relative path to compiled file */
  file: string;
  /** Function name in the source */
  functionName: string;
  /** Whether the function is async */
  isAsync: boolean;
  /** Input port definitions */
  inputs: Record<string, TManifestPort>;
  /** Output port definitions */
  outputs: Record<string, TManifestPort>;
  /** Visual customization */
  visuals?: {
    color?: string;
    icon?: string;
    tags?: Array<{ label: string; color?: string }>;
  };
};

export type TManifestWorkflow = {
  /** Workflow name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Relative path to compiled file */
  file: string;
  /** Function name in the source */
  functionName: string;
  /** Start (input) ports */
  startPorts: Record<string, TManifestPort>;
  /** Exit (output) ports */
  exitPorts: Record<string, TManifestPort>;
  /** Number of node instances */
  nodeCount: number;
  /** Number of connections */
  connectionCount: number;
};

export type TManifestPattern = {
  /** Pattern name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Relative path to source file */
  file: string;
  /** Input ports (IN pseudo-node connections) */
  inputPorts: Record<string, TManifestPort>;
  /** Output ports (OUT pseudo-node connections) */
  outputPorts: Record<string, TManifestPort>;
  /** Number of internal nodes */
  nodeCount: number;
};

// ── Validation ───────────────────────────────────────────────────────────────

export type TValidationSeverity = 'error' | 'warning';

export type TValidationIssue = {
  /** Unique rule identifier (e.g., PKG-001, UNIT-002) */
  code: string;
  /** error = must fix, warning = should fix */
  severity: TValidationSeverity;
  /** Human-readable description */
  message: string;
};

export type TPackageValidationResult = {
  /** Whether the package passed all error-level checks */
  valid: boolean;
  /** All issues found during validation */
  issues: TValidationIssue[];
};

// ── Registry ─────────────────────────────────────────────────────────────────

/** A marketplace package discovered via npm search or local scan. */
export type TMarketplacePackageInfo = {
  /** npm package name */
  name: string;
  /** Latest version */
  version: string;
  /** Package description */
  description?: string;
  /** npm weekly download count */
  downloads?: number;
  /** npm publisher username */
  publisher?: string;
  /** Package keywords */
  keywords?: string[];
  /** Whether this is an official @synergenius package */
  official: boolean;
};

/** An installed marketplace package with its resolved manifest. */
export type TInstalledPackage = {
  /** npm package name */
  name: string;
  /** Installed version */
  version: string;
  /** Resolved manifest */
  manifest: TMarketplaceManifest;
  /** Absolute path to the package in node_modules */
  path: string;
};

// ── Pack extension points (manifest v2) ──────────────────────────────────────

/**
 * A tag handler contributed by a pack. Declares which JSDoc tags the pack handles,
 * the deploy namespace to store results in, and the JS file exporting the handler.
 */
export type TManifestTagHandler = {
  /** Tag name(s) this handler processes (e.g., "secret", "runner") */
  tags: string[];
  /** Deploy namespace for storing parsed data (e.g., "cicd") */
  namespace: string;
  /** Applicable scope: workflow-level tags, nodeType-level tags, or both */
  scope: 'workflow' | 'nodeType' | 'both';
  /** Relative path to the compiled JS file exporting the handler function */
  file: string;
  /** Named export from the file (default: "default") */
  exportName?: string;
};

/**
 * A validation rule set contributed by a pack. Declares a detect function
 * and rules export for conditional validation.
 */
export type TManifestValidationRuleSet = {
  /** Human-readable name for this rule set */
  name: string;
  /** Deploy namespace this rule set applies to (e.g., "cicd") */
  namespace: string;
  /** Relative path to the compiled JS file exporting detect and getRules */
  file: string;
  /** Named export for the detect function (default: "detect") */
  detectExport?: string;
  /** Named export for the getRules function (default: "getRules") */
  rulesExport?: string;
};

/**
 * A documentation topic contributed by a pack.
 */
export type TManifestDocTopic = {
  /** Topic slug (used in fw_docs read) */
  slug: string;
  /** Human-readable topic name */
  name: string;
  /** Topic description */
  description?: string;
  /** Search keywords */
  keywords?: string[];
  /** Context presets this topic should be included in */
  presets?: string[];
  /** Relative path to the markdown file */
  file: string;
};

/**
 * Init contributions from a pack: use case entries and template IDs.
 */
export type TManifestInitContribution = {
  /** Use case entry for fw init prompts */
  useCase?: {
    /** Use case ID (must be unique across all packs) */
    id: string;
    /** Display name */
    name: string;
    /** Brief description */
    description: string;
  };
  /** Template IDs this pack provides (must match IDs in the template registry) */
  templates?: string[];
};

// ── Init scaffold ────────────────────────────────────────────────────────────

export type TMarketInitConfig = {
  /** Package name (e.g., flowweaver-pack-openai) */
  name: string;
  /** Target directory */
  directory: string;
  /** Package description */
  description?: string;
  /** Author name */
  author?: string;
  /** Run npm install after scaffolding */
  install: boolean;
};
