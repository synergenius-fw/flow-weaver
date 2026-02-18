/**
 * Utility functions with no annotations.
 * These should be auto-inferred when referenced via @node.
 */

export function add(a: number, b: number) {
  return { sum: a + b };
}

export async function fetchGreeting(name: string): Promise<string> {
  return `Hello, ${name}!`;
}
