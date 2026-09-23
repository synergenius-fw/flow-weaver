/**
 * Marketplace commands: init, pack, publish, install, search, list
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { TMarketplacePackageInfo } from '../../marketplace/types.js';
import { logger } from '../utils/logger.js';
import {
  generateManifest,
  writeManifest,
  readManifest,
  validatePackage,
  searchAllRegistries,
  searchPackages,
  listInstalledPackages,
} from '../../marketplace/index.js';
import type { TMarketplaceManifest, TInstalledPackage } from '../../marketplace/types.js';
import { getErrorMessage } from '../../utils/error-utils.js';
import { VERSION } from '../../generated-version.js';

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
  if (!name.startsWith('flow-weaver-pack-')) {
    const suggested = `flow-weaver-pack-${name}`;
    logger.warn(`Name should follow "flow-weaver-pack-*" convention, using "${suggested}"`);
    name = suggested;
  }

  const targetDir = path.resolve(name);

  if (fs.existsSync(targetDir)) {
    const stat = fs.statSync(targetDir);
    if (stat.isDirectory()) {
      const contents = fs.readdirSync(targetDir);
      if (contents.length > 0) {
        throw new Error(`Directory "${name}" already exists and is not empty`);
      }
    } else {
      throw new Error(`"${name}" already exists and is not a directory`);
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
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // package.json
  const shortName = name.replace(/^flow-weaver-pack-/, '');
  const pkg = {
    name,
    version: '1.0.0',
    description: options.description ?? `Flow Weaver marketplace pack: ${shortName}`,
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    keywords: ['flow-weaver-marketplace-pack', 'flow-weaver', shortName],
    flowWeaver: {
      type: 'marketplace-pack',
      engineVersion: `>=${VERSION}`,
    },
    scripts: {
      build: 'tsc',
      pack: 'fw market pack',
      prepublishOnly: 'npm run build && npm run pack',
    },
    ...(options.author && { author: options.author }),
    license: 'MIT',
    peerDependencies: {
      '@synergenius/flow-weaver': `>=${VERSION}`,
    },
    devDependencies: {
      '@synergenius/flow-weaver': `^${VERSION}`,
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

  // Sample node type: an expression node, the shape to start from. Ports
  // come from the signature; the annotations add what a user sees.
  const sampleNodeType = `/**
 * @flowWeaver nodeType
 * @expression
 * @label Sample
 * @description A sample node type for your marketplace pack
 * @color blue
 * @icon inventory
 * @tag ${shortName}
 */
export function sample(data: string): { result: string } {
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
    path.join(targetDir, 'src', 'index.ts'),
    [
      "export * from './node-types/index.js';",
      "export * from './workflows/index.js';",
      '',
    ].join('\n')
  );

  // README.md
  const readme = `# ${name}

A [Flow Weaver](https://github.com/synergenius-fw/flow-weaver) marketplace pack.

## Installation

\`\`\`bash
fw market install ${name}
\`\`\`

## Contents

### Node Types

- **Sample**: a sample node type in src/node-types/sample.ts. Add yours beside it and re-export them from src/index.ts

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
  logger.log('  # Add your node types and workflows to src/');
  logger.log('  npm run build');
  logger.log('  fw market pack');
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
    if (!validation.valid) {
      process.exitCode = 1;
    }
    return;
  }

  // Display results
  logger.info(`Parsed ${parsedFiles.length} file(s)`);
  logger.info(`Found ${manifest.nodeTypes.length} node type(s), ${manifest.workflows.length} workflow(s)`);
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
    throw new Error('Package validation failed. Fix errors above before publishing.');
  }

  // 3. Write manifest
  const outPath = writeManifest(dir, manifest);
  logger.newline();
  logger.success(`Manifest written to ${path.relative(dir, outPath)}`);

  if (warnings.length > 0) {
    logger.warn(`${warnings.length} warning(s). Consider fixing before publishing`);
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
    logger.warn('LICENSE file not found. Consider adding one');
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
    throw new Error(`npm publish failed: ${getErrorMessage(err)}`);
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
    process.exitCode = 1;
    return;
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
    logger.info('The package may need to run "fw market pack" before publishing');
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
    // One registry when named; otherwise every one the project's npm uses,
    // which is how a private pack is found without knowing its URL.
    let results: TMarketplacePackageInfo[];
    if (registry) {
      results = await searchPackages({ query, limit, registryUrl: registry });
    } else {
      const multi = await searchAllRegistries({ query, limit, projectDir: process.cwd() });
      results = multi.results;
      if (!json) {
        for (const s of multi.searched) {
          const scopes = s.scopes.length ? ` (${s.scopes.join(', ')})` : '';
          if (s.ok) logger.info(`Searched ${s.url}${scopes}: ${s.count} pack(s)`);
          else logger.warn(`Could not search ${s.url}${scopes}: ${s.error}`);
        }
        logger.newline();
      }
    }

    // Client-side filtering: npm search may return broad results, narrow to query match
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(
        (pkg) => pkg.name.toLowerCase().includes(q) || (pkg.description && pkg.description.toLowerCase().includes(q))
      );
    }

    if (json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      logger.info(query ? `No packages matching "${query}"` : 'No packages found');
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
    process.exitCode = 1;
    return;
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
    })), null, 2));
    return;
  }

  if (packages.length === 0) {
    logger.info('No marketplace packages installed');
    logger.info('Use "fw market search" to find packages');
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
    // flow-weaver-pack-test-1.0.0 → flow-weaver-pack-test
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
      const desc = nt.description ? `: ${nt.description}` : '';
      logger.log(`    - ${nt.name}${desc}`);
    }
  }

  if (manifest.workflows.length > 0) {
    logger.log('  Workflows:');
    for (const wf of manifest.workflows) {
      const desc = wf.description ? `: ${wf.description}` : '';
      logger.log(`    - ${wf.name}${desc}`);
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

  if (counts.length > 0) {
    logger.log(`    ${counts.join(', ')}`);
  }

  logger.newline();
}
