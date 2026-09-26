/**
 * The fixture every console test starts from: a project of its own in a temp
 * directory, a console over it in a process of its own, and a page open on
 * that console.
 *
 * The project holds a plain workflow, a durable one with an approval gate
 * (both from `tests/continuation/fixtures`), one that parses but names a node
 * type that does not exist, and one that does not parse.
 */
import { test as base, expect, type Locator } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fixtures = path.join(root, 'tests', 'continuation', 'fixtures');

const UNKNOWN_TYPE = `/**
 * @flowWeaver workflow
 * @node first missingType
 * @connect Start.value -> first.value
 * @connect first.result -> Exit.result
 */
export async function unknownStep(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Flow Weaver must generate this body');
}
`;

const DOES_NOT_PARSE = `/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 */
function addOne(execute: boolean, value: number) {
  return { onSuccess: execute, onFailure: false, result: value + 1 };
}

/**
 * @flowWeaver workflow
 * @node step addOne
 * @path Start -> nowhere -> Exit
 */
export async function halfWritten(
  execute: boolean,
  params: { value: number },
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Flow Weaver must generate this body');
}
`;

function makeProject(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-console-e2e-')));
  fs.mkdirSync(path.join(dir, 'flows'));
  fs.mkdirSync(path.join(dir, 'drafts'));
  fs.copyFileSync(path.join(fixtures, 'sequential.ts'), path.join(dir, 'flows', 'sequential.ts'));
  fs.copyFileSync(path.join(fixtures, 'durable-approval.ts'), path.join(dir, 'flows', 'approval.ts'));
  fs.writeFileSync(path.join(dir, 'flows', 'unknown-step.ts'), UNKNOWN_TYPE);
  fs.writeFileSync(path.join(dir, 'drafts', 'half-written.ts'), DOES_NOT_PARSE);
  return dir;
}

/** Start `e2e/serve.mjs` and wait for the line that says where it listens. */
function startConsole(projectDir: string): Promise<{ url: string; child: ChildProcess }> {
  const server = path.join(here, 'serve.mjs');
  if (!fs.existsSync(path.join(root, 'dist', 'console', 'server.js'))) {
    throw new Error('dist/console is missing: run `npm run build` before `npm run test:e2e`');
  }
  const child = spawn(process.execPath, [server, projectDir], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the console did not start in time\n${err}`)); }, 30_000);
    child.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const line = out.split('\n').find((l) => l.startsWith('{'));
      if (!line) return;
      clearTimeout(timer);
      resolve({ url: (JSON.parse(line) as { url: string }).url, child });
    });
    child.stderr!.on('data', (chunk: Buffer) => { err += chunk.toString(); });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the console exited with ${code}\n${err}`)); });
  });
}

function stopConsole(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.once('exit', () => { clearTimeout(force); resolve(); });
    child.kill('SIGTERM');
  });
}

export interface ConsoleUnderTest {
  /** Where the console listens, `http://127.0.0.1:<port>`. */
  url: string;
  /** The project it is open on. */
  dir: string;
  /** Open the console on a route: a workflow's `<rel>/<name>`, `doc/<slug>`, or nothing for the front page. */
  open(route?: string): Promise<void>;
  /** The left column: the workflows, the guide, the packs. */
  navigator: Locator;
  /** The right column: the run form, the run, the step, the issues. */
  inspector: Locator;
  /** The centre: the header and the process. */
  main: Locator;
}

export const test = base.extend<{ fw: ConsoleUnderTest }>({
  fw: async ({ page }, use) => {
    const dir = makeProject();
    const { url, child } = await startConsole(dir);
    // The icon font comes from Google Fonts. The tests do not need it, and a
    // request to the network is a way for a test to be slow or flaky.
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
    try {
      await use({
        url,
        dir,
        open: async (route = '') => {
          await page.goto(`${url}/${route ? `#${route}` : ''}`);
          // Wait for the page the route leads to, so each test starts from
          // a settled console.
          if (!route) await expect(page.getByRole('main').getByRole('button', { name: 'Overview' })).toBeVisible();
        },
        navigator: page.getByRole('complementary', { name: 'Navigator' }),
        inspector: page.getByRole('complementary', { name: 'Inspector' }),
        main: page.getByRole('main'),
      });
    } finally {
      await stopConsole(child);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
});

/** A workflow's entry in the navigator's tree, by its name. */
export function workflowEntry(fw: ConsoleUnderTest, name: string): Locator {
  return fw.navigator.getByRole('button', { name: new RegExp(`\\b${name}\\b`) });
}

/** Open a workflow from the navigator and wait until the header names it. */
export async function openWorkflow(fw: ConsoleUnderTest, name: string): Promise<void> {
  await workflowEntry(fw, name).click();
  await expect(fw.main.getByRole('heading', { level: 1, name })).toBeVisible();
}

export { expect };
