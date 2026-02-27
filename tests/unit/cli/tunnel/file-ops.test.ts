import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileOpsHandlers } from '../../../../src/cli/tunnel/handlers/file-ops.js';
import type { TunnelContext } from '../../../../src/cli/tunnel/dispatch.js';

let tmpDir: string;
let ctx: TunnelContext;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-ops-test-'));
  ctx = { workspaceRoot: tmpDir };
});

describe('file-ops handlers', () => {
  describe('getCWD / findProjectRoot', () => {
    it('returns /', async () => {
      expect(await fileOpsHandlers.getCWD({}, ctx)).toBe('/');
      expect(await fileOpsHandlers.findProjectRoot({}, ctx)).toBe('/');
    });
  });

  describe('getFile', () => {
    it('reads file content', async () => {
      await fs.writeFile(path.join(tmpDir, 'hello.txt'), 'hello world', 'utf-8');
      const result = await fileOpsHandlers.getFile({ filePath: '/hello.txt' }, ctx);
      expect(result).toBe('hello world');
    });

    it('throws when filePath is missing', async () => {
      await expect(fileOpsHandlers.getFile({}, ctx)).rejects.toThrow('filePath is required');
    });
  });

  describe('writeFile / saveFile', () => {
    it('writes a file and returns { saved: true }', async () => {
      const result = await fileOpsHandlers.writeFile(
        { filePath: '/new.txt', content: 'new content' },
        ctx,
      );
      expect(result).toEqual({ saved: true });
      const content = await fs.readFile(path.join(tmpDir, 'new.txt'), 'utf-8');
      expect(content).toBe('new content');
    });

    it('creates intermediate directories', async () => {
      await fileOpsHandlers.writeFile(
        { filePath: '/deep/nested/file.txt', content: 'deep' },
        ctx,
      );
      const content = await fs.readFile(path.join(tmpDir, 'deep', 'nested', 'file.txt'), 'utf-8');
      expect(content).toBe('deep');
    });

    it('saveFile is an alias for writeFile', async () => {
      const result = await fileOpsHandlers.saveFile(
        { filePath: '/alias.txt', content: 'aliased' },
        ctx,
      );
      expect(result).toEqual({ saved: true });
    });
  });

  describe('hasFile', () => {
    it('returns true for existing file', async () => {
      await fs.writeFile(path.join(tmpDir, 'exists.txt'), '', 'utf-8');
      expect(await fileOpsHandlers.hasFile({ filePath: '/exists.txt' }, ctx)).toBe(true);
    });

    it('returns false for non-existing file', async () => {
      expect(await fileOpsHandlers.hasFile({ filePath: '/nope.txt' }, ctx)).toBe(false);
    });

    it('returns false when filePath is missing', async () => {
      expect(await fileOpsHandlers.hasFile({}, ctx)).toBe(false);
    });
  });

  describe('deleteFile', () => {
    it('deletes a file and returns { deleted: true }', async () => {
      await fs.writeFile(path.join(tmpDir, 'del.txt'), 'bye', 'utf-8');
      const result = await fileOpsHandlers.deleteFile({ filePath: '/del.txt' }, ctx);
      expect(result).toEqual({ deleted: true });

      await expect(fs.access(path.join(tmpDir, 'del.txt'))).rejects.toThrow();
    });

    it('throws for non-existing file', async () => {
      await expect(
        fileOpsHandlers.deleteFile({ filePath: '/missing.txt' }, ctx),
      ).rejects.toThrow();
    });
  });

  describe('getFilesStructure', () => {
    it('returns files and directories recursively', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'root.ts'), '', 'utf-8');
      await fs.writeFile(path.join(tmpDir, 'src', 'index.ts'), '', 'utf-8');

      const result = (await fileOpsHandlers.getFilesStructure({}, ctx)) as Array<{
        path: string;
        type: string;
      }>;

      const paths = result.map((r) => r.path);
      expect(paths).toContain('/root.ts');
      expect(paths).toContain('/src');
      expect(paths).toContain('/src/index.ts');
    });

    it('skips node_modules and .git directories', async () => {
      await fs.mkdir(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'node_modules', 'pkg', 'index.js'), '', 'utf-8');
      await fs.writeFile(path.join(tmpDir, 'keep.ts'), '', 'utf-8');

      const result = (await fileOpsHandlers.getFilesStructure({}, ctx)) as Array<{
        path: string;
        type: string;
      }>;

      const paths = result.map((r) => r.path);
      expect(paths).toContain('/keep.ts');
      expect(paths).not.toContain('/node_modules');
    });
  });

  describe('listDirectory', () => {
    it('lists directory entries with metadata', async () => {
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content', 'utf-8');
      await fs.mkdir(path.join(tmpDir, 'subdir'));

      const result = (await fileOpsHandlers.listDirectory({}, ctx)) as Array<{
        name: string;
        path: string;
        type: string;
        isDirectory: boolean;
        size: number;
        modified: string;
      }>;

      const file = result.find((e) => e.name === 'file.txt');
      expect(file).toBeDefined();
      expect(file!.type).toBe('file');
      expect(file!.isDirectory).toBe(false);
      expect(file!.size).toBe(7);

      const dir = result.find((e) => e.name === 'subdir');
      expect(dir).toBeDefined();
      expect(dir!.type).toBe('directory');
      expect(dir!.isDirectory).toBe(true);
    });

    it('strips /cloud prefix from path', async () => {
      await fs.mkdir(path.join(tmpDir, 'sub'));
      await fs.writeFile(path.join(tmpDir, 'sub', 'a.ts'), '', 'utf-8');

      const result = (await fileOpsHandlers.listDirectory(
        { dirPath: '/cloud/sub' },
        ctx,
      )) as Array<{ name: string }>;

      expect(result.some((e) => e.name === 'a.ts')).toBe(true);
    });
  });

  describe('findWorkflows', () => {
    it('returns paths of .ts files in root', async () => {
      await fs.writeFile(path.join(tmpDir, 'workflow.ts'), '', 'utf-8');
      await fs.writeFile(path.join(tmpDir, 'readme.md'), '', 'utf-8');

      const result = (await fileOpsHandlers.findWorkflows({}, ctx)) as string[];
      expect(result).toContain('/workflow.ts');
      expect(result).not.toContain('/readme.md');
    });
  });

  describe('createFolder', () => {
    it('creates a directory', async () => {
      const result = await fileOpsHandlers.createFolder({ dirPath: '/new-dir' }, ctx);
      expect(result).toEqual({ created: true });

      const stat = await fs.stat(path.join(tmpDir, 'new-dir'));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('renameFile', () => {
    it('renames a file', async () => {
      await fs.writeFile(path.join(tmpDir, 'old.txt'), 'data', 'utf-8');
      const result = await fileOpsHandlers.renameFile(
        { oldPath: '/old.txt', newPath: '/new.txt' },
        ctx,
      );
      expect(result).toEqual({ renamed: true });

      const content = await fs.readFile(path.join(tmpDir, 'new.txt'), 'utf-8');
      expect(content).toBe('data');
    });
  });

  describe('getFileStats', () => {
    it('returns file stats', async () => {
      await fs.writeFile(path.join(tmpDir, 'stat.txt'), 'hello', 'utf-8');
      const result = (await fileOpsHandlers.getFileStats({ filePath: '/stat.txt' }, ctx)) as {
        size: number;
        isFile: boolean;
        isDirectory: boolean;
      };

      expect(result.size).toBe(5);
      expect(result.isFile).toBe(true);
      expect(result.isDirectory).toBe(false);
    });
  });

  describe('checkLibraryStatus', () => {
    it('returns installed: false when package is not present', async () => {
      const result = (await fileOpsHandlers.checkLibraryStatus({}, ctx)) as {
        installed: boolean;
      };
      expect(result.installed).toBe(false);
    });
  });

  describe('getPackages', () => {
    it('parses dependencies from package.json', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { lodash: '^4.0.0', express: '^5.0.0' } }),
        'utf-8',
      );

      const result = (await fileOpsHandlers.getPackages({}, ctx)) as Array<{
        name: string;
        version: string;
      }>;
      expect(result).toEqual([
        { name: 'lodash', version: '^4.0.0' },
        { name: 'express', version: '^5.0.0' },
      ]);
    });

    it('returns [] when no package.json exists', async () => {
      const result = await fileOpsHandlers.getPackages({}, ctx);
      expect(result).toEqual([]);
    });
  });
});
