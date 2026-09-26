/**
 * Import and export syntax for the module format a generated file uses.
 *
 * Decides how an import and an exported function are spelled in ESM and in
 * CJS: `import { a } from 'x'` or `const { a } = require('x')`, and an
 * `export` keyword or a `module.exports` statement at the end of the file.
 */

import type { TModuleFormat } from '../../ast/types';

/**
 * Generate an import statement in the appropriate module format
 */
export function generateImportStatement(
  names: string[],
  source: string,
  moduleFormat: TModuleFormat
): string {
  if (moduleFormat === 'cjs') {
    return `const { ${names.join(', ')} } = require('${source}');`;
  }
  return `import { ${names.join(', ')} } from '${source}';`;
}

/**
 * Generate an export statement for a function in the appropriate module format
 * For ESM: export async function name() { }
 * For CJS: async function name() { } (module.exports added at end)
 */
export function generateFunctionExportKeyword(moduleFormat: TModuleFormat): string {
  return moduleFormat === 'cjs' ? '' : 'export ';
}

/**
 * Generate module.exports statement for CJS format
 */
export function generateModuleExports(functionNames: string[]): string {
  if (functionNames.length === 1) {
    return `module.exports = { ${functionNames[0]} };`;
  }
  return `module.exports = { ${functionNames.join(', ')} };`;
}
