/**
 * Workflow registry for discovering and managing workflow endpoints
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { parseWorkflow } from '../api/parse.js';
import type { WorkflowEndpoint } from './types.js';
import type { TDataType, TWorkflowAST } from '../ast/types.js';

import type { FSWatcher } from 'chokidar';

/**
 * Registry that discovers, caches, and manages workflow endpoints
 */
export class WorkflowRegistry {
  private endpoints: Map<string, WorkflowEndpoint> = new Map();
  private watcher: FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private startTime = Date.now();

  constructor(
    private workflowDir: string,
    private options: { precompile?: boolean; production?: boolean } = {}
  ) {}

  /**
   * Initialize the registry by discovering all workflows
   */
  async initialize(): Promise<void> {
    await this.discoverWorkflows();
  }

  /**
   * Discover all workflow files in the configured directory
   */
  async discoverWorkflows(): Promise<void> {
    const files = await glob('**/*.ts', {
      cwd: this.workflowDir,
      absolute: true,
      ignore: [
        '**/*.generated.ts',
        '**/node_modules/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    });

    this.endpoints.clear();

    for (const file of files) {
      try {
        // Quick check for @flowWeaver annotation before parsing
        const content = fs.readFileSync(file, 'utf8');
        if (!content.includes('@flowWeaver')) {
          continue;
        }

        // The same parse the console and the coordinator do, so built-in
        // gates and imported node types resolve the same way here. A file
        // with several workflows refuses a nameless parse. Naming one gives
        // all of them.
        let result = await parseWorkflow(file, { projectDir: path.dirname(file) });
        if (result.errors.length && result.availableWorkflows.length > 1) {
          result = await parseWorkflow(file, { projectDir: path.dirname(file), workflowName: result.availableWorkflows[0] });
        }
        if (result.errors.length) continue;
        for (const workflow of result.allWorkflows) {
          const endpoint: WorkflowEndpoint = {
            name: workflow.name,
            functionName: workflow.functionName,
            filePath: file,
            method: 'POST',
            path: `/workflows/${workflow.name}`,
            inputSchema: this.extractInputSchema(workflow),
            outputSchema: this.extractOutputSchema(workflow),
            description: workflow.description,
            gates: workflow.instances.filter((i) => workflow.nodeTypes.find((n) => n.name === i.nodeType || n.functionName === i.nodeType)?.durableGate !== undefined).length,
            routes: workflow.options?.http ?? [],
          };
          this.endpoints.set(workflow.name, endpoint);
        }
      } catch {
        // Skip files that fail to parse - they may have syntax errors
        // In a server context, we don't want one bad file to break everything
      }
    }
  }

  /**
   * Extract JSON Schema for workflow input ports
   */
  private extractInputSchema(workflow: TWorkflowAST): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {},
    };
    const required: string[] = [];

    for (const [portName, port] of Object.entries(workflow.startPorts || {})) {
      // Skip the execute port - it's internal
      if (portName === 'execute') continue;

      (schema.properties as Record<string, unknown>)[portName] = {
        ...this.dataTypeToJsonSchema(port.dataType),
        ...(port.label && { description: port.label }),
      };

      if (!port.optional) {
        required.push(portName);
      }
    }

    if (required.length > 0) {
      schema.required = required;
    }

    return schema;
  }

  /**
   * Extract JSON Schema for workflow output ports
   */
  private extractOutputSchema(workflow: TWorkflowAST): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {},
    };

    for (const [portName, port] of Object.entries(workflow.exitPorts || {})) {
      // Skip control flow ports
      if (portName === 'onSuccess' || portName === 'onFailure') continue;

      (schema.properties as Record<string, unknown>)[portName] = {
        ...this.dataTypeToJsonSchema(port.dataType),
        ...(port.label && { description: port.label }),
      };
    }

    return schema;
  }

  /**
   * A Flow Weaver data type as a JSON Schema fragment. `ANY` has no JSON
   * Schema type: it is the empty schema, which admits anything.
   */
  private dataTypeToJsonSchema(dataType: TDataType): Record<string, unknown> {
    const mapping: Record<string, string> = {
      STRING: 'string',
      NUMBER: 'number',
      BOOLEAN: 'boolean',
      OBJECT: 'object',
      ARRAY: 'array',
      STEP: 'boolean',
    };
    const type = mapping[dataType];
    return type ? { type } : {};
  }

  /**
   * Get a specific endpoint by workflow name
   */
  getEndpoint(name: string): WorkflowEndpoint | undefined {
    return this.endpoints.get(name);
  }

  /**
   * Get all registered endpoints
   */
  getAllEndpoints(): WorkflowEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  /**
   * Get server uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * Start watching for file changes. After a change settles, the workflows
   * are discovered again and `onChange` runs. A rediscovery that fails goes
   * to `onError`, which by default writes it to stderr, and the next change
   * tries again.
   */
  async startWatching(
    onChange: () => void,
    onError: (error: unknown) => void = (error) => {
      console.error(`Rediscovering workflows in ${this.workflowDir} failed: ${error instanceof Error ? error.message : String(error)}`);
    },
  ): Promise<void> {
    try {
      const chokidar = await import('chokidar');

      const watcher = chokidar.watch(this.workflowDir, {
        persistent: true,
        ignoreInitial: true,
        ignored: ['**/*.generated.ts', '**/node_modules/**', '**/*.d.ts'],
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100,
        },
      });
      this.watcher = watcher;

      watcher.on('all', (event: string, filePath: string) => {
        if (!filePath.endsWith('.ts')) return;

        // Debounce changes to avoid rapid re-parsing
        const existingTimer = this.debounceTimers.get(filePath);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => {
          this.debounceTimers.delete(filePath);
          this.discoverWorkflows()
            .then(() => onChange())
            .catch(onError);
        }, 500);

        this.debounceTimers.set(filePath, timer);
      });
    } catch {
      // File watching not available (chokidar not installed)
    }
  }

  /**
   * Stop watching for file changes
   */
  async stopWatching(): Promise<void> {
    // Clear all pending timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
