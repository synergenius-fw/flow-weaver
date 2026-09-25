/**
 * Identifier case helpers shared by the template registry and the node
 * templates it lists. Kept out of templates/index.ts so a template can use
 * them without importing the registry that imports it.
 */

/**
 * Convert a string to camelCase
 */
export function toCamelCase(str: string): string {
  // Preserve leading underscores/dollar signs
  const leadingMatch = str.match(/^[_$]+/);
  const leading = leadingMatch ? leadingMatch[0] : '';
  const rest = leading ? str.slice(leading.length) : str;

  const result = rest
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[^a-zA-Z_$]+/, '') // Strip leading non-identifier chars
    .replace(/^./, (c) => c.toLowerCase());

  const final = leading + result;
  return final || '_' + str.replace(/[^a-zA-Z0-9_$]/g, '');
}

/**
 * Convert a string to PascalCase (for labels)
 */
export function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}
