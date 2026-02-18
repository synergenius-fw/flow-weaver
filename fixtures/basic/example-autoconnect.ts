/**
 * @autoConnect example — zero explicit wiring needed for linear pipelines.
 *
 * @autoConnect auto-wires nodes in declaration order:
 *   Start → first node → second node → ... → Exit
 * Data ports are matched by name (output "x" connects to input "x" of next node).
 *
 * Run: flow-weaver run fixtures/basic/example-autoconnect.ts --params '{"text":"hello world"}'
 */

/** @flowWeaver nodeType @expression */
function capitalize(text: string): { capitalized: string } {
  return { capitalized: text.replace(/\b\w/g, (c) => c.toUpperCase()) };
}

/** @flowWeaver nodeType @expression */
function addEmoji(capitalized: string): { decorated: string } {
  return { decorated: `✨ ${capitalized} ✨` };
}

/** @flowWeaver nodeType @expression */
function wrapInBox(decorated: string): { boxed: string } {
  const line = '─'.repeat(decorated.length + 2);
  return { boxed: `┌${line}┐\n│ ${decorated} │\n└${line}┘` };
}

/**
 * @flowWeaver workflow
 * @autoConnect
 * @node cap capitalize
 * @node emoji addEmoji
 * @node box wrapInBox
 */
export function textDecorator(
  execute: boolean,
  params: { text: string }
): { onSuccess: boolean; onFailure: boolean; boxed: string } {
  throw new Error('Compile with: flow-weaver compile <file>');
}
