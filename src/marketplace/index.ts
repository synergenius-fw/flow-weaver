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
  TManifestExportTarget,
  TManifestPort,
  TValidationIssue,
  TValidationSeverity,
  TPackageValidationResult,
  TMarketplacePackageInfo,
  TInstalledPackage,
  TMarketInitConfig,
  TManifestTagHandler,
  TManifestValidationRuleSet,
  TManifestDocTopic,
  TManifestInitContribution,
  TManifestCliCommand,
  TManifestMcpTool,
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
  discoverTagHandlers,
  discoverValidationRuleSets,
  discoverDocTopics,
  discoverInitContributions,
  discoverDeviceHandlers,
  type SearchOptions,
  type TDiscoveredTagHandler,
  type TDiscoveredValidationRuleSet,
  type TDiscoveredDocTopic,
  type TDiscoveredInitContribution,
  type TDiscoveredDeviceHandler,
} from './registry.js';
