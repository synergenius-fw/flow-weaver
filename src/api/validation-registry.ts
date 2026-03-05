/**
 * Singleton validation rule registry for the public API.
 *
 * Core rule sets (agent, CI/CD) are registered statically.
 * Pack-contributed rule sets are registered via marketplace discovery.
 */

import { ValidationRuleRegistry } from '../validation/rule-registry';

/** Global validation rule registry. Packs register rule sets here at startup. */
export const validationRuleRegistry = new ValidationRuleRegistry();
