/**
 * The command line as a structure: usage and flags read from the
 * catalogue, a typed line taken apart, a filled form put back together.
 */
import { describe, it, expect } from 'vitest';
import { parseUsage, parseFlag, parseLine, composeLine, commandFor, hasPlaceholder, type CommandLike } from '../../../console-ui/src/cli-model';

const compile: CommandLike = {
  name: 'compile', words: ['compile'], usage: 'fw compile <input> [options]', description: 'Compile',
  flags: [
    { flag: '-o, --output <path>', description: 'Output file or directory', default: 'in-place' },
    { flag: '-p, --production', description: 'No debug events', default: 'false' },
    { flag: '--dry-run', description: 'Preview without writing', default: 'false' },
    { flag: '-w, --workflow <name>', description: 'Specific workflow name', default: 'all' },
  ],
  examples: ['fw compile my-workflow.ts'],
};
const run: CommandLike = {
  name: 'run', words: ['run'], usage: 'fw run <input> [options]', description: 'Run',
  flags: [
    { flag: '--params <json>', description: 'Params', default: '' },
    { flag: '-b, --breakpoint <nodeIds...>', description: 'Breakpoints', default: '' },
  ],
  examples: [],
};
const createWorkflow: CommandLike = { name: 'create workflow', words: ['create', 'workflow'], usage: 'fw create workflow <template> <file> [options]', description: '', flags: [], examples: [] };
const create: CommandLike = { name: 'create', words: ['create'], usage: 'fw create', description: '', flags: [], examples: [] };
const serve: CommandLike = { name: 'serve', words: ['serve'], usage: 'fw serve [directory] [options]', description: '', flags: [{ flag: '--no-watch', description: 'No reload', default: 'watch enabled' }], examples: [] };
const all = [compile, run, createWorkflow, create, serve];

describe('parseUsage', () => {
  it('reads required, optional and variadic arguments, skipping [options]', () => {
    expect(parseUsage('fw compile <input> [options]')).toEqual([{ name: 'input', required: true, variadic: false }]);
    expect(parseUsage('fw serve [directory] [options]')).toEqual([{ name: 'directory', required: false, variadic: false }]);
    expect(parseUsage('fw docs [args...]')).toEqual([{ name: 'args', required: false, variadic: true }]);
    expect(parseUsage('fw create workflow <template> <file>')).toEqual([
      { name: 'template', required: true, variadic: false }, { name: 'file', required: true, variadic: false },
    ]);
  });
});

describe('parseFlag', () => {
  it('splits short and long forms and the value placeholder', () => {
    expect(parseFlag(compile.flags[0])).toMatchObject({ long: '--output', short: '-o', value: '<path>', variadic: false, negation: false });
    expect(parseFlag(compile.flags[1])).toMatchObject({ long: '--production', short: '-p', value: null });
    expect(parseFlag(compile.flags[2])).toMatchObject({ long: '--dry-run', short: null, value: null });
    expect(parseFlag(run.flags[1])).toMatchObject({ long: '--breakpoint', short: '-b', value: '<nodeIds...>', variadic: true });
    expect(parseFlag(serve.flags[0])).toMatchObject({ long: '--no-watch', negation: true });
  });

  it('returns null for something that is not a flag', () => {
    expect(parseFlag({ flag: 'garbage', description: '', default: '' })).toBeNull();
  });
});

describe('commandFor', () => {
  it('picks the longest matching run of words, with or without fw', () => {
    expect(commandFor(['fw', 'create', 'workflow', 'sequential'], all)).toBe(createWorkflow);
    expect(commandFor(['create'], all)).toBe(create);
    expect(commandFor(['compile', 'a.ts'], all)).toBe(compile);
    expect(commandFor(['nothing'], all)).toBeUndefined();
  });
});

describe('parseLine', () => {
  it('takes a typed line apart into arguments and flags, short or long, with = or a space', () => {
    const f = parseLine("fw compile 'my flow.ts' -o dist --production --workflow=main", all)!;
    expect(f.command).toBe(compile);
    expect(f.args).toEqual(['my flow.ts']);
    expect(f.flags).toEqual({ '--output': 'dist', '--production': true, '--workflow': 'main' });
    expect(f.rest).toEqual([]);
  });

  it('keeps what it cannot place', () => {
    const f = parseLine('compile a.ts --mystery 3 extra', all)!;
    expect(f.args).toEqual(['a.ts', '3', 'extra']);
    expect(f.rest).toEqual(['--mystery']);
  });

  it('is null for an unknown command', () => {
    expect(parseLine('frobnicate', all)).toBeNull();
  });
});

describe('composeLine', () => {
  it('writes the form back as a line, quoting what needs it and leaving off what is empty', () => {
    const line = composeLine({ command: compile, args: ['my flow.ts'], flags: { '--output': 'dist', '--production': true, '--workflow': '' }, rest: [] });
    expect(line).toBe('compile "my flow.ts" --output dist --production');
  });

  it('keeps a placeholder for a required argument not yet given', () => {
    expect(composeLine({ command: compile, args: [''], flags: {}, rest: [] })).toBe('compile <input>');
    expect(composeLine({ command: serve, args: [''], flags: { '--no-watch': true }, rest: [] })).toBe('serve --no-watch');
  });

  it('round-trips through parseLine', () => {
    // Quoted as a shell would want it. The JSON's own quotes survive the round trip.
    const line = `run flow.ts --params '{"a":1}' --breakpoint a`;
    const f = parseLine(line, all)!;
    expect(composeLine(f)).toBe('run flow.ts --params "{\\"a\\":1}" --breakpoint a');
    expect(parseLine(composeLine(f), all)!.flags).toEqual(f.flags);
  });
});

describe('hasPlaceholder', () => {
  it('spots an unfilled <placeholder>', () => {
    expect(hasPlaceholder('validate <input>')).toBe(true);
    expect(hasPlaceholder('validate a.ts')).toBe(false);
  });
});
