/**
 * The console's command line is split here, not by a shell: what the
 * person quoted is one argument on every platform, and nothing expands.
 */
import { describe, it, expect } from 'vitest';
import { splitArgs, quoteArg } from '../../../console-ui/src/shell';

describe('splitArgs', () => {
  it('splits on whitespace', () => {
    expect(splitArgs('fw validate  flow.ts --json')).toEqual(['fw', 'validate', 'flow.ts', '--json']);
  });

  it('keeps a quoted argument whole', () => {
    expect(splitArgs(`fw run flow.ts --params '{"a": 1}'`)).toEqual(['fw', 'run', 'flow.ts', '--params', '{"a": 1}']);
    expect(splitArgs('fw compile "my flow.ts"')).toEqual(['fw', 'compile', 'my flow.ts']);
  });

  it('escapes with a backslash outside single quotes', () => {
    expect(splitArgs('fw compile my\\ flow.ts')).toEqual(['fw', 'compile', 'my flow.ts']);
    expect(splitArgs('fw x "say \\"hi\\""')).toEqual(['fw', 'x', 'say "hi"']);
    expect(splitArgs("fw x 'C:\\\\path'")).toEqual(['fw', 'x', 'C:\\\\path']);
  });

  it('allows an empty quoted argument', () => {
    expect(splitArgs('fw x ""')).toEqual(['fw', 'x', '']);
  });

  it('returns nothing for a blank line', () => {
    expect(splitArgs('   ')).toEqual([]);
  });

  it('does not expand anything', () => {
    // A glob stays a glob; the CLI decides what it means.
    expect(splitArgs("fw compile '**/*.ts'")).toEqual(['fw', 'compile', '**/*.ts']);
  });
});

describe('quoteArg', () => {
  it('round-trips through splitArgs', () => {
    for (const a of ['plain', 'has space', 'C:\\Users\\me\\flow.ts', 'say "hi"', '', "it's"]) {
      expect(splitArgs(`fw ${quoteArg(a)}`)).toEqual(['fw', a]);
    }
  });
});
