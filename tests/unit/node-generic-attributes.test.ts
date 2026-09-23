import { describe, it, expect } from 'vitest';
import { parseNodeLine } from '../../src/chevrotain-parser/node-parser.js';
import { generateNodeInstanceTag } from '../../src/generator/annotation-generator.js';
import type { TNodeInstanceAST } from '../../src/ast/types.js';

/**
 * Generic `[key: "value"]` bracket attributes are the `@node` extension point:
 * core parses any bracket attribute it does not itself define into
 * `attributes`, gives it no meaning, and round-trips it. A pack reads the map.
 * This replaces the former hardcoded `[job:]` / `[environment:]` attributes,
 * which core no longer knows about — a pack can re-add them, or any other key,
 * with no grammar change.
 */

function parse(line: string) {
  const warnings: string[] = [];
  const result = parseNodeLine(line, warnings);
  return { result, warnings };
}

describe('generic @node bracket attributes', () => {
  it('captures an unknown attribute into `attributes`', () => {
    const { result, warnings } = parse('@node deploy myType [runner: "ubuntu-latest"]');
    expect(warnings).toEqual([]);
    expect(result?.attributes).toEqual({ runner: 'ubuntu-latest' });
  });

  it('captures several attributes, comma-separated in one bracket', () => {
    const { result } = parse('@node deploy myType [region: "eu-west-1", environment: "production"]');
    expect(result?.attributes).toEqual({ region: 'eu-west-1', environment: 'production' });
  });

  it('captures attributes across separate brackets', () => {
    const { result } = parse('@node deploy myType [job: "build"] [environment: "prod"]');
    expect(result?.attributes).toEqual({ job: 'build', environment: 'prod' });
  });

  it('does not swallow a named attribute (label/color) into `attributes`', () => {
    const { result } = parse('@node deploy myType [label: "Deploy", runner: "gpu"]');
    expect(result?.label).toBe('Deploy');
    expect(result?.attributes).toEqual({ runner: 'gpu' });
  });

  it('leaves `attributes` unset when there are none', () => {
    const { result } = parse('@node deploy myType [minimized]');
    expect(result?.attributes).toBeUndefined();
    expect(result?.minimized).toBe(true);
  });

  it('round-trips through generate then parse', () => {
    const instance: TNodeInstanceAST = {
      type: 'NodeInstance',
      id: 'deploy',
      nodeType: 'myType',
      attributes: { runner: 'ubuntu-latest', region: 'eu-west-1' },
    };
    const generated = generateNodeInstanceTag(instance);
    // Sorted, so output is stable.
    expect(generated).toContain('[region: "eu-west-1"]');
    expect(generated).toContain('[runner: "ubuntu-latest"]');

    const warnings: string[] = [];
    const reparsed = parseNodeLine(generated.replace(' * ', ''), warnings);
    expect(reparsed?.attributes).toEqual({ runner: 'ubuntu-latest', region: 'eu-west-1' });
  });
});
