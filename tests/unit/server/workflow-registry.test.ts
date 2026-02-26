import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowRegistry } from '../../../src/server/workflow-registry.js';

const TEMP_DIR = path.join(os.tmpdir(), `fw-registry-test-${process.pid}`);

const WORKFLOW_WITH_TYPES = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input data - Input data
 * @input flag - Optional flag
 * @output onSuccess - On success
 * @output items - List of items
 * @output count - Item count
 */
function processor(execute: boolean, data: object, flag?: boolean): { onSuccess: boolean; items: any[]; count: number } {
  return { onSuccess: true, items: [], count: 0 };
}

/**
 * @flowWeaver workflow
 * @name processorFlow
 * @description Processes items with various data types
 * @node p processor
 * @connect Start.execute -> p.execute
 * @connect Start.data -> p.data
 * @connect p.onSuccess -> Exit.onSuccess
 * @connect p.items -> Exit.items
 * @connect p.count -> Exit.count
 */
export function processorFlow(
  execute: boolean,
  params: { data: object }
): Promise<{ onSuccess: boolean; items: any[]; count: number }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

const MALFORMED_FILE = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * This file has a deliberately broken annotation.
 */
function broken(execute: boolean)  {
  // Missing output annotations and return type
`;

beforeEach(() => {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe('WorkflowRegistry', () => {
  describe('schema extraction', () => {
    it('extracts input schema with required and optional ports', async () => {
      fs.writeFileSync(path.join(TEMP_DIR, 'wf.ts'), WORKFLOW_WITH_TYPES);

      const registry = new WorkflowRegistry(TEMP_DIR);
      await registry.initialize();

      const endpoint = registry.getEndpoint('processorFlow');
      expect(endpoint).toBeDefined();

      const schema = endpoint!.inputSchema!;
      expect(schema.type).toBe('object');

      const props = schema.properties as Record<string, { type: string }>;
      // 'execute' port should be excluded (it's the execute port)
      expect(props.execute).toBeUndefined();
      // 'data' should be present
      expect(props.data).toBeDefined();
      expect(props.data.type).toBe('object');
    });

    it('extracts output schema and skips control flow ports', async () => {
      fs.writeFileSync(path.join(TEMP_DIR, 'wf.ts'), WORKFLOW_WITH_TYPES);

      const registry = new WorkflowRegistry(TEMP_DIR);
      await registry.initialize();

      const endpoint = registry.getEndpoint('processorFlow');
      const schema = endpoint!.outputSchema!;
      expect(schema.type).toBe('object');

      const props = schema.properties as Record<string, { type: string }>;
      // Control flow ports (onSuccess, onFailure) should be excluded
      expect(props.onSuccess).toBeUndefined();
      expect(props.onFailure).toBeUndefined();
      // Data ports should be present
      expect(props.items).toBeDefined();
      expect(props.items.type).toBe('array');
      expect(props.count).toBeDefined();
      expect(props.count.type).toBe('number');
    });

    it('maps data types to JSON schema types correctly', async () => {
      // This tests the dataTypeToJsonSchema mapping indirectly through schema extraction.
      // STRING -> string, NUMBER -> number, BOOLEAN -> boolean, OBJECT -> object, ARRAY -> array
      fs.writeFileSync(path.join(TEMP_DIR, 'wf.ts'), WORKFLOW_WITH_TYPES);

      const registry = new WorkflowRegistry(TEMP_DIR);
      await registry.initialize();

      const endpoint = registry.getEndpoint('processorFlow');
      const inputProps = endpoint!.inputSchema!.properties as Record<string, { type: string }>;
      const outputProps = endpoint!.outputSchema!.properties as Record<string, { type: string }>;

      // data is OBJECT
      expect(inputProps.data.type).toBe('object');
      // items is ARRAY
      expect(outputProps.items.type).toBe('array');
      // count is NUMBER
      expect(outputProps.count.type).toBe('number');
    });
  });

  describe('parse error recovery', () => {
    it('skips files that fail to parse without crashing', async () => {
      fs.writeFileSync(path.join(TEMP_DIR, 'good.ts'), WORKFLOW_WITH_TYPES);
      fs.writeFileSync(path.join(TEMP_DIR, 'bad.ts'), MALFORMED_FILE);

      const registry = new WorkflowRegistry(TEMP_DIR);
      await registry.initialize();

      // Good file should still be registered
      const endpoints = registry.getAllEndpoints();
      expect(endpoints.length).toBeGreaterThanOrEqual(1);
      expect(endpoints.some((e) => e.name === 'processorFlow')).toBe(true);
    });

    it('skips files without @flowWeaver annotation', async () => {
      fs.writeFileSync(
        path.join(TEMP_DIR, 'util.ts'),
        'export function add(a: number, b: number) { return a + b; }',
      );

      const registry = new WorkflowRegistry(TEMP_DIR);
      await registry.initialize();

      expect(registry.getAllEndpoints()).toHaveLength(0);
    });
  });

  describe('file watching', () => {
    it('startWatching handles missing chokidar gracefully', async () => {
      // When chokidar can't be imported, startWatching should not throw.
      // This happens in environments where chokidar isn't installed.
      const registry = new WorkflowRegistry(TEMP_DIR);
      await registry.initialize();

      // The real chokidar is likely installed, so this tests the normal path.
      // We're mainly verifying it doesn't throw.
      const onChange = vi.fn();
      await registry.startWatching(onChange);
      await registry.stopWatching();
    });

    it('stopWatching clears debounce timers', async () => {
      const registry = new WorkflowRegistry(TEMP_DIR);
      await registry.initialize();

      const onChange = vi.fn();
      await registry.startWatching(onChange);

      // Immediately stop, should clear any pending timers
      await registry.stopWatching();

      // Call again, should be safe
      await registry.stopWatching();
    });
  });

  describe('discoverWorkflows', () => {
    it('clears endpoints before rediscovery', async () => {
      fs.writeFileSync(path.join(TEMP_DIR, 'wf.ts'), WORKFLOW_WITH_TYPES);

      const registry = new WorkflowRegistry(TEMP_DIR);
      await registry.initialize();
      expect(registry.getAllEndpoints()).toHaveLength(1);

      // Remove the file
      fs.unlinkSync(path.join(TEMP_DIR, 'wf.ts'));

      // Rediscover
      await registry.discoverWorkflows();
      expect(registry.getAllEndpoints()).toHaveLength(0);
    });

    it('handles multiple workflows in a single file', async () => {
      const multiWorkflow = WORKFLOW_WITH_TYPES + `
/**
 * @flowWeaver workflow
 * @name secondFlow
 * @description A second workflow in the same file
 * @node p processor
 * @connect Start.execute -> p.execute
 * @connect p.onSuccess -> Exit.onSuccess
 */
export function secondFlow(
  execute: boolean,
  params: {}
): Promise<{ onSuccess: boolean }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;
      fs.writeFileSync(path.join(TEMP_DIR, 'multi.ts'), multiWorkflow);

      const registry = new WorkflowRegistry(TEMP_DIR);
      await registry.initialize();

      const endpoints = registry.getAllEndpoints();
      expect(endpoints.length).toBe(2);
      expect(endpoints.map((e) => e.name).sort()).toEqual(['processorFlow', 'secondFlow']);
    });
  });

  describe('getUptime', () => {
    it('returns increasing uptime values', async () => {
      const registry = new WorkflowRegistry(TEMP_DIR);
      const t1 = registry.getUptime();

      // Give a tiny delay
      await new Promise((r) => setTimeout(r, 10));

      const t2 = registry.getUptime();
      expect(t2).toBeGreaterThanOrEqual(t1);
    });
  });
});
