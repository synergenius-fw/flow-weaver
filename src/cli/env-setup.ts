/**
 * Environment setup that must run before any color library imports.
 * This module is imported first in index.ts to ensure picocolors reads the correct env vars.
 */

// FORCE_COLOR=0 should disable colors, but picocolors treats any non-empty
// FORCE_COLOR as "enable colors". Translate to NO_COLOR which picocolors checks first.
if (process.env.FORCE_COLOR === '0') {
  process.env.NO_COLOR = '1';
  delete process.env.FORCE_COLOR;
}
