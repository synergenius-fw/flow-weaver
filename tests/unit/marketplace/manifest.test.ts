import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock glob
const mockGlob = vi.fn();
vi.mock('glob', () => ({
  glob: (...args: unknown[]) => mockGlob(...args),
}));

// Mock AnnotationParser
const mockParse = vi.fn();
vi.mock('../../../src/parser.js', () => {
  class MockAnnotationParser {
    parse(...args: unknown[]) {
      return mockParse(...args);
    }
  }
  return { AnnotationParser: MockAnnotationParser };
});

import {
  generateManifest,
  readManifest,
  writeManifest,
} from '../../../src/marketplace/manifest.js';
import type { TMarketplaceManifest } from '../../../src/marketplace/types.js';

describe('marketplace/manifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-manifest-test-'));
  });

  // ── generateManifest ──────────────────────────────────────────────────

  describe('generateManifest', () => {
    it('returns error when package.json is missing', async () => {
      const result = await generateManifest({ directory: tmpDir });

      expect(result.manifest.name).toBe('unknown');
      expect(result.manifest.version).toBe('0.0.0');
      expect(result.errors).toContain('package.json not found');
      expect(result.parsedFiles).toHaveLength(0);
    });

    it('generates manifest from parsed node types', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'flowweaver-pack-test',
          version: '1.2.3',
          description: 'Test pack',
        }),
      );
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

      const srcFile = path.join(tmpDir, 'src', 'nodes.ts');
      mockGlob.mockResolvedValue([srcFile]);

      mockParse.mockReturnValue({
        nodeTypes: [
          {
            name: 'MyNode',
            description: 'Does stuff',
            functionName: 'myNode',
            isAsync: false,
            inputs: {
              execute: { dataType: 'STEP', description: 'Trigger' },
              value: { dataType: 'STRING', optional: true },
            },
            outputs: {
              onSuccess: { dataType: 'STEP' },
              result: { dataType: 'NUMBER' },
            },
          },
        ],
        workflows: [],
        patterns: [],
        errors: [],
      });

      const result = await generateManifest({ directory: tmpDir });

      expect(result.manifest.name).toBe('flowweaver-pack-test');
      expect(result.manifest.version).toBe('1.2.3');
      expect(result.manifest.description).toBe('Test pack');
      expect(result.manifest.nodeTypes).toHaveLength(1);

      const nt = result.manifest.nodeTypes[0];
      expect(nt.name).toBe('MyNode');
      expect(nt.functionName).toBe('myNode');
      expect(nt.isAsync).toBe(false);
      expect(nt.inputs.execute.dataType).toBe('STEP');
      expect(nt.inputs.value.optional).toBe(true);
      expect(nt.outputs.result.dataType).toBe('NUMBER');
      expect(nt.file).toBe(path.join('dist', 'nodes.js'));
    });

    it('generates manifest from parsed workflows', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '0.1.0' }),
      );
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

      const srcFile = path.join(tmpDir, 'src', 'flows.ts');
      mockGlob.mockResolvedValue([srcFile]);

      mockParse.mockReturnValue({
        nodeTypes: [],
        workflows: [
          {
            name: 'EmailFlow',
            description: 'Sends emails',
            functionName: 'emailFlow',
            startPorts: {
              execute: { dataType: 'STEP' },
              to: { dataType: 'STRING' },
            },
            exitPorts: {
              onSuccess: { dataType: 'STEP' },
              status: { dataType: 'STRING' },
            },
            instances: [{ id: 'a' }, { id: 'b' }],
            connections: [{ from: {}, to: {} }],
          },
        ],
        patterns: [],
        errors: [],
      });

      const result = await generateManifest({ directory: tmpDir });

      expect(result.manifest.workflows).toHaveLength(1);
      const wf = result.manifest.workflows[0];
      expect(wf.name).toBe('EmailFlow');
      expect(wf.nodeCount).toBe(2);
      expect(wf.connectionCount).toBe(1);
      expect(wf.startPorts.to.dataType).toBe('STRING');
    });

    it('generates manifest from parsed patterns', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '0.1.0' }),
      );
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

      const srcFile = path.join(tmpDir, 'src', 'patterns.ts');
      mockGlob.mockResolvedValue([srcFile]);

      mockParse.mockReturnValue({
        nodeTypes: [],
        workflows: [],
        patterns: [
          {
            name: 'RetryPattern',
            description: 'Retries on failure',
            inputPorts: {
              input: { dataType: 'ANY', description: 'Input data' },
            },
            outputPorts: {
              output: { description: 'Output data' }, // no dataType, should default to ANY
            },
            instances: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
          },
        ],
        errors: [],
      });

      const result = await generateManifest({ directory: tmpDir });

      expect(result.manifest.patterns).toHaveLength(1);
      const pat = result.manifest.patterns[0];
      expect(pat.name).toBe('RetryPattern');
      expect(pat.nodeCount).toBe(3);
      expect(pat.inputPorts.input.dataType).toBe('ANY');
      expect(pat.outputPorts.output.dataType).toBe('ANY');
    });

    it('collects parse errors from individual files', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '0.1.0' }),
      );
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

      const srcFile = path.join(tmpDir, 'src', 'bad.ts');
      mockGlob.mockResolvedValue([srcFile]);

      mockParse.mockReturnValue({
        nodeTypes: [],
        workflows: [],
        patterns: [],
        errors: ['Missing @output annotation'],
      });

      const result = await generateManifest({ directory: tmpDir });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Missing @output annotation');
      expect(result.errors[0]).toContain(srcFile);
    });

    it('handles file parse exceptions gracefully', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '0.1.0' }),
      );
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

      const srcFile = path.join(tmpDir, 'src', 'crash.ts');
      mockGlob.mockResolvedValue([srcFile]);

      mockParse.mockImplementation(() => {
        throw new Error('Unexpected token');
      });

      const result = await generateManifest({ directory: tmpDir });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to parse');
      expect(result.errors[0]).toContain('Unexpected token');
    });

    it('filters out .d.ts and node_modules files from glob results', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '0.1.0' }),
      );
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

      mockGlob.mockResolvedValue([
        path.join(tmpDir, 'src', 'good.ts'),
        path.join(tmpDir, 'src', 'types.d.ts'),
        path.join(tmpDir, 'src', 'node_modules', 'dep.ts'),
      ]);

      mockParse.mockReturnValue({
        nodeTypes: [],
        workflows: [],
        patterns: [],
        errors: [],
      });

      const result = await generateManifest({ directory: tmpDir });
      // Only good.ts should be parsed
      expect(result.parsedFiles).toHaveLength(1);
      expect(result.parsedFiles[0]).toContain('good.ts');
    });

    it('includes dependencies from package.json', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          version: '1.0.0',
          dependencies: { axios: '^1.0.0', zod: '^3.0.0' },
        }),
      );
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

      mockGlob.mockResolvedValue([]);

      const result = await generateManifest({ directory: tmpDir });
      expect(result.manifest.dependencies).toBeDefined();
      expect(result.manifest.dependencies!.npm).toEqual({
        axios: '^1.0.0',
        zod: '^3.0.0',
      });
    });

    it('omits dependencies when none exist', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0' }),
      );
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

      mockGlob.mockResolvedValue([]);

      const result = await generateManifest({ directory: tmpDir });
      expect(result.manifest.dependencies).toBeUndefined();
    });

    it('includes engineVersion and categories from flowWeaver config', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          version: '1.0.0',
          flowWeaver: {
            engineVersion: '>=0.9.0',
            categories: ['ai', 'automation'],
          },
        }),
      );
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

      mockGlob.mockResolvedValue([]);

      const result = await generateManifest({ directory: tmpDir });
      expect(result.manifest.engineVersion).toBe('>=0.9.0');
      expect(result.manifest.categories).toEqual(['ai', 'automation']);
    });

    it('includes visuals when present on node types', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0' }),
      );
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

      const srcFile = path.join(tmpDir, 'src', 'visual.ts');
      mockGlob.mockResolvedValue([srcFile]);

      mockParse.mockReturnValue({
        nodeTypes: [
          {
            name: 'ColoredNode',
            functionName: 'coloredNode',
            isAsync: true,
            inputs: {},
            outputs: {},
            visuals: {
              color: '#ff0000',
              icon: 'zap',
              tags: [{ label: 'AI', color: 'blue' }],
            },
          },
        ],
        workflows: [],
        patterns: [],
        errors: [],
      });

      const result = await generateManifest({ directory: tmpDir });
      const nt = result.manifest.nodeTypes[0];
      expect(nt.visuals).toBeDefined();
      expect(nt.visuals!.color).toBe('#ff0000');
      expect(nt.visuals!.icon).toBe('zap');
      expect(nt.visuals!.tags).toHaveLength(1);
    });

    it('uses custom srcDir and distDir', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0' }),
      );
      fs.mkdirSync(path.join(tmpDir, 'lib'), { recursive: true });

      const srcFile = path.join(tmpDir, 'lib', 'node.ts');
      mockGlob.mockResolvedValue([srcFile]);

      mockParse.mockReturnValue({
        nodeTypes: [{
          name: 'N',
          functionName: 'n',
          isAsync: false,
          inputs: {},
          outputs: {},
        }],
        workflows: [],
        patterns: [],
        errors: [],
      });

      const result = await generateManifest({
        directory: tmpDir,
        srcDir: 'lib',
        distDir: 'build',
      });

      expect(result.manifest.nodeTypes[0].file).toBe(path.join('build', 'node.js'));
    });
  });

  // ── readManifest / writeManifest round-trip ────────────────────────────

  describe('readManifest / writeManifest', () => {
    it('writes and reads a manifest round-trip', () => {
      const manifest: TMarketplaceManifest = {
        manifestVersion: 1,
        name: 'flowweaver-pack-round-trip',
        version: '2.0.0',
        description: 'A test package',
        nodeTypes: [
          {
            name: 'TestNode',
            file: 'dist/test.js',
            functionName: 'testNode',
            isAsync: false,
            inputs: { x: { dataType: 'STRING' } },
            outputs: { y: { dataType: 'NUMBER' } },
          },
        ],
        workflows: [],
        patterns: [],
      };

      const outPath = writeManifest(tmpDir, manifest);
      expect(outPath).toBe(path.join(tmpDir, 'flowweaver.manifest.json'));
      expect(fs.existsSync(outPath)).toBe(true);

      const read = readManifest(tmpDir);
      expect(read).toEqual(manifest);
    });

    it('readManifest returns null when file does not exist', () => {
      const result = readManifest(path.join(tmpDir, 'nonexistent'));
      expect(result).toBeNull();
    });

    it('writeManifest creates properly formatted JSON with trailing newline', () => {
      const manifest: TMarketplaceManifest = {
        manifestVersion: 1,
        name: 'test',
        version: '1.0.0',
        nodeTypes: [],
        workflows: [],
        patterns: [],
      };

      const outPath = writeManifest(tmpDir, manifest);
      const content = fs.readFileSync(outPath, 'utf-8');
      expect(content.endsWith('\n')).toBe(true);
      // Should be pretty-printed
      expect(content).toContain('\n  ');
    });
  });
});
