/**
 * CI/CD Extension — public API barrel file.
 *
 * Re-exports detection, base target, and validation rule utilities
 * for consumers importing from `@synergenius/flow-weaver/extensions/cicd`.
 *
 * The register import is a side effect that populates the global tag handler
 * registry with CI/CD handlers. Without it, parseWorkflow() silently drops
 * all CI/CD annotations (@runner, @stage, @job, @variables, etc.).
 */

import './register.js';

export { isCICDWorkflow, getJobNames, getDeclaredSecrets, getReferencedSecrets } from './detection.js';
export { BaseCICDTarget, NODE_ACTION_MAP, type CICDJob, type CICDStep, type ActionMapping } from './base-target.js';
export { getCICDValidationRules } from './rules.js';
