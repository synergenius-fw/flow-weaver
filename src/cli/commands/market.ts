/* eslint-disable no-console */
/**
 * Marketplace commands — init, pack, publish, install, search, list
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';
import {
  generateManifest,
  writeManifest,
  readManifest,
  validatePackage,
  searchPackages,
  listInstalledPackages,
} from '../../marketplace/index.js';
import type { TMarketplaceManifest, TInstalledPackage } from '../../marketplace/types.js';
import { getErrorMessage } from '../../utils/error-utils.js';

// ── Init ─────────────────────────────────────────────────────────────────────

export interface MarketInitOptions {
  description?: string;
  author?: string;
  yes?: boolean;
}

/**
 * Scaffold a new marketplace package project.
 */
export async function marketInitCommand(name: string, options: MarketInitOptions = {}): Promise<void> {
  // Validate name
  if (!name.startsWith('flowweaver-pack-')) {
    const suggested = `flowweaver-pack-${name}`;
    logger.warn(`Name should follow "flowweaver-pack-*" convention, using "${suggested}"`);
    name = suggested;
  }

  const targetDir = path.resolve(name);

  if (fs.existsSync(targetDir)) {
    const stat = fs.statSync(targetDir);
    if (stat.isDirectory()) {
      const contents = fs.readdirSync(targetDir);
      if (contents.length > 0) {
        logger.error(`Directory "${name}" already exists and is not empty`);
        process.exit(1);
      }
    } else {
      logger.error(`"${name}" already exists and is not a directory`);
      process.exit(1);
    }
  }

  logger.section('Creating Marketplace Package');
  logger.info(`Package: ${name}`);
  logger.newline();

  // Create directory structure
  const dirs = [
    targetDir,
    path.join(targetDir, 'src'),
    path.join(targetDir, 'src', 'node-types'),
    path.join(targetDir, 'src', 'workflows'),
    path.join(targetDir, 'src', 'patterns'),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // package.json
  const shortName = name.replace(/^flowweaver-pack-/, '');
  const pkg = {
    name,
    version: '1.0.0',
    description: options.description ?? `Flow Weaver marketplace pack: ${shortName}`,
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    keywords: ['flowweaver-marketplace-pack', 'flow-weaver', shortName],
    flowWeaver: {
      type: 'marketplace-pack',
      engineVersion: '>=0.1.0',
    },
    scripts: {
      build: 'tsc',
      pack: 'flow-weaver market pack',
      prepublishOnly: 'npm run build && npm run pack',
    },
    ...(options.author && { author: options.author }),
    license: 'MIT',
    peerDependencies: {
      '@synergenius/flow-weaver': '>=0.1.0',
    },
    devDependencies: {
      '@synergenius/flow-weaver': '^0.1.0',
      typescript: '^5.3.0',
    },
    files: ['dist', 'flowweaver.manifest.json', 'README.md', 'LICENSE'],
  };

  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  );

  // tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      declaration: true,
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    include: ['src'],
    exclude: ['node_modules', 'dist'],
  };

  fs.writeFileSync(
    path.join(targetDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2) + '\n'
  );

  // Sample node type
  const sampleNodeType = `/**
 * @flowWeaver nodeType
 * @name Sample
 * @description A sample node type for your marketplace pack
 * @input data - Input data
 * @output result - Processed result
 * @visual color blue
 * @visual icon box
 * @visual tag ${shortName}
 */
export function sample(execute: () => void, data: string): { result: string } {
  execute();
  return { result: data.toUpperCase() };
}
`;

  fs.writeFileSync(path.join(targetDir, 'src', 'node-types', 'sample.ts'), sampleNodeType);

  // Barrel exports
  fs.writeFileSync(
    path.join(targetDir, 'src', 'node-types', 'index.ts'),
    "export { sample } from './sample.js';\n"
  );
  fs.writeFileSync(
    path.join(targetDir, 'src', 'workflows', 'index.ts'),
    '// Export workflows here\n'
  );
  fs.writeFileSync(
    path.join(targetDir, 'src', 'patterns', 'index.ts'),
    '// Export patterns here\n'
  );
  fs.writeFileSync(
    path.join(targetDir, 'src', 'index.ts'),
    [
      "export * from './node-types/index.js';",
      "export * from './workflows/index.js';",
      "export * from './patterns/index.js';",
      '',
    ].join('\n')
  );

  // README.md
  const readme = `# ${name}

A [Flow Weaver](https://github.com/synergenius-fw/flow-weaver) marketplace pack.

## Installation

\`\`\`bash
flow-weaver market install ${name}
\`\`\`

## Contents

### Node Types

- **Sample** — A sample node type

## Development

\`\`\`bash
npm install
npm run build
npm run pack    # Generate flowweaver.manifest.json
npm publish     # Publish to npm
\`\`\`
`;

  fs.writeFileSync(path.join(targetDir, 'README.md'), readme);

  // .gitignore
  fs.writeFileSync(
    path.join(targetDir, '.gitignore'),
    ['node_modules', 'dist', '*.tgz', ''].join('\n')
  );

  logger.success('Created package.json');
  logger.success('Created tsconfig.json');
  logger.success('Created src/node-types/sample.ts');
  logger.success('Created src/index.ts');
  logger.success('Created README.md');
  logger.success('.gitignore');

  logger.newline();
  logger.section('Next Steps');
  logger.log(`  cd ${name}`);
  logger.log('  npm install');
  logger.log('  # Add your node types, workflows, and patterns to src/');
  logger.log('  npm run build');
  logger.log('  flow-weaver market pack');
  logger.log('  npm publish');
  logger.newline();
}

// ── Pack ─────────────────────────────────────────────────────────────────────

export interface MarketPackOptions {
  json?: boolean;
  verbose?: boolean;
}

/**
 * Parse source files, validate, and generate flowweaver.manifest.json.
 */
export async function marketPackCommand(directory?: string, options: MarketPackOptions = {}): Promise<void> {
  const dir = path.resolve(directory ?? '.');
  const { json = false, verbose = false } = options;

  if (!json) {
    logger.section('Packing Marketplace Package');
  }

  // 1. Generate manifest from source files
  const { manifest, parsedFiles, errors: parseErrors } = await generateManifest({ directory: dir });

  if (parseErrors.length > 0 && verbose) {
    for (const err of parseErrors) {
      logger.warn(err);
    }
  }

  // 2. Validate
  const validation = await validatePackage(dir, manifest);

  if (json) {
    console.log(JSON.stringify({
      manifest,
      validation,
      parsedFiles: parsedFiles.length,
    }, null, 2));
    if (!validation.valid) process.exit(1);
    return;
  }

  // Display results
  logger.info(`Parsed ${parsedFiles.length} file(s)`);
  logger.info(`Found ${manifest.nodeTypes.length} node type(s), ${manifest.workflows.length} workflow(s), ${manifest.patterns.length} pattern(s)`);
  logger.newline();

  // Show validation issues
  const errors = validation.issues.filter((i) => i.severity === 'error');
  const warnings = validation.issues.filter((i) => i.severity === 'warning');

  for (const err of errors) {
    logger.error(`[${err.code}] ${err.message}`);
  }
  for (const warn of warnings) {
    logger.warn(`[${warn.code}] ${warn.message}`);
  }

  if (!validation.valid) {
    logger.newline();
    logger.error('Package validation failed. Fix errors above before publishing.');
    process.exit(1);
  }

  // 3. Write manifest
  const outPath = writeManifest(dir, manifest);
  logger.newline();
  logger.success(`Manifest written to ${path.relative(dir, outPath)}`);

  if (warnings.length > 0) {
    logger.warn(`${warnings.length} warning(s) — consider fixing before publishing`);
  }

  logger.newline();
}

// ── Publish ──────────────────────────────────────────────────────────────────

export interface MarketPublishOptions {
  dryRun?: boolean;
  tag?: string;
}

/**
 * Pack + pre-publish checks + npm publish.
 */
export async function marketPublishCommand(directory?: string, options: MarketPublishOptions = {}): Promise<void> {
  const dir = path.resolve(directory ?? '.');
  const { dryRun = false, tag } = options;

  logger.section('Publishing Marketplace Package');

  // 1. Run pack first
  await marketPackCommand(dir, { json: false });

  // 2. Pre-publish checks
  if (!fs.existsSync(path.join(dir, 'LICENSE'))) {
    logger.warn('LICENSE file not found — consider adding one');
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  logger.info(`Publishing ${pkg.name}@${pkg.version}`);

  // 3. npm publish
  const npmArgs = ['publish'];
  if (dryRun) npmArgs.push('--dry-run');
  if (tag) npmArgs.push('--tag', tag);

  try {
    logger.newline();
    execSync(`npm ${npmArgs.join(' ')}`, { cwd: dir, stdio: 'inherit' });

    if (!dryRun) {
      logger.newline();
      logger.success(`Published ${pkg.name}@${pkg.version} to npm`);
    }
  } catch (err) {
    logger.error(`npm publish failed: ${getErrorMessage(err)}`);
    process.exit(1);
  }
}

// ── Install ──────────────────────────────────────────────────────────────────

export interface MarketInstallOptions {
  json?: boolean;
}

/**
 * Install a marketplace package and display its contents.
 */
export async function marketInstallCommand(packageSpec: string, options: MarketInstallOptions = {}): Promise<void> {
  const { json = false } = options;

  if (!json) {
    logger.section('Installing Marketplace Package');
    logger.info(`Installing ${packageSpec}...`);
    logger.newline();
  }

  // 1. npm install
  try {
    execSync(`npm install ${packageSpec}`, { stdio: json ? 'pipe' : 'inherit' });
  } catch (err) {
    if (json) {
      console.log(JSON.stringify({ success: false, error: getErrorMessage(err) }));
    } else {
      logger.error(`npm install failed: ${getErrorMessage(err)}`);
    }
    process.exit(1);
  }

  // 2. Read manifest from installed package
  // Resolve the package name from the spec (could be a tarball path or name@version)
  const packageName = resolvePackageName(packageSpec);
  const manifest = readManifest(path.join(process.cwd(), 'node_modules', packageName));

  if (json) {
    console.log(JSON.stringify({
      success: true,
      package: packageName,
      manifest: manifest ?? 'no manifest found',
    }, null, 2));
    return;
  }

  logger.newline();
  logger.success(`Installed ${packageName}`);
  logger.newline();

  if (manifest) {
    displayManifestSummary(manifest);
  } else {
    logger.warn('No flowweaver.manifest.json found in package');
    logger.info('The package may need to run "flow-weaver market pack" before publishing');
  }
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface MarketSearchOptions {
  limit?: number;
  json?: boolean;
  registry?: string;
}

/**
 * Search npm for marketplace packages.
 */
export async function marketSearchCommand(query?: string, options: MarketSearchOptions = {}): Promise<void> {
  const { limit = 20, json = false, registry } = options;

  if (!json) {
    logger.section('Marketplace Search');
    if (query) logger.info(`Query: ${query}`);
    if (registry) logger.info(`Registry: ${registry}`);
    logger.newline();
  }

  try {
    const results = await searchPackages({ query, limit, registryUrl: registry });

    if (json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      logger.info('No packages found');
      return;
    }

    for (const pkg of results) {
      const badge = pkg.official ? ' [official]' : '';
      logger.log(`  ${pkg.name}@${pkg.version}${badge}`);
      if (pkg.description) {
        logger.log(`    ${pkg.description}`);
      }
      logger.newline();
    }

    logger.info(`${results.length} package(s) found`);
  } catch (err) {
    if (json) {
      console.log(JSON.stringify({ error: getErrorMessage(err) }));
    } else {
      logger.error(`Search failed: ${getErrorMessage(err)}`);
    }
    process.exit(1);
  }
}

// ── List ─────────────────────────────────────────────────────────────────────

export interface MarketListOptions {
  json?: boolean;
}

/**
 * List installed marketplace packages.
 */
export async function marketListCommand(options: MarketListOptions = {}): Promise<void> {
  const { json = false } = options;

  if (!json) {
    logger.section('Installed Marketplace Packages');
    logger.newline();
  }

  const packages = await listInstalledPackages(process.cwd());

  if (json) {
    console.log(JSON.stringify(packages.map((p) => ({
      name: p.name,
      version: p.version,
      nodeTypes: p.manifest.nodeTypes.length,
      workflows: p.manifest.workflows.length,
      patterns: p.manifest.patterns.length,
    })), null, 2));
    return;
  }

  if (packages.length === 0) {
    logger.info('No marketplace packages installed');
    logger.info('Use "flow-weaver market search" to find packages');
    return;
  }

  for (const pkg of packages) {
    displayInstalledPackage(pkg);
  }

  logger.info(`${packages.length} package(s) installed`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolvePackageName(spec: string): string {
  // Handle tarball paths: ./foo-1.0.0.tgz → read name from the tarball
  if (spec.endsWith('.tgz') || spec.endsWith('.tar.gz')) {
    // For local tarballs, try to extract the package name
    const base = path.basename(spec, spec.endsWith('.tar.gz') ? '.tar.gz' : '.tgz');
    // flowweaver-pack-test-1.0.0 → flowweaver-pack-test
    const match = base.match(/^(.+)-\d+\.\d+\.\d+/);
    return match ? match[1] : base;
  }

  // Handle name@version
  if (spec.startsWith('@')) {
    // Scoped: @scope/name@version
    const atIndex = spec.indexOf('@', 1);
    return atIndex > 0 ? spec.slice(0, atIndex) : spec;
  }

  const atIndex = spec.indexOf('@');
  return atIndex > 0 ? spec.slice(0, atIndex) : spec;
}

function displayManifestSummary(manifest: TMarketplaceManifest): void {
  if (manifest.nodeTypes.length > 0) {
    logger.log('  Node Types:');
    for (const nt of manifest.nodeTypes) {
      const desc = nt.description ? ` — ${nt.description}` : '';
      logger.log(`    - ${nt.name}${desc}`);
    }
  }

  if (manifest.workflows.length > 0) {
    logger.log('  Workflows:');
    for (const wf of manifest.workflows) {
      const desc = wf.description ? ` — ${wf.description}` : '';
      logger.log(`    - ${wf.name}${desc}`);
    }
  }

  if (manifest.patterns.length > 0) {
    logger.log('  Patterns:');
    for (const pat of manifest.patterns) {
      const desc = pat.description ? ` — ${pat.description}` : '';
      logger.log(`    - ${pat.name}${desc}`);
    }
  }

  logger.newline();
}

function displayInstalledPackage(pkg: TInstalledPackage): void {
  const m = pkg.manifest;
  logger.log(`  ${pkg.name}@${pkg.version}`);

  const counts: string[] = [];
  if (m.nodeTypes.length > 0) counts.push(`${m.nodeTypes.length} node type(s)`);
  if (m.workflows.length > 0) counts.push(`${m.workflows.length} workflow(s)`);
  if (m.patterns.length > 0) counts.push(`${m.patterns.length} pattern(s)`);

  if (counts.length > 0) {
    logger.log(`    ${counts.join(', ')}`);
  }

  logger.newline();
}
