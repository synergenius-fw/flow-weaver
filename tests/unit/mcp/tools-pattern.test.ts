import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Mock the API ─────────────────────────────────────────────────────────────
const mockParseWorkflow = vi.fn();
const mockValidateWorkflow = vi.fn();

vi.mock('../../../src/api/index.js', () => ({
  parseWorkflow: (...args: unknown[]) => mockParseWorkflow(...args),
  validateWorkflow: (...args: unknown[]) => mockValidateWorkflow(...args),
}));

// ── Mock patterns API ────────────────────────────────────────────────────────
const mockListPatterns = vi.fn();
const mockApplyPattern = vi.fn();
const mockFindWorkflows = vi.fn();
const mockExtractPattern = vi.fn();

vi.mock('../../../src/api/patterns.js', () => ({
  listPatterns: (...args: unknown[]) => mockListPatterns(...args),
  applyPattern: (...args: unknown[]) => mockApplyPattern(...args),
  findWorkflows: (...args: unknown[]) => mockFindWorkflows(...args),
  extractPattern: (...args: unknown[]) => mockExtractPattern(...args),
}));

// ── Mock generate-in-place ───────────────────────────────────────────────────
const mockGenerateInPlace = vi.fn();

vi.mock('../../../src/api/generate-in-place.js', () => ({
  generateInPlace: (...args: unknown[]) => mockGenerateInPlace(...args),
}));

// ── Mock migration registry ─────────────────────────────────────────────────
const mockApplyMigrations = vi.fn();
const mockGetRegisteredMigrations = vi.fn();

vi.mock('../../../src/migration/registry.js', () => ({
  applyMigrations: (...args: unknown[]) => mockApplyMigrations(...args),
  getRegisteredMigrations: (...args: unknown[]) => mockGetRegisteredMigrations(...args),
}));

// ── Mock describe command ────────────────────────────────────────────────────
const mockDescribeWorkflow = vi.fn();
const mockFormatDescribeOutput = vi.fn();

vi.mock('../../../src/cli/commands/describe.js', () => ({
  describeWorkflow: (...args: unknown[]) => mockDescribeWorkflow(...args),
  formatDescribeOutput: (...args: unknown[]) => mockFormatDescribeOutput(...args),
}));

// ── Mock manipulation functions ──────────────────────────────────────────────
const mockManipAddNode = vi.fn();
const mockManipRemoveNode = vi.fn();
const mockManipRenameNode = vi.fn();
const mockManipAddConnection = vi.fn();
const mockManipRemoveConnection = vi.fn();
const mockManipSetNodePosition = vi.fn();
const mockManipSetNodeLabel = vi.fn();

vi.mock('../../../src/api/manipulation.js', () => ({
  addNode: (...args: unknown[]) => mockManipAddNode(...args),
  removeNode: (...args: unknown[]) => mockManipRemoveNode(...args),
  renameNode: (...args: unknown[]) => mockManipRenameNode(...args),
  addConnection: (...args: unknown[]) => mockManipAddConnection(...args),
  removeConnection: (...args: unknown[]) => mockManipRemoveConnection(...args),
  setNodePosition: (...args: unknown[]) => mockManipSetNodePosition(...args),
  setNodeLabel: (...args: unknown[]) => mockManipSetNodeLabel(...args),
}));

// ── Mock query functions ─────────────────────────────────────────────────────
const mockFindIsolatedNodes = vi.fn();

vi.mock('../../../src/api/query.js', () => ({
  findIsolatedNodes: (...args: unknown[]) => mockFindIsolatedNodes(...args),
}));

// ── Mock annotation parser ──────────────────────────────────────────────────
const mockAnnotationParserParse = vi.fn();

vi.mock('../../../src/parser.js', () => {
  class MockAnnotationParser {
    parse(...args: unknown[]) {
      return mockAnnotationParserParse(...args);
    }
  }
  return { AnnotationParser: MockAnnotationParser };
});

// ── Mock glob ────────────────────────────────────────────────────────────────
const mockGlobSync = vi.fn();

vi.mock('glob', () => ({
  globSync: (...args: unknown[]) => mockGlobSync(...args),
}));

// ── Mock friendly errors ─────────────────────────────────────────────────────
vi.mock('../../../src/friendly-errors.js', () => ({
  getFriendlyError: () => null,
}));

// ── Mock MCP SDK ─────────────────────────────────────────────────────────────
const toolHandlers = new Map<string, (args: unknown) => Promise<unknown>>();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class MockMcpServer {
    tool(
      name: string,
      _description: string,
      _schema: Record<string, unknown>,
      handler: (args: unknown) => Promise<unknown>,
    ): void {
      toolHandlers.set(name, handler);
    }
  }
  return { McpServer: MockMcpServer };
});

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPatternTools } from '../../../src/mcp/tools-pattern.js';

function parseResult(result: unknown): { success: boolean; data?: unknown; error?: unknown } {
  const r = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

describe('tools-pattern', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    toolHandlers.clear();
    const mcp = new McpServer({ name: 'test', version: '1.0.0' });
    registerPatternTools(mcp);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-pattern-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── fw_list_patterns ───────────────────────────────────────────────────

  describe('fw_list_patterns', () => {
    function callListPatterns(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_list_patterns')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('returns patterns from a file', async () => {
      mockListPatterns.mockReturnValue([
        { name: 'retry', description: 'Retry pattern' },
        { name: 'circuit-breaker', description: 'Circuit breaker' },
      ]);

      const result = parseResult(await callListPatterns({ filePath: '/tmp/patterns.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as Array<{ name: string }>;
      expect(data).toHaveLength(2);
      expect(data[0].name).toBe('retry');
    });

    it('returns empty list when no patterns found', async () => {
      mockListPatterns.mockReturnValue([]);

      const result = parseResult(await callListPatterns({ filePath: '/tmp/empty.ts' }));
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns LIST_PATTERNS_ERROR on failure', async () => {
      mockListPatterns.mockImplementation(() => {
        throw new Error('file not found');
      });

      const result = parseResult(await callListPatterns({ filePath: '/tmp/bad.ts' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('LIST_PATTERNS_ERROR');
    });

    it('handles non-Error throws', async () => {
      mockListPatterns.mockImplementation(() => {
        throw 'string error';
      });

      const result = parseResult(await callListPatterns({ filePath: '/tmp/bad.ts' }));
      expect(result.success).toBe(false);
      expect((result.error as { message: string }).message).toContain('string error');
    });
  });

  // ── fw_apply_pattern ───────────────────────────────────────────────────

  describe('fw_apply_pattern', () => {
    function callApplyPattern(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_apply_pattern')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    function setupPatternMocks() {
      const targetFile = path.join(tmpDir, 'target.ts');
      fs.writeFileSync(targetFile, '// target workflow');

      mockAnnotationParserParse
        .mockReturnValueOnce({
          patterns: [{ name: 'retry', nodes: [], connections: [] }],
          nodeTypes: [],
        })
        .mockReturnValueOnce({
          patterns: [],
          nodeTypes: [{ name: 'ExistingType' }],
        });

      mockApplyPattern.mockReturnValue({
        modifiedContent: '// modified content',
        nodesAdded: ['retry1', 'retry2'],
        connectionsAdded: 2,
        nodeTypesAdded: ['RetryNode'],
        conflicts: [],
        wiringInstructions: 'Wire retry1.execute to your main node',
      });

      return targetFile;
    }

    it('applies a pattern and writes to target file', async () => {
      const targetFile = setupPatternMocks();

      const result = parseResult(
        await callApplyPattern({
          patternFile: '/tmp/patterns.ts',
          targetFile,
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as {
        success: boolean;
        nodesAdded: string[];
        connectionsAdded: number;
        nodeTypesAdded: string[];
        wiringInstructions: string;
      };
      expect(data.nodesAdded).toEqual(['retry1', 'retry2']);
      expect(data.connectionsAdded).toBe(2);
      expect(data.nodeTypesAdded).toEqual(['RetryNode']);

      const written = fs.readFileSync(targetFile, 'utf-8');
      expect(written).toBe('// modified content');
    });

    it('returns preview without writing when preview=true', async () => {
      const targetFile = setupPatternMocks();

      const result = parseResult(
        await callApplyPattern({
          patternFile: '/tmp/patterns.ts',
          targetFile,
          preview: true,
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { preview: boolean; content: string };
      expect(data.preview).toBe(true);
      expect(data.content).toBe('// modified content');

      // File should not be modified
      expect(fs.readFileSync(targetFile, 'utf-8')).toBe('// target workflow');
    });

    it('selects a named pattern when patternName is provided', async () => {
      const targetFile = path.join(tmpDir, 'target2.ts');
      fs.writeFileSync(targetFile, '// target');

      mockAnnotationParserParse
        .mockReturnValueOnce({
          patterns: [
            { name: 'retry', nodes: [] },
            { name: 'circuit', nodes: [] },
          ],
          nodeTypes: [],
        })
        .mockReturnValueOnce({
          patterns: [],
          nodeTypes: [],
        });

      mockApplyPattern.mockReturnValue({
        modifiedContent: '// circuit applied',
        nodesAdded: [],
        connectionsAdded: 0,
        nodeTypesAdded: [],
        conflicts: [],
        wiringInstructions: '',
      });

      await callApplyPattern({
        patternFile: '/tmp/patterns.ts',
        targetFile,
        patternName: 'circuit',
      });

      // Should have passed the second pattern
      expect(mockApplyPattern).toHaveBeenCalledWith(
        expect.objectContaining({
          patternAST: expect.objectContaining({ name: 'circuit' }),
        }),
      );
    });

    it('returns PATTERN_NOT_FOUND when no patterns in file', async () => {
      const targetFile = path.join(tmpDir, 'target3.ts');
      fs.writeFileSync(targetFile, '// target');

      mockAnnotationParserParse.mockReturnValueOnce({
        patterns: [],
        nodeTypes: [],
      });

      const result = parseResult(
        await callApplyPattern({
          patternFile: '/tmp/empty.ts',
          targetFile,
        }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PATTERN_NOT_FOUND');
    });

    it('returns PATTERN_NOT_FOUND when named pattern not found', async () => {
      const targetFile = path.join(tmpDir, 'target4.ts');
      fs.writeFileSync(targetFile, '// target');

      mockAnnotationParserParse.mockReturnValueOnce({
        patterns: [{ name: 'retry' }],
        nodeTypes: [],
      });

      const result = parseResult(
        await callApplyPattern({
          patternFile: '/tmp/patterns.ts',
          targetFile,
          patternName: 'missing',
        }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PATTERN_NOT_FOUND');
      expect((result.error as { message: string }).message).toContain('missing');
    });

    it('passes prefix to applyPattern', async () => {
      const targetFile = setupPatternMocks();

      await callApplyPattern({
        patternFile: '/tmp/patterns.ts',
        targetFile,
        prefix: 'retry_',
      });

      expect(mockApplyPattern).toHaveBeenCalledWith(
        expect.objectContaining({ prefix: 'retry_' }),
      );
    });

    it('returns APPLY_PATTERN_ERROR on failure', async () => {
      mockAnnotationParserParse.mockImplementation(() => {
        throw new Error('parse failed');
      });

      const result = parseResult(
        await callApplyPattern({
          patternFile: '/tmp/bad.ts',
          targetFile: '/tmp/target.ts',
        }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('APPLY_PATTERN_ERROR');
    });
  });

  // ── fw_find_workflows ──────────────────────────────────────────────────

  describe('fw_find_workflows', () => {
    function callFindWorkflows(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_find_workflows')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('returns discovered workflows', async () => {
      mockFindWorkflows.mockResolvedValue([
        { file: '/src/wf1.ts', name: 'emailWorkflow' },
        { file: '/src/wf2.ts', name: 'slackWorkflow' },
      ]);

      const result = parseResult(
        await callFindWorkflows({ directory: '/src' }),
      );
      expect(result.success).toBe(true);
      const data = result.data as Array<{ file: string; name: string }>;
      expect(data).toHaveLength(2);
    });

    it('passes glob pattern to findWorkflows', async () => {
      mockFindWorkflows.mockResolvedValue([]);

      await callFindWorkflows({ directory: '/src', pattern: '**/*.flow.ts' });
      expect(mockFindWorkflows).toHaveBeenCalledWith(
        expect.any(String),
        '**/*.flow.ts',
      );
    });

    it('returns FIND_WORKFLOWS_ERROR on failure', async () => {
      mockFindWorkflows.mockRejectedValue(new Error('permission denied'));

      const result = parseResult(
        await callFindWorkflows({ directory: '/forbidden' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('FIND_WORKFLOWS_ERROR');
    });
  });

  // ── fw_modify ──────────────────────────────────────────────────────────

  describe('fw_modify', () => {
    function callModify(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_modify')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    function setupModifyMocks(astOverrides?: Record<string, unknown>) {
      const wfFile = path.join(tmpDir, 'wf.ts');
      fs.writeFileSync(wfFile, '// source');

      const ast = {
        name: 'wf',
        nodeTypes: [
          {
            name: 'TypeA',
            functionName: 'typeA',
            inputs: { x: { dataType: 'STRING' }, execute: { dataType: 'STEP' } },
            outputs: { y: { dataType: 'NUMBER' }, onSuccess: { dataType: 'STEP' } },
          },
        ],
        instances: [
          { id: 'step1', nodeType: 'TypeA', config: { x: 100, y: 50 } },
        ],
        connections: [
          { from: { node: 'Start', port: 'execute' }, to: { node: 'step1', port: 'execute' } },
        ],
        options: {},
        ...astOverrides,
      };

      mockParseWorkflow.mockResolvedValue({
        errors: [],
        warnings: [],
        ast,
      });

      mockValidateWorkflow.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });

      mockDescribeWorkflow.mockReturnValue({});
      mockFormatDescribeOutput.mockReturnValue('Workflow: wf');

      return { wfFile, ast };
    }

    it('addNode: adds a node and writes the file', async () => {
      const { wfFile, ast } = setupModifyMocks();
      const modifiedAST = { ...ast, instances: [...ast.instances, { id: 'step2', nodeType: 'TypeA' }] };
      mockManipAddNode.mockReturnValue(modifiedAST);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// updated' });

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addNode',
          params: { nodeId: 'step2', nodeType: 'TypeA', x: 200, y: 100 },
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { success: boolean; hasChanges: boolean; operation: string };
      expect(data.hasChanges).toBe(true);
      expect(data.operation).toBe('addNode');
      expect(fs.readFileSync(wfFile, 'utf-8')).toBe('// updated');
    });

    it('addNode: auto-positions to the right of rightmost node', async () => {
      const { wfFile, ast } = setupModifyMocks();
      mockManipAddNode.mockReturnValue(ast);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// out' });

      await callModify({
        filePath: wfFile,
        operation: 'addNode',
        params: { nodeId: 'step2', nodeType: 'TypeA' },
      });

      // step1 is at x=100, so new node should be at x=280 (100+180)
      expect(mockManipAddNode).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          config: expect.objectContaining({ x: 280, y: 0 }),
        }),
      );
    });

    it('addNode: warns when nodeType is not defined', async () => {
      const { wfFile, ast } = setupModifyMocks();
      mockManipAddNode.mockReturnValue(ast);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// out' });

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addNode',
          params: { nodeId: 'step2', nodeType: 'UnknownType' },
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { warnings?: string[] };
      expect(data.warnings).toBeDefined();
      expect(data.warnings![0]).toContain('UnknownType');
    });

    it('removeNode: removes a node and reports removed connections', async () => {
      const { wfFile, ast } = setupModifyMocks();
      const stripped = { ...ast, instances: [], connections: [] };
      mockManipRemoveNode.mockReturnValue(stripped);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// removed' });

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'removeNode',
          params: { nodeId: 'step1' },
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { removedConnections?: Array<{ from: string; to: string }> };
      expect(data.removedConnections).toBeDefined();
      expect(data.removedConnections![0].from).toBe('Start.execute');
    });

    it('renameNode: renames a node', async () => {
      const { wfFile, ast } = setupModifyMocks();
      mockManipRenameNode.mockReturnValue(ast);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// renamed' });

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'renameNode',
          params: { oldId: 'step1', newId: 'renamedStep' },
        }),
      );

      expect(result.success).toBe(true);
      expect(mockManipRenameNode).toHaveBeenCalledWith(expect.anything(), 'step1', 'renamedStep');
    });

    it('addConnection: validates and adds a connection', async () => {
      const { wfFile, ast } = setupModifyMocks();
      mockManipAddConnection.mockReturnValue(ast);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// connected' });

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addConnection',
          params: { from: 'step1.onSuccess', to: 'Exit.onSuccess' },
        }),
      );

      expect(result.success).toBe(true);
    });

    it('addConnection: returns UNKNOWN_SOURCE_NODE when source not found', async () => {
      const { wfFile } = setupModifyMocks();

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addConnection',
          params: { from: 'ghost.out', to: 'step1.execute' },
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('UNKNOWN_SOURCE_NODE');
    });

    it('addConnection: returns UNKNOWN_TARGET_NODE when target not found', async () => {
      const { wfFile } = setupModifyMocks();

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addConnection',
          params: { from: 'Start.execute', to: 'ghost.execute' },
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('UNKNOWN_TARGET_NODE');
    });

    it('addConnection: returns UNKNOWN_SOURCE_PORT when port not found', async () => {
      const { wfFile } = setupModifyMocks();

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addConnection',
          params: { from: 'step1.noSuchPort', to: 'Exit.onSuccess' },
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('UNKNOWN_SOURCE_PORT');
    });

    it('addConnection: returns UNKNOWN_TARGET_PORT when input port not found', async () => {
      const { wfFile } = setupModifyMocks();

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addConnection',
          params: { from: 'Start.execute', to: 'step1.noSuchInput' },
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('UNKNOWN_TARGET_PORT');
    });

    it('addConnection: returns INVALID_PARAMS for missing port format', async () => {
      const { wfFile } = setupModifyMocks();

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addConnection',
          params: { from: 'Start', to: 'step1' },
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('INVALID_PARAMS');
    });

    it('removeConnection: removes a connection and reports isolated nodes', async () => {
      const { wfFile, ast } = setupModifyMocks();
      mockManipRemoveConnection.mockReturnValue(ast);
      mockFindIsolatedNodes.mockReturnValue(['step1']);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// disconnected' });

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'removeConnection',
          params: { from: 'Start.execute', to: 'step1.execute' },
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { newlyIsolatedNodes?: string[] };
      expect(data.newlyIsolatedNodes).toEqual(['step1']);
    });

    it('setNodePosition: updates node position', async () => {
      const { wfFile, ast } = setupModifyMocks();
      mockManipSetNodePosition.mockReturnValue(ast);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// positioned' });

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'setNodePosition',
          params: { nodeId: 'step1', x: 300, y: 200 },
        }),
      );

      expect(result.success).toBe(true);
      expect(mockManipSetNodePosition).toHaveBeenCalledWith(expect.anything(), 'step1', 300, 200);
    });

    it('setNodeLabel: updates node label', async () => {
      const { wfFile, ast } = setupModifyMocks();
      mockManipSetNodeLabel.mockReturnValue(ast);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// labeled' });

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'setNodeLabel',
          params: { nodeId: 'step1', label: 'My Step' },
        }),
      );

      expect(result.success).toBe(true);
      expect(mockManipSetNodeLabel).toHaveBeenCalledWith(expect.anything(), 'step1', 'My Step');
    });

    it('preview mode returns code without writing', async () => {
      const { wfFile, ast } = setupModifyMocks();
      mockManipAddNode.mockReturnValue(ast);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// preview code' });

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addNode',
          params: { nodeId: 'step2', nodeType: 'TypeA' },
          preview: true,
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { preview: boolean; code: string };
      expect(data.preview).toBe(true);
      expect(data.code).toBe('// preview code');

      // File should not be modified
      expect(fs.readFileSync(wfFile, 'utf-8')).toBe('// source');
    });

    it('returns INVALID_PARAMS for invalid operation params', async () => {
      const wfFile = path.join(tmpDir, 'wf2.ts');
      fs.writeFileSync(wfFile, '// source');

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addNode',
          params: {}, // missing nodeId and nodeType
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('INVALID_PARAMS');
    });

    it('returns PARSE_ERROR when file cannot be parsed', async () => {
      const wfFile = path.join(tmpDir, 'bad.ts');
      fs.writeFileSync(wfFile, '// broken');

      mockParseWorkflow.mockResolvedValue({
        errors: ['Unexpected token'],
        ast: null,
      });

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addNode',
          params: { nodeId: 'step1', nodeType: 'TypeA' },
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
    });

    it('returns UNKNOWN_OPERATION for invalid operation', async () => {
      const { wfFile } = setupModifyMocks();

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'magicTransform',
          params: {},
        }),
      );

      expect(result.success).toBe(false);
      // INVALID_PARAMS from schema validation, or UNKNOWN_OPERATION from the switch default
      expect((result.error as { code: string }).code).toMatch(/INVALID_PARAMS|UNKNOWN_OPERATION/);
    });

    it('returns MODIFY_ERROR on unexpected exception', async () => {
      const wfFile = path.join(tmpDir, 'crash.ts');
      fs.writeFileSync(wfFile, '// source');

      mockParseWorkflow.mockRejectedValue(new Error('crash'));

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addNode',
          params: { nodeId: 'x', nodeType: 'T' },
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('MODIFY_ERROR');
    });

    it('does not write when generateInPlace reports no changes', async () => {
      const { wfFile, ast } = setupModifyMocks();
      mockManipAddNode.mockReturnValue(ast);
      mockGenerateInPlace.mockReturnValue({ hasChanges: false, code: '// source' });

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addNode',
          params: { nodeId: 'step2', nodeType: 'TypeA' },
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { hasChanges: boolean };
      expect(data.hasChanges).toBe(false);
    });

    it('includes validation and description in response', async () => {
      const { wfFile, ast } = setupModifyMocks();
      mockManipAddNode.mockReturnValue(ast);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// out' });

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addNode',
          params: { nodeId: 'step2', nodeType: 'TypeA' },
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { validation?: object; description?: string };
      expect(data.validation).toBeDefined();
      expect(data.description).toBeDefined();
    });

    it('handles post-modify validation failure gracefully', async () => {
      const { wfFile, ast } = setupModifyMocks();
      mockManipAddNode.mockReturnValue(ast);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// out' });

      // Make the second parseWorkflow call (post-modify validation) throw
      mockParseWorkflow
        .mockResolvedValueOnce({ errors: [], warnings: [], ast })
        .mockRejectedValueOnce(new Error('validation crash'));

      const result = parseResult(
        await callModify({
          filePath: wfFile,
          operation: 'addNode',
          params: { nodeId: 'step2', nodeType: 'TypeA' },
        }),
      );

      // Operation should still succeed even though validation failed
      expect(result.success).toBe(true);
      const data = result.data as { warnings?: string[] };
      expect(data.warnings).toBeDefined();
      expect(data.warnings![0]).toContain('Post-modify validation failed');
    });
  });

  // ── fw_modify_batch ────────────────────────────────────────────────────

  describe('fw_modify_batch', () => {
    function callBatch(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_modify_batch')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    function setupBatchMocks() {
      const wfFile = path.join(tmpDir, 'batch.ts');
      fs.writeFileSync(wfFile, '// source');

      const ast = {
        name: 'wf',
        nodeTypes: [
          {
            name: 'TypeA',
            functionName: 'typeA',
            inputs: { x: { dataType: 'STRING' }, execute: { dataType: 'STEP' } },
            outputs: { y: { dataType: 'NUMBER' }, onSuccess: { dataType: 'STEP' } },
          },
        ],
        instances: [
          { id: 'step1', nodeType: 'TypeA', config: { x: 100, y: 50 } },
        ],
        connections: [],
        options: {},
      };

      mockParseWorkflow.mockResolvedValue({
        errors: [],
        warnings: [],
        ast,
      });

      mockValidateWorkflow.mockReturnValue({ valid: true, errors: [], warnings: [] });
      mockDescribeWorkflow.mockReturnValue({});
      mockFormatDescribeOutput.mockReturnValue('Workflow: wf');

      return { wfFile, ast };
    }

    it('applies multiple operations in sequence', async () => {
      const { wfFile, ast } = setupBatchMocks();

      const modifiedAST1 = { ...ast, instances: [...ast.instances, { id: 'step2', nodeType: 'TypeA' }] };
      const modifiedAST2 = { ...modifiedAST1, instances: [...modifiedAST1.instances, { id: 'step3', nodeType: 'TypeA' }] };

      mockManipAddNode
        .mockReturnValueOnce(modifiedAST1)
        .mockReturnValueOnce(modifiedAST2);

      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// batch output' });

      const result = parseResult(
        await callBatch({
          filePath: wfFile,
          operations: [
            { operation: 'addNode', params: { nodeId: 'step2', nodeType: 'TypeA' } },
            { operation: 'addNode', params: { nodeId: 'step3', nodeType: 'TypeA' } },
          ],
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { operationsApplied: number; hasChanges: boolean };
      expect(data.operationsApplied).toBe(2);
      expect(data.hasChanges).toBe(true);
    });

    it('returns preview without writing', async () => {
      const { wfFile, ast } = setupBatchMocks();
      mockManipAddNode.mockReturnValue(ast);
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// preview' });

      const result = parseResult(
        await callBatch({
          filePath: wfFile,
          operations: [
            { operation: 'addNode', params: { nodeId: 'step2', nodeType: 'TypeA' } },
          ],
          preview: true,
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { preview: boolean; code: string };
      expect(data.preview).toBe(true);
      expect(data.code).toBe('// preview');
      expect(fs.readFileSync(wfFile, 'utf-8')).toBe('// source');
    });

    it('pre-validates all params before applying any', async () => {
      const { wfFile } = setupBatchMocks();

      const result = parseResult(
        await callBatch({
          filePath: wfFile,
          operations: [
            { operation: 'addNode', params: { nodeId: 'ok', nodeType: 'TypeA' } },
            { operation: 'addNode', params: {} }, // invalid - missing nodeId
          ],
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('INVALID_PARAMS');
      expect((result.error as { message: string }).message).toContain('Operation 1');
      // No manipulations should have been called
      expect(mockManipAddNode).not.toHaveBeenCalled();
    });

    it('returns MODIFY_ERROR when an operation fails mid-batch', async () => {
      const { wfFile } = setupBatchMocks();

      mockManipAddNode.mockImplementation(() => {
        throw new Error('manipulation crash');
      });

      const result = parseResult(
        await callBatch({
          filePath: wfFile,
          operations: [
            { operation: 'addNode', params: { nodeId: 'step2', nodeType: 'TypeA' } },
          ],
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('MODIFY_ERROR');
      expect((result.error as { message: string }).message).toContain('Operation 0');
    });

    it('returns PARSE_ERROR when file cannot be parsed', async () => {
      const wfFile = path.join(tmpDir, 'bad-batch.ts');
      fs.writeFileSync(wfFile, '// broken');

      mockParseWorkflow.mockResolvedValue({
        errors: ['Syntax error'],
        ast: null,
      });

      const result = parseResult(
        await callBatch({
          filePath: wfFile,
          operations: [
            { operation: 'addNode', params: { nodeId: 'step1', nodeType: 'T' } },
          ],
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
    });

    it('returns MODIFY_ERROR on outer exception', async () => {
      const wfFile = path.join(tmpDir, 'crash-batch.ts');
      fs.writeFileSync(wfFile, '// source');

      mockParseWorkflow.mockRejectedValue(new Error('crash'));

      const result = parseResult(
        await callBatch({
          filePath: wfFile,
          operations: [
            { operation: 'addNode', params: { nodeId: 'x', nodeType: 'T' } },
          ],
        }),
      );

      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('MODIFY_ERROR');
    });
  });

  // ── fw_extract_pattern ─────────────────────────────────────────────────

  describe('fw_extract_pattern', () => {
    function callExtract(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_extract_pattern')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('extracts a pattern and returns preview (no outputFile)', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: { name: 'wf', nodeTypes: [], instances: [], connections: [] },
      });
      mockAnnotationParserParse.mockReturnValue({
        nodeTypes: [{ name: 'TypeA' }],
      });
      mockExtractPattern.mockReturnValue({
        patternName: 'extracted',
        patternCode: '// pattern code',
        nodes: ['step1', 'step2'],
        inputPorts: [{ nodeId: 'step1', port: 'x' }],
        outputPorts: [{ nodeId: 'step2', port: 'y' }],
        internalConnectionCount: 1,
      });

      const result = parseResult(
        await callExtract({
          sourceFile: '/tmp/wf.ts',
          nodes: 'step1, step2',
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as {
        preview: boolean;
        patternName: string;
        code: string;
        nodes: string[];
      };
      expect(data.preview).toBe(true);
      expect(data.patternName).toBe('extracted');
      expect(data.code).toBe('// pattern code');
      expect(data.nodes).toEqual(['step1', 'step2']);
    });

    it('writes pattern to outputFile when specified', async () => {
      const outFile = path.join(tmpDir, 'pattern.ts');
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: { name: 'wf' },
      });
      mockAnnotationParserParse.mockReturnValue({
        nodeTypes: [],
      });
      mockExtractPattern.mockReturnValue({
        patternName: 'myPattern',
        patternCode: '// extracted pattern',
        nodes: ['a'],
        inputPorts: [],
        outputPorts: [],
        internalConnectionCount: 0,
      });

      const result = parseResult(
        await callExtract({
          sourceFile: '/tmp/wf.ts',
          nodes: 'a',
          outputFile: outFile,
        }),
      );

      expect(result.success).toBe(true);
      const data = result.data as { filePath: string; patternName: string };
      expect(data.filePath).toBe(outFile);
      expect(data.patternName).toBe('myPattern');
      expect(fs.readFileSync(outFile, 'utf-8')).toBe('// extracted pattern');
    });

    it('passes custom pattern name', async () => {
      mockParseWorkflow.mockResolvedValue({ errors: [], ast: {} });
      mockAnnotationParserParse.mockReturnValue({ nodeTypes: [] });
      mockExtractPattern.mockReturnValue({
        patternName: 'customName',
        patternCode: 'code',
        nodes: ['x'],
        inputPorts: [],
        outputPorts: [],
        internalConnectionCount: 0,
      });

      await callExtract({
        sourceFile: '/tmp/wf.ts',
        nodes: 'x',
        name: 'customName',
      });

      expect(mockExtractPattern).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'customName' }),
      );
    });

    it('returns PARSE_ERROR when source file has errors', async () => {
      mockParseWorkflow.mockResolvedValue({
        errors: ['Bad syntax'],
        ast: null,
      });

      const result = parseResult(
        await callExtract({ sourceFile: '/tmp/bad.ts', nodes: 'x' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('PARSE_ERROR');
    });

    it('returns EXTRACT_PATTERN_ERROR on exception', async () => {
      mockParseWorkflow.mockRejectedValue(new Error('crash'));

      const result = parseResult(
        await callExtract({ sourceFile: '/tmp/wf.ts', nodes: 'x' }),
      );
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('EXTRACT_PATTERN_ERROR');
    });
  });

  // ── fw_migrate ─────────────────────────────────────────────────────────

  describe('fw_migrate', () => {
    function callMigrate(args: Record<string, unknown>) {
      const handler = toolHandlers.get('fw_migrate')!;
      expect(handler).toBeDefined();
      return handler(args);
    }

    it('migrates files that have changes', async () => {
      const file1 = path.join(tmpDir, 'wf1.ts');
      const file2 = path.join(tmpDir, 'wf2.ts');
      fs.writeFileSync(file1, '// old syntax');
      fs.writeFileSync(file2, '// current syntax');

      mockGlobSync.mockReturnValue([file1, file2]);

      mockParseWorkflow
        .mockResolvedValueOnce({
          errors: [],
          ast: { name: 'wf1' },
          allWorkflows: [],
        })
        .mockResolvedValueOnce({
          errors: [],
          ast: { name: 'wf2' },
          allWorkflows: [],
        });

      mockApplyMigrations
        .mockReturnValueOnce({ name: 'wf1-migrated' })
        .mockReturnValueOnce({ name: 'wf2' });

      mockGenerateInPlace
        .mockReturnValueOnce({ hasChanges: true, code: '// new syntax' })
        .mockReturnValueOnce({ hasChanges: false, code: '// current syntax' });

      mockGetRegisteredMigrations.mockReturnValue(['migration-1', 'migration-2']);

      const result = parseResult(await callMigrate({ glob: 'src/**/*.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as {
        dryRun: boolean;
        summary: { migrated: number; current: number; errors: number; total: number };
        files: Array<{ status: string }>;
      };
      expect(data.dryRun).toBe(false);
      expect(data.summary.migrated).toBe(1);
      expect(data.summary.current).toBe(1);
      expect(data.summary.total).toBe(2);

      // File should have been written
      expect(fs.readFileSync(file1, 'utf-8')).toBe('// new syntax');
    });

    it('dryRun mode does not write files', async () => {
      const file = path.join(tmpDir, 'wf.ts');
      fs.writeFileSync(file, '// old');

      mockGlobSync.mockReturnValue([file]);
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: { name: 'wf' },
        allWorkflows: [],
      });
      mockApplyMigrations.mockReturnValue({ name: 'wf' });
      mockGenerateInPlace.mockReturnValue({ hasChanges: true, code: '// new' });
      mockGetRegisteredMigrations.mockReturnValue([]);

      const result = parseResult(await callMigrate({ glob: '*.ts', dryRun: true }));
      expect(result.success).toBe(true);
      const data = result.data as { dryRun: boolean; summary: { migrated: number } };
      expect(data.dryRun).toBe(true);
      expect(data.summary.migrated).toBe(1);

      // File should NOT have been written
      expect(fs.readFileSync(file, 'utf-8')).toBe('// old');
    });

    it('handles files with parse errors', async () => {
      const file = path.join(tmpDir, 'bad.ts');
      fs.writeFileSync(file, '// broken');

      mockGlobSync.mockReturnValue([file]);
      mockParseWorkflow.mockResolvedValue({
        errors: ['Syntax error'],
        ast: null,
      });
      mockGetRegisteredMigrations.mockReturnValue([]);

      const result = parseResult(await callMigrate({ glob: '*.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as {
        summary: { errors: number };
        files: Array<{ status: string; error?: string }>;
      };
      expect(data.summary.errors).toBe(1);
      expect(data.files[0].status).toBe('error');
    });

    it('returns empty result when no files match', async () => {
      mockGlobSync.mockReturnValue([]);

      const result = parseResult(await callMigrate({ glob: 'nonexistent/**/*.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { message: string; files: unknown[] };
      expect(data.message).toContain('No files matched');
      expect(data.files).toEqual([]);
    });

    it('returns MIGRATE_ERROR on outer exception', async () => {
      mockGlobSync.mockImplementation(() => {
        throw new Error('glob crash');
      });

      const result = parseResult(await callMigrate({ glob: '*.ts' }));
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('MIGRATE_ERROR');
    });

    it('handles per-file exceptions gracefully', async () => {
      const file = path.join(tmpDir, 'throw.ts');
      fs.writeFileSync(file, '// source');

      mockGlobSync.mockReturnValue([file]);
      mockParseWorkflow.mockResolvedValue({
        errors: [],
        ast: { name: 'wf' },
        allWorkflows: [],
      });
      mockApplyMigrations.mockImplementation(() => {
        throw new Error('migration crash');
      });
      mockGetRegisteredMigrations.mockReturnValue([]);

      const result = parseResult(await callMigrate({ glob: '*.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { files: Array<{ status: string; error?: string }> };
      expect(data.files[0].status).toBe('error');
      expect(data.files[0].error).toContain('migration crash');
    });
  });
});
