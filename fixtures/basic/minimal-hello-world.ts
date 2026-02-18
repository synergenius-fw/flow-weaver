/**
 * Minimal hello-world — zero @input/@output needed.
 * Ports are auto-inferred from TypeScript function signatures.
 *
 * Run: flow-weaver run fixtures/basic/minimal-hello-world.ts --params '{"name":"World"}'
 */

/** @flowWeaver nodeType @expression */
function greet(name: string): { greeting: string } {
  return { greeting: `Hello, ${name}!` };
}

/** @flowWeaver nodeType @expression */
function shout(text: string): { result: string } {
  return { result: text.toUpperCase() + '!!!' };
}

/**
 * @flowWeaver workflow
 * @node g greet
 * @node s shout
 * @path Start -> g -> s -> Exit
 * @connect Start.name -> g.name
 * @connect g.greeting -> s.text
 * @connect s.result -> Exit.message
 */
export function helloWorld(
  execute: boolean,
  params: { name: string }
): { onSuccess: boolean; onFailure: boolean; message: string } {
  throw new Error('Compile with: flow-weaver compile <file>');
}
