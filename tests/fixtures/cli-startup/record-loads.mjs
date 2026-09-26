/**
 * `node --import` this file to log every module the ESM loader resolves, one
 * `<parent> -> <resolved>` line per module, to the file named by
 * FW_TEST_LOAD_LOG. Used by tests/cli/startup-modules.test.ts to see which
 * heavy dependencies a CLI invocation loads.
 *
 * The same file is the hooks module: registered from the main thread, loaded
 * again in the hooks thread, where it only exports the hook.
 */

import { appendFileSync } from 'node:fs';
import { register } from 'node:module';
import { isMainThread } from 'node:worker_threads';

if (isMainThread) register(import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  const log = process.env.FW_TEST_LOAD_LOG;
  if (log) appendFileSync(log, `${context.parentURL ?? '(entry)'} -> ${result.url}\n`);
  return result;
}
