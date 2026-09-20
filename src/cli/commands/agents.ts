/**
 * Agents command: the project's agent profiles, and a starter file.
 *
 * A profile is what answers a `waitForAgent` gate while nobody is watching.
 * The console has an editor for them; this is the same information for a
 * terminal, and the one-line way to get the file to start from.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { loadAgentProfiles, readiness, keyEnvOf, agentsFile, STARTER_AGENTS_YAML, DEFAULT_MODEL } from '../../agent/profiles.js';

export interface AgentsOptions {
  /** Write the starter `.flowweaver/agents.yaml` when there is none. */
  init?: boolean;
  /** Overwrite an existing file with the starter. */
  force?: boolean;
  json?: boolean;
}

export async function agentsCommand(dir: string | undefined, options: AgentsOptions): Promise<void> {
  const projectDir = path.resolve(dir || '.');
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`Directory not found: ${projectDir}`);
  }
  const file = agentsFile(projectDir);

  if (options.init) {
    if (fs.existsSync(file) && !options.force) {
      throw new Error(`${path.relative(projectDir, file)} already exists; edit it, or pass --force to replace it with the starter`);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, STARTER_AGENTS_YAML);
    if (options.json) { console.log(JSON.stringify({ written: file }, null, 2)); return; }
    logger.success(`Wrote ${path.relative(projectDir, file)}`);
    logger.log(`  Open it, pick a provider, and name the environment variable that holds its key. Never put the key itself in the file.`);
    logger.log(`  \`fw agents\` says whether each profile is ready; the console's Agents page edits the same file.`);
    return;
  }

  const p = loadAgentProfiles(projectDir);
  const profiles = Object.values(p.agents).map((a) => {
    const r = readiness(a);
    return { name: a.name, provider: a.provider, model: a.model || DEFAULT_MODEL[a.provider] || null, keyEnv: keyEnvOf(a) ?? null, ready: r.ready, reason: r.reason ?? null, isDefault: p.default === a.name };
  });

  if (options.json) {
    console.log(JSON.stringify({ file: p.file, exists: p.exists, default: p.default ?? null, profiles, gates: p.gates, errors: p.errors }, null, 2));
    return;
  }

  if (!p.exists) {
    logger.info(`No ${path.relative(projectDir, file)}: agent gates in this project wait for a person.`);
    logger.log(`  \`fw agents --init\` writes a starter file; the console's Agents page does the same with a form.`);
    return;
  }

  logger.section('Agent profiles');
  logger.log(`  ${logger.dim(path.relative(projectDir, file))}`);
  logger.newline();
  if (!profiles.length) logger.log('  none defined');
  for (const a of profiles) {
    const mark = a.ready ? '✓' : '✗';
    logger.log(`  ${mark} ${logger.bold(a.name)}${a.isDefault ? logger.dim(' (default)') : ''}  ${a.provider}${a.model ? ` · ${a.model}` : ''}`);
    logger.log(`      ${a.ready ? (a.keyEnv ? `${a.keyEnv} is set` : 'ready') : (a.reason ?? 'not ready')}`);
  }
  if (!p.default) logger.log(`  ${logger.dim('no default: a gate is answered only when a mapping below names its profile')}`);
  const mapped = Object.entries(p.gates);
  if (mapped.length) {
    logger.newline();
    logger.log('  Gates');
    for (const [gate, name] of mapped) logger.log(`    ${gate} → ${name}`);
  }
  if (p.errors.length) {
    logger.newline();
    for (const e of p.errors) logger.warn(`  ${e}`);
  }
  logger.newline();
  logger.log(`  ${logger.dim('A run started with agents off, from the console or fw serve --no-agents, waits for a person regardless.')}`);
}
