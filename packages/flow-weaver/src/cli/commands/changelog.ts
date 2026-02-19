/**
 * Changelog command - generates changelog from git history
 *
 * Categorizes commits by changed file paths — no conventional commits needed.
 * Works with any commit message style.
 */

import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

export interface ChangelogOptions {
  lastTag?: boolean;
  since?: string;
  range?: string;
}

interface CommitEntry {
  hash: string;
  message: string;
  files: string[];
}

const CATEGORIES: Array<{ name: string; match: (file: string) => boolean }> = [
  { name: 'Grammar', match: (f) => /parser|chevrotain|grammar/.test(f) },
  { name: 'Code Generation', match: (f) => /generator|body-generator|generate/.test(f) },
  { name: 'Differ', match: (f) => f.includes('diff/') },
  { name: 'CLI', match: (f) => f.includes('cli/commands/') },
  { name: 'MCP Tools', match: (f) => f.includes('mcp/') },
  { name: 'Deployment', match: (f) => /deployment|export/.test(f) },
  { name: 'Runtime', match: (f) => f.includes('runtime/') },
  { name: 'Migration', match: (f) => f.includes('migration/') },
  { name: 'Tests', match: (f) => f.includes('tests/') || f.includes('.test.') },
  { name: 'Documentation', match: (f) => /doc|readme|changelog/i.test(f) },
];

function categorize(files: string[]): string {
  for (const category of CATEGORIES) {
    if (files.some(category.match)) {
      return category.name;
    }
  }
  return 'Other';
}

function getGitRange(options: ChangelogOptions): string {
  if (options.range) {
    return options.range;
  }

  if (options.lastTag) {
    try {
      const lastTag = execSync('git describe --tags --abbrev=0', {
        encoding: 'utf8',
      }).trim();
      return `${lastTag}..HEAD`;
    } catch {
      logger.warn('No git tags found, showing all commits');
      return 'HEAD';
    }
  }

  if (options.since) {
    return `--since="${options.since}"`;
  }

  // Default: last 20 commits
  return '-20';
}

function getCommits(rangeArg: string): CommitEntry[] {
  const isSinceArg = rangeArg.startsWith('--since');
  const isCountArg = rangeArg.startsWith('-');

  let logCmd: string;
  if (isSinceArg) {
    logCmd = `git log ${rangeArg} --format="%H %s" --no-merges`;
  } else if (isCountArg) {
    logCmd = `git log ${rangeArg} --format="%H %s" --no-merges`;
  } else {
    logCmd = `git log ${rangeArg} --format="%H %s" --no-merges`;
  }

  const logOutput = execSync(logCmd, { encoding: 'utf8' }).trim();

  if (!logOutput) {
    return [];
  }

  const entries: CommitEntry[] = [];

  for (const line of logOutput.split('\n')) {
    if (!line.trim()) continue;

    const spaceIdx = line.indexOf(' ');
    const hash = line.slice(0, spaceIdx);
    const message = line.slice(spaceIdx + 1);

    // Get changed files for this commit
    let files: string[];
    try {
      const filesOutput = execSync(`git diff-tree --no-commit-id --name-only -r ${hash}`, {
        encoding: 'utf8',
      }).trim();
      files = filesOutput ? filesOutput.split('\n') : [];
    } catch {
      files = [];
    }

    entries.push({ hash: hash.slice(0, 7), message, files });
  }

  return entries;
}

export async function changelogCommand(options: ChangelogOptions = {}): Promise<void> {
  const rangeArg = getGitRange(options);

  const rangeLabel = options.range || (options.lastTag ? 'last tag' : options.since ? `since ${options.since}` : 'recent');

  const commits = getCommits(rangeArg);

  if (commits.length === 0) {
    logger.info('No commits found in the specified range.');
    return;
  }

  // Group by category
  const grouped = new Map<string, CommitEntry[]>();
  for (const commit of commits) {
    const category = categorize(commit.files);
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push(commit);
  }

  // Output as markdown
  // eslint-disable-next-line no-console
  console.log(`## Changes (${rangeLabel})\n`);

  // Sort categories: defined order first, then "Other"
  const categoryOrder = CATEGORIES.map((c) => c.name);
  const sortedCategories = [...grouped.keys()].sort((a, b) => {
    const idxA = categoryOrder.indexOf(a);
    const idxB = categoryOrder.indexOf(b);
    if (idxA === -1 && idxB === -1) return a.localeCompare(b);
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });

  for (const category of sortedCategories) {
    const categoryCommits = grouped.get(category)!;
    // eslint-disable-next-line no-console
    console.log(`### ${category} (${categoryCommits.length} commit${categoryCommits.length !== 1 ? 's' : ''})\n`);
    for (const commit of categoryCommits) {
      // eslint-disable-next-line no-console
      console.log(`- ${commit.hash} ${commit.message}`);
    }
    // eslint-disable-next-line no-console
    console.log('');
  }
}
