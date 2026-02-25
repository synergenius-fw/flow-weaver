/**
 * Tests for diagram command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock dependencies before importing the command
vi.mock('../../src/diagram/index.js', () => ({
  fileToSVG: vi.fn().mockReturnValue('<svg>mock</svg>'),
  fileToHTML: vi.fn().mockReturnValue('<html>mock</html>'),
}));

vi.mock('../../src/cli/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
    newline: vi.fn(),
    section: vi.fn(),
  },
}));

import { diagramCommand } from '../../src/cli/commands/diagram';
import { fileToSVG, fileToHTML } from '../../src/diagram/index.js';
import { logger } from '../../src/cli/utils/logger.js';

const DIAGRAM_TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-diagram-test-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(DIAGRAM_TEMP_DIR, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(DIAGRAM_TEMP_DIR, { recursive: true, force: true });
});

describe('diagramCommand', () => {
  let origExit: typeof process.exit;
  let origStdoutWrite: typeof process.stdout.write;
  let stdoutChunks: string[];

  beforeEach(() => {
    origExit = process.exit;
    origStdoutWrite = process.stdout.write;
    process.exit = vi.fn() as never;
    stdoutChunks = [];
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.exit = origExit;
    process.stdout.write = origStdoutWrite;
  });

  it('should exit with error when input file does not exist', async () => {
    await diagramCommand('/nonexistent/file.ts', {});

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('File not found'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should generate SVG by default and write to stdout', async () => {
    const inputFile = path.join(DIAGRAM_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, '// workflow');

    await diagramCommand(inputFile, {});

    expect(fileToSVG).toHaveBeenCalledWith(inputFile, {});
    expect(stdoutChunks.join('')).toContain('<svg>mock</svg>');
  });

  it('should generate HTML when format is html', async () => {
    const inputFile = path.join(DIAGRAM_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, '// workflow');

    await diagramCommand(inputFile, { format: 'html' });

    expect(fileToHTML).toHaveBeenCalledWith(inputFile, {});
    expect(stdoutChunks.join('')).toContain('<html>mock</html>');
  });

  it('should write to output file when output option is provided', async () => {
    const inputFile = path.join(DIAGRAM_TEMP_DIR, 'workflow.ts');
    const outputFile = path.join(DIAGRAM_TEMP_DIR, 'output.svg');
    fs.writeFileSync(inputFile, '// workflow');

    await diagramCommand(inputFile, { output: outputFile });

    expect(fs.existsSync(outputFile)).toBe(true);
    expect(fs.readFileSync(outputFile, 'utf-8')).toBe('<svg>mock</svg>');
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining(outputFile));
  });

  it('should write HTML to output file when format is html', async () => {
    const inputFile = path.join(DIAGRAM_TEMP_DIR, 'workflow.ts');
    const outputFile = path.join(DIAGRAM_TEMP_DIR, 'output.html');
    fs.writeFileSync(inputFile, '// workflow');

    await diagramCommand(inputFile, { format: 'html', output: outputFile });

    expect(fs.existsSync(outputFile)).toBe(true);
    expect(fs.readFileSync(outputFile, 'utf-8')).toBe('<html>mock</html>');
  });

  it('should pass diagram options (theme, width, etc.) through to generator', async () => {
    const inputFile = path.join(DIAGRAM_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, '// workflow');

    await diagramCommand(inputFile, {
      theme: 'dark',
      width: 800,
      padding: 20,
      showPortLabels: true,
      workflowName: 'MyWorkflow',
    });

    expect(fileToSVG).toHaveBeenCalledWith(inputFile, {
      theme: 'dark',
      width: 800,
      padding: 20,
      showPortLabels: true,
      workflowName: 'MyWorkflow',
    });
  });

  it('should handle errors from the diagram generator', async () => {
    const inputFile = path.join(DIAGRAM_TEMP_DIR, 'workflow.ts');
    fs.writeFileSync(inputFile, '// workflow');

    vi.mocked(fileToSVG).mockImplementationOnce(() => {
      throw new Error('Parse error in workflow');
    });

    await diagramCommand(inputFile, {});

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to generate diagram'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Parse error in workflow'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
