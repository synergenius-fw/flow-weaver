/**
 * Tests for plugin command (scaffolding, validation, file generation)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('../../src/cli/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
    newline: vi.fn(),
    section: vi.fn(),
  },
}));

import {
  validatePluginName,
  generatePluginFiles,
  pluginInitCommand,
} from '../../src/cli/commands/plugin';
import { logger } from '../../src/cli/utils/logger.js';

const PLUGIN_TEMP_DIR = path.join(os.tmpdir(), `flow-weaver-plugin-test-${process.pid}`);

beforeEach(() => {
  fs.mkdirSync(PLUGIN_TEMP_DIR, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(PLUGIN_TEMP_DIR, { recursive: true, force: true });
});

// -- validatePluginName --

describe('validatePluginName', () => {
  it('should return true for a valid name', () => {
    expect(validatePluginName('my-plugin')).toBe(true);
  });

  it('should return true for name with dots and underscores', () => {
    expect(validatePluginName('my_plugin.v2')).toBe(true);
  });

  it('should return true for single character name', () => {
    expect(validatePluginName('x')).toBe(true);
  });

  it('should return true for name starting with a digit', () => {
    expect(validatePluginName('3d-viewer')).toBe(true);
  });

  it('should return error string for empty name', () => {
    const result = validatePluginName('');
    expect(result).toBe('Plugin name cannot be empty');
  });

  it('should return error string for name exceeding 100 characters', () => {
    const result = validatePluginName('a'.repeat(101));
    expect(typeof result).toBe('string');
    expect(result).toContain('at most 100');
  });

  it('should return error string for name starting with a hyphen', () => {
    const result = validatePluginName('-bad-name');
    expect(typeof result).toBe('string');
    expect(result).toContain('must start with');
  });

  it('should return error string for name with spaces', () => {
    const result = validatePluginName('my plugin');
    expect(typeof result).toBe('string');
  });

  it('should return error string for name with special characters', () => {
    const result = validatePluginName('my@plugin!');
    expect(typeof result).toBe('string');
  });
});

// -- generatePluginFiles --

describe('generatePluginFiles', () => {
  it('should generate plugin-artifact.yaml and client/index.tsx', () => {
    const files = generatePluginFiles('test-plugin', { area: 'sidebar', system: false });

    expect(files).toHaveProperty('plugin-artifact.yaml');
    expect(files).toHaveProperty('client/index.tsx');
    expect(Object.keys(files)).toHaveLength(2);
  });

  it('should include system/index.ts when system is true', () => {
    const files = generatePluginFiles('test-plugin', { area: 'sidebar', system: true });

    expect(files).toHaveProperty('system/index.ts');
    expect(Object.keys(files)).toHaveLength(3);
  });

  it('should include plugin name in plugin-artifact.yaml', () => {
    const files = generatePluginFiles('my-sidebar', { area: 'sidebar', system: false });

    expect(files['plugin-artifact.yaml']).toContain('name: my-sidebar');
    expect(files['plugin-artifact.yaml']).toContain('version: 1.0.0');
  });

  it('should include system entry in artifact when system is true', () => {
    const files = generatePluginFiles('my-plugin', { area: 'panel', system: true });

    expect(files['plugin-artifact.yaml']).toContain('system: ./system/index.ts');
  });

  it('should not include system entry in artifact when system is false', () => {
    const files = generatePluginFiles('my-plugin', { area: 'panel', system: false });

    expect(files['plugin-artifact.yaml']).not.toContain('system:');
  });

  it('should generate PascalCase component name from plugin name', () => {
    const files = generatePluginFiles('my-cool-plugin', { area: 'sidebar', system: false });

    expect(files['client/index.tsx']).toContain('MyCoolPluginPanel');
  });

  it('should handle plugin names with dots and underscores in PascalCase', () => {
    const files = generatePluginFiles('data_viewer.v2', { area: 'main', system: false });

    expect(files['client/index.tsx']).toContain('DataViewerV2Panel');
  });

  it('should set the correct area in client config', () => {
    const files = generatePluginFiles('test-plugin', { area: 'toolbar', system: false });

    expect(files['client/index.tsx']).toContain("area: 'toolbar'");
  });

  it('should include fetchData call when system is true', () => {
    const files = generatePluginFiles('test-plugin', { area: 'panel', system: true });

    expect(files['client/index.tsx']).toContain('fetchData');
    expect(files['client/index.tsx']).toContain("'getData'");
  });

  it('should show "Plugin loaded." text when system is false', () => {
    const files = generatePluginFiles('test-plugin', { area: 'panel', system: false });

    expect(files['client/index.tsx']).toContain('Plugin loaded.');
  });

  it('should generate system module with getData method', () => {
    const files = generatePluginFiles('my-plugin', { area: 'panel', system: true });

    const systemContent = files['system/index.ts'];
    expect(systemContent).toContain('async getData()');
    expect(systemContent).toContain('Hello from my-plugin');
    expect(systemContent).toContain('TPluginSystemModule');
  });
});

// -- pluginInitCommand --

describe('pluginInitCommand', () => {
  let origCwd: () => string;

  beforeEach(() => {
    origCwd = process.cwd;
    process.cwd = () => PLUGIN_TEMP_DIR;
  });

  afterEach(() => {
    process.cwd = origCwd;
  });

  it('should throw for invalid plugin name', async () => {
    await expect(
      pluginInitCommand('', {})
    ).rejects.toThrow('Plugin name cannot be empty');
  });

  it('should throw for invalid area', async () => {
    await expect(
      pluginInitCommand('my-plugin', { area: 'invalid-area' })
    ).rejects.toThrow('Invalid area');
  });

  it('should create files under plugins/<name>/', async () => {
    await pluginInitCommand('test-scaffold', {});

    const targetDir = path.join(PLUGIN_TEMP_DIR, 'plugins', 'test-scaffold');
    expect(fs.existsSync(path.join(targetDir, 'plugin-artifact.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'client', 'index.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'system', 'index.ts'))).toBe(true);
  });

  it('should create only client files when system is false', async () => {
    await pluginInitCommand('no-system', { system: false });

    const targetDir = path.join(PLUGIN_TEMP_DIR, 'plugins', 'no-system');
    expect(fs.existsSync(path.join(targetDir, 'plugin-artifact.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'client', 'index.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'system', 'index.ts'))).toBe(false);
  });

  it('should log success messages for created files', async () => {
    await pluginInitCommand('log-test', {});

    expect(logger.section).toHaveBeenCalledWith('Plugin scaffolded');
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining('Created plugins/log-test/')
    );
  });

  it('should skip existing files without --force', async () => {
    // Create the plugin first
    await pluginInitCommand('skip-test', {});

    vi.clearAllMocks();

    // Run again without force
    await pluginInitCommand('skip-test', {});

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipped')
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('already exists')
    );
  });

  it('should overwrite existing files with --force', async () => {
    // Create the plugin first
    await pluginInitCommand('force-test', {});

    vi.clearAllMocks();

    // Run again with force
    await pluginInitCommand('force-test', { force: true });

    // Should report created, not skipped
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining('Created')
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should output preview without writing files', async () => {
    await pluginInitCommand('preview-test', { preview: true });

    const targetDir = path.join(PLUGIN_TEMP_DIR, 'plugins', 'preview-test');
    expect(fs.existsSync(targetDir)).toBe(false);
    expect(logger.section).toHaveBeenCalledWith('Preview');
  });

  it('should use "panel" as default area', async () => {
    await pluginInitCommand('default-area', {});

    const targetDir = path.join(PLUGIN_TEMP_DIR, 'plugins', 'default-area');
    const clientContent = fs.readFileSync(
      path.join(targetDir, 'client', 'index.tsx'),
      'utf8'
    );
    expect(clientContent).toContain("area: 'panel'");
  });

  it('should use the specified area', async () => {
    await pluginInitCommand('custom-area', { area: 'modal' });

    const targetDir = path.join(PLUGIN_TEMP_DIR, 'plugins', 'custom-area');
    const clientContent = fs.readFileSync(
      path.join(targetDir, 'client', 'index.tsx'),
      'utf8'
    );
    expect(clientContent).toContain("area: 'modal'");
  });

  it('should show next steps after scaffolding', async () => {
    await pluginInitCommand('steps-test', {});

    expect(logger.section).toHaveBeenCalledWith('Next steps');
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('pluginsDir')
    );
  });

  it('should accept all valid area values', async () => {
    const areas = ['sidebar', 'main', 'toolbar', 'modal', 'panel'];
    for (const area of areas) {
      vi.clearAllMocks();
      await pluginInitCommand(`area-${area}`, { area });
      expect(logger.section).toHaveBeenCalledWith('Plugin scaffolded');
    }
  });
});
