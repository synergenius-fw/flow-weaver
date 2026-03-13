/**
 * Coverage tests for src/cli/commands/export.ts (round 2)
 *
 * Targets uncovered branches:
 *  - Missing --target throws
 *  - Multi-workflow dry run success message (lines 106-109)
 *  - Multi-workflow non-dry run with workflows list (lines 114-118)
 *  - Dry run handler preview for .yml/.yaml files (lines 140-141)
 *  - Dry run with no matching handler file (line 143)
 *  - Dry run with short handler (<=40 lines, no "more lines" message)
 *  - Warnings display (lines 155-161)
 *  - Target not found in registry for deploy instructions (line 186-188)
 *  - Prerequisites in deploy instructions (lines 183-185)
 *  - workflows comma parsing (line 63)
 *  - durableSteps logging (line 83-85)
 *  - docs logging (line 80-82)
 */

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockExportWorkflow, mockCreateTargetRegistry } = vi.hoisted(() => ({
  mockExportWorkflow: vi.fn(),
  mockCreateTargetRegistry: vi.fn(),
}));

vi.mock('../../src/export/index.js', () => ({
  exportWorkflow: mockExportWorkflow,
}));

vi.mock('../../src/deployment/index.js', () => ({
  createTargetRegistry: mockCreateTargetRegistry,
}));

// ── Imports ────────────────────────────────────────────────────────────────

import { exportCommand } from '../../src/cli/commands/export';

// ── Helpers ────────────────────────────────────────────────────────────────

let logOutput: string[];
let errorOutput: string[];
let warnOutput: string[];
let origLog: typeof console.log;
let origError: typeof console.error;
let origWarn: typeof console.warn;

beforeEach(() => {
  logOutput = [];
  errorOutput = [];
  warnOutput = [];
  origLog = console.log;
  origError = console.error;
  origWarn = console.warn;
  console.log = (...args: unknown[]) => logOutput.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => errorOutput.push(args.map(String).join(' '));
  console.warn = (...args: unknown[]) => warnOutput.push(args.map(String).join(' '));

  vi.clearAllMocks();

  // Default: target found, no prerequisites
  mockCreateTargetRegistry.mockResolvedValue({
    get: () => ({
      getDeployInstructions: () => ({
        steps: ['npm install', 'deploy'],
        prerequisites: [],
      }),
    }),
  });
});

afterEach(() => {
  console.log = origLog;
  console.error = origError;
  console.warn = origWarn;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('exportCommand coverage round 2', () => {
  describe('missing target', () => {
    it('should throw when --target is not provided', async () => {
      await expect(
        exportCommand('input.ts', { target: '', output: 'out/' })
      ).rejects.toThrow('--target is required');
    });
  });

  describe('single workflow non-dry run', () => {
    it('should display success message for single workflow', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWorkflow',
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', { target: 'lambda', output: 'dist/' });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('Exported workflow "myWorkflow" for lambda');
      expect(allLogs).toContain('done in');
    });
  });

  describe('multi-workflow dry run', () => {
    it('should show multi-workflow preview message in dry run', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'my-service',
        workflows: ['wfA', 'wfB', 'wfC'],
        files: [{ path: 'handler.ts', content: '// multi handler' }],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
        dryRun: true,
        multi: true,
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('Preview for multi-workflow service "my-service" with 3 workflows');
    });
  });

  describe('multi-workflow non-dry run', () => {
    it('should show multi-workflow export message with workflow names', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'vercel',
        workflow: 'api-service',
        workflows: ['calculate', 'transform'],
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', {
        target: 'vercel',
        output: 'api/',
        multi: true,
        workflows: 'calculate, transform',
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('Exported multi-workflow service "api-service" with 2 workflows for vercel');
      expect(allLogs).toContain('Workflows: calculate, transform');
    });
  });

  describe('single workflow dry run', () => {
    it('should show single workflow preview message in dry run', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'cloudflare',
        workflow: 'myWf',
        files: [{ path: 'index.ts', content: '// handler\n// line 2' }],
      });

      await exportCommand('input.ts', {
        target: 'cloudflare',
        output: 'workers/',
        dryRun: true,
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('Preview for workflow "myWf" (cloudflare)');
    });
  });

  describe('dry run handler preview', () => {
    it('should show handler preview for .yml file', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [
          { path: 'template.yml', content: 'AWSTemplateFormatVersion: 2010\nResources:\n  MyFunc:\n    Type: AWS::Lambda' },
        ],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
        dryRun: true,
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('Handler Preview');
      expect(allLogs).toContain('AWSTemplateFormatVersion');
    });

    it('should show handler preview for .yaml file', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [
          { path: 'config.yaml', content: 'key: value\nother: data' },
        ],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
        dryRun: true,
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('key: value');
    });

    it('should show handler preview for file named after workflow', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'vercel',
        workflow: 'myWf',
        files: [
          { path: 'myWf.ts', content: '// vercel handler\nexport default function() {}' },
        ],
      });

      await exportCommand('input.ts', {
        target: 'vercel',
        output: 'api/',
        dryRun: true,
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('// vercel handler');
    });

    it('should truncate handler preview at 40 lines and show count', async () => {
      const lines = Array.from({ length: 60 }, (_, i) => `// line ${i + 1}`);
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [
          { path: 'handler.ts', content: lines.join('\n') },
        ],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
        dryRun: true,
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('// line 1');
      expect(allLogs).toContain('// line 40');
      expect(allLogs).not.toContain('// line 41');
      expect(allLogs).toContain('20 more lines');
    });

    it('should not show "more lines" when handler is <= 40 lines', async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `// line ${i + 1}`);
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [
          { path: 'handler.ts', content: lines.join('\n') },
        ],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
        dryRun: true,
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('// line 1');
      expect(allLogs).not.toContain('more lines');
    });

    it('should not show handler content when no matching file exists', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [
          { path: 'package.json', content: '{}' },
        ],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
        dryRun: true,
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('Handler Preview');
      // No handler content shown but no crash
      expect(allLogs).not.toContain('{}');
    });
  });

  describe('warnings display', () => {
    it('should display warnings from export result', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
        warnings: [
          'Annotation @timeout is not supported by lambda target',
          'Annotation @retry dropped: use target retry config',
        ],
      });

      await exportCommand('input.ts', { target: 'lambda', output: 'dist/' });

      const allWarns = warnOutput.join('\n');
      expect(allWarns).toContain('Annotation @timeout is not supported by lambda target');
      expect(allWarns).toContain('Annotation @retry dropped');
    });

    it('should not show warnings section when warnings array is empty', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
        warnings: [],
      });

      await exportCommand('input.ts', { target: 'lambda', output: 'dist/' });

      const allOutput = [...logOutput, ...warnOutput].join('\n');
      // The "Warnings" section header should not appear
      expect(allOutput).not.toMatch(/\bWarnings\b/);
    });

    it('should not show warnings section when warnings is undefined', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', { target: 'lambda', output: 'dist/' });

      const allOutput = [...logOutput, ...warnOutput].join('\n');
      expect(allOutput).not.toMatch(/\bWarnings\b/);
    });
  });

  describe('deploy instructions', () => {
    it('should show deploy steps from target', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
      });
      mockCreateTargetRegistry.mockResolvedValue({
        get: () => ({
          getDeployInstructions: () => ({
            steps: ['Run sam build', 'Run sam deploy --guided'],
            prerequisites: [],
          }),
        }),
      });

      await exportCommand('input.ts', { target: 'lambda', output: 'dist/' });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('1. Run sam build');
      expect(allLogs).toContain('2. Run sam deploy --guided');
    });

    it('should show prerequisites when target has them', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
      });
      mockCreateTargetRegistry.mockResolvedValue({
        get: () => ({
          getDeployInstructions: () => ({
            steps: ['Deploy'],
            prerequisites: ['AWS CLI', 'SAM CLI'],
          }),
        }),
      });

      await exportCommand('input.ts', { target: 'lambda', output: 'dist/' });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('Requires: AWS CLI, SAM CLI');
    });

    it('should show fallback message when target is not found in registry', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'custom-target',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
      });
      mockCreateTargetRegistry.mockResolvedValue({
        get: () => null,
      });

      await exportCommand('input.ts', { target: 'custom-target', output: 'dist/' });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('See target documentation for deployment instructions.');
    });
  });

  describe('logging options info', () => {
    it('should log multi mode with workflow list', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'svc',
        workflows: ['a', 'b'],
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
        multi: true,
        workflows: 'a, b',
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('Mode: Multi-workflow service');
      expect(allLogs).toContain('Workflows: a, b');
    });

    it('should log "All workflows in file" when multi without specific workflows', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'svc',
        workflows: ['a', 'b'],
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
        multi: true,
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('Workflows: All workflows in file');
    });

    it('should log specific workflow name when not multi', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'calculate',
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
        workflow: 'calculate',
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('Workflow: calculate');
    });

    it('should log docs option', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'vercel',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', {
        target: 'vercel',
        output: 'api/',
        docs: true,
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('Include docs: Yes');
    });

    it('should log durableSteps option', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'inngest',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', {
        target: 'inngest',
        output: 'out/',
        durableSteps: true,
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('Durable steps: Yes');
    });

    it('should log dry run mode info', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
        dryRun: true,
      });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('DRY RUN');
      expect(allLogs).toContain('Export Preview');
    });
  });

  describe('exportWorkflow options passthrough', () => {
    it('should parse comma-separated workflows list', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'svc',
        workflows: ['wfA', 'wfB', 'wfC'],
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
        multi: true,
        workflows: 'wfA, wfB, wfC',
      });

      expect(mockExportWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          workflows: ['wfA', 'wfB', 'wfC'],
        })
      );
    });

    it('should default production to true', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
      });

      expect(mockExportWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ production: true })
      );
    });

    it('should pass production=false when specified', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
        production: false,
      });

      expect(mockExportWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ production: false })
      );
    });

    it('should pass includeDocs and durableSteps to exportWorkflow', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'inngest',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', {
        target: 'inngest',
        output: 'out/',
        docs: true,
        durableSteps: true,
      });

      expect(mockExportWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          includeDocs: true,
          durableSteps: true,
        })
      );
    });

    it('should not pass workflows when option is not set', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [{ path: 'handler.ts', content: 'code' }],
      });

      await exportCommand('input.ts', {
        target: 'lambda',
        output: 'dist/',
      });

      expect(mockExportWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          workflows: undefined,
        })
      );
    });
  });

  describe('generated files listing', () => {
    it('should list all generated files', async () => {
      mockExportWorkflow.mockResolvedValue({
        target: 'lambda',
        workflow: 'myWf',
        files: [
          { path: 'handler.ts', content: 'handler code' },
          { path: 'template.yaml', content: 'yaml content' },
          { path: 'package.json', content: '{}' },
        ],
      });

      await exportCommand('input.ts', { target: 'lambda', output: 'dist/' });

      const allLogs = logOutput.join('\n');
      expect(allLogs).toContain('handler.ts');
      expect(allLogs).toContain('template.yaml');
      expect(allLogs).toContain('package.json');
    });
  });
});
