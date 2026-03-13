/**
 * Tests for src/api/command-runner.ts
 * Covers runCommand dispatch, getAvailableCommands, and individual handlers.
 */

import * as path from 'path';
import * as fs from 'node:fs';
import { runCommand, getAvailableCommands } from '../../src/api/command-runner';

const fixtureFile = path.resolve(__dirname, '../../fixtures/basic/example.ts');

describe('command-runner', () => {
  describe('getAvailableCommands', () => {
    it('should return all registered command names', () => {
      const commands = getAvailableCommands();
      expect(commands).toContain('compile');
      expect(commands).toContain('validate');
      expect(commands).toContain('describe');
      expect(commands).toContain('diagram');
      expect(commands).toContain('mermaid');
      expect(commands).toContain('diff');
      expect(commands).toContain('context');
      expect(commands).toContain('modify');
      expect(commands).toContain('add-node');
      expect(commands).toContain('remove-node');
      expect(commands).toContain('add-connection');
      expect(commands).toContain('remove-connection');
      expect(commands).toContain('scaffold');
      expect(commands).toContain('query');
      expect(commands).toContain('run');
    });
  });

  describe('runCommand - unknown command', () => {
    it('should throw for unknown command names', async () => {
      await expect(runCommand('nonexistent', {})).rejects.toThrow('Unknown command: nonexistent');
    });

    it('should list available commands in the error message', async () => {
      await expect(runCommand('bogus', {})).rejects.toThrow('Available:');
    });
  });

  describe('validate command', () => {
    it('should validate a valid workflow file', async () => {
      const result = await runCommand('validate', { file: fixtureFile });
      expect(result.data).toBeDefined();
      const data = result.data as { valid: boolean; errors: string[]; warnings: string[] };
      expect(typeof data.valid).toBe('boolean');
      expect(Array.isArray(data.errors)).toBe(true);
      expect(Array.isArray(data.warnings)).toBe(true);
    });

    it('should report parse errors for invalid file', async () => {
      const badFile = path.resolve(__dirname, '../../fixtures/basic/does-not-exist.ts');
      const result = await runCommand('validate', { file: badFile });
      const data = result.data as { valid: boolean; errors: string[] };
      expect(data.valid).toBe(false);
      expect(data.errors.length).toBeGreaterThan(0);
    });
  });

  describe('describe command', () => {
    it('should describe a valid workflow', async () => {
      const result = await runCommand('describe', { file: fixtureFile });
      expect(result.output).toBeDefined();
      expect(typeof result.output).toBe('string');
    });
  });

  describe('diagram command', () => {
    it('should generate ASCII diagram by default', async () => {
      const result = await runCommand('diagram', { file: fixtureFile });
      expect(result.output).toBeDefined();
      expect(typeof result.output).toBe('string');
    });

    it('should generate SVG diagram when format=svg', async () => {
      const result = await runCommand('diagram', { file: fixtureFile, format: 'svg' });
      expect(result.output).toBeDefined();
      expect(result.output).toContain('<svg');
    });
  });

  describe('mermaid command', () => {
    it('should generate mermaid output for a valid workflow', async () => {
      const result = await runCommand('mermaid', { file: fixtureFile });
      expect(result.output).toBeDefined();
      expect(typeof result.output).toBe('string');
    });
  });

  describe('context command', () => {
    it('should return context output without preset', async () => {
      const result = await runCommand('context', {});
      expect(result.output).toBeDefined();
      expect(typeof result.output).toBe('string');
    });

    it('should return context output with core preset', async () => {
      const result = await runCommand('context', { preset: 'core' });
      expect(result.output).toBeDefined();
    });
  });

  describe('query command', () => {
    it('should query nodes', async () => {
      const result = await runCommand('query', { file: fixtureFile, query: 'nodes' });
      const data = result.data as { nodes: unknown[] };
      expect(Array.isArray(data.nodes)).toBe(true);
    });

    it('should query connections', async () => {
      const result = await runCommand('query', { file: fixtureFile, query: 'connections' });
      const data = result.data as { connections: unknown[] };
      expect(Array.isArray(data.connections)).toBe(true);
    });

    it('should query isolated nodes', async () => {
      const result = await runCommand('query', { file: fixtureFile, query: 'isolated' });
      const data = result.data as { isolated: unknown[] };
      expect(Array.isArray(data.isolated)).toBe(true);
    });

    it('should query dead-ends', async () => {
      const result = await runCommand('query', { file: fixtureFile, query: 'dead-ends' });
      const data = result.data as { deadEnds: unknown[] };
      expect(Array.isArray(data.deadEnds)).toBe(true);
    });

    it('should query topology', async () => {
      const result = await runCommand('query', { file: fixtureFile, query: 'topology' });
      const data = result.data as { order: unknown[] };
      expect(Array.isArray(data.order)).toBe(true);
    });

    it('should query stats', async () => {
      const result = await runCommand('query', { file: fixtureFile, query: 'stats' });
      const data = result.data as { nodeCount: number; connectionCount: number };
      expect(typeof data.nodeCount).toBe('number');
      expect(typeof data.connectionCount).toBe('number');
    });

    it('should throw for unknown query type', async () => {
      await expect(
        runCommand('query', { file: fixtureFile, query: 'unknown-query' })
      ).rejects.toThrow('Unknown query type: unknown-query');
    });
  });

  describe('compile command', () => {
    it('should compile a workflow file', async () => {
      // Work on a copy so we don't modify the fixture
      const tmpDir = path.resolve(__dirname, '../../tests/temp-compile');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, 'cmd-runner-compile-test.ts');
      fs.copyFileSync(fixtureFile, tmpFile);

      try {
        const result = await runCommand('compile', { file: tmpFile });
        expect(result.files).toBeDefined();
        expect(result.files).toContain(tmpFile);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('diff command', () => {
    it('should diff two workflow files', async () => {
      const result = await runCommand('diff', {
        fileA: fixtureFile,
        fileB: fixtureFile,
      });
      expect(result.output).toBeDefined();
      expect(typeof result.output).toBe('string');
    });

    it('should support json format', async () => {
      const result = await runCommand('diff', {
        fileA: fixtureFile,
        fileB: fixtureFile,
        format: 'json',
      });
      expect(result.output).toBeDefined();
    });

    it('should support cwd-relative paths', async () => {
      const dir = path.dirname(fixtureFile);
      const basename = path.basename(fixtureFile);
      const result = await runCommand('diff', {
        fileA: basename,
        fileB: basename,
        cwd: dir,
      });
      expect(result.output).toBeDefined();
    });
  });

  describe('scaffold command', () => {
    it('should scaffold a workflow file from template', async () => {
      const tmpDir = path.resolve(__dirname, '../../tests/temp-compile');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, 'scaffolded-workflow.ts');

      try {
        const result = await runCommand('scaffold', {
          file: tmpFile,
          template: 'sequential',
        });
        expect(result.files).toContain(tmpFile);
        expect(fs.existsSync(tmpFile)).toBe(true);
        const content = fs.readFileSync(tmpFile, 'utf-8');
        expect(content.length).toBeGreaterThan(0);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('modify command', () => {
    it('should reject invalid modify operation params', async () => {
      const tmpDir = path.resolve(__dirname, '../../tests/temp-compile');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, 'modify-test.ts');
      fs.copyFileSync(fixtureFile, tmpFile);

      try {
        // Missing required params should fail validation
        await expect(
          runCommand('modify', { file: tmpFile, operation: 'addNode', params: {} })
        ).rejects.toThrow();
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('add-node command', () => {
    it('should add a node to a workflow file', async () => {
      const tmpDir = path.resolve(__dirname, '../../tests/temp-compile');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, 'add-node-test.ts');
      fs.copyFileSync(fixtureFile, tmpFile);

      try {
        const result = await runCommand('add-node', {
          file: tmpFile,
          nodeId: 'newNode',
          nodeType: 'add',
        });
        expect(result.files).toContain(tmpFile);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('remove-node command', () => {
    it('should remove a node from a workflow file', async () => {
      const tmpDir = path.resolve(__dirname, '../../tests/temp-compile');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, 'remove-node-test.ts');
      fs.copyFileSync(fixtureFile, tmpFile);

      try {
        const result = await runCommand('remove-node', {
          file: tmpFile,
          nodeId: 'adder',
        });
        expect(result.files).toContain(tmpFile);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('add-connection command', () => {
    it('should add a connection to a workflow file', async () => {
      const tmpDir = path.resolve(__dirname, '../../tests/temp-compile');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, 'add-conn-test.ts');
      fs.copyFileSync(fixtureFile, tmpFile);

      try {
        const result = await runCommand('add-connection', {
          file: tmpFile,
          from: 'adder.sum',
          to: 'Exit.result',
        });
        expect(result.files).toContain(tmpFile);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('remove-connection command', () => {
    it('should remove a connection from a workflow file', async () => {
      const tmpDir = path.resolve(__dirname, '../../tests/temp-compile');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, 'remove-conn-test.ts');
      fs.copyFileSync(fixtureFile, tmpFile);

      try {
        const result = await runCommand('remove-connection', {
          file: tmpFile,
          from: 'adder.sum',
          to: 'multiplier.value',
        });
        expect(result.files).toContain(tmpFile);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('resolveFile with cwd', () => {
    it('should resolve relative file paths using cwd', async () => {
      const dir = path.dirname(fixtureFile);
      const basename = path.basename(fixtureFile);
      const result = await runCommand('validate', { file: basename, cwd: dir });
      expect(result.data).toBeDefined();
    });
  });
});
