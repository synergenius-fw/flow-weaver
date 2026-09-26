/**
 * Starts one console for an end-to-end test, over the project directory given
 * as the first argument, and prints `{"url": ...}` on a line once it listens.
 *
 * It runs the built console (`dist/`), the one that ships, in a process of its
 * own, the way `fw console` does. Runs are kept in memory, so nothing is left
 * behind in the project. SIGTERM closes it.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConsoleServer } from '../dist/console/server.js';
import { createMemoryRunStore } from '../dist/coordinator/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectDir = process.argv[2];
if (!projectDir) {
  process.stderr.write('usage: node e2e/serve.mjs <project-dir>\n');
  process.exit(2);
}

const server = await createConsoleServer({
  projectDir,
  port: 0,
  watch: false,
  assetsDir: path.join(root, 'dist', 'console'),
  store: createMemoryRunStore(),
});
process.stdout.write(`${JSON.stringify({ url: server.url })}\n`);

// Closing waits for the browser's idle keep-alive connections to time out,
// which is seconds per test for nothing: give it a moment, then go.
const stop = () => {
  setTimeout(() => process.exit(0), 500).unref();
  server.close().finally(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
