import { requireLogin, fmt, exitWithError } from '../utils/cli-helpers.js';

export function formatLimit(used: number, limit: number): string {
  if (limit === -1) return `${used} (unlimited)`;
  return `${used} / ${limit}`;
}

export function usageBar(used: number, limit: number, width: number = 20): string {
  if (limit === -1) return '\x1b[36m∞\x1b[0m';
  if (limit <= 0) return '\x1b[2m-\x1b[0m';
  const ratio = Math.min(used / limit, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const color = ratio >= 0.9 ? '\x1b[31m' : ratio >= 0.7 ? '\x1b[33m' : '\x1b[32m';
  return `${color}${'█'.repeat(filled)}\x1b[2m${'░'.repeat(empty)}\x1b[0m`;
}

export async function accountCommand(): Promise<void> {
  const { creds, client } = requireLogin();

  try {
    const [user, usage] = await Promise.all([
      client.getUser(),
      client.getDetailedUsage().catch(() => null),
    ]);

    console.log('');
    console.log(`  ${fmt.bold(user.name)}`);
    console.log(`  ${user.email}`);
    console.log(`  Plan: ${user.plan}`);
    console.log(`  Platform: ${fmt.dim(creds.platformUrl)}`);

    if (usage) {
      console.log('');
      const rows = [
        { label: 'Workflows', ...usage.usage.workflows },
        { label: 'Deployments', ...usage.usage.deployments },
        { label: 'Executions', ...usage.usage.executions },
      ];

      for (const row of rows) {
        const bar = usageBar(row.used, row.limit);
        const nums = formatLimit(row.used, row.limit);
        console.log(`  ${row.label.padEnd(14)} ${bar}  ${nums}`);
      }

      console.log(`  ${'Timeout'.padEnd(14)} ${usage.limits.timeoutMs / 1000}s per run`);
    }

    console.log('');
  } catch (err) {
    exitWithError(err, 'Failed to fetch account');
  }
}
