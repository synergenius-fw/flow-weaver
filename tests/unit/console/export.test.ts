/**
 * Export from the console: the targets a project's packs provide, an
 * export previewed and then written, and the target's own instructions.
 *
 * The target is a fake pack in a temp project, since core ships none.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { listTargets, runExport, defaultOutputDir } from '../../../src/console/export';
import { exportWorkflow } from '../../../src/export/index';

const useCases = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'use-cases');
const hello = path.join(useCases, 'hello-world.ts');

let project: string;

beforeAll(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-export-'));
  const dir = path.join(project, 'node_modules', 'flow-weaver-pack-echo');
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'flow-weaver-pack-echo', version: '0.1.0' }));
  fs.writeFileSync(path.join(dir, 'flowweaver.manifest.json'), JSON.stringify({
    manifestVersion: 2, name: 'flow-weaver-pack-echo', version: '0.1.0', nodeTypes: [], workflows: [], patterns: [],
    exportTargets: [{ name: 'echo', description: 'Writes the workflow name to a file', file: 'dist/target.js', exportName: 'EchoTarget' }],
  }));
  // A CommonJS module: the loader imports it by file URL, and node reads
  // `exports.X =` as a named export.
  fs.writeFileSync(path.join(dir, 'dist', 'target.js'), `
    class EchoTarget {
      constructor() { this.name = 'echo'; this.description = 'Writes the workflow name to a file'; this.deploySchema = { region: { type: 'string', description: 'Where it runs', default: 'eu' } }; }
      async generate(options) {
        return { target: 'echo', workflowName: options.workflowName, entryPoint: 'echo.txt', warnings: ['just a test'],
          files: [{ relativePath: 'echo.txt', absolutePath: options.outputDir + '/echo.txt', content: 'exported ' + options.workflowName, type: 'other' }] };
      }
      getDeployInstructions(artifacts) { return { title: 'Deploy ' + artifacts.workflowName, steps: ['cat ' + artifacts.entryPoint], prerequisites: [] }; }
    }
    exports.EchoTarget = EchoTarget;
  `);
});
afterAll(() => { fs.rmSync(project, { recursive: true, force: true }); });

describe('listTargets', () => {
  it('names each target with the pack it came from and the keys it reads', async () => {
    const targets = await listTargets(project);
    expect(targets).toEqual([{
      name: 'echo', description: 'Writes the workflow name to a file', pack: 'flow-weaver-pack-echo',
      deploySchema: { region: { type: 'string', description: 'Where it runs', default: 'eu' } },
    }]);
  });

  it('is empty where no pack provides one', async () => {
    expect(await listTargets(path.join(project, 'nowhere'))).toEqual([]);
  });
});

describe('runExport', () => {
  it('previews without writing, then writes where asked and returns the instructions', async () => {
    const out = path.join(project, 'out');
    const preview = await runExport(project, { file: hello, name: 'helloWorld', target: 'echo', outputDir: out, preview: true });
    expect(preview.written).toBe(false);
    expect(preview.files).toEqual([{ path: 'echo.txt', content: 'exported helloWorld' }]);
    expect(preview.warnings).toEqual(['just a test']);
    expect(preview.instructions).toMatchObject({ title: 'Deploy helloWorld', steps: ['cat echo.txt'] });
    expect(fs.existsSync(path.join(out, 'echo.txt'))).toBe(false);

    const written = await runExport(project, { file: hello, name: 'helloWorld', target: 'echo', outputDir: out, preview: false });
    expect(written.written).toBe(true);
    expect(fs.readFileSync(path.join(out, 'echo.txt'), 'utf8')).toBe('exported helloWorld');
  }, 60000);

  it('lands beside the file, under dist/<target>, unless told otherwise', () => {
    expect(defaultOutputDir('/p/flows/a.ts', 'echo')).toBe(path.join('/p/flows', 'dist', 'echo'));
  });

  it('names the installed targets when asked for one that is not', async () => {
    await expect(runExport(project, { file: hello, name: 'helloWorld', target: 'nope', preview: true })).rejects.toThrow(/Installed: echo/);
  });
});

describe('exportWorkflow projectDir', () => {
  it('finds targets in the given project rather than the working directory', async () => {
    // The working directory has no packs; the temp project has the echo target.
    await expect(exportWorkflow({ target: 'echo', input: hello, output: path.join(project, 'cwd-out'), dryRun: true }))
      .rejects.toThrow(/No export targets installed|Unknown target/);
    const r = await exportWorkflow({ target: 'echo', input: hello, output: path.join(project, 'cwd-out'), dryRun: true, projectDir: project });
    expect(r.workflow).toBe('helloWorld');
  }, 60000);
});
