/**
 * Webhook server for exposing workflows as HTTP endpoints
 */

import { WorkflowRegistry } from './workflow-registry.js';
import { executeWorkflowFromFile } from '../mcp/workflow-executor.js';
import type {
  WebhookServerConfig,
  ExecutionResult,
  HealthResponse,
  WorkflowListResponse,
} from './types.js';

// Use dynamic imports for Fastify to handle optional dependencies gracefully
type FastifyInstance = {
  register: (plugin: unknown, options?: unknown) => Promise<void>;
  get: <T = unknown>(
    path: string,
    handler: (req: FastifyRequest, reply: FastifyReply) => Promise<T>
  ) => void;
  post: <T = unknown, P = unknown>(
    path: string,
    handler: (req: FastifyRequest<P>, reply: FastifyReply) => Promise<T>
  ) => void;
  listen: (options: { port: number; host: string }) => Promise<void>;
  close: () => Promise<void>;
};

type FastifyRequest<T = unknown> = {
  params: T;
  body: Record<string, unknown>;
  query: Record<string, string>;
};

type FastifyReply = {
  status: (code: number) => FastifyReply;
  send: (data: unknown) => void;
  type: (contentType: string) => FastifyReply;
  header: (name: string, value: string) => FastifyReply;
};

/**
 * HTTP server that exposes Flow Weaver workflows as REST endpoints
 */
export class WebhookServer {
  private fastify: FastifyInstance | null = null;
  private registry: WorkflowRegistry;
  private config: WebhookServerConfig;

  constructor(config: WebhookServerConfig) {
    this.config = config;
    this.registry = new WorkflowRegistry(config.workflowDir, {
      precompile: config.precompile,
      production: config.production,
    });
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    // Dynamic import Fastify
    const Fastify = await import('fastify');
    this.fastify = Fastify.default({ logger: false }) as unknown as FastifyInstance;

    // Register CORS
    try {
      const cors = await import('@fastify/cors');
      await this.fastify.register(cors.default, { origin: this.config.corsOrigin });
    } catch {
      // CORS plugin not available, continue without it
    }

    // Initialize registry
    await this.registry.initialize();

    // Setup routes
    this.setupHealthRoute();
    this.setupListRoute();
    this.setupExecuteRoute();

    // Setup Swagger UI routes if enabled
    if (this.config.swaggerEnabled) {
      this.setupSwaggerRoutes();
    }

    // Start file watching
    if (this.config.watchEnabled) {
      await this.registry.startWatching(() => {
        // Workflows reloaded - could emit event here if needed
      });
    }

    // Start server
    await this.fastify.listen({ port: this.config.port, host: this.config.host });
  }

  /**
   * Setup health check endpoint
   */
  private setupHealthRoute(): void {
    if (!this.fastify) return;

    this.fastify.get('/health', async (): Promise<HealthResponse> => {
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        workflows: this.registry.getAllEndpoints().length,
        uptime: this.registry.getUptime(),
      };
    });
  }

  /**
   * Setup workflow list endpoint
   */
  private setupListRoute(): void {
    if (!this.fastify) return;

    this.fastify.get('/workflows', async (): Promise<WorkflowListResponse> => {
      const endpoints = this.registry.getAllEndpoints();
      return {
        count: endpoints.length,
        workflows: endpoints.map((e) => ({
          name: e.name,
          path: e.path,
          method: e.method,
          description: e.description,
          inputSchema: e.inputSchema,
          outputSchema: e.outputSchema,
        })),
      };
    });
  }

  /**
   * Setup dynamic workflow execution route
   */
  private setupExecuteRoute(): void {
    if (!this.fastify) return;

    // POST /workflows/:name
    this.fastify.post(
      '/workflows/:name',
      async (
        request: FastifyRequest<{ name: string }>,
        reply: FastifyReply
      ): Promise<ExecutionResult> => {
        const { name } = request.params;
        const params = request.body || {};
        const includeTrace = request.query?.trace === 'true';

        const endpoint = this.registry.getEndpoint(name);
        if (!endpoint) {
          reply.status(404);
          return {
            success: false,
            workflow: name,
            executionTime: 0,
            error: { message: `Workflow "${name}" not found` },
          };
        }

        const startTime = Date.now();
        try {
          const result = await executeWorkflowFromFile(endpoint.filePath, params, {
            workflowName: endpoint.functionName,
            production: this.config.production,
            includeTrace,
          });

          const response: ExecutionResult = {
            success: true,
            workflow: result.functionName,
            executionTime: result.executionTime,
            result: result.result,
          };

          if (includeTrace && result.trace) {
            response.trace = result.trace;
          }

          return response;
        } catch (error) {
          reply.status(500);
          return {
            success: false,
            workflow: endpoint.functionName,
            executionTime: Date.now() - startTime,
            error: {
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
          };
        }
      }
    );
  }

  /**
   * Build OpenAPI spec from discovered workflows
   */
  private buildOpenApiSpec(): object {
    const endpoints = this.registry.getAllEndpoints();
    const paths: Record<string, object> = {};

    for (const endpoint of endpoints) {
      paths[endpoint.path] = {
        post: {
          operationId: `execute_${endpoint.functionName}`,
          summary: `Execute ${endpoint.name} workflow`,
          description: endpoint.description || `Execute the ${endpoint.name} workflow`,
          tags: ['workflows'],
          requestBody: {
            description: 'Workflow input parameters',
            required: true,
            content: {
              'application/json': {
                schema: endpoint.inputSchema || { type: 'object', additionalProperties: true },
              },
            },
          },
          responses: {
            '200': {
              description: 'Successful execution',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      result: endpoint.outputSchema || { type: 'object' },
                      executionTime: { type: 'number' },
                    },
                  },
                },
              },
            },
            '500': {
              description: 'Execution error',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      error: { type: 'object', properties: { message: { type: 'string' } } },
                    },
                  },
                },
              },
            },
          },
        },
      };
    }

    return {
      openapi: '3.0.3',
      info: {
        title: 'Flow Weaver API',
        version: '1.0.0',
        description: `Webhook server with ${endpoints.length} workflow endpoint(s)`,
      },
      servers: [{ url: `http://${this.config.host}:${this.config.port}`, description: 'Local server' }],
      paths,
      tags: [{ name: 'workflows', description: 'Workflow execution endpoints' }],
    };
  }

  /**
   * Setup Swagger UI and OpenAPI spec routes
   */
  private setupSwaggerRoutes(): void {
    if (!this.fastify) return;

    // GET /openapi.json - OpenAPI specification
    this.fastify.get('/openapi.json', async (_req: FastifyRequest, reply: FastifyReply) => {
      const spec = this.buildOpenApiSpec();
      reply.header('Content-Type', 'application/json');
      reply.send(spec);
    });

    // GET /docs - Swagger UI
    this.fastify.get('/docs', async (_req: FastifyRequest, reply: FastifyReply) => {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flow Weaver API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>`;
      reply.type('text/html').send(html);
    });
  }

  /**
   * Get server info for external logging
   */
  getServerInfo(): { port: number; host: string; endpoints: number } {
    return {
      port: this.config.port,
      host: this.config.host,
      endpoints: this.registry.getAllEndpoints().length,
    };
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    await this.registry.stopWatching();
    if (this.fastify) {
      await this.fastify.close();
    }
  }
}
