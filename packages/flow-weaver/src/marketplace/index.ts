/**
 * @module marketplace
 *
 * Flow Weaver Marketplace — discover, install, and publish reusable
 * node types, workflows, and patterns via npm.
 */

export type {
  TMarketplaceManifest,
  TManifestNodeType,
  TManifestWorkflow,
  TManifestPattern,
  TManifestPort,
  TValidationIssue,
  TValidationSeverity,
  TPackageValidationResult,
  TMarketplacePackageInfo,
  TInstalledPackage,
  TMarketInitConfig,
} from './types.js';

export {
  generateManifest,
  writeManifest,
  readManifest,
  type GenerateManifestOptions,
  type GenerateManifestResult,
} from './manifest.js';

export { validatePackage } from './validator.js';

export {
  searchPackages,
  listInstalledPackages,
  getInstalledPackageManifest,
  type SearchOptions,
} from './registry.js';
