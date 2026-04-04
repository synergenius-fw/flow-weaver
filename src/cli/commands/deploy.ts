import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireLogin, fmt, exitWithError } from '../utils/cli-helpers.js';

export async function deployCommand(filePath: string, options: { name?: string } = {}): Promise<void> {
  const { creds, client } = requireLogin();

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    exitWithError(new Error(`File not found: ${filePath}`), 'File not found');
  }

  const source = fs.readFileSync(absPath, 'utf-8');
  const name = options.name ?? path.basename(filePath, path.extname(filePath));

  console.log('');
  console.log(`  ${fmt.dim(`Pushing ${name}...`)}`);

  try {
    const workflow = await client.pushWorkflow(name, source);
    console.log(fmt.ok(`Pushed (v${workflow.version})`));

    console.log(`  ${fmt.dim('Deploying...')}`);
    const deployment = await client.deploy(workflow.slug);
    console.log(fmt.ok(`Deployed: ${deployment.slug}`));

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
    exitWithError(err, 'Deploy failed');
  }
}

export async function undeployCommand(slug: string): Promise<void> {
  const { client } = requireLogin();

  try {
    await client.undeploy(slug);
    console.log(fmt.ok(`Undeployed: ${slug}`));
  } catch (err) {
    exitWithError(err, 'Undeploy failed');
  }
}

export async function cloudStatusCommand(): Promise<void> {
  const { creds, client } = requireLogin();

  console.log('');
  console.log(`  ${fmt.bold(creds.email)} ${fmt.dim(`(${creds.plan} plan)`)}`);
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
    console.log(`  ${fmt.yellow('⚠')} Could not fetch deployments`);
  }

  try {
    const usage = await client.getUsage();
    console.log('');
    console.log(`  AI Credits: ${usage.aiCalls} calls this month`);
    console.log(`  Executions: ${usage.executions} this month`);
  } catch { /* usage not available */ }

  console.log('');
}
