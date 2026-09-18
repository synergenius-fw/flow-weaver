import * as fs from 'fs';
import { discoverDocTopics } from '../marketplace/registry.js';
import { registerPackDocTopics } from './index.js';

/**
 * Register the documentation topics installed packs declare, so `fw docs`,
 * `fw_docs` and the context bundles list, read and search them alongside
 * the core topics.
 *
 * A pack declares topics in its manifest's `docs` field. `discoverDocTopics`
 * has resolved them to absolute paths since manifest v2, but nothing handed
 * the result to the docs registry, so a declared topic was invisible. This
 * is that missing step. Call it once per process before the first docs
 * read; the registry ignores a slug it already holds and a core slug always
 * wins over a pack's.
 *
 * Returns the number of topics offered to the registry. A topic whose file
 * is missing is skipped with a note on stderr, the same channel pack-tools
 * uses, so a half-built pack cannot make `fw docs` throw.
 */
export async function loadPackDocTopics(projectDir: string = process.cwd()): Promise<number> {
  let topics;
  try {
    topics = await discoverDocTopics(projectDir);
  } catch {
    return 0;
  }

  const present = topics.filter((topic) => {
    if (fs.existsSync(topic.absoluteFile)) return true;
    process.stderr.write(
      `[docs] ${topic.packageName} declares topic "${topic.slug}" but ${topic.absoluteFile} does not exist\n`,
    );
    return false;
  });

  registerPackDocTopics(present);
  return present.length;
}
