import { requireLogin, readLine, confirm, fmt, exitWithError } from '../utils/cli-helpers.js';

const VALID_PROVIDERS = ['anthropic', 'openai'];

export async function aiAddCommand(
  provider: string,
  options: { key?: string; label?: string; model?: string; default?: boolean },
): Promise<void> {
  const { client } = requireLogin();

  try {
    if (!VALID_PROVIDERS.includes(provider)) {
      throw new Error(`Invalid provider "${provider}". Use: ${VALID_PROVIDERS.join(', ')}`);
    }

    // Read key from --key flag or prompt via stdin (non-TTY requires --key)
    let apiKey = options.key;
    if (!apiKey) {
      apiKey = await readLine('  Enter API key: ') ?? undefined;
      if (!apiKey) {
        throw new Error('No API key provided. Use --key <key> or run in a terminal.');
      }
    }

    const label = options.label ?? `${provider} key`;

    const cred = await client.createAiCredential({
      provider,
      label,
      apiKey,
      defaultModel: options.model,
      isDefault: options.default,
    });

    console.log('');
    console.log(fmt.ok('Credential added'));
    console.log('');
    console.log(`  Provider: ${cred.provider}`);
    console.log(`  Label:    ${cred.label}`);
    console.log(`  ID:       ${fmt.dim(cred.id)}`);
    console.log('');
    console.log(`  Test it:  fw ai test ${cred.id}`);
    console.log('');
  } catch (err) {
    exitWithError(err, 'Failed to add credential');
  }
}

export async function aiListCommand(): Promise<void> {
  const { client } = requireLogin();

  try {
    const creds = await client.listAiCredentials();

    console.log('');
    if (creds.length === 0) {
      console.log('  No AI credentials. Add one with: fw ai add <provider>');
    } else {
      console.log(`  ${creds.length} credential${creds.length === 1 ? '' : 's'}:`);
      console.log('');
      for (const c of creds) {
        const def = c.isDefault ? ` ${fmt.yellow('★ default')}` : '';
        const model = c.defaultModel ? ` ${fmt.dim(`(${c.defaultModel})`)}` : '';
        console.log(`    ${fmt.cyan(c.provider.padEnd(10))} ${c.label}${model}${def}  ${fmt.dim(c.id)}`);
      }
    }
    console.log('');
  } catch (err) {
    exitWithError(err, 'Failed to list credentials');
  }
}

export async function aiRevokeCommand(id: string, options: { force?: boolean }): Promise<void> {
  const { client } = requireLogin();

  if (!options.force) {
    const confirmed = await confirm('  Are you sure? This cannot be undone. [y/N] ');
    if (!confirmed) {
      console.log('  Cancelled.');
      return;
    }
  }

  try {
    await client.revokeAiCredential(id);
    console.log(fmt.ok('Credential revoked'));
  } catch (err) {
    exitWithError(err, 'Failed to revoke credential');
  }
}

export async function aiTestCommand(id: string): Promise<void> {
  const { client } = requireLogin();

  try {
    console.log(`  ${fmt.dim('Testing credential...')}`);
    const result = await client.testAiCredential(id);

    if (result.success) {
      console.log(fmt.ok('Credential is valid'));
    } else {
      console.log(fmt.err(`Credential test failed${result.message ? `: ${result.message}` : ''}`));
    }
  } catch (err) {
    exitWithError(err, 'Test failed');
  }
}
