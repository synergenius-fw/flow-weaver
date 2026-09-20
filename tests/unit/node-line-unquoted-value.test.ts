/**
 * An attribute value that should be quoted, but is not.
 *
 * Every `@node` attribute takes a quoted string -- `[color: "blue"]`,
 * `[expr: timeout="24h"]`. Dropping the quotes failed with Chevrotain's own
 * message, "Expecting token of type --> StringLiteral <-- but found --> '24'",
 * which names neither the attribute nor the quoting. Worse, the failure is a
 * warning and the instance is then never created, so what the author sees as
 * an *error* is `@path: node "g" not found` -- the symptom, pointing at a
 * line that is correct.
 *
 * The message now names the attribute, the value, and the fix.
 */
import { describe, it, expect } from 'vitest';
import { parseNodeLine } from '../../src/chevrotain-parser/node-parser';

function warningFor(line: string): string {
  const warnings: string[] = [];
  const result = parseNodeLine(line, warnings);
  expect(result).toBeNull();
  expect(warnings).toHaveLength(1);
  return warnings[0];
}

describe('unquoted @node attribute values', () => {
  it('names the attribute and shows it quoted', () => {
    const warning = warningFor('@node myDb fetchData [color: blue]');
    expect(warning).toContain('color');
    expect(warning).toContain('[color: "blue"]');
    expect(warning).not.toContain('StringLiteral');
  });

  it('quotes an expression value inside the attribute, not around it', () => {
    // `timeout="24h"` is the attribute; the JavaScript string needs its own
    // quotes, so the fix is `timeout="'24h'"` rather than `timeout=24h`.
    const warning = warningFor('@node g greet [expr: timeout=24h]');
    expect(warning).toContain('timeout');
    expect(warning).toContain(`timeout="'24h'"`);
  });

  it('reads an unquoted port reference as a port reference, not a string', () => {
    // `agentId=prep.agentId` means the upstream port, so the quoted form
    // keeps it an expression rather than making it the text "prep.agentId".
    const warning = warningFor('@node g greet [expr: agentId=prep.agentId]');
    expect(warning).toContain(`agentId="prep.agentId"`);
    expect(warning).not.toContain(`"'prep.agentId'"`);
  });

  it('still explains a failure it cannot attribute to quoting', () => {
    const warning = warningFor('@node');
    expect(warning).toContain('@node');
  });

  it('leaves correctly quoted lines alone', () => {
    const warnings: string[] = [];
    const result = parseNodeLine('@node myDb fetchData [color: "blue"] [expr: timeout="\'24h\'"]', warnings);
    expect(warnings).toEqual([]);
    expect(result).toMatchObject({ instanceId: 'myDb', nodeType: 'fetchData' });
  });
});
