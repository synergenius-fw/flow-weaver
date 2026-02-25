/**
 * Tests for the changelog CLI command
 *
 * Mocks execSync (git) calls to test commit parsing, categorization,
 * and markdown output generation without requiring a real git repo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';

// Mock child_process before importing the command
vi.mock('child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('child_process')>();
  return {
    ...orig,
    execSync: vi.fn(),
  };
});

const mockedExecSync = vi.mocked(childProcess.execSync);

// ── Helpers ──────────────────────────────────────────────────────────────────

function captureLogs() {
  const logs: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  console.warn = (...args: unknown[]) => warns.push(args.map(String).join(' '));

  return {
    logs,
    errors,
    warns,
    restore() {
      console.log = origLog;
      console.error = origError;
      console.warn = origWarn;
    },
  };
}

describe('changelogCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should produce categorized markdown output from git commits', async () => {
    // Mock git log: two commits, one in CLI, one in parser
    mockedExecSync.mockImplementation((cmd: string) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString();
      if (cmdStr.includes('git log')) {
        return 'abc1234 Add new validate subcommand\ndef5678 Fix chevrotain grammar rule\n';
      }
      if (cmdStr.includes('git diff-tree') && cmdStr.includes('abc1234')) {
        return 'src/cli/commands/validate.ts\n';
      }
      if (cmdStr.includes('git diff-tree') && cmdStr.includes('def5678')) {
        return 'src/parser/chevrotain/grammar.ts\n';
      }
      return '';
    });

    const { changelogCommand } = await import('../../src/cli/commands/changelog');
    const capture = captureLogs();

    try {
      await changelogCommand({});
    } finally {
      capture.restore();
    }

    const output = capture.logs.join('\n');
    expect(output).toContain('## Changes');
    expect(output).toContain('### Grammar');
    expect(output).toContain('### CLI');
    expect(output).toContain('abc1234');
    expect(output).toContain('def5678');
  });

  it('should show "no commits" when range is empty', async () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString();
      if (cmdStr.includes('git log')) {
        return '';
      }
      return '';
    });

    const { changelogCommand } = await import('../../src/cli/commands/changelog');
    const capture = captureLogs();

    try {
      await changelogCommand({});
    } finally {
      capture.restore();
    }

    const allOutput = [...capture.logs, ...capture.errors, ...capture.warns].join(' ');
    expect(allOutput).toContain('No commits found');
  });

  it('should use --range when provided', async () => {
    let capturedLogCmd = '';
    mockedExecSync.mockImplementation((cmd: string) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString();
      if (cmdStr.includes('git log')) {
        capturedLogCmd = cmdStr;
        return 'aaa1111 Some commit\n';
      }
      if (cmdStr.includes('git diff-tree')) {
        return 'src/runtime/executor.ts\n';
      }
      return '';
    });

    const { changelogCommand } = await import('../../src/cli/commands/changelog');
    const capture = captureLogs();

    try {
      await changelogCommand({ range: 'v0.9.0..v0.10.0' });
    } finally {
      capture.restore();
    }

    expect(capturedLogCmd).toContain('v0.9.0..v0.10.0');
  });

  it('should use --lastTag to determine range', async () => {
    let capturedLogCmd = '';
    mockedExecSync.mockImplementation((cmd: string) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString();
      if (cmdStr.includes('git describe --tags')) {
        return 'v0.9.5\n';
      }
      if (cmdStr.includes('git log')) {
        capturedLogCmd = cmdStr;
        return 'bbb2222 Another commit\n';
      }
      if (cmdStr.includes('git diff-tree')) {
        return 'src/diff/differ.ts\n';
      }
      return '';
    });

    const { changelogCommand } = await import('../../src/cli/commands/changelog');
    const capture = captureLogs();

    try {
      await changelogCommand({ lastTag: true });
    } finally {
      capture.restore();
    }

    expect(capturedLogCmd).toContain('v0.9.5..HEAD');
  });

  it('should use --since for date-based filtering', async () => {
    let capturedLogCmd = '';
    mockedExecSync.mockImplementation((cmd: string) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString();
      if (cmdStr.includes('git log')) {
        capturedLogCmd = cmdStr;
        return 'ccc3333 Recent fix\n';
      }
      if (cmdStr.includes('git diff-tree')) {
        return 'tests/cli/validate.test.ts\n';
      }
      return '';
    });

    const { changelogCommand } = await import('../../src/cli/commands/changelog');
    const capture = captureLogs();

    try {
      await changelogCommand({ since: '2024-01-01' });
    } finally {
      capture.restore();
    }

    expect(capturedLogCmd).toContain('--since');
    expect(capturedLogCmd).toContain('2024-01-01');
  });

  it('should categorize commits into correct groups', async () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString();
      if (cmdStr.includes('git log')) {
        return [
          'aaa0001 Parser update',
          'bbb0002 Generator fix',
          'ccc0003 CLI command',
          'ddd0004 Test fix',
          'eee0005 MCP tool',
          'fff0006 Deploy thing',
          'ggg0007 Runtime tweak',
          'hhh0008 Random file',
        ].join('\n') + '\n';
      }
      if (cmdStr.includes('aaa0001')) return 'src/parser/grammar.ts\n';
      if (cmdStr.includes('bbb0002')) return 'src/generator/body-generator.ts\n';
      if (cmdStr.includes('ccc0003')) return 'src/cli/commands/validate.ts\n';
      if (cmdStr.includes('ddd0004')) return 'tests/cli/validate.test.ts\n';
      if (cmdStr.includes('eee0005')) return 'src/mcp/tools.ts\n';
      if (cmdStr.includes('fff0006')) return 'src/deployment/lambda.ts\n';
      if (cmdStr.includes('ggg0007')) return 'src/runtime/executor.ts\n';
      if (cmdStr.includes('hhh0008')) return 'src/utils/misc.ts\n';
      return '';
    });

    const { changelogCommand } = await import('../../src/cli/commands/changelog');
    const capture = captureLogs();

    try {
      await changelogCommand({});
    } finally {
      capture.restore();
    }

    const output = capture.logs.join('\n');
    expect(output).toContain('### Grammar');
    expect(output).toContain('### Code Generation');
    expect(output).toContain('### CLI');
    expect(output).toContain('### Tests');
    expect(output).toContain('### MCP Tools');
    expect(output).toContain('### Deployment');
    expect(output).toContain('### Runtime');
    expect(output).toContain('### Other');
  });

  it('should fall back when no git tags found with --lastTag', async () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      const cmdStr = typeof cmd === 'string' ? cmd : cmd.toString();
      if (cmdStr.includes('git describe --tags')) {
        throw new Error('fatal: No names found');
      }
      if (cmdStr.includes('git log')) {
        return 'aaa1111 Fallback commit\n';
      }
      if (cmdStr.includes('git diff-tree')) {
        return 'README.md\n';
      }
      return '';
    });

    const { changelogCommand } = await import('../../src/cli/commands/changelog');
    const capture = captureLogs();

    try {
      await changelogCommand({ lastTag: true });
    } finally {
      capture.restore();
    }

    // Should still produce output (falls back to HEAD)
    const output = capture.logs.join('\n');
    expect(output).toContain('## Changes');
  });
});
