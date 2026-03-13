/**
 * Coverage tests for jsdoc-parser.ts uncovered lines:
 * - parseThrottleTag invalid format (lines 1498-1499)
 * - parseDefaultValue non-JSON fallback (line 1569)
 */

import { describe, it, expect } from 'vitest';
import { AnnotationParser } from '../../src/parser';

function parseWorkflowSource(source: string) {
  const parser = new AnnotationParser();
  return parser.parseFromString(source, 'test-throttle.ts');
}

function parseNodeTypeSource(source: string) {
  const parser = new AnnotationParser();
  return parser.parseFromString(source, 'test-default.ts');
}

describe('JSDocParser.parseThrottleTag', () => {
  it('warns on invalid @throttle format', () => {
    // @throttle with no key=value assignments should fail Chevrotain parsing
    // and hit the warning + early return on lines 1498-1499.
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @throttle
 * @node a SomeType
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('stub');
}
`);

    const throttleWarnings = result.warnings.filter(w => w.includes('throttle'));
    expect(throttleWarnings.length).toBeGreaterThan(0);
    // The second warning from parseThrottleTag (line 1498) contains this text
    expect(throttleWarnings.some(w => w.includes('Invalid @throttle format'))).toBe(true);

    // The workflow should still parse, just without throttle config
    expect(result.workflows.length).toBe(1);
    expect(result.workflows[0].options?.throttle).toBeUndefined();
  });

  it('parses valid @throttle correctly', () => {
    const result = parseWorkflowSource(`
/**
 * @flowWeaver workflow
 * @throttle limit=5 period="1m"
 * @node a SomeType
 */
export function myWorkflow(execute: boolean): { onSuccess: boolean; onFailure: boolean } {
  throw new Error('stub');
}
`);

    // Should parse without "Invalid @throttle" warnings (other warnings about node types are OK)
    const invalidThrottleWarnings = result.warnings.filter(w => w.includes('Invalid @throttle'));
    expect(invalidThrottleWarnings.length).toBe(0);
    expect(result.workflows.length).toBe(1);
  });
});

describe('JSDocParser.parseDefaultValue', () => {
  it('returns non-JSON string as-is for @input default', () => {
    // An @input with a default value that is not valid JSON triggers
    // the catch branch in parseDefaultValue (line 1569).
    const result = parseNodeTypeSource(`
/**
 * @flowWeaver nodeType
 * @input [greeting="hello world"] {STRING}
 */
export function Greeter(execute: boolean, greeting: string): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`);

    expect(result.nodeTypes.length).toBe(1);
    const nt = result.nodeTypes[0];
    const greetingPort = nt.inputs?.greeting;
    expect(greetingPort).toBeDefined();
    // "hello world" is not valid JSON, so parseDefaultValue returns it as a string
    expect(greetingPort!.default).toBe('hello world');
  });

  it('parses valid JSON default values', () => {
    const result = parseNodeTypeSource(`
/**
 * @flowWeaver nodeType
 * @input [count=42] {NUMBER}
 * @input [flag=true] {BOOLEAN}
 */
export function Counter(execute: boolean, count: number, flag: boolean): { onSuccess: boolean; onFailure: boolean } {
  return { onSuccess: true, onFailure: false };
}
`);

    expect(result.nodeTypes.length).toBe(1);
    const nt = result.nodeTypes[0];
    expect(nt.inputs?.count?.default).toBe(42);
    expect(nt.inputs?.flag?.default).toBe(true);
  });
});
