import { listTopics, readTopic, readTopicStructured, searchDocs } from '../../docs/index.js';
import { logger } from '../utils/logger.js';

export interface DocsCommandOptions {
  compact?: boolean;
  json?: boolean;
}

export interface DocsSearchOptions {
  json?: boolean;
}

export async function docsListCommand(options: DocsCommandOptions): Promise<void> {
  const topics = listTopics();

  if (topics.length === 0) {
    logger.error('No documentation topics found.');
    process.exit(1);
  }

  if (options.json) {
    process.stdout.write(JSON.stringify({ topics }, null, 2) + '\n');
    return;
  }

  logger.section('Flow Weaver Documentation');
  logger.newline();
  const maxSlug = Math.max(...topics.map((t) => t.slug.length));
  for (const topic of topics) {
    logger.log(`  ${topic.slug.padEnd(maxSlug + 2)} ${topic.description}`);
  }
  logger.newline();
  logger.log('  Usage: flow-weaver docs <topic>');
  logger.log('  Search: flow-weaver docs search <query>');
  logger.newline();
}

export async function docsReadCommand(
  topic: string,
  options: DocsCommandOptions
): Promise<void> {
  if (options.json) {
    const structured = readTopicStructured(topic);
    if (!structured) {
      logger.error(`Unknown topic: "${topic}". Run "flow-weaver docs" to see available topics.`);
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(structured, null, 2) + '\n');
    return;
  }

  const doc = readTopic(topic, options.compact);
  if (!doc) {
    logger.error(`Unknown topic: "${topic}". Run "flow-weaver docs" to see available topics.`);
    process.exit(1);
  }

  process.stdout.write(doc.content + '\n');
}

export async function docsSearchCommand(
  query: string,
  options: DocsSearchOptions
): Promise<void> {
  const results = searchDocs(query);

  if (options.json) {
    process.stdout.write(JSON.stringify({ query, results }, null, 2) + '\n');
    return;
  }

  if (results.length === 0) {
    logger.log(`No results found for "${query}".`);
    return;
  }

  logger.section(`Search results for "${query}"`);
  logger.newline();

  // Deduplicate by topic+heading, show top results
  const seen = new Set<string>();
  let shown = 0;
  for (const result of results) {
    const key = `${result.slug}:${result.heading}`;
    if (seen.has(key)) continue;
    seen.add(key);

    logger.log(`  [${result.slug}] ${result.heading}`);
    if (result.excerpt) {
      const excerptLines = result.excerpt.split('\n').slice(0, 2);
      for (const line of excerptLines) {
        logger.log(`    ${line}`);
      }
    }
    logger.newline();

    shown++;
    if (shown >= 15) break;
  }

  logger.log(`  ${results.length} matching section(s) across ${new Set(results.map((r) => r.slug)).size} topic(s).`);
  logger.log('  Read a topic: flow-weaver docs <topic>');
  logger.newline();
}
