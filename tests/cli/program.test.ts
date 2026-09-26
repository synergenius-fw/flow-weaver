/**
 * The real `fw` program from src/cli/program.ts, with every command module it
 * lazily imports replaced by a mock. Each case parses an argument vector the
 * way a user would type it and checks the call the action makes, so a renamed
 * option, a lost default or a dropped alias (`--workflow` to `workflowName`)
 * fails here.
 *
 * process.exit is replaced by a throw, so a parse that would end the process
 * stops there and the test reads the exit code.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

const m = vi.hoisted(() => ({
  compileCommand: vi.fn(),
  stripCommand: vi.fn(),
  describeCommand: vi.fn(),
  diagramCommand: vi.fn(),
  artifactCommand: vi.fn(),
  diffCommand: vi.fn(),
  validateCommand: vi.fn(),
  doctorCommand: vi.fn(),
  agentsCommand: vi.fn(),
  initCommand: vi.fn(),
  watchCommand: vi.fn(),
  devCommand: vi.fn(),
  mcpServerCommand: vi.fn(),
  mcpSetupCommand: vi.fn(),
  createWorkflowCommand: vi.fn(),
  createNodeCommand: vi.fn(),
  modifyAddNodeCommand: vi.fn(),
  modifyRemoveNodeCommand: vi.fn(),
  modifyAddConnectionCommand: vi.fn(),
  modifyRemoveConnectionCommand: vi.fn(),
  modifyRenameNodeCommand: vi.fn(),
  modifySetLabelCommand: vi.fn(),
  templatesCommand: vi.fn(),
  grammarCommand: vi.fn(),
  runCommand: vi.fn(),
  serveCommand: vi.fn(),
  consoleCommand: vi.fn(),
  exportCommand: vi.fn(),
  openapiCommand: vi.fn(),
  migrateCommand: vi.fn(),
  statusCommand: vi.fn(),
  implementCommand: vi.fn(),
  docsListCommand: vi.fn(),
  docsReadCommand: vi.fn(),
  docsSearchCommand: vi.fn(),
  contextCommand: vi.fn(),
  marketInitCommand: vi.fn(),
  marketPackCommand: vi.fn(),
  marketPublishCommand: vi.fn(),
  marketInstallCommand: vi.fn(),
  marketSearchCommand: vi.fn(),
  marketListCommand: vi.fn(),
}));

vi.mock('../../src/cli/commands/compile.js', () => ({ compileCommand: m.compileCommand }));
vi.mock('../../src/cli/commands/strip.js', () => ({ stripCommand: m.stripCommand }));
vi.mock('../../src/cli/commands/describe.js', () => ({ describeCommand: m.describeCommand }));
vi.mock('../../src/cli/commands/diagram.js', () => ({ diagramCommand: m.diagramCommand }));
vi.mock('../../src/cli/commands/artifact.js', () => ({ artifactCommand: m.artifactCommand }));
vi.mock('../../src/cli/commands/diff.js', () => ({ diffCommand: m.diffCommand }));
vi.mock('../../src/cli/commands/validate.js', () => ({ validateCommand: m.validateCommand }));
vi.mock('../../src/cli/commands/doctor.js', () => ({ doctorCommand: m.doctorCommand }));
vi.mock('../../src/cli/commands/agents.js', () => ({ agentsCommand: m.agentsCommand }));
vi.mock('../../src/cli/commands/init.js', () => ({ initCommand: m.initCommand }));
vi.mock('../../src/cli/commands/watch.js', () => ({ watchCommand: m.watchCommand }));
vi.mock('../../src/cli/commands/dev.js', () => ({ devCommand: m.devCommand }));
vi.mock('../../src/mcp/server.js', () => ({ mcpServerCommand: m.mcpServerCommand }));
vi.mock('../../src/cli/commands/mcp-setup.js', () => ({ mcpSetupCommand: m.mcpSetupCommand }));
vi.mock('../../src/cli/commands/create.js', () => ({
  createWorkflowCommand: m.createWorkflowCommand,
  createNodeCommand: m.createNodeCommand,
}));
vi.mock('../../src/cli/commands/modify.js', () => ({
  modifyAddNodeCommand: m.modifyAddNodeCommand,
  modifyRemoveNodeCommand: m.modifyRemoveNodeCommand,
  modifyAddConnectionCommand: m.modifyAddConnectionCommand,
  modifyRemoveConnectionCommand: m.modifyRemoveConnectionCommand,
  modifyRenameNodeCommand: m.modifyRenameNodeCommand,
  modifySetLabelCommand: m.modifySetLabelCommand,
}));
vi.mock('../../src/cli/commands/templates.js', () => ({ templatesCommand: m.templatesCommand }));
vi.mock('../../src/cli/commands/grammar.js', () => ({ grammarCommand: m.grammarCommand }));
vi.mock('../../src/cli/commands/run.js', () => ({ runCommand: m.runCommand }));
vi.mock('../../src/cli/commands/serve.js', () => ({ serveCommand: m.serveCommand }));
vi.mock('../../src/cli/commands/console.js', () => ({ consoleCommand: m.consoleCommand }));
vi.mock('../../src/cli/commands/export.js', () => ({ exportCommand: m.exportCommand }));
vi.mock('../../src/cli/commands/openapi.js', () => ({ openapiCommand: m.openapiCommand }));
vi.mock('../../src/cli/commands/migrate.js', () => ({ migrateCommand: m.migrateCommand }));
vi.mock('../../src/cli/commands/status.js', () => ({ statusCommand: m.statusCommand }));
vi.mock('../../src/cli/commands/implement.js', () => ({ implementCommand: m.implementCommand }));
vi.mock('../../src/cli/commands/docs.js', () => ({
  docsListCommand: m.docsListCommand,
  docsReadCommand: m.docsReadCommand,
  docsSearchCommand: m.docsSearchCommand,
}));
vi.mock('../../src/cli/commands/context.js', () => ({ contextCommand: m.contextCommand }));
vi.mock('../../src/cli/commands/market.js', () => ({
  marketInitCommand: m.marketInitCommand,
  marketPackCommand: m.marketPackCommand,
  marketPublishCommand: m.marketPublishCommand,
  marketInstallCommand: m.marketInstallCommand,
  marketSearchCommand: m.marketSearchCommand,
  marketListCommand: m.marketListCommand,
}));

import { buildProgram, cliVersion } from '../../src/cli/program';
import { logger } from '../../src/cli/utils/logger';

class ExitCalled extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${code})`);
  }
}

let stdout = '';
let errorSpy: MockInstance<typeof logger.error>;
let bannerSpy: MockInstance<typeof logger.banner>;
let exitSpy: MockInstance<typeof process.exit>;

beforeEach(() => {
  vi.clearAllMocks();
  stdout = '';
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ExitCalled(code);
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  });
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
  bannerSpy = vi.spyOn(logger, 'banner').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Parse `args` (the words after `fw`) against a fresh program; the exit code if it exited. */
async function fw(...args: string[]): Promise<number | string | null | undefined> {
  try {
    await buildProgram().parseAsync(args, { from: 'user' });
    return undefined;
  } catch (error) {
    if (error instanceof ExitCalled) return error.code;
    throw error;
  }
}

/** The messages logger.error printed, in order. */
function errors(): string[] {
  return errorSpy.mock.calls.map(([message]) => message);
}

describe('program', () => {
  it('is named fw and registers every built-in command in help order', () => {
    const program = buildProgram();
    expect(program.name()).toBe('fw');
    expect(program.commands.map((c) => c.name())).toEqual([
      'compile', 'strip', 'describe', 'diagram', 'artifact', 'diff', 'validate', 'doctor', 'agents',
      'init', 'watch', 'dev', 'mcp-server', 'mcp-setup', 'create', 'modify', 'templates', 'grammar',
      'run', 'serve', 'console', 'export', 'openapi', 'migrate', 'status', 'implement', 'docs',
      'context', 'market',
    ]);
  });

  it('builds a fresh program each time, so tests and packs cannot leak commands into each other', () => {
    const a = buildProgram();
    a.command('extra');
    expect(buildProgram().commands.some((c) => c.name() === 'extra')).toBe(false);
  });
});

describe('command wiring', () => {
  // [argv, the mocked handler, the arguments its call must receive]
  const cases: Array<[string[], keyof typeof m, unknown[]]> = [
    [['compile', 'wf.ts'], 'compileCommand', ['wf.ts', {
      production: false, sourceMap: false, verbose: false, dryRun: false, format: 'auto', strict: false, clean: false,
    }]],
    [['compile', 'wf.ts', '-o', 'out', '-p', '-s', '--verbose', '--dry-run', '-w', 'main', '-f', 'cjs', '--strict', '--clean'], 'compileCommand', ['wf.ts', {
      output: 'out', production: true, sourceMap: true, verbose: true, dryRun: true, workflow: 'main', workflowName: 'main',
      format: 'cjs', strict: true, clean: true,
    }]],
    [['strip', 'wf.ts', '-o', 'dir', '--dry-run'], 'stripCommand', ['wf.ts', { output: 'dir', dryRun: true, verbose: false }]],
    [['describe', 'wf.ts'], 'describeCommand', ['wf.ts', { format: 'json' }]],
    [['describe', 'wf.ts', '-f', 'ascii-compact', '-n', 'a', '--compile', '-w', 'main'], 'describeCommand', ['wf.ts', {
      format: 'ascii-compact', node: 'a', compile: true, workflow: 'main', workflowName: 'main',
    }]],
    [['diagram', 'wf.ts'], 'diagramCommand', ['wf.ts', { theme: 'dark', format: 'svg' }]],
    [['diagram', 'wf.ts', '-t', 'light', '-f', 'text', '-o', 'd.txt', '-w', 'main'], 'diagramCommand', ['wf.ts', {
      theme: 'light', format: 'text', output: 'd.txt', workflow: 'main', workflowName: 'main',
    }]],
    [['artifact', 'wf.ts'], 'artifactCommand', ['wf.ts', { kind: 'brief', theme: 'light' }]],
    [['artifact', 'wf.ts', '-k', 'pdf', '-t', 'dark', '-w', 'main', '--subtitle', 'S', '--browser', '/b', '-o', 'x.pdf'], 'artifactCommand', ['wf.ts', {
      kind: 'pdf', theme: 'dark', workflow: 'main', workflowName: 'main', subtitle: 'S', browser: '/b', output: 'x.pdf',
    }]],
    [['diff', 'a.ts', 'b.ts'], 'diffCommand', ['a.ts', 'b.ts', { format: 'text', exitZero: false }]],
    [['diff', 'a.ts', 'b.ts', '-f', 'json', '-w', 'main', '--exit-zero'], 'diffCommand', ['a.ts', 'b.ts', {
      format: 'json', workflow: 'main', workflowName: 'main', exitZero: true,
    }]],
    [['validate', 'src/*.ts'], 'validateCommand', ['src/*.ts', { verbose: false, quiet: false, json: false, strict: false }]],
    [['validate', 'wf.ts', '-q', '--json', '--strict', '-w', 'main'], 'validateCommand', ['wf.ts', {
      verbose: false, quiet: true, json: true, strict: true, workflow: 'main', workflowName: 'main',
    }]],
    [['doctor', '--json'], 'doctorCommand', [{ json: true }]],
    [['agents'], 'agentsCommand', [undefined, { init: false, force: false, json: false }]],
    [['agents', 'proj', '--init', '--force'], 'agentsCommand', ['proj', { init: true, force: true, json: false }]],
    [['init'], 'initCommand', [undefined, { yes: false, json: false, force: false, agent: true }]],
    [['init', 'my-app', '-n', 'App', '-t', 'ai-agent', '-f', 'cjs', '-y', '--preset', 'expert', '--use-case', 'ai',
      '--no-mcp', '--no-agent', '--install', '--no-git', '--force', '--json'], 'initCommand', ['my-app', {
      name: 'App', template: 'ai-agent', format: 'cjs', yes: true, preset: 'expert', useCase: 'ai',
      mcp: false, agent: false, install: true, git: false, force: true, json: true,
    }]],
    [['watch', 'wf.ts', '-w', 'main'], 'watchCommand', ['wf.ts', {
      production: false, sourceMap: false, verbose: false, format: 'auto', workflow: 'main', workflowName: 'main',
    }]],
    [['dev', 'wf.ts', '--params', '{"a":1}', '--once', '--json', '-w', 'main', '--mocks-file', 'm.json'], 'devCommand', ['wf.ts', {
      params: '{"a":1}', once: true, json: true, workflow: 'main', mocksFile: 'm.json',
      production: false, format: 'auto', clean: false,
    }]],
    [['mcp-server', '--stdio'], 'mcpServerCommand', [{ stdio: true }]],
    [['mcp-setup', '--tool', 'claude', 'cursor', '--all'], 'mcpSetupCommand', [{ tool: ['claude', 'cursor'], all: true }]],
    [['create', 'workflow', 'sequential', 'wf.ts'], 'createWorkflowCommand', ['sequential', 'wf.ts', { async: false, preview: false }]],
    [['create', 'workflow', 'ai-agent', 'wf.ts', '-l', '12', '-a', '-p', '--provider', 'mock', '--nodes', 'a,b', '--input', 'in', '--output', 'out'],
      'createWorkflowCommand', ['ai-agent', 'wf.ts', {
        line: 12, async: true, preview: true, provider: 'mock', nodes: 'a,b', input: 'in', output: 'out',
      }]],
    [['create', 'node', 'fetch', 'wf.ts'], 'createNodeCommand', ['fetch', 'wf.ts', { template: 'transformer', preview: false }]],
    [['create', 'node', 'fetch', 'wf.ts', '-t', 'http', '--strategy', 'mock', '--config', '{}'], 'createNodeCommand', ['fetch', 'wf.ts', {
      template: 'http', preview: false, strategy: 'mock', config: '{}',
    }]],
    [['modify', 'addNode', '--file', 'wf.ts', '--nodeId', 'n1', '--nodeType', 'T'], 'modifyAddNodeCommand', ['wf.ts', {
      file: 'wf.ts', nodeId: 'n1', nodeType: 'T',
    }]],
    [['modify', 'removeNode', '--file', 'wf.ts', '--nodeId', 'n1'], 'modifyRemoveNodeCommand', ['wf.ts', { file: 'wf.ts', nodeId: 'n1' }]],
    [['modify', 'addConnection', '--file', 'wf.ts', '--from', 'a.out', '--to', 'b.in'], 'modifyAddConnectionCommand', ['wf.ts', {
      file: 'wf.ts', from: 'a.out', to: 'b.in',
    }]],
    [['modify', 'removeConnection', '--file', 'wf.ts', '--from', 'a.out', '--to', 'b.in'], 'modifyRemoveConnectionCommand', ['wf.ts', {
      file: 'wf.ts', from: 'a.out', to: 'b.in',
    }]],
    [['modify', 'renameNode', '--file', 'wf.ts', '--oldId', 'a', '--newId', 'b'], 'modifyRenameNodeCommand', ['wf.ts', {
      file: 'wf.ts', oldId: 'a', newId: 'b',
    }]],
    [['modify', 'setLabel', '--file', 'wf.ts', '--nodeId', 'a', '--label', 'A'], 'modifySetLabelCommand', ['wf.ts', {
      file: 'wf.ts', nodeId: 'a', label: 'A',
    }]],
    [['templates', '--json'], 'templatesCommand', [{ json: true }]],
    [['grammar'], 'grammarCommand', [{}]],
    [['grammar', '-f', 'ebnf', '-o', 'g.txt'], 'grammarCommand', [{ format: 'ebnf', output: 'g.txt' }]],
    [['run', 'wf.ts'], 'runCommand', ['wf.ts', { production: false, json: false }]],
    [['run', 'wf.ts', '-w', 'main', '--params', '{"x":1}', '-t', '-s', '--timeout', '500', '--mocks', '{}', '-d', '-b', 'a', 'b'],
      'runCommand', ['wf.ts', {
        workflow: 'main', params: '{"x":1}', trace: true, stream: true, timeout: 500, mocks: '{}', debug: true,
        breakpoint: ['a', 'b'], production: false, json: false,
      }]],
    [['serve'], 'serveCommand', [undefined, {
      port: 3000, host: '127.0.0.1', watch: true, production: false, cors: undefined, swagger: false,
      token: undefined, agents: true, trace: false, dev: false, insecure: false,
    }]],
    [['serve', 'dir', '-p', '8080', '-H', '0.0.0.0', '--token', 't', '--no-agents', '--no-watch', '--cors', '*', '--swagger', '--trace', '--dev', '--insecure'],
      'serveCommand', ['dir', {
        port: 8080, host: '0.0.0.0', watch: false, production: false, cors: '*', swagger: true,
        token: 't', agents: false, trace: true, dev: true, insecure: true,
      }]],
    [['console'], 'consoleCommand', [undefined, { port: 4311, host: '127.0.0.1', insecure: false, open: false, watch: true }]],
    [['console', 'dir', '-p', '5000', '--open', '--no-watch'], 'consoleCommand', ['dir', {
      port: 5000, host: '127.0.0.1', insecure: false, open: true, watch: false,
    }]],
    [['export', 'wf.ts', '-t', 'lambda', '-o', 'dist'], 'exportCommand', ['wf.ts', {
      target: 'lambda', output: 'dist', production: false, bundle: false, dryRun: false, multi: false, docs: false, durableSteps: false,
    }]],
    [['export', 'wf.ts', '-t', 'lambda', '-o', 'dist', '--multi', '--workflows', 'a,b', '--docs', '--durable-steps', '-w', 'main'],
      'exportCommand', ['wf.ts', {
        target: 'lambda', output: 'dist', production: false, bundle: false, dryRun: false, multi: true, workflows: 'a,b',
        docs: true, durableSteps: true, workflow: 'main',
      }]],
    [['openapi', 'dir'], 'openapiCommand', ['dir', { title: 'Flow Weaver API', version: '1.0.0', format: 'json', auth: true, legacy: true }]],
    [['openapi', 'dir', '--title', 'T', '-f', 'yaml', '--no-auth', '--no-legacy'], 'openapiCommand', ['dir', {
      title: 'T', version: '1.0.0', format: 'yaml', auth: false, legacy: false,
    }]],
    [['migrate', '**/*.ts', '--dry-run'], 'migrateCommand', ['**/*.ts', { dryRun: true, diff: false }]],
    [['status', 'wf.ts', '-w', 'main'], 'statusCommand', ['wf.ts', { json: false, workflow: 'main', workflowName: 'main' }]],
    [['implement', 'wf.ts', 'fetch'], 'implementCommand', ['wf.ts', 'fetch', { preview: false }]],
    [['implement', 'wf.ts', '--nodeId', 'fetch', '-w', 'main'], 'implementCommand', ['wf.ts', 'fetch', {
      nodeId: 'fetch', preview: false, workflow: 'main', workflowName: 'main',
    }]],
    [['implement', 'wf.ts', 'pos', '--nodeId', 'flag'], 'implementCommand', ['wf.ts', 'pos', { nodeId: 'flag', preview: false }]],
    [['docs'], 'docsListCommand', [{ json: false, compact: false }]],
    [['docs', 'list', '--json'], 'docsListCommand', [{ json: true, compact: false }]],
    [['docs', 'search', 'scoped', 'ports'], 'docsSearchCommand', ['scoped ports', { json: false, compact: false }]],
    [['docs', 'concepts', '--compact'], 'docsReadCommand', ['concepts', { json: false, compact: true }]],
    [['context'], 'contextCommand', [undefined, { profile: 'standalone', grammar: true }]],
    [['context', 'core', '--profile', 'assistant', '--add', 'a,b', '--no-grammar', '-o', 'c.md'], 'contextCommand', ['core', {
      profile: 'assistant', add: 'a,b', grammar: false, output: 'c.md',
    }]],
    [['market', 'init', 'openai', '-y'], 'marketInitCommand', ['openai', { yes: true }]],
    [['market', 'pack'], 'marketPackCommand', [undefined, { json: false, verbose: false }]],
    [['market', 'publish', 'pkg', '--dry-run', '--tag', 'next'], 'marketPublishCommand', ['pkg', { dryRun: true, tag: 'next' }]],
    [['market', 'install', 'flow-weaver-pack-x', '--json'], 'marketInstallCommand', ['flow-weaver-pack-x', { json: true }]],
    [['market', 'search'], 'marketSearchCommand', [undefined, { limit: 20, json: false }]],
    [['market', 'search', 'ai', '-l', '5', '-r', 'https://r.example'], 'marketSearchCommand', ['ai', {
      limit: 5, registry: 'https://r.example', json: false,
    }]],
    [['market', 'list'], 'marketListCommand', [{ json: false }]],
  ];

  for (const [argv, handler, expected] of cases) {
    it(`fw ${argv.join(' ')} calls ${handler}`, async () => {
      expect(await fw(...argv)).toBeUndefined();
      expect(errors()).toEqual([]);
      expect(m[handler]).toHaveBeenCalledTimes(1);
      expect(m[handler].mock.calls[0]).toEqual(expected);
    });
  }

  it('accepts the root --no-color and --color flags before a command', async () => {
    expect(await fw('--no-color', 'doctor')).toBeUndefined();
    expect(await fw('--color', 'doctor')).toBeUndefined();
    expect(m.doctorCommand).toHaveBeenCalledTimes(2);
  });

  // Known bug: the program's own -v/--version is recognised after a
  // subcommand too, so `fw openapi <dir> --version 2.0.0` prints the fw
  // banner and exits 0 instead of setting the API version. When that is
  // fixed this test starts passing, and `.fails` turns that into a failure
  // so the marker is removed.
  it.fails('passes openapi --version to the command', async () => {
    expect(await fw('openapi', 'dir', '--version', '2.0.0')).toBeUndefined();
    expect(m.openapiCommand.mock.calls[0]?.[1]).toMatchObject({ version: '2.0.0' });
  });
});

describe('version', () => {
  it('prints the banner with the version and exits 0 for --version and -v', async () => {
    expect(await fw('--version')).toBe(0);
    expect(await fw('-v')).toBe(0);
    expect(bannerSpy.mock.calls).toEqual([[cliVersion], [cliVersion]]);
  });

  it('is 0.0.0-dev when the build did not inject one', () => {
    expect(cliVersion).toBe('0.0.0-dev');
  });
});

describe('help', () => {
  it('lists every command with its usage, unsorted, followed by the examples', async () => {
    expect(await fw('--help')).toBe(0);
    expect(stdout).toContain('Usage: fw [options] [command]');
    expect(stdout).toContain('Flow Weaver: workflows as annotated TypeScript');
    // subcommandTerm shows the arguments after the name.
    expect(stdout).toMatch(/^ {2}compile \[options\] <input> +Compile workflow files to TypeScript$/m);
    expect(stdout).toMatch(/^ {2}diff \[options\] <file1> <file2> +Compare two workflow files semantically$/m);
    expect(stdout).toMatch(/^ {2}create \[options\] \[command\] +Create workflows or nodes from templates$/m);
    expect(stdout.indexOf('  compile ')).toBeLessThan(stdout.indexOf('  strip '));
    expect(stdout.indexOf('  strip ')).toBeLessThan(stdout.indexOf('  agents '));
    expect(stdout).toContain('Examples:\n\n  $ fw compile my-workflow.ts');
    expect(stdout).toContain('Run fw <command> --help for detailed usage.');
  });

  it('shows a command\'s options with their choices, defaults and required flags', async () => {
    expect(await fw('compile', '--help')).toBe(0);
    // Help wraps long lines; compare with the wrapping undone.
    const text = stdout.replace(/\s+/g, ' ');
    expect(text).toContain('Usage: fw compile [options] <input>');
    expect(text).toContain('-f, --format <format> Module format (choices: "esm", "cjs", "auto", default: "auto")');
    expect(text).toContain('--dry-run Preview compilation without writing files (default: false)');

    stdout = '';
    expect(await fw('export', '--help')).toBe(0);
    expect(stdout).toContain('-t, --target <target>');
    expect(stdout).toContain('-o, --output <path>');
  });

  it('shows a group\'s subcommands', async () => {
    expect(await fw('market', '--help')).toBe(0);
    for (const sub of ['init [options] <name>', 'pack [options] [directory]', 'publish [options] [directory]',
      'install [options] <package>', 'search [options] [query]', 'list [options]']) {
      expect(stdout).toContain(sub);
    }
  });
});

describe('errors', () => {
  it('prints an unknown command once, with a suggestion, and exits 1', async () => {
    expect(await fw('compil')).toBe(1);
    expect(errors()).toEqual(["unknown command 'compil'\n(Did you mean compile?)"]);
  });

  it('prints a failing action\'s message once and exits 1', async () => {
    m.validateCommand.mockRejectedValueOnce(new Error('No files found matching pattern: /nonexistent.ts'));
    expect(await fw('validate', '/nonexistent.ts')).toBe(1);
    expect(errors()).toEqual(['No files found matching pattern: /nonexistent.ts']);
  });

  it('prints a thrown non-Error as text', async () => {
    m.compileCommand.mockRejectedValueOnce('plain string');
    expect(await fw('compile', 'wf.ts')).toBe(1);
    expect(errors()).toEqual(['plain string']);
  });

  it('prints nothing more from Commander once an action has failed', async () => {
    const program = buildProgram();
    m.compileCommand.mockRejectedValueOnce(new Error('boom'));
    await expect(program.parseAsync(['compile', 'wf.ts'], { from: 'user' })).rejects.toBeInstanceOf(ExitCalled);
    await expect(program.parseAsync(['bogus'], { from: 'user' })).rejects.toBeInstanceOf(ExitCalled);
    expect(errors()).toEqual(['boom']);
  });

  it.each([
    [['compile'], "missing required argument 'input'"],
    [['compile', 'wf.ts', '--bogus'], "unknown option '--bogus'"],
    [['compile', 'wf.ts', '-f', 'nope'], "option '-f, --format <format>' argument 'nope' is invalid. Allowed choices are esm, cjs, auto."],
    [['export', 'wf.ts', '-o', 'dist'], "required option '-t, --target <target>' not specified"],
    [['modify', 'addNode', '--file', 'wf.ts'], "required option '--nodeId <id>' not specified"],
  ])('rejects fw %j with one message and exit 1', async (argv, message) => {
    expect(await fw(...argv)).toBe(1);
    expect(errors()).toEqual([message]);
    expect(Object.values(m).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('throws an option value its parser rejects to the caller, which the entry prints', async () => {
    // parseIntStrict throws a plain Error, which Commander does not turn into
    // its own error, so it leaves parse(); src/cli/index.ts catches and prints it.
    await expect(fw('create', 'node', 'n', 'f.ts', '--line', 'abc')).rejects.toThrow('"abc" is not a valid number');
    expect(errors()).toEqual([]);
    expect(m.createNodeCommand).not.toHaveBeenCalled();
  });

  it('prints the group help as the error when a group is called without a subcommand', async () => {
    expect(await fw('create')).toBe(1);
    expect(errors()).toHaveLength(1);
    expect(errors()[0]).toMatch(/^Usage: fw create \[options\] \[command\]/);
    expect(errors()[0]).toContain('workflow [options] <template> <file>');
  });

  it('reports a port that is not a number from inside the action', async () => {
    expect(await fw('serve', '--port', 'abc')).toBe(1);
    expect(errors()).toEqual(['"abc" is not a valid number']);
    expect(m.serveCommand).not.toHaveBeenCalled();
  });

  it('requires a node for implement, as an argument or --nodeId', async () => {
    expect(await fw('implement', 'wf.ts')).toBe(1);
    expect(errors()).toEqual(['Node name is required (as positional arg or --nodeId flag)']);
    expect(m.implementCommand).not.toHaveBeenCalled();
  });

  it('asks for a query when docs search has none', async () => {
    expect(await fw('docs', 'search')).toBe(1);
    // The real process ends at the first exit; the stubbed exit throws, and
    // wrapAction then reports that throw too, so only the first call counts.
    expect(errors()[0]).toBe('Usage: fw docs search <query>');
    expect(exitSpy.mock.calls[0]).toEqual([1]);
    expect(m.docsSearchCommand).not.toHaveBeenCalled();
  });
});
