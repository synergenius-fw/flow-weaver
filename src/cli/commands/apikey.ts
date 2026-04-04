import { requireLogin, isUuid, fmt, exitWithError } from '../utils/cli-helpers.js';

export async function apiKeyCreateCommand(name: string): Promise<void> {
  const { client } = requireLogin();

  try {
    const apiKey = await client.createApiKey(name);

    console.log('');
    console.log(fmt.ok('API key created'));
    console.log('');
    console.log(`  Name:   ${apiKey.name}`);
    console.log(`  Key:    ${fmt.bold(apiKey.key)}`);
    console.log(`  Prefix: ${apiKey.keyPrefix}`);
    console.log('');
    console.log(`  ${fmt.yellow('⚠')} Copy this key now — it cannot be shown again.`);
    console.log('');
  } catch (err) {
    exitWithError(err, 'Failed to create API key');
  }
}

export async function apiKeyListCommand(): Promise<void> {
  const { client } = requireLogin();

  try {
    const keys = await client.listApiKeys();

    console.log('');
    if (keys.length === 0) {
      console.log('  No API keys. Create one with: fw apikey create <name>');
    } else {
      console.log(`  ${keys.length} API key${keys.length === 1 ? '' : 's'}:`);
      console.log('');
      for (const key of keys) {
        const date = new Date(key.createdAt).toLocaleDateString();
        console.log(`    ${fmt.cyan(key.keyPrefix + '...')}  ${key.name.padEnd(20)}  ${date}  ${fmt.dim(key.id)}`);
      }
    }
    console.log('');
  } catch (err) {
    exitWithError(err, 'Failed to list API keys');
  }
}

export async function apiKeyRevokeCommand(idOrPrefix: string): Promise<void> {
  const { client } = requireLogin();

  try {
    let id = idOrPrefix;

    if (!isUuid(idOrPrefix)) {
      const keys = await client.listApiKeys();
      const match = keys.filter((k) => k.keyPrefix.startsWith(idOrPrefix) || k.id.startsWith(idOrPrefix));
      if (match.length === 0) {
        throw new Error(`No API key matching "${idOrPrefix}"`);
      }
      if (match.length > 1) {
        throw new Error(`Ambiguous: "${idOrPrefix}" matches ${match.length} keys. Use the full ID.`);
      }
      id = match[0].id;
    }

    await client.revokeApiKey(id);
    console.log(fmt.ok('API key revoked'));
  } catch (err) {
    exitWithError(err, 'Failed to revoke API key');
  }
}
