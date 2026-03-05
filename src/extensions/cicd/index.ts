/**
 * CI/CD Extension — public API barrel file.
 *
 * Re-exports detection, base target, and validation rule utilities
 * for consumers importing from `@synergenius/flow-weaver/extensions/cicd`.
 */

export { isCICDWorkflow, getJobNames, getDeclaredSecrets, getReferencedSecrets } from './detection.js';
export { BaseCICDTarget, NODE_ACTION_MAP, type CICDJob, type CICDStep, type ActionMapping } from './base-target.js';
export { getCICDValidationRules } from './rules.js';
