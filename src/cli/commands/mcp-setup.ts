/**
 * mcp-setup command — detect AI coding tools and configure the Flow Weaver MCP server.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import confirm from '@inquirer/confirm';
import { ExitPromptError } from '@inquirer/core';
import { isNonInteractive } from './init.js';

// ── Constants ────────────────────────────────────────────────────────────────

const MCP_COMMAND = 'npx';
const MCP_ARGS = ['@synergenius/flow-weaver@latest', 'mcp-server', '--stdio'];
const MCP_ENTRY = { command: MCP_COMMAND, args: [...MCP_ARGS] };

// ── Types ────────────────────────────────────────────────────────────────────

export type ToolId = 'claude' | 'cursor' | 'vscode' | 'windsurf' | 'codex' | 'openclaw';

export interface McpSetupDeps {
  execCommand: (cmd: string) => Promise<{ stdout: string; exitCode: number }>;
  fileExists: (filePath: string) => Promise<boolean>;
  readFile: (filePath: string) => Promise<string | null>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  mkdir: (dirPath: string) => Promise<void>;
  cwd: () => string;
  homedir: () => string;
  log: (msg: string) => void;
}

export interface ToolDefinition {
  id: ToolId;
  displayName: string;
  detect: (deps: McpSetupDeps) => Promise<boolean>;
  isConfigured: (deps: McpSetupDeps) => Promise<boolean>;
  configure: (deps: McpSetupDeps) => Promise<string>;
}

export interface McpSetupOptions {
  tool?: string[];
  all?: boolean;
  list?: boolean;
}

interface DetectedTool {
  id: ToolId;
  displayName: string;
  detected: boolean;
  configured: boolean;
}

interface ConfigResult {
  id: ToolId;
  displayName: string;
  action: 'configured' | 'already-configured' | 'skipped' | 'failed';
  detail: string;
}

// ── Deps ─────────────────────────────────────────────────────────────────────

export function defaultDeps(): McpSetupDeps {
  return {
    execCommand: async (cmd: string) => {
      try {
        const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        return { stdout: stdout.trim(), exitCode: 0 };
      } catch {
        return { stdout: '', exitCode: 1 };
      }
    },
    fileExists: async (filePath: string) => {
      try {
        await fs.promises.access(filePath);
        return true;
      } catch {
        return false;
      }
    },
    readFile: async (filePath: string) => {
      try {
        return await fs.promises.readFile(filePath, 'utf8');
      } catch {
        return null;
      }
    },
    writeFile: async (filePath: string, content: string) => {
      await fs.promises.writeFile(filePath, content, 'utf8');
    },
    mkdir: async (dirPath: string) => {
      await fs.promises.mkdir(dirPath, { recursive: true });
    },
    cwd: () => process.cwd(),
    homedir: () => os.homedir(),
    log: (msg: string) => process.stdout.write(msg + '\n'),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function whichCmd(binary: string): string {
  return process.platform === 'win32' ? `where ${binary}` : `which ${binary}`;
}

async function binaryExists(binary: string, deps: McpSetupDeps): Promise<boolean> {
  const result = await deps.execCommand(whichCmd(binary));
  return result.exitCode === 0;
}

export async function mergeJsonConfig(
  deps: McpSetupDeps,
  filePath: string,
  rootKey: string,
): Promise<{ action: 'created' | 'added' | 'already-configured'; detail: string }> {
  const existing = await deps.readFile(filePath);

  if (existing === null) {
    // File doesn't exist: create it
    const dir = path.dirname(filePath);
    await deps.mkdir(dir);
    const config = { [rootKey]: { 'flow-weaver': MCP_ENTRY } };
    await deps.writeFile(filePath, JSON.stringify(config, null, 2) + '\n');
    return { action: 'created', detail: `created ${filePath}` };
  }

  // File exists: parse and merge
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(existing);
  } catch {
    throw new Error(`invalid JSON in ${filePath}`);
  }

  if (!config[rootKey] || typeof config[rootKey] !== 'object') {
    config[rootKey] = {};
  }

  const servers = config[rootKey] as Record<string, unknown>;
  if (servers['flow-weaver']) {
    return { action: 'already-configured', detail: `already in ${filePath}` };
  }

  servers['flow-weaver'] = MCP_ENTRY;
  await deps.writeFile(filePath, JSON.stringify(config, null, 2) + '\n');
  return { action: 'added', detail: `added to ${filePath}` };
}

// ── Tool Registry ────────────────────────────────────────────────────────────

export const TOOL_REGISTRY: ToolDefinition[] = [
  // Claude Code
  {
    id: 'claude',
    displayName: 'Claude Code',
    detect: (deps) => binaryExists('claude', deps),
    isConfigured: async (deps) => {
      const result = await deps.execCommand('claude mcp list');
      return result.exitCode === 0 && result.stdout.includes('flow-weaver');
    },
    configure: async (deps) => {
      const cmd =
        `claude mcp add --scope project flow-weaver -- ${MCP_COMMAND} ${MCP_ARGS.join(' ')}`;
      const result = await deps.execCommand(cmd);
      if (result.exitCode !== 0) {
        throw new Error('claude mcp add failed');
      }
      return 'registered via claude mcp add';
    },
  },

  // Cursor
  {
    id: 'cursor',
    displayName: 'Cursor',
    detect: async (deps) => {
      const dirExists = await deps.fileExists(path.join(deps.cwd(), '.cursor'));
      if (dirExists) return true;
      return binaryExists('cursor', deps);
    },
    isConfigured: async (deps) => {
      const filePath = path.join(deps.cwd(), '.cursor', 'mcp.json');
      const content = await deps.readFile(filePath);
      if (!content) return false;
      try {
        const config = JSON.parse(content);
        return !!config?.mcpServers?.['flow-weaver'];
      } catch {
        return false;
      }
    },
    configure: async (deps) => {
      const filePath = path.join(deps.cwd(), '.cursor', 'mcp.json');
      const result = await mergeJsonConfig(deps, filePath, 'mcpServers');
      return result.detail;
    },
  },

  // VS Code Copilot
  {
    id: 'vscode',
    displayName: 'VS Code Copilot',
    detect: (deps) => binaryExists('code', deps),
    isConfigured: async (deps) => {
      const filePath = path.join(deps.cwd(), '.vscode', 'mcp.json');
      const content = await deps.readFile(filePath);
      if (!content) return false;
      try {
        const config = JSON.parse(content);
        return !!config?.servers?.['flow-weaver'];
      } catch {
        return false;
      }
    },
    configure: async (deps) => {
      const filePath = path.join(deps.cwd(), '.vscode', 'mcp.json');
      const result = await mergeJsonConfig(deps, filePath, 'servers');
      return result.detail;
    },
  },

  // Windsurf
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    detect: async (deps) => {
      const configDir = path.join(deps.homedir(), '.codeium', 'windsurf');
      const dirExists = await deps.fileExists(configDir);
      if (dirExists) return true;
      return binaryExists('windsurf', deps);
    },
    isConfigured: async (deps) => {
      const filePath = path.join(deps.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
      const content = await deps.readFile(filePath);
      if (!content) return false;
      try {
        const config = JSON.parse(content);
        return !!config?.mcpServers?.['flow-weaver'];
      } catch {
        return false;
      }
    },
    configure: async (deps) => {
      const filePath = path.join(deps.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
      const result = await mergeJsonConfig(deps, filePath, 'mcpServers');
      return result.detail;
    },
  },

  // Codex (OpenAI)
  {
    id: 'codex',
    displayName: 'Codex',
    detect: (deps) => binaryExists('codex', deps),
    isConfigured: async (deps) => {
      const result = await deps.execCommand('codex mcp list');
      return result.exitCode === 0 && result.stdout.includes('flow-weaver');
    },
    configure: async (deps) => {
      const cmd = `codex mcp add flow-weaver -- ${MCP_COMMAND} ${MCP_ARGS.join(' ')}`;
      const result = await deps.execCommand(cmd);
      if (result.exitCode !== 0) {
        throw new Error('codex mcp add failed');
      }
      return 'registered via codex mcp add';
    },
  },

  // OpenClaw
  {
    id: 'openclaw',
    displayName: 'OpenClaw',
    detect: async (deps) => {
      return deps.fileExists(path.join(deps.cwd(), 'openclaw.json'));
    },
    isConfigured: async (deps) => {
      const filePath = path.join(deps.cwd(), 'openclaw.json');
      const content = await deps.readFile(filePath);
      if (!content) return false;
      try {
        const config = JSON.parse(content);
        return !!config?.mcpServers?.['flow-weaver'];
      } catch {
        return false;
      }
    },
    configure: async (deps) => {
      const filePath = path.join(deps.cwd(), 'openclaw.json');
      const result = await mergeJsonConfig(deps, filePath, 'mcpServers');
      return result.detail;
    },
  },
];

// ── Detection ────────────────────────────────────────────────────────────────

export async function detectTools(deps: McpSetupDeps): Promise<DetectedTool[]> {
  const results = await Promise.all(
    TOOL_REGISTRY.map(async (tool) => {
      const detected = await tool.detect(deps);
      const configured = detected ? await tool.isConfigured(deps) : false;
      return { id: tool.id, displayName: tool.displayName, detected, configured };
    }),
  );
  return results;
}

// ── Configuration ────────────────────────────────────────────────────────────

async function configureTool(tool: ToolDefinition, deps: McpSetupDeps): Promise<ConfigResult> {
  try {
    const already = await tool.isConfigured(deps);
    if (already) {
      return { id: tool.id, displayName: tool.displayName, action: 'already-configured', detail: 'already configured' };
    }
    const detail = await tool.configure(deps);
    return { id: tool.id, displayName: tool.displayName, action: 'configured', detail };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: tool.id, displayName: tool.displayName, action: 'failed', detail: msg };
  }
}

// ── Command ──────────────────────────────────────────────────────────────────

export async function mcpSetupCommand(
  options: McpSetupOptions,
  deps?: McpSetupDeps,
): Promise<void> {
  const d = deps ?? defaultDeps();

  // Step 1: detect all tools
  const detected = await detectTools(d);

  // Step 2: --list mode
  if (options.list) {
    d.log('');
    for (const t of detected) {
      const status = t.detected
        ? (t.configured ? 'detected, configured' : 'detected')
        : 'not found';
      const icon = t.detected ? (t.configured ? '●' : '○') : '·';
      d.log(`  ${icon} ${t.displayName.padEnd(18)} ${status}`);
    }
    d.log('');
    return;
  }

  // Step 3: determine which tools to configure
  let toolIds: ToolId[];

  if (options.tool && options.tool.length > 0) {
    // Validate tool names
    const valid = new Set(TOOL_REGISTRY.map((t) => t.id));
    for (const name of options.tool) {
      if (!valid.has(name as ToolId)) {
        d.log(`Unknown tool: "${name}". Valid tools: ${[...valid].join(', ')}`);
        return;
      }
    }
    toolIds = options.tool as ToolId[];
  } else if (options.all) {
    toolIds = detected.filter((t) => t.detected).map((t) => t.id);
  } else if (isNonInteractive()) {
    // Non-TTY: configure all detected tools
    toolIds = detected.filter((t) => t.detected).map((t) => t.id);
  } else {
    // Interactive: show detection results, then confirm each
    const detectedTools = detected.filter((t) => t.detected);

    if (detectedTools.length === 0) {
      d.log('No AI coding tools detected. You can specify tools manually with --tool.');
      return;
    }

    d.log('');
    d.log('Detected tools:');
    for (const t of detected) {
      const icon = t.detected ? '✓' : '✗';
      d.log(`  ${icon} ${t.displayName}`);
    }
    d.log('');

    toolIds = [];
    try {
      for (const t of detectedTools) {
        if (t.configured) {
          d.log(`  ${t.displayName}: already configured, skipping`);
          continue;
        }
        const yes = await confirm({
          message: `Configure ${t.displayName}?`,
          default: true,
        });
        if (yes) toolIds.push(t.id);
      }
    } catch (err) {
      if (err instanceof ExitPromptError) return;
      throw err;
    }

    d.log('');
  }

  if (toolIds.length === 0) {
    const anyDetected = detected.some((t) => t.detected);
    if (!anyDetected) {
      d.log('No AI coding tools detected. You can specify tools manually with --tool.');
    } else {
      d.log('No tools selected.');
    }
    return;
  }

  // Step 4: configure selected tools
  const toolMap = new Map(TOOL_REGISTRY.map((t) => [t.id, t]));
  const results: ConfigResult[] = [];

  for (const id of toolIds) {
    const tool = toolMap.get(id)!;
    const result = await configureTool(tool, d);
    results.push(result);

    const icon = result.action === 'configured' ? '✓'
      : result.action === 'already-configured' ? '●'
      : '✗';
    d.log(`${icon} ${result.displayName}: ${result.detail}`);
  }

  // Summary
  const configured = results.filter((r) => r.action === 'configured').length;
  const alreadyDone = results.filter((r) => r.action === 'already-configured').length;
  const failed = results.filter((r) => r.action === 'failed').length;

  const parts: string[] = [];
  if (configured > 0) parts.push(`${configured} configured`);
  if (alreadyDone > 0) parts.push(`${alreadyDone} already configured`);
  if (failed > 0) parts.push(`${failed} failed`);

  d.log('');
  d.log(`Done. ${parts.join(', ')}.`);
}
