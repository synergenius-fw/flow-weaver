import { buildContext, PRESETS, PRESET_NAMES, type ContextPreset } from '../../context/index.js';
import { loadPackDocTopics } from '../../docs/pack-topics.js';
import { logger } from '../utils/logger.js';
import { safeWriteFile } from '../utils/safe-write.js';

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
    logger.log('  Usage: fw context [preset] [options]');
    logger.newline();
    return;
  }

  // Validate preset
  const presetName = (preset ?? 'core') as ContextPreset;
  if (!PRESET_NAMES.includes(presetName) && !options.topics) {
    throw new Error(
      `Unknown preset "${preset}". Available: ${PRESET_NAMES.join(', ')}. Or use --topics to specify topics directly.`
    );
  }

  // Validate profile
  const profile = options.profile ?? 'standalone';
  if (profile !== 'standalone' && profile !== 'assistant') {
    throw new Error(`Unknown profile "${profile}". Use "standalone" or "assistant".`);
  }

  // Pack topics that name this preset in their manifest join the bundle.
  await loadPackDocTopics();

  const result = buildContext({
    preset: PRESET_NAMES.includes(presetName) ? presetName : 'core',
    profile: profile as 'standalone' | 'assistant',
    topics: options.topics ? options.topics.split(',').map((s) => s.trim()) : undefined,
    addTopics: options.add ? options.add.split(',').map((s) => s.trim()) : undefined,
    includeGrammar: options.grammar !== false,
  });

  // Write output
  if (options.output) {
    safeWriteFile(options.output, result.content);
    logger.success(`Context written to ${options.output}`);
  } else {
    process.stdout.write(result.content);
  }

  // Stats to stderr (doesn't pollute piped stdout)
  const stats = `${result.topicCount} topics, ${result.lineCount} lines (${result.profile} profile)`;
  process.stderr.write(`fw context: ${stats}\n`);
}
