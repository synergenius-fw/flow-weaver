import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadCredentials } from '../config/credentials.js';
import { PlatformClient } from '../config/platform-client.js';

export async function deployCommand(filePath: string, options: { name?: string } = {}): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    console.error('  \x1b[31m✗\x1b[0m Not logged in. Run: fw login');
    process.exit(1);
    return;
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`  \x1b[31m✗\x1b[0m File not found: ${filePath}`);
    process.exit(1);
    return;
  }

  const source = fs.readFileSync(absPath, 'utf-8');
  const name = options.name ?? path.basename(filePath, path.extname(filePath));
  const client = new PlatformClient(creds);

  console.log('');
  console.log(`  \x1b[2mPushing ${name}...\x1b[0m`);

  try {
    const workflow = await client.pushWorkflow(name, source);
    console.log(`  \x1b[32m✓\x1b[0m Pushed (v${workflow.version})`);

    console.log(`  \x1b[2mDeploying...\x1b[0m`);
    const deployment = await client.deploy(workflow.slug);
    console.log(`  \x1b[32m✓\x1b[0m Deployed: ${deployment.slug}`);

    console.log('');
    console.log(`  Endpoint: ${creds.platformUrl}/run/${deployment.slug}`);
    console.log('');
    console.log('  Test it:');
    console.log(`    curl -X POST ${creds.platformUrl}/run/${deployment.slug} \\`);
    console.log(`      -H "X-API-Key: <your-api-key>" \\`);
    console.log(`      -H "Content-Type: application/json" \\`);
    console.log(`      -d '{"input": "hello"}'`);
    console.log('');
  } catch (err) {
    console.error(`  \x1b[31m✗\x1b[0m ${err instanceof Error ? err.message : 'Deploy failed'}`);
    process.exit(1);
  }
}

export async function undeployCommand(slug: string): Promise<void> {
  const creds = loadCredentials();
  if (!creds) { console.error('  \x1b[31m✗\x1b[0m Not logged in.'); process.exit(1); return; }
  const client = new PlatformClient(creds);
  try {
    await client.undeploy(slug);
    console.log(`  \x1b[32m✓\x1b[0m Undeployed: ${slug}`);
  } catch (err) {
    console.error(`  \x1b[31m✗\x1b[0m ${err instanceof Error ? err.message : 'Undeploy failed'}`);
  }
}

export async function cloudStatusCommand(): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    console.log('');
    console.log('  Not logged in. Run: \x1b[36mfw login\x1b[0m');
    console.log('');
    return;
  }

  const client = new PlatformClient(creds);

  console.log('');
  console.log(`  \x1b[1m${creds.email}\x1b[0m \x1b[2m(${creds.plan} plan)\x1b[0m`);
  console.log('');

  try {
    const deployments = await client.listDeployments();
    if (deployments.length === 0) {
      console.log('  No deployments.');
    } else {
      console.log('  Deployments:');
      for (const d of deployments) {
        const icon = d.status === 'active' ? '\x1b[32m●\x1b[0m' : '\x1b[33m○\x1b[0m';
        console.log(`    ${icon} ${d.slug.padEnd(25)} ${d.status}`);
      }
    }
  } catch {
    console.log('  \x1b[33m⚠\x1b[0m Could not fetch deployments');
  }

  try {
    const usage = await client.getUsage();
    console.log('');
    console.log(`  AI Credits: ${usage.aiCalls} calls this month`);
    console.log(`  Executions: ${usage.executions} this month`);
  } catch { /* usage not available */ }

  console.log('');
}
