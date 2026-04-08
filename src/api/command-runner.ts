/**
 * Programmatic command runner for flow-weaver operations.
 * Provides a unified dispatch interface that maps command names to
 * the existing programmatic APIs, suitable for bot/agent consumption.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseWorkflow } from './parse.js';
import { validateWorkflow } from './validate.js';
import { compileWorkflow } from './compile.js';
import { generateInPlace } from './generate-in-place.js';
import { applyModifyOperation, validateModifyParams } from './modify-operation.js';
import { generateWorkflowFromTemplate } from './templates.js';
import {
  getNode, getNodes, getConnections, getTopologicalOrder,
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
    const { executeWorkflowFromFile } = await import('../mcp/workflow-executor.js');
    const params = (args.params as Record<string, unknown>) ?? {};
    const result = await executeWorkflowFromFile(filePath, params, {
      workflowName: args.workflow as string | undefined,
    });
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
    const directory = path.resolve(String(args.directory));
    const { generateOpenAPIJson, generateOpenAPIYaml } = await import('../deployment/openapi/generator.js');
    const format = (args.format as string) || 'json';

    // Scan directory for .ts files and parse each for workflows
    const files = fs.readdirSync(directory).filter((f) => f.endsWith('.ts'));
    const endpoints: Array<{
      name: string; functionName: string; filePath: string;
      method: 'POST'; path: string; description?: string;
    }> = [];

    for (const file of files) {
      const filePath = path.join(directory, file);
      try {
        const parsed = await parseWorkflow(filePath);
        if (parsed.errors.length === 0) {
          endpoints.push({
            name: parsed.ast.name,
            functionName: parsed.ast.name,
            filePath,
            method: 'POST',
            path: `/${parsed.ast.name}`,
          });
        }
      } catch {
        // Skip unparseable files
      }
    }

    const genOptions = {
      title: (args.title as string) || 'Flow Weaver API',
      version: (args.version as string) || '1.0.0',
    };

    const spec = format === 'yaml'
      ? generateOpenAPIYaml(endpoints, genOptions)
      : generateOpenAPIJson(endpoints, genOptions);

    return { data: { spec, format, workflowCount: endpoints.length } };
  },

  // ─── login ──────────────────────────────────────────────────────
  login: async (args) => {
    try {
      const { saveCredentials, loadCredentials, getPlatformUrl } = await import('../cli/config/credentials.js');
      const apiKey = args.apiKey as string | undefined;
      if (apiKey) {
        saveCredentials({
          token: apiKey,
          email: '',
          plan: 'free',
          platformUrl: getPlatformUrl(),
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        });
        return { data: { authenticated: true, method: 'apiKey' } };
      }
      const existing = loadCredentials();
      if (existing) {
        return { data: { authenticated: true, method: 'existing' } };
      }
      return { data: { authenticated: false, message: 'Provide an apiKey parameter or run fw login in the terminal for browser auth.' } };
    } catch {
      return { data: { authenticated: false, message: 'Auth module not available' } };
    }
  },

  // ─── account ────────────────────────────────────────────────────
  account: async () => {
    try {
      const { loadCredentials, isLoggedIn } = await import('../cli/config/credentials.js');
      if (!isLoggedIn()) {
        return { data: { authenticated: false, message: 'Not logged in. Use fw login first.' } };
      }
      const creds = loadCredentials();
      const { PlatformClient } = await import('../cli/config/platform-client.js');
      const client = new PlatformClient(creds!);
      const user = await client.getUser();
      const usage = await client.getDetailedUsage();
      return { data: { authenticated: true, user, usage } };
    } catch (err) {
      return { data: { authenticated: false, message: err instanceof Error ? err.message : String(err) } };
    }
  },

  // ─── deploy ─────────────────────────────────────────────────────
  deploy: async (args) => {
    try {
      const { loadCredentials, isLoggedIn } = await import('../cli/config/credentials.js');
      if (!isLoggedIn()) {
        return { data: { authenticated: false, message: 'Not logged in. Use fw login first.' } };
      }
      const filePath = resolveFile(args, args.cwd as string | undefined);
      const source = fs.readFileSync(filePath, 'utf-8');
      const name = (args.name as string) || path.basename(filePath, '.ts');
      const creds = loadCredentials();
      const { PlatformClient } = await import('../cli/config/platform-client.js');
      const client = new PlatformClient(creds!);
      const pushed = await client.pushWorkflow(name, source);
      const deployed = await client.deploy(pushed.slug);
      return { data: { authenticated: true, slug: deployed.slug, status: deployed.status } };
    } catch (err) {
      return { data: { authenticated: false, message: err instanceof Error ? err.message : String(err) } };
    }
  },

  // ─── undeploy ───────────────────────────────────────────────────
  undeploy: async (args) => {
    try {
      const { loadCredentials, isLoggedIn } = await import('../cli/config/credentials.js');
      if (!isLoggedIn()) {
        return { data: { authenticated: false, message: 'Not logged in. Use fw login first.' } };
      }
      const slug = String(args.slug);
      const creds = loadCredentials();
      const { PlatformClient } = await import('../cli/config/platform-client.js');
      const client = new PlatformClient(creds!);
      await client.undeploy(slug);
      return { data: { authenticated: true, slug, removed: true } };
    } catch (err) {
      return { data: { authenticated: false, message: err instanceof Error ? err.message : String(err) } };
    }
  },

  // ─── cloud-status ───────────────────────────────────────────────
  'cloud-status': async () => {
    try {
      const { loadCredentials, isLoggedIn } = await import('../cli/config/credentials.js');
      if (!isLoggedIn()) {
        return { data: { authenticated: false, message: 'Not logged in. Use fw login first.' } };
      }
      const creds = loadCredentials();
      const { PlatformClient } = await import('../cli/config/platform-client.js');
      const client = new PlatformClient(creds!);
      const deployments = await client.listDeployments();
      const usage = await client.getUsage();
      return { data: { authenticated: true, deployments, usage } };
    } catch (err) {
      return { data: { authenticated: false, message: err instanceof Error ? err.message : String(err) } };
    }
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
