/**
 * Guards the built CLI bundle against ESM/CJS breakage in bundled dependencies.
 *
 * Background: `scripts/build-cli.ts` bundles `src/cli/index.ts` into ESM:
 * `dist/cli/flow-weaver.mjs` and the `flow-weaver-*.mjs` chunks beside it. esbuild's own `lib/main.js` reads
 * `__filename` and `__dirname` to locate its native binary. Those do not exist
 * in an ESM bundle, so once esbuild was bundled in, `fw console` died at once
 * with `✗ __filename is not defined` while `npx tsx src/cli/index.ts console`
 * kept working. esbuild is a runtime dependency, so the fix is to keep it in
 * the `external` list and let Node resolve the installed copy.
 *
 * `fw console` is the regression trigger because it is the command that
 * actually reaches `await import('esbuild')` (see `devBuild` in
 * `src/console/server.ts`).
 *
 * The guard covers `__filename` only. Two `__dirname` uses survive in the
 * bundle and are deliberately not asserted on: a CommonJS fallback in
 * `serverInstallInfo` that the `import.meta.url` branch always wins, and
 * `source-map`'s `read-wasm.js`, which is reachable but only on its WASM path.
 * Neither is the reported regression; widening the assertion would fail the
 * build today.
 *
 * These tests run against the build output, so they skip when `dist/` is
 * absent (a fresh clone or a worktree that has not built). CI builds before
 * running the suite, so the guard still has teeth there.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(here, '..', '..');
const BUILT_CLI = path.join(PROJECT_ROOT, 'dist', 'cli', 'flow-weaver.mjs');
const hasBuild = fs.existsSync(BUILT_CLI);

// Strip VITEST* vars so the CLI entry guard does not skip program.parse().
const cliEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST')),
) as NodeJS.ProcessEnv;

/** A port unlikely to collide with a developer's own servers or a parallel worker. */
function pickPort(): number {
  return 4400 + (process.pid % 500);
}

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timed out')));
  });
}

/** Poll until the server answers, or give up. Returns the successful response. */
async function waitForServer(
  url: string,
  child: ChildProcess,
  getOutput: () => string,
  timeoutMs = 30000,
): Promise<{ status: number; body: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `console exited early (code ${child.exitCode}, signal ${child.signalCode}). Output:\n${getOutput()}`,
      );
    }
    try {
      return await get(url);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`server never answered ${url} (last error: ${lastError}). Output:\n${getOutput()}`);
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    // Don't hang the suite if the child ignores SIGTERM.
    setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5000).unref();
  });
}

describe.skipIf(!hasBuild)('built CLI bundle', () => {
  it('does not reference __filename, which is undefined in an ESM bundle', () => {
    // The bundle is split: the entry and its flow-weaver-*.mjs chunks beside it.
    const cliDir = path.dirname(BUILT_CLI);
    const files = fs.readdirSync(cliDir).filter((f) => /^flow-weaver.*\.mjs$/.test(f));
    expect(files).toContain('flow-weaver.mjs');
    const offenders = files.flatMap((file) =>
      fs.readFileSync(path.join(cliDir, file), 'utf-8').split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /(?<![\w$])__filename(?![\w$])/.test(line))
        .map(({ line, n }) => `${file}:${n}: ${line.trim().slice(0, 120)}`),
    );
    expect(
      offenders,
      'dist/cli/flow-weaver*.mjs references __filename, which does not exist in an ESM bundle. A ' +
        'CommonJS dependency was bundled into the ESM output; add it to the `external` list in ' +
        `scripts/build-cli.ts.\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps esbuild external so `fw console` can import it at runtime', () => {
    const script = fs.readFileSync(path.join(PROJECT_ROOT, 'scripts', 'build-cli.ts'), 'utf-8');
    expect(script).toMatch(/['"]esbuild['"]/);
  });

  it('starts `fw console` and serves the page', async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-console-binary-'));
    const port = pickPort();
    let output = '';
    const child = spawn(process.execPath, [BUILT_CLI, 'console', projectDir, '--port', String(port)], {
      cwd: PROJECT_ROOT,
      env: cliEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => (output += c));
    child.stderr?.on('data', (c: string) => (output += c));

    try {
      const res = await waitForServer(`http://127.0.0.1:${port}/`, child, () => output);
      expect(res.status).toBe(200);
      expect(res.body).toContain('<html');
      // The exact symptom of the bundled-esbuild regression.
      expect(output).not.toContain('__filename is not defined');
    } finally {
      await stop(child);
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  }, 60000);
});
