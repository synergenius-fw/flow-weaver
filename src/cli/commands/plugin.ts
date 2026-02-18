/* eslint-disable no-console */
/**
 * Plugin command — scaffolds a new external plugin directory
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PluginInitOptions {
  area?: string;
  system?: boolean;
  preview?: boolean;
  force?: boolean;
}

// ── Validation ───────────────────────────────────────────────────────────────

const PLUGIN_NAME_RE = /^[a-zA-Z0-9][-a-zA-Z0-9_.]*$/;

const VALID_AREAS = ['sidebar', 'main', 'toolbar', 'modal', 'panel'] as const;

export function validatePluginName(name: string): string | true {
  if (!name) return 'Plugin name cannot be empty';
  if (name.length > 100) return 'Plugin name must be at most 100 characters';
  if (!PLUGIN_NAME_RE.test(name)) {
    return 'Plugin name must start with a letter or digit and contain only letters, digits, hyphens, dots, and underscores';
  }
  return true;
}

// ── File generation ──────────────────────────────────────────────────────────

function toPascalCase(name: string): string {
  return name
    .split(/[-_.]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

export function generatePluginFiles(
  pluginName: string,
  options: { area: string; system: boolean }
): Record<string, string> {
  const componentName = toPascalCase(pluginName) + 'Panel';

  const pluginArtifact = [
    `name: ${pluginName}`,
    'version: 1.0.0',
    `description: ${pluginName} plugin`,
    'entry:',
    '  client: ./client/index.tsx',
    ...(options.system ? ['  system: ./system/index.ts'] : []),
    'capabilities: {}',
    '',
  ].join('\n');

  const clientIndex = [
    "import { PluginPanel, createPlugin } from '@synergenius/flow-weaver/plugin';",
    "import type { TPluginComponentProps, TPluginComponentApi } from '@synergenius/flow-weaver/plugin';",
    "import React from 'react';",
    '',
    `const PLUGIN_NAME = '${pluginName}';`,
    '',
    ...(options.system
      ? [
          `const fetchData = async (api: TPluginComponentApi) =>`,
          `  api.call(PLUGIN_NAME, 'getData', undefined);`,
          '',
        ]
      : []),
    `const ${componentName} = (props: TPluginComponentProps) => {`,
    '  return (',
    '    <PluginPanel {...props}>',
    `      <div style={{ padding: 16 }}>`,
    `        <h3>${pluginName}</h3>`,
    ...(options.system
      ? [
          '        <button',
          '          onClick={async () => {',
          '            const result = await fetchData(props.api);',
          '            console.log(result);',
          '          }}',
          '        >',
          '          Fetch Data',
          '        </button>',
        ]
      : ['        <p>Plugin loaded.</p>']),
    '      </div>',
    '    </PluginPanel>',
    '  );',
    '};',
    '',
    'export default createPlugin(() => ({',
    '  async initialize() {},',
    '  ui: {',
    '    components: {',
    `      ${componentName},`,
    '    },',
    '    config: {',
    `      ${componentName}: {`,
    `        name: '${componentName}',`,
    `        displayName: '${pluginName}',`,
    `        area: '${options.area}',`,
    `        description: '${pluginName} plugin panel',`,
    '      },',
    '    },',
    '  },',
    '}));',
    '',
  ].join('\n');

  const files: Record<string, string> = {
    'plugin-artifact.yaml': pluginArtifact,
    'client/index.tsx': clientIndex,
  };

  if (options.system) {
    const systemIndex = [
      "import type { TPluginSystemModule } from '@synergenius/flow-weaver/plugin';",
      '',
      'const plugin: TPluginSystemModule = {',
      '  async initialize() {',
      '    // Plugin system module initialized',
      '  },',
      '  methods: {',
      '    async getData() {',
      `      return { message: 'Hello from ${pluginName}!' };`,
      '    },',
      '  },',
      '  async cleanup() {',
      '    // Plugin cleanup',
      '  },',
      '};',
      '',
      'export default plugin;',
      '',
    ].join('\n');

    files['system/index.ts'] = systemIndex;
  }

  return files;
}

// ── CLI entrypoint ───────────────────────────────────────────────────────────

export async function pluginInitCommand(name: string, options: PluginInitOptions): Promise<void> {
  const area = options.area ?? 'panel';
  const includeSystem = options.system !== false;
  const preview = options.preview ?? false;
  const force = options.force ?? false;

  // Validate plugin name
  const valid = validatePluginName(name);
  if (valid !== true) {
    throw new Error(valid);
  }

  // Validate area
  if (!VALID_AREAS.includes(area as (typeof VALID_AREAS)[number])) {
    throw new Error(`Invalid area "${area}". Available: ${VALID_AREAS.join(', ')}`);
  }

  const files = generatePluginFiles(name, { area, system: includeSystem });

  if (preview) {
    logger.section('Preview');
    for (const [relativePath, content] of Object.entries(files)) {
      logger.log(`\n── ${relativePath} ──`);
      logger.log(content);
    }
    return;
  }

  // Write files under plugins/<name>/
  const targetDir = path.resolve('plugins', name);
  const filesCreated: string[] = [];
  const filesSkipped: string[] = [];

  for (const [relativePath, content] of Object.entries(files)) {
    const absPath = path.join(targetDir, relativePath);
    const dir = path.dirname(absPath);
    fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(absPath) && !force) {
      filesSkipped.push(relativePath);
      continue;
    }

    fs.writeFileSync(absPath, content, 'utf8');
    filesCreated.push(relativePath);
  }

  // Output
  logger.section('Plugin scaffolded');

  for (const file of filesCreated) {
    logger.success(`Created plugins/${name}/${file}`);
  }
  for (const file of filesSkipped) {
    logger.warn(`Skipped plugins/${name}/${file} (already exists)`);
  }

  logger.newline();
  logger.section('Next steps');
  logger.log(`  Ensure your .flowweaver/config.yaml has: pluginsDir: plugins`);
  logger.log(`  Then restart the editor to load the plugin.`);
  logger.newline();
}
