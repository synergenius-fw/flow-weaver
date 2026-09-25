/**
 * Programmatic command runner for flow-weaver operations.
 * Provides a unified dispatch interface that maps command names to
 * the existing programmatic APIs, suitable for bot/agent consumption.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseWorkflow } from './parse.js';
import { validateWorkflow } from './validate.js';
import { compileWorkflow } from './compile.js';
import { generateInPlace } from './generate-in-place.js';
import { applyModifyOperation, validateModifyParams } from './modify-operation.js';
import { generateWorkflowFromTemplate } from './templates.js';
import {
  getNodes, getConnections, getTopologicalOrder,
  findIsolatedNodes, findDeadEnds, countNodes, countConnections,
} from './query.js';
import { WorkflowDiffer } from '../diff/WorkflowDiffer.js';
import { formatDiff } from '../diff/formatDiff.js';
import { searchPackages, listInstalledPackages } from '../marketplace/registry.js';
import { applyMigrations, getRegisteredMigrations } from '../migration/registry.js';

export interface CommandResult {
  output?: string;
  files?: string[];
  data?: unknown;
}

type CommandHandler = (args: Record<string, unknown>) => Promise<CommandResult>;

function resolveFile(args: Record<string, unknown>, cwd?: string): string {
  const file = String(args.file);
  return cwd ? path.resolve(cwd, file) : path.resolve(file);
}

const handlers: Record<string, CommandHandler> = {
  compile: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    await compileWorkflow(filePath);
    return { files: [filePath] };
  },

  validate: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      return { data: { valid: false, errors: parseResult.errors, warnings: parseResult.warnings } };
    }
    const validation = validateWorkflow(parseResult.ast);
    const errors = validation.errors.map((e) => typeof e === 'string' ? e : e.message);
    const warnings = validation.warnings.map((w) => typeof w === 'string' ? w : w.message);
    return { data: { valid: errors.length === 0, errors, warnings } };
  },

  describe: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const { describeWorkflow, formatTextOutput } = await import('../cli/commands/describe.js');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const output = describeWorkflow(parseResult.ast);
    return { output: formatTextOutput(parseResult.ast, output) };
  },

  diagram: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const { fileToSVG, fileToASCII } = await import('../diagram/index.js');
    const format = (args.format as string) ?? 'ascii';
    const output = format === 'svg' ? fileToSVG(filePath) : fileToASCII(filePath);
    return { output };
  },

  mermaid: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const { generateMermaid } = await import('../cli/commands/describe.js');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    return { output: generateMermaid(parseResult.ast) };
  },

  diff: async (args) => {
    const cwd = args.cwd as string | undefined;
    const fileA = cwd ? path.resolve(cwd, String(args.fileA ?? args.file)) : path.resolve(String(args.fileA ?? args.file));
    const fileB = cwd ? path.resolve(cwd, String(args.fileB)) : path.resolve(String(args.fileB));
    const parseA = await parseWorkflow(fileA);
    const parseB = await parseWorkflow(fileB);
    if (parseA.errors.length > 0) throw new Error(`Parse errors in ${fileA}:\n${parseA.errors.join('\n')}`);
    if (parseB.errors.length > 0) throw new Error(`Parse errors in ${fileB}:\n${parseB.errors.join('\n')}`);
    const diff = WorkflowDiffer.compare(parseA.ast, parseB.ast);
    const format = (args.format as string) ?? 'text';
    return { output: formatDiff(diff, format === 'json' ? 'json' : 'text') };
  },

  context: async (args) => {
    const { buildContext } = await import('../context/index.js');
    const preset = args.preset as 'core' | 'authoring' | 'ops' | 'full' | undefined;
    const result = buildContext(preset ? { preset } : undefined);
    return { output: result.content };
  },

  modify: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const operation = String(args.operation);
    const params = (args.params as Record<string, unknown>) ?? {};
    const validation = validateModifyParams(operation, params);
    if (!validation.success) {
      throw new Error(validation.error);
    }
    const source = fs.readFileSync(filePath, 'utf-8');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const { ast: modifiedAST } = applyModifyOperation(parseResult.ast, operation, params);
    const result = generateInPlace(source, modifiedAST);
    fs.writeFileSync(filePath, result.code, 'utf-8');
    return { files: [filePath] };
  },

  'add-node': async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const source = fs.readFileSync(filePath, 'utf-8');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const { ast } = applyModifyOperation(parseResult.ast, 'addNode', {
      nodeId: String(args.nodeId), nodeType: String(args.nodeType),
    });
    const result = generateInPlace(source, ast);
    fs.writeFileSync(filePath, result.code, 'utf-8');
    return { files: [filePath] };
  },

  'remove-node': async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const source = fs.readFileSync(filePath, 'utf-8');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const { ast } = applyModifyOperation(parseResult.ast, 'removeNode', { nodeId: String(args.nodeId) });
    const result = generateInPlace(source, ast);
    fs.writeFileSync(filePath, result.code, 'utf-8');
    return { files: [filePath] };
  },

  'add-connection': async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const source = fs.readFileSync(filePath, 'utf-8');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const { ast } = applyModifyOperation(parseResult.ast, 'addConnection', {
      from: String(args.from), to: String(args.to),
    });
    const result = generateInPlace(source, ast);
    fs.writeFileSync(filePath, result.code, 'utf-8');
    return { files: [filePath] };
  },

  'remove-connection': async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const source = fs.readFileSync(filePath, 'utf-8');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const { ast } = applyModifyOperation(parseResult.ast, 'removeConnection', {
      from: String(args.from), to: String(args.to),
    });
    const result = generateInPlace(source, ast);
    fs.writeFileSync(filePath, result.code, 'utf-8');
    return { files: [filePath] };
  },

  scaffold: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const workflowName = path.basename(filePath, '.ts');
    const code = generateWorkflowFromTemplate(String(args.template), { workflowName });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, code, 'utf-8');
    return { files: [filePath] };
  },

  query: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
    }
    const ast = parseResult.ast;
    const queryType = String(args.query);

    let data: Record<string, unknown>;
    switch (queryType) {
      case 'nodes':
        data = { nodes: getNodes(ast).map((n) => ({ id: n.id, type: n.nodeType })) };
        break;
      case 'connections':
        data = { connections: getConnections(ast).map((c) => ({ from: `${c.from.node}.${c.from.port}`, to: `${c.to.node}.${c.to.port}` })) };
        break;
      case 'isolated':
        data = { isolated: findIsolatedNodes(ast) };
        break;
      case 'dead-ends':
        data = { deadEnds: findDeadEnds(ast) };
        break;
      case 'topology':
        data = { order: getTopologicalOrder(ast) };
        break;
      case 'stats':
        data = { nodeCount: countNodes(ast), connectionCount: countConnections(ast), isolatedNodes: findIsolatedNodes(ast), deadEnds: findDeadEnds(ast) };
        break;
      default:
        throw new Error(`Unknown query type: ${queryType}. Valid types: nodes, connections, isolated, dead-ends, topology, stats`);
    }
    return { data };
  },

  run: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const { executeWorkflow } = await import('../mcp/workflow-executor.js');
    const params = (args.params as Record<string, unknown>) ?? {};
    const result = await executeWorkflow({
      runId: randomUUID(),
      filePath,
      params,
      workflowName: args.workflow as string | undefined,
    });
    if (result.kind === 'yielded') {
      throw new Error(
        'The programmatic command runner is not a durable coordinator and cannot persist a yielded continuation',
      );
    }
    return { data: result };
  },

  // ─── status ─────────────────────────────────────────────────────
  status: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const parseResult = await parseWorkflow(filePath, {
      workflowName: args.workflow as string | undefined,
    });
    if (parseResult.errors.length > 0) {
      return { data: { valid: false, errors: parseResult.errors } };
    }
    const ast = parseResult.ast;
    const nodeTypes = ast.nodeTypes ?? [];
    const stubs = nodeTypes.filter((nt) => nt.variant === 'STUB').map((nt) => nt.name);
    const implemented = nodeTypes.filter((nt) => nt.variant !== 'STUB').map((nt) => nt.name);
    return {
      data: {
        total: nodeTypes.length,
        implemented,
        stubs,
        progress: nodeTypes.length > 0
          ? Math.round((implemented.length / nodeTypes.length) * 100)
          : 100,
      },
    };
  },

  // ─── market-search ──────────────────────────────────────────────
  'market-search': async (args) => {
    const query = String(args.query ?? '');
    const results = await searchPackages({ query });
    return { data: { results, query } };
  },

  // ─── market-list ────────────────────────────────────────────────
  'market-list': async (args) => {
    const cwd = (args.cwd as string) || process.cwd();
    const packages = await listInstalledPackages(cwd);
    return {
      data: {
        packages: packages.map((p) => ({
          name: p.name,
          version: p.version,
          nodeTypes: p.manifest.nodeTypes?.length ?? 0,
          workflows: p.manifest.workflows?.length ?? 0,
          cliCommands: p.manifest.cliCommands?.length ?? 0,
        })),
      },
    };
  },

  // ─── market-install ─────────────────────────────────────────────
  'market-install': async (args) => {
    const pkg = args.package as string | undefined;
    if (!pkg) {
      return { data: { success: false, error: 'Package name is required' } };
    }
    const cwd = (args.cwd as string) || process.cwd();
    try {
      const { execSync } = await import('child_process');
      execSync(`npm install ${pkg}`, { cwd, stdio: 'pipe' });
      // Try to read manifest from installed package
      const packageName = pkg.replace(/@[^/]*$/, ''); // strip version suffix
      const manifestPath = path.join(cwd, 'node_modules', packageName, 'flowweaver.manifest.json');
      let manifest = null;
      if (fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      }
      return { data: { success: true, package: pkg, manifest: manifest ? { name: manifest.name, version: manifest.version, nodeTypes: manifest.nodeTypes?.length ?? 0 } : null } };
    } catch (err) {
      return { data: { success: false, error: err instanceof Error ? err.message : String(err) } };
    }
  },

  // ─── market-uninstall ──────────────────────────────────────────
  'market-uninstall': async (args) => {
    const pkg = args.package as string | undefined;
    if (!pkg) {
      return { data: { success: false, error: 'Package name is required' } };
    }
    const cwd = (args.cwd as string) || process.cwd();
    try {
      const { execSync } = await import('child_process');
      execSync(`npm uninstall ${pkg}`, { cwd, stdio: 'pipe' });
      return { data: { success: true, package: pkg, removed: true } };
    } catch (err) {
      return { data: { success: false, error: err instanceof Error ? err.message : String(err) } };
    }
  },

  // ─── market-init ───────────────────────────────────────────────
  'market-init': async (args) => {
    const name = args.name as string | undefined;
    if (!name) {
      return { data: { success: false, error: 'Pack name is required' } };
    }
    const directory = path.resolve(String(args.directory || name));
    fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(path.join(directory, 'src'), { recursive: true });

    // Create package.json
    const pkg = {
      name: name.startsWith('flow-weaver-pack-') ? name : `flow-weaver-pack-${name}`,
      version: '0.1.0',
      type: 'module',
      main: 'dist/index.js',
      flowWeaver: {
        type: 'marketplace-pack',
        engineVersion: '>=0.30.0',
        categories: [],
      },
      scripts: {
        build: 'tsc',
        pack: 'fw market pack',
      },
      peerDependencies: {
        '@synergenius/flow-weaver': '>=0.30.0',
      },
    };
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(pkg, null, 2));

    // Create tsconfig
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
        outDir: 'dist', declaration: true, strict: true, esModuleInterop: true,
      },
      include: ['src'],
    };
    fs.writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

    // Create starter node type
    const starterNode = `/** @flowWeaver nodeType @expression */\nexport function hello(name: string): { greeting: string } {\n  return { greeting: \`Hello, \${name}!\` };\n}\n`;
    fs.writeFileSync(path.join(directory, 'src', 'index.ts'), starterNode);

    return { data: { success: true, directory, name: pkg.name, files: ['package.json', 'tsconfig.json', 'src/index.ts'] } };
  },

  // ─── market-pack ───────────────────────────────────────────────
  'market-pack': async (args) => {
    const directory = path.resolve(String(args.directory || process.cwd()));
    const pkgJsonPath = path.join(directory, 'package.json');

    if (!fs.existsSync(pkgJsonPath)) {
      return { data: { success: false, error: `No package.json found in ${directory}` } };
    }

    try {
      const { generateManifest, writeManifest } = await import('../marketplace/manifest.js');
      const { validatePackage } = await import('../marketplace/validator.js');

      const genResult = await generateManifest({ directory });
      const manifest = genResult.manifest;
      const dryRun = Boolean(args.dryRun);

      if (!dryRun) {
        writeManifest(directory, manifest);
      }

      // Run validation
      const validation = await validatePackage(directory, manifest);
      const errors = validation.issues.filter((i) => i.severity === 'error');
      const warnings = validation.issues.filter((i) => i.severity === 'warning');

      return {
        data: {
          success: errors.length === 0,
          manifest: {
            name: manifest.name,
            version: manifest.version,
            nodeTypes: manifest.nodeTypes?.length ?? 0,
            workflows: manifest.workflows?.length ?? 0,
            cliCommands: manifest.cliCommands?.length ?? 0,
          },
          errors: errors.map((e) => e.message),
          warnings: warnings.map((w) => w.message),
          dryRun,
        },
      };
    } catch (err) {
      return { data: { success: false, error: err instanceof Error ? err.message : String(err) } };
    }
  },

  // ─── market-publish ────────────────────────────────────────────
  'market-publish': async (args) => {
    const directory = path.resolve(String(args.directory || process.cwd()));
    const dryRun = Boolean(args.dryRun);
    const tag = args.tag as string | undefined;

    const pkgJsonPath = path.join(directory, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      return { data: { success: false, error: `No package.json found in ${directory}` } };
    }

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

    if (dryRun) {
      return {
        data: {
          success: true,
          dryRun: true,
          package: pkg.name,
          version: pkg.version,
          message: `Would publish ${pkg.name}@${pkg.version}${tag ? ` with tag ${tag}` : ''}`,
        },
      };
    }

    try {
      const { execSync } = await import('child_process');
      const tagFlag = tag ? ` --tag ${tag}` : '';
      execSync(`npm publish${tagFlag}`, { cwd: directory, stdio: 'pipe' });
      return { data: { success: true, package: pkg.name, version: pkg.version, published: true } };
    } catch (err) {
      return { data: { success: false, error: err instanceof Error ? err.message : String(err) } };
    }
  },

  // ─── migrate ────────────────────────────────────────────────────
  migrate: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const dryRun = Boolean(args.dryRun);
    const source = fs.readFileSync(filePath, 'utf-8');
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      return { data: { migrated: false, errors: parseResult.errors } };
    }
    const migrated = applyMigrations(parseResult.ast);
    const genResult = generateInPlace(source, migrated);
    const newSource = genResult.code;
    const changed = newSource !== source;
    if (changed && !dryRun) {
      fs.writeFileSync(filePath, newSource);
    }
    return {
      data: {
        migrated: true,
        changed,
        dryRun,
        file: filePath,
        availableMigrations: getRegisteredMigrations().map((m) => m.name),
      },
    };
  },

  // ─── openapi ────────────────────────────────────────────────────
  openapi: async (args) => {
    // The document `fw serve` publishes at /openapi.json and `fw openapi`
    // writes to a file: declared @http routes, run resources, run endpoints.
    const directory = path.resolve(String(args.directory));
    const { openApiForDirectory, formatOpenApi } = await import('../server/openapi-document.js');
    const format = args.format === 'yaml' ? 'yaml' : 'json';

    const { doc, workflowCount, routeCount, problems } = await openApiForDirectory(directory, {
      title: args.title as string | undefined,
      version: args.version as string | undefined,
      description: args.description as string | undefined,
      serverUrl: (args.serverUrl ?? args.server) as string | undefined,
      auth: args.auth === undefined ? undefined : Boolean(args.auth),
      legacy: args.legacy === undefined ? undefined : Boolean(args.legacy),
    });

    return { data: { spec: formatOpenApi(doc, format), format, workflowCount, routeCount, problems } };
  },

  // ─── export ──────────────────────────────────────────────────────
  export: async (args) => {
    const filePath = resolveFile(args, args.cwd as string | undefined);
    const target = String(args.target);
    const outputDir = args.output ? path.resolve(String(args.output)) : path.resolve('export');
    const dryRun = Boolean(args.dryRun);

    // Parse and validate
    const parseResult = await parseWorkflow(filePath);
    if (parseResult.errors.length > 0) {
      return { data: { errors: parseResult.errors } };
    }
    const validation = validateWorkflow(parseResult.ast);
    if (!validation.valid) {
      return { data: { errors: validation.errors.map((e) => typeof e === 'string' ? e : e.message) } };
    }

    // Compile first
    await compileWorkflow(filePath);

    // Load export target registry
    const { createTargetRegistry } = await import('../deployment/index.js');
    const registry = await createTargetRegistry(path.dirname(filePath));
    const targetInstance = registry.get(target);

    if (!targetInstance) {
      const available = registry.getNames();
      return { data: { error: `Unknown export target: ${target}. Available: ${available.join(', ')}` } };
    }

    if (dryRun) {
      return { data: { target, filePath, outputDir, dryRun: true, message: `Would export to ${target} at ${outputDir}` } };
    }

    const workflowName = (args.workflow as string) || parseResult.ast.name;
    const artifacts = await targetInstance.generate({
      sourceFile: filePath,
      workflowName,
      displayName: workflowName,
      outputDir,
    });

    return { data: { target, outputDir, files: artifacts.files.map((f) => f.relativePath) } };
  },

  // ─── doctor ─────────────────────────────────────────────────────
  doctor: async (args) => {
    const cwd = (args.cwd as string) || process.cwd();
    const checks: Array<{ name: string; ok: boolean; message: string }> = [];

    // Check package.json exists
    const pkgPath = path.join(cwd, 'package.json');
    const hasPkg = fs.existsSync(pkgPath);
    checks.push({ name: 'package.json', ok: hasPkg, message: hasPkg ? 'Found' : 'Not found' });

    // Check flow-weaver dependency
    if (hasPkg) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const hasFw = !!deps['@synergenius/flow-weaver'];
        checks.push({ name: 'flow-weaver dependency', ok: hasFw, message: hasFw ? deps['@synergenius/flow-weaver'] : 'Not installed' });
      } catch {
        checks.push({ name: 'flow-weaver dependency', ok: false, message: 'Could not parse package.json' });
      }
    }

    // Check node_modules
    const hasModules = fs.existsSync(path.join(cwd, 'node_modules'));
    checks.push({ name: 'node_modules', ok: hasModules, message: hasModules ? 'Found' : 'Run npm install' });

    // Check tsconfig
    const hasTsConfig = fs.existsSync(path.join(cwd, 'tsconfig.json'));
    checks.push({ name: 'tsconfig.json', ok: hasTsConfig, message: hasTsConfig ? 'Found' : 'Not found (optional)' });

    const allOk = checks.every((c) => c.ok);
    return { data: { healthy: allOk, checks } };
  },

  // ─── init ───────────────────────────────────────────────────────
  init: async (args) => {
    const directory = path.resolve(String(args.directory || 'flow-weaver-project'));
    const template = (args.template as string) || 'hello';

    // Create directory
    fs.mkdirSync(directory, { recursive: true });

    // Create package.json
    const name = path.basename(directory);
    const pkg = {
      name,
      version: '1.0.0',
      type: 'module',
      scripts: { build: 'fw compile src/**/*.ts', dev: 'fw dev src/**/*.ts' },
      dependencies: { '@synergenius/flow-weaver': 'latest' },
    };
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(pkg, null, 2));

    // Create src directory and a starter workflow via scaffold
    const srcDir = path.join(directory, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    try {
      const wfPath = path.join(srcDir, `${name}-workflow.ts`);
      const code = generateWorkflowFromTemplate(template, { workflowName: name });
      fs.writeFileSync(wfPath, code);
      return { data: { directory, template, files: [wfPath], message: `Project created. Run: cd ${name} && npm install` } };
    } catch {
      return { data: { directory, template, files: [], message: `Project directory created but template '${template}' failed. Run: fw create workflow sequential src/workflow.ts` } };
    }
  },

  // ─── grammar ────────────────────────────────────────────────────
  grammar: async (args) => {
    const { getAllGrammars, serializedToEBNF } = await import('../chevrotain-parser/grammar-diagrams.js');
    const format = (args.format as string) || 'ebnf';
    const grammars = getAllGrammars();
    const allProductions = [
      ...grammars.node, ...grammars.port, ...grammars.connect,
      ...grammars.path, ...grammars.map, ...grammars.fan,
      ...grammars.triggerCancel, ...grammars.scope,
    ];
    const grammar = serializedToEBNF(allProductions);
    return { data: { grammar, format } };
  },

};

export async function runCommand(
  name: string,
  args: Record<string, unknown>,
): Promise<CommandResult> {
  const handler = handlers[name];
  if (!handler) {
    throw new Error(`Unknown command: ${name}. Available: ${Object.keys(handlers).join(', ')}`);
  }
  return handler(args);
}

export function getAvailableCommands(): string[] {
  return Object.keys(handlers);
}
