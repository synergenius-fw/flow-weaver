/**
 * Context command - generate LLM context bundles from documentation and grammar
 */

import * as fs from 'fs';
import { buildContext, PRESETS, PRESET_NAMES, type ContextPreset } from '../../context/index.js';
import { logger } from '../utils/logger.js';

export interface ContextCommandOptions {
  profile?: string;
  topics?: string;
  add?: string;
  grammar?: boolean;
  output?: string;
  list?: boolean;
}

export async function contextCommand(
  preset: string | undefined,
  options: ContextCommandOptions
): Promise<void> {
  // --list: show presets and exit
  if (options.list) {
    logger.section('Context Presets');
    logger.newline();
    const maxName = Math.max(...PRESET_NAMES.map((n) => n.length));
    for (const name of PRESET_NAMES) {
      const topics = PRESETS[name];
      logger.log(`  ${name.padEnd(maxName + 2)} ${topics.join(', ')}`);
    }
    logger.newline();
    logger.log('  Usage: flow-weaver context [preset] [options]');
    logger.newline();
    return;
  }

  // Validate preset
  const presetName = (preset ?? 'core') as ContextPreset;
  if (!PRESET_NAMES.includes(presetName) && !options.topics) {
    logger.error(
      `Unknown preset "${preset}". Available: ${PRESET_NAMES.join(', ')}. Or use --topics to specify topics directly.`
    );
    process.exit(1);
  }

  // Validate profile
  const profile = options.profile ?? 'standalone';
  if (profile !== 'standalone' && profile !== 'assistant') {
    logger.error(`Unknown profile "${profile}". Use "standalone" or "assistant".`);
    process.exit(1);
  }

  const result = buildContext({
    preset: PRESET_NAMES.includes(presetName) ? presetName : 'core',
    profile: profile as 'standalone' | 'assistant',
    topics: options.topics ? options.topics.split(',').map((s) => s.trim()) : undefined,
    addTopics: options.add ? options.add.split(',').map((s) => s.trim()) : undefined,
    includeGrammar: options.grammar !== false,
  });

  // Write output
  if (options.output) {
    fs.writeFileSync(options.output, result.content, 'utf-8');
    logger.success(`Context written to ${options.output}`);
  } else {
    process.stdout.write(result.content);
  }

  // Stats to stderr (doesn't pollute piped stdout)
  const stats = `${result.topicCount} topics, ${result.lineCount} lines (${result.profile} profile)`;
  process.stderr.write(`flow-weaver context: ${stats}\n`);
}
