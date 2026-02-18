// =============================================================================
// Hello World - Simplest possible Flow Weaver workflow.
//
// Demonstrates:
//   - @expression nodes (pure functions, no execute/onSuccess boilerplate)
//   - @autoConnect (zero wiring - ports matched by name in declaration order)
//   - TypeScript signature inference (no @input/@output annotations needed)
//
// Pattern: Start -> formatName -> buildGreeting -> Exit
//
// Run: flow-weaver run use-cases/hello-world.ts --params '{"firstName":"Jane","lastName":"Doe"}'
// =============================================================================

/**
 * Combines first and last name into a single full name.
 *
 * @flowWeaver nodeType
 * @expression
 */
function formatName(firstName: string, lastName: string): { fullName: string } {
  return { fullName: `${firstName} ${lastName}` };
}

/**
 * Generates a personalized welcome message from a full name.
 *
 * @flowWeaver nodeType
 * @expression
 */
function buildGreeting(fullName: string): { message: string } {
  return { message: `Hello, ${fullName}! Welcome aboard.` };
}

/**
 * @flowWeaver workflow
 * @autoConnect
 * @node fmt formatName
 * @node greet buildGreeting
 */
export function helloWorld(
  execute: boolean,
  params: { firstName: string; lastName: string }
): { onSuccess: boolean; onFailure: boolean; message: string } {
  throw new Error('Compile with: flow-weaver compile <file>');
}
