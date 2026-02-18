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
  /** Manifest schema version (currently 1) */
  manifestVersion: 1;
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
  /** External dependency information */
  dependencies?: {
    /** Flow Weaver peer dependency constraints */
    flowweaver?: Record<string, string>;
    /** npm runtime dependencies */
    npm?: Record<string, string>;
  };
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
