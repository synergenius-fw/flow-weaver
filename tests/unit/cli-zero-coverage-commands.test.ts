/**
 * Tests for CLI commands with 0% coverage:
 * watch, templates, serve, context, grammar
 */

// ── Hoisted mocks (available inside vi.mock factories) ─────────────────

const {
  mockCompileCommand,
  mockGlob,
  mockWatcherOn,
  mockWatcherClose,
  mockChokidarWatch,
  mockBuildContext,
  mockGenerateGrammarDiagrams,
  mockGetAllGrammars,
  mockSerializedToEBNF,
  mockWebhookServerStart,
  mockWebhookServerStop,
} = vi.hoisted(() => {
  const mockWatcherOn = vi.fn().mockReturnThis();
  const mockWatcherClose = vi.fn();
  return {
    mockCompileCommand: vi.fn().mockResolvedValue(undefined),
    mockGlob: vi.fn().mockResolvedValue(['/abs/a.flow', '/abs/b.flow']),
    mockWatcherOn,
    mockWatcherClose,
    mockChokidarWatch: vi.fn().mockReturnValue({
      on: mockWatcherOn,
      close: mockWatcherClose,
    }),
    mockBuildContext: vi.fn().mockReturnValue({
      content: '# context output',
      topicCount: 3,
      lineCount: 42,
      profile: 'standalone',
    }),
    mockGenerateGrammarDiagrams: vi.fn().mockReturnValue('<html>diagrams</html>'),
    mockGetAllGrammars: vi.fn().mockReturnValue({
      port: [{ name: 'Port' }],
      node: [{ name: 'Node' }],
      connect: [{ name: 'Connect' }],
      position: [{ name: 'Position' }],
      scope: [{ name: 'Scope' }],
    }),
    mockSerializedToEBNF: vi.fn().mockReturnValue('rule ::= ...'),
    mockWebhookServerStart: vi.fn().mockResolvedValue(undefined),
    mockWebhookServerStop: vi.fn().mockResolvedValue(undefined),
  };
});

// ── vi.mock calls ──────────────────────────────────────────────────────

vi.mock('../../src/cli/commands/compile.js', () => ({
  compileCommand: mockCompileCommand,
}));

vi.mock('glob', () => ({ glob: mockGlob }));

vi.mock('chokidar', () => ({ default: { watch: mockChokidarWatch }, watch: mockChokidarWatch }));

vi.mock('../../src/cli/utils/logger.js', () => ({
  logger: {
    section: vi.fn(),
    info: vi.fn(),
    newline: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/utils/error-utils.js', () => ({
  getErrorMessage: vi.fn((e: unknown) =>
    e instanceof Error ? e.message : String(e),
  ),
}));

const mockWorkflowTemplates = [
  { id: 'basic', name: 'Basic', description: 'A basic workflow', category: 'Starter' },
  { id: 'advanced', name: 'Advanced', description: 'An advanced workflow', category: 'Advanced' },
];

vi.mock('../../src/cli/templates/index.js', () => ({
  workflowTemplates: mockWorkflowTemplates,
  getAllWorkflowTemplates: () => mockWorkflowTemplates,
  nodeTemplates: [
    { id: 'transform', name: 'Transform', description: 'Transform node' },
  ],
}));

vi.mock('../../src/cli/templates/pack-loader.js', () => ({
  loadPackTemplates: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/context/index.js', () => ({
  buildContext: mockBuildContext,
  PRESETS: {
    core: ['syntax', 'nodes'],
    authoring: ['syntax', 'nodes', 'patterns'],
    full: ['syntax', 'nodes', 'patterns', 'internals'],
    ops: ['deploy', 'serve'],
  },
  PRESET_NAMES: ['core', 'authoring', 'full', 'ops'],
}));

vi.mock('../../src/chevrotain-parser/grammar-diagrams.js', () => ({
  generateGrammarDiagrams: mockGenerateGrammarDiagrams,
  getAllGrammars: mockGetAllGrammars,
  serializedToEBNF: mockSerializedToEBNF,
}));

vi.mock('../../src/server/webhook-server.js', () => {
  const Ctor = vi.fn(function (this: any) {
    this.start = mockWebhookServerStart;
    this.stop = mockWebhookServerStop;
  });
  return { WebhookServer: Ctor };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(true),
      statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
      writeFileSync: vi.fn(),
    },
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
    writeFileSync: vi.fn(),
  };
});

// ── Imports (after mocks) ──────────────────────────────────────────────

import * as fs from 'fs';
import { watchCommand } from '../../src/cli/commands/watch.js';
import { templatesCommand } from '../../src/cli/commands/templates.js';
import { serveCommand } from '../../src/cli/commands/serve.js';
import { contextCommand } from '../../src/cli/commands/context.js';
import { grammarCommand } from '../../src/cli/commands/grammar.js';
import { logger } from '../../src/cli/utils/logger.js';
import { WebhookServer } from '../../src/server/webhook-server.js';

// ── Helpers ────────────────────────────────────────────────────────────

let sigintHandlers: Function[] = [];
let sigtermHandlers: Function[] = [];

beforeEach(() => {
  vi.clearAllMocks();

  // Restore default return values after clearAllMocks
  mockGlob.mockResolvedValue(['/abs/a.flow', '/abs/b.flow']);
  mockCompileCommand.mockResolvedValue(undefined);
  mockWatcherOn.mockReturnThis();
  mockChokidarWatch.mockReturnValue({ on: mockWatcherOn, close: mockWatcherClose });
  mockBuildContext.mockReturnValue({
    content: '# context output',
    topicCount: 3,
    lineCount: 42,
    profile: 'standalone',
  });
  mockGenerateGrammarDiagrams.mockReturnValue('<html>diagrams</html>');
  mockGetAllGrammars.mockReturnValue({
    port: [{ name: 'Port' }],
    node: [{ name: 'Node' }],
    connect: [{ name: 'Connect' }],
    position: [{ name: 'Position' }],
    scope: [{ name: 'Scope' }],
  });
  mockSerializedToEBNF.mockReturnValue('rule ::= ...');
  mockWebhookServerStart.mockResolvedValue(undefined);
  mockWebhookServerStop.mockResolvedValue(undefined);
  (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
  (fs.statSync as ReturnType<typeof vi.fn>).mockReturnValue({ isDirectory: () => true });

  sigintHandlers = [];
  sigtermHandlers = [];
  vi.spyOn(process, 'on').mockImplementation((event: string, handler: Function) => {
    if (event === 'SIGINT') sigintHandlers.push(handler);
    if (event === 'SIGTERM') sigtermHandlers.push(handler);
    return process;
  });
  vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════
// watch command
// ═══════════════════════════════════════════════════════════════════════

describe('watchCommand', () => {
  it('runs initial compilation and sets up chokidar watcher', async () => {
    const watchPromise = watchCommand('src/**/*.flow');
    await vi.waitFor(() => {
      expect(mockWatcherOn).toHaveBeenCalledWith('change', expect.any(Function));
    });

    expect(mockCompileCommand).toHaveBeenCalledWith('src/**/*.flow', {});
    expect(mockGlob).toHaveBeenCalledWith('src/**/*.flow', { absolute: true });
    expect(mockChokidarWatch).toHaveBeenCalledWith(
      ['/abs/a.flow', '/abs/b.flow'],
      { persistent: true, ignoreInitial: true },
    );
    expect(logger.section).toHaveBeenCalledWith('Watch Mode');
  });

  it('recompiles when a file change event fires', async () => {
    const onRecompile = vi.fn();
    const watchPromise = watchCommand('src/**/*.flow', { onRecompile });
    await vi.waitFor(() => expect(mockWatcherOn).toHaveBeenCalled());

    const changeHandler = mockWatcherOn.mock.calls.find(
      (c: unknown[]) => c[0] === 'change',
    )![1] as (file: string) => Promise<void>;

    await changeHandler('/abs/a.flow');

    expect(mockCompileCommand).toHaveBeenCalledWith('/abs/a.flow', { onRecompile });
    expect(onRecompile).toHaveBeenCalledWith('/abs/a.flow', true);
  });

  it('handles recompilation errors', async () => {
    const onRecompile = vi.fn();
    mockCompileCommand.mockResolvedValueOnce(undefined); // initial
    mockCompileCommand.mockRejectedValueOnce(new Error('parse error'));

    const watchPromise = watchCommand('src/**/*.flow', { onRecompile });
    await vi.waitFor(() => expect(mockWatcherOn).toHaveBeenCalled());

    const changeHandler = mockWatcherOn.mock.calls.find(
      (c: unknown[]) => c[0] === 'change',
    )![1] as (file: string) => Promise<void>;

    await changeHandler('/abs/a.flow');

    expect(onRecompile).toHaveBeenCalledWith('/abs/a.flow', false, ['parse error']);
    expect(logger.error).toHaveBeenCalled();
  });

  it('logs watched files when verbose is set', async () => {
    const watchPromise = watchCommand('src/**/*.flow', { verbose: true });
    await vi.waitFor(() => expect(mockWatcherOn).toHaveBeenCalled());

    expect(logger.debug).toHaveBeenCalledWith('Watching: /abs/a.flow');
    expect(logger.debug).toHaveBeenCalledWith('Watching: /abs/b.flow');
  });

  it('registers SIGINT handler that closes watcher and exits', async () => {
    const watchPromise = watchCommand('src/**/*.flow');
    await vi.waitFor(() => expect(sigintHandlers.length).toBeGreaterThan(0));

    sigintHandlers[0]();
    expect(mockWatcherClose).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// templates command
// ═══════════════════════════════════════════════════════════════════════

describe('templatesCommand', () => {
  it('outputs JSON when json option is set', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await templatesCommand({ json: true });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.workflows).toHaveLength(2);
    expect(output.workflows[0].id).toBe('basic');
    expect(output.nodes).toHaveLength(1);
    expect(output.nodes[0].id).toBe('transform');
    consoleSpy.mockRestore();
  });

  it('outputs formatted text by default', async () => {
    await templatesCommand();

    expect(logger.section).toHaveBeenCalledWith('Workflow Templates');
    expect(logger.section).toHaveBeenCalledWith('Node Templates');
    expect(logger.section).toHaveBeenCalledWith('Usage');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Starter'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Advanced'));
  });

  it('displays node template info', async () => {
    await templatesCommand({});

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('transform'),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// serve command
// ═══════════════════════════════════════════════════════════════════════

describe('serveCommand', () => {
  it('creates a WebhookServer with default options and starts it', async () => {
    await serveCommand(undefined, {});

    expect(WebhookServer).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 3000,
        host: '0.0.0.0',
        watchEnabled: true,
        production: false,
        precompile: false,
        corsOrigin: '*',
        swaggerEnabled: false,
      }),
    );
    expect(mockWebhookServerStart).toHaveBeenCalled();
  });

  it('passes custom options through', async () => {
    await serveCommand('/my/dir', {
      port: 8080,
      host: 'localhost',
      watch: false,
      production: true,
      precompile: true,
      cors: 'https://example.com',
      swagger: true,
    });

    expect(WebhookServer).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 8080,
        host: 'localhost',
        watchEnabled: false,
        production: true,
        precompile: true,
        corsOrigin: 'https://example.com',
        swaggerEnabled: true,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Swagger'));
  });

  it('throws if directory does not exist', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

    await expect(serveCommand('/no/such/dir', {})).rejects.toThrow(
      'Directory not found',
    );
  });

  it('throws if path is not a directory', async () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    (fs.statSync as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      isDirectory: () => false,
    });

    await expect(serveCommand('/some/file.txt', {})).rejects.toThrow(
      'Not a directory',
    );
  });

  it('wraps EADDRINUSE errors with a friendly message', async () => {
    const err = new Error('listen EADDRINUSE') as NodeJS.ErrnoException;
    err.code = 'EADDRINUSE';
    mockWebhookServerStart.mockRejectedValueOnce(err);

    await expect(serveCommand(undefined, { port: 9999 })).rejects.toThrow(
      'Port 9999 is already in use',
    );
  });

  it('re-throws non-EADDRINUSE errors', async () => {
    mockWebhookServerStart.mockRejectedValueOnce(new Error('boom'));

    await expect(serveCommand(undefined, {})).rejects.toThrow('boom');
  });

  it('registers SIGINT shutdown handler', async () => {
    await serveCommand(undefined, {});
    expect(sigintHandlers.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// context command
// ═══════════════════════════════════════════════════════════════════════

describe('contextCommand', () => {
  it('lists presets when --list is set', async () => {
    await contextCommand(undefined, { list: true });

    expect(logger.section).toHaveBeenCalledWith('Context Presets');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('core'));
  });

  it('writes context to stdout by default', async () => {
    await contextCommand('core', {});

    expect(mockBuildContext).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'core', profile: 'standalone' }),
    );
    expect(process.stdout.write).toHaveBeenCalledWith('# context output');
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('3 topics'),
    );
  });

  it('writes context to a file when --output is set', async () => {
    await contextCommand('core', { output: '/tmp/ctx.md' });

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/ctx.md',
      '# context output',
      'utf-8',
    );
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/ctx.md'),
    );
  });

  it('exits on unknown preset without --topics', async () => {
    await contextCommand('nonexistent', {});

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown preset'),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits on invalid profile', async () => {
    await contextCommand('core', { profile: 'invalid' });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown profile'),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('passes topics and add options through', async () => {
    await contextCommand('core', { topics: 'syntax, nodes', add: 'extra' });

    expect(mockBuildContext).toHaveBeenCalledWith(
      expect.objectContaining({
        topics: ['syntax', 'nodes'],
        addTopics: ['extra'],
      }),
    );
  });

  it('allows unknown preset when topics are provided', async () => {
    await contextCommand('whatever', { topics: 'syntax' });

    expect(process.exit).not.toHaveBeenCalled();
    expect(mockBuildContext).toHaveBeenCalled();
  });

  it('defaults to core preset when no preset is given', async () => {
    await contextCommand(undefined, {});

    expect(mockBuildContext).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'core' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// grammar command
// ═══════════════════════════════════════════════════════════════════════

describe('grammarCommand', () => {
  it('generates EBNF and writes to stdout by default on TTY', async () => {
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    await grammarCommand({});

    expect(mockGetAllGrammars).toHaveBeenCalled();
    expect(mockSerializedToEBNF).toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalledWith('rule ::= ...');

    Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
  });

  it('generates HTML when format is html', async () => {
    await grammarCommand({ format: 'html' });

    expect(mockGenerateGrammarDiagrams).toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalledWith('<html>diagrams</html>');
  });

  it('writes to file when output is specified', async () => {
    await grammarCommand({ format: 'ebnf', output: '/tmp/grammar.ebnf' });

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/grammar.ebnf',
      'rule ::= ...',
      'utf-8',
    );
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/grammar.ebnf'),
    );
  });

  it('defaults to html format when output is specified', async () => {
    await grammarCommand({ output: '/tmp/grammar.html' });

    expect(mockGenerateGrammarDiagrams).toHaveBeenCalled();
  });

  it('handles errors and exits', async () => {
    mockGetAllGrammars.mockImplementationOnce(() => {
      throw new Error('grammar broken');
    });

    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    await grammarCommand({});

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('grammar broken'),
    );
    expect(process.exit).toHaveBeenCalledWith(1);

    Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
  });
});
