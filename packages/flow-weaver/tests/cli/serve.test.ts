/**
 * Tests for the serve command and webhook server components
 *
 * Tests workflow discovery, registry, and endpoint generation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowRegistry } from '../../src/server/workflow-registry';

const tempDir = path.join(os.tmpdir(), `flow-weaver-serve-test-${process.pid}`);

// Sample workflows for testing
const WORKFLOW_A = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input value - Input value
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output doubled - Doubled result
 */
function doubleValue(execute: boolean, value: number): { onSuccess: boolean; onFailure: boolean; doubled: number } {
  if (!execute) return { onSuccess: false, onFailure: false, doubled: 0 };
  return { onSuccess: true, onFailure: false, doubled: value * 2 };
}

/**
 * @flowWeaver workflow
 * @name doubler
 * @description Doubles a numeric value
 * @node d doubleValue
 * @connect Start.execute -> d.execute
 * @connect Start.value -> d.value
 * @connect d.onSuccess -> Exit.onSuccess
 * @connect d.doubled -> Exit.doubled
 */
export function doubler(
  execute: boolean,
  params: { value: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; doubled: number }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

const WORKFLOW_B = `
/**
 * @flowWeaver nodeType
 * @input execute - Execute
 * @input text - Input text
 * @output onSuccess - On Success
 * @output onFailure - On Failure
 * @output upper - Uppercase result
 */
function toUpperCase(execute: boolean, text: string): { onSuccess: boolean; onFailure: boolean; upper: string } {
  if (!execute) return { onSuccess: false, onFailure: false, upper: '' };
  return { onSuccess: true, onFailure: false, upper: text.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @name uppercaser
 * @description Converts text to uppercase
 * @node u toUpperCase
 * @connect Start.execute -> u.execute
 * @connect Start.text -> u.text
 * @connect u.onSuccess -> Exit.onSuccess
 * @connect u.upper -> Exit.upper
 */
export function uppercaser(
  execute: boolean,
  params: { text: string }
): Promise<{ onSuccess: boolean; onFailure: boolean; upper: string }> {
  // @flowWeaver generated-body
  throw new Error('Not compiled');
  // @flowWeaver end-generated-body
}
`;

const NON_WORKFLOW_FILE = `
// This is a regular TypeScript file, not a workflow
export function helper(x: number): number {
  return x + 1;
}
`;

// Setup temp directory
beforeAll(() => {
  fs.mkdirSync(tempDir, { recursive: true });

  // Create workflows subdirectory
  fs.mkdirSync(path.join(tempDir, 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'nested', 'deep'), { recursive: true });
});

// Cleanup
afterAll(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe('WorkflowRegistry', () => {
  describe('workflow discovery', () => {
    it('should discover workflows in a directory', async () => {
      // Setup files
      fs.writeFileSync(path.join(tempDir, 'workflows', 'doubler.ts'), WORKFLOW_A);
      fs.writeFileSync(path.join(tempDir, 'workflows', 'uppercaser.ts'), WORKFLOW_B);

      const registry = new WorkflowRegistry(path.join(tempDir, 'workflows'));
      await registry.initialize();

      const endpoints = registry.getAllEndpoints();

      expect(endpoints.length).toBe(2);
      expect(endpoints.map((e) => e.name).sort()).toEqual(['doubler', 'uppercaser']);
    });

    it('should skip non-workflow files', async () => {
      // Setup files
      const testDir = path.join(tempDir, 'skip-test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'workflow.ts'), WORKFLOW_A);
      fs.writeFileSync(path.join(testDir, 'helper.ts'), NON_WORKFLOW_FILE);

      const registry = new WorkflowRegistry(testDir);
      await registry.initialize();

      const endpoints = registry.getAllEndpoints();

      expect(endpoints.length).toBe(1);
      expect(endpoints[0].name).toBe('doubler');
    });

    it('should discover workflows in nested directories', async () => {
      // Setup nested structure
      fs.writeFileSync(path.join(tempDir, 'nested', 'workflow1.ts'), WORKFLOW_A);
      fs.writeFileSync(path.join(tempDir, 'nested', 'deep', 'workflow2.ts'), WORKFLOW_B);

      const registry = new WorkflowRegistry(path.join(tempDir, 'nested'));
      await registry.initialize();

      const endpoints = registry.getAllEndpoints();

      expect(endpoints.length).toBe(2);
    });

    it('should skip .generated.ts files', async () => {
      const testDir = path.join(tempDir, 'generated-test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'workflow.ts'), WORKFLOW_A);
      fs.writeFileSync(path.join(testDir, 'workflow.generated.ts'), WORKFLOW_B);

      const registry = new WorkflowRegistry(testDir);
      await registry.initialize();

      const endpoints = registry.getAllEndpoints();

      expect(endpoints.length).toBe(1);
      expect(endpoints[0].name).toBe('doubler');
    });
  });

  describe('endpoint generation', () => {
    it('should generate correct endpoint paths', async () => {
      const testDir = path.join(tempDir, 'endpoint-test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'workflow.ts'), WORKFLOW_A);

      const registry = new WorkflowRegistry(testDir);
      await registry.initialize();

      const endpoint = registry.getEndpoint('doubler');

      expect(endpoint).toBeDefined();
      expect(endpoint?.path).toBe('/workflows/doubler');
      expect(endpoint?.method).toBe('POST');
    });

    it('should include workflow description', async () => {
      const testDir = path.join(tempDir, 'description-test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'workflow.ts'), WORKFLOW_A);

      const registry = new WorkflowRegistry(testDir);
      await registry.initialize();

      const endpoint = registry.getEndpoint('doubler');

      expect(endpoint?.description).toBe('Doubles a numeric value');
    });

    it('should extract input schema from workflow ports', async () => {
      const testDir = path.join(tempDir, 'input-schema-test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'workflow.ts'), WORKFLOW_A);

      const registry = new WorkflowRegistry(testDir);
      await registry.initialize();

      const endpoint = registry.getEndpoint('doubler');

      expect(endpoint?.inputSchema).toBeDefined();
      expect(endpoint?.inputSchema?.type).toBe('object');
      expect(endpoint?.inputSchema?.properties).toBeDefined();

      const props = endpoint?.inputSchema?.properties as Record<string, { type?: string }>;
      expect(props.value).toBeDefined();
      expect(props.value.type).toBe('number');
    });

    it('should extract output schema from workflow ports', async () => {
      const testDir = path.join(tempDir, 'output-schema-test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'workflow.ts'), WORKFLOW_A);

      const registry = new WorkflowRegistry(testDir);
      await registry.initialize();

      const endpoint = registry.getEndpoint('doubler');

      expect(endpoint?.outputSchema).toBeDefined();
      expect(endpoint?.outputSchema?.type).toBe('object');

      const props = endpoint?.outputSchema?.properties as Record<string, { type?: string }>;
      expect(props.doubled).toBeDefined();
      expect(props.doubled.type).toBe('number');
    });
  });

  describe('endpoint lookup', () => {
    it('should return undefined for non-existent workflow', async () => {
      const testDir = path.join(tempDir, 'lookup-test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'workflow.ts'), WORKFLOW_A);

      const registry = new WorkflowRegistry(testDir);
      await registry.initialize();

      const endpoint = registry.getEndpoint('nonexistent');

      expect(endpoint).toBeUndefined();
    });

    it('should return correct endpoint by name', async () => {
      const testDir = path.join(tempDir, 'lookup-correct-test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'a.ts'), WORKFLOW_A);
      fs.writeFileSync(path.join(testDir, 'b.ts'), WORKFLOW_B);

      const registry = new WorkflowRegistry(testDir);
      await registry.initialize();

      const endpoint = registry.getEndpoint('uppercaser');

      expect(endpoint).toBeDefined();
      expect(endpoint?.name).toBe('uppercaser');
      expect(endpoint?.functionName).toBe('uppercaser');
    });
  });

  describe('uptime tracking', () => {
    it('should track server uptime', async () => {
      const testDir = path.join(tempDir, 'uptime-test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'workflow.ts'), WORKFLOW_A);

      const registry = new WorkflowRegistry(testDir);
      await registry.initialize();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      const uptime = registry.getUptime();

      expect(uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('re-discovery', () => {
    it('should update endpoints on re-discovery', async () => {
      const testDir = path.join(tempDir, 'rediscover-test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'workflow.ts'), WORKFLOW_A);

      const registry = new WorkflowRegistry(testDir);
      await registry.initialize();

      expect(registry.getAllEndpoints().length).toBe(1);

      // Add another workflow
      fs.writeFileSync(path.join(testDir, 'workflow2.ts'), WORKFLOW_B);

      // Re-discover
      await registry.discoverWorkflows();

      expect(registry.getAllEndpoints().length).toBe(2);
    });
  });
});
