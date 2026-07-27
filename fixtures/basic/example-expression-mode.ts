
/**
 * Convert text to uppercase
 *
 * @flowWeaver nodeType
 * @expression
 * @label To Upper Case
 * @input text [order:1] - Text to convert
 * @output result [order:2] - Uppercased text
 */
function toUpperCase(text: string): string {
  return text.toUpperCase();
}

/**
 * Concatenate two strings with a separator
 *
 * @flowWeaver nodeType
 * @expression
 * @label Concatenate
 * @input a [order:1] - First string
 * @input b [order:2] - Second string
 * @output result [order:2] - Combined string
 */
function concatenate(a: string, b: string): string {
  return `${a} ${b}`;
}

/**
 * Get the length of a string
 *
 * @flowWeaver nodeType
 * @expression
 * @label Get Length
 * @input text [order:1] - Text to measure
 * @output length [order:2] - Character count
 */
function getLength(text: string): number {
  return text.length;
}

// ============================================================================
// WORKFLOW
// ============================================================================

/**
 * @flowWeaver workflow
 * @node upper toUpperCase [position: 180 0]
 * @node concat concatenate [position: 360 0]
 * @node len getLength [position: 360 150]
 * @path Start -> upper -> concat -> Exit
 * @path Start -> upper -> len -> Exit
 * @connect Start.text -> upper.text
 * @connect upper.result -> concat.a
 * @connect Start.suffix -> concat.b
 * @connect upper.result -> len.text
 * @connect concat.result -> Exit.output
 * @connect len.length -> Exit.length
 * @param execute [order:0] - Execute
 * @param text [order:1] - Text
 * @param suffix [order:2] - Suffix
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns output [order:2] - Output
 * @returns length [order:3] - Length
 */
export function textTransform(
  execute: boolean,
  params: { text: string; suffix: string },
): { onSuccess: boolean; onFailure: boolean; output: string; length: number } {
  throw new Error('Not implemented');
}
