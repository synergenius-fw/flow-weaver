/**
 * Cloudflare Workers export target
 *
 * Generates Cloudflare Workers with Wrangler configuration.
 */

import {
  BaseExportTarget,
  type ExportOptions,
  type ExportArtifacts,
  type DeployInstructions,
  type CompiledWorkflow,
  type MultiWorkflowArtifacts,
  type NodeTypeInfo,
  type NodeTypeExportOptions,
  type NodeTypeArtifacts,
  type BundleWorkflow,
  type BundleNodeType,
  type BundleArtifacts,
} from './base.js';
import { getGeneratedBranding } from '../../generated-branding.js';
import { generateStandaloneRuntimeModule } from '../../api/inline-runtime.js';

/**
 * Handler template for Cloudflare Workers - Basic version
 */
const CLOUDFLARE_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
{{WORKFLOW_IMPORT}}

interface Env {
  // Add your bindings here (D1, KV, R2, etc.)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are allowed' },
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const requestId = request.headers.get('cf-ray') || crypto.randomUUID();

    try {
      const body = await request.json() as Record<string, unknown>;
      const startTime = performance.now();

      const result = await {{FUNCTION_NAME}}(true, body);

      return new Response(JSON.stringify({
        success: true,
        result,
        executionTime: Math.round(performance.now() - startTime),
        requestId,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
          'X-Execution-Time': \`\${Math.round(performance.now() - startTime)}ms\`,
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
        requestId,
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        },
      });
    }
  },
} satisfies ExportedHandler<Env>;
`;

/**
 * Handler template for Cloudflare Workers with API documentation
 */
const CLOUDFLARE_HANDLER_WITH_DOCS_TEMPLATE = `{{GENERATED_HEADER}}
{{WORKFLOW_IMPORT}}
import { openApiSpec } from './openapi.js';

interface Env {
  // Add your bindings here (D1, KV, R2, etc.)
}

const SWAGGER_UI_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{WORKFLOW_NAME}} API Documentation</title>
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
</html>\`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Serve OpenAPI spec
    if (path === '/openapi.json' && method === 'GET') {
      return new Response(JSON.stringify(openApiSpec), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Serve Swagger UI
    if (path === '/docs' && method === 'GET') {
      return new Response(SWAGGER_UI_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Only allow POST requests for workflow execution
    if (method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are allowed for workflow execution' },
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const requestId = request.headers.get('cf-ray') || crypto.randomUUID();

    try {
      const body = await request.json() as Record<string, unknown>;
      const startTime = performance.now();

      const result = await {{FUNCTION_NAME}}(true, body);

      return new Response(JSON.stringify({
        success: true,
        result,
        executionTime: Math.round(performance.now() - startTime),
        requestId,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
          'X-Execution-Time': \`\${Math.round(performance.now() - startTime)}ms\`,
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
        requestId,
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        },
      });
    }
  },
} satisfies ExportedHandler<Env>;
`;

/**
 * OpenAPI spec file template
 */
const OPENAPI_SPEC_TEMPLATE = `// Generated OpenAPI specification
export const openApiSpec = {{OPENAPI_SPEC}};
`;

/**
 * Wrangler configuration template
 */
const WRANGLER_TEMPLATE = `name = "{{WORKFLOW_NAME}}"
main = "dist/index.js"
compatibility_date = "2024-01-01"

[build]
command = "npm run build"
`;

/**
 * Node type handler template for Cloudflare Workers
 */
const CLOUDFLARE_NODE_TYPE_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
{{NODE_TYPE_IMPORTS}}
import { openApiSpec } from './openapi.js';

interface Env {
  // Add your bindings here (D1, KV, R2, etc.)
}

// Handler type for node type functions
type NodeTypeHandler = (execute: boolean, params: Record<string, unknown>) => unknown;

// Node type router
const nodeTypes: Record<string, NodeTypeHandler> = {
{{NODE_TYPE_ENTRIES}}
};

const SWAGGER_UI_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{SERVICE_NAME}} API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>\`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Serve OpenAPI spec
    if (path === '/api/openapi.json' && method === 'GET') {
      return new Response(JSON.stringify(openApiSpec), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Serve Swagger UI
    if (path === '/api/docs' && method === 'GET') {
      return new Response(SWAGGER_UI_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Route to node type
    const nodeTypeMatch = path.match(/^\\/api\\/([^\\/]+)$/);
    if (!nodeTypeMatch) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const nodeTypeName = nodeTypeMatch[1];
    const nodeType = nodeTypes[nodeTypeName];

    if (!nodeType) {
      return new Response(JSON.stringify({
        error: \`Node type '\${nodeTypeName}' not found\`,
        availableNodeTypes: Object.keys(nodeTypes),
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Only POST for node type execution
    if (method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are allowed for node type execution' },
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const requestId = request.headers.get('cf-ray') || crypto.randomUUID();

    try {
      const body = await request.json() as Record<string, unknown>;
      const startTime = performance.now();

      const result = await nodeType(true, body);

      return new Response(JSON.stringify({
        success: true,
        result,
        executionTime: Math.round(performance.now() - startTime),
        requestId,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
          'X-Execution-Time': \`\${Math.round(performance.now() - startTime)}ms\`,
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
        requestId,
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        },
      });
    }
  },
} satisfies ExportedHandler<Env>;
`;

/**
 * Multi-workflow handler template for Cloudflare Workers
 */
const CLOUDFLARE_MULTI_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
{{WORKFLOW_IMPORTS}}
import { functionRegistry } from './runtime/function-registry.js';
import './runtime/builtin-functions.js';
import { openApiSpec } from './openapi.js';

interface Env {
  // Add your bindings here (D1, KV, R2, etc.)
}

// Handler type for workflow functions
type WorkflowHandler = (execute: boolean, params: Record<string, unknown>) => unknown;

// Workflow router
const workflows: Record<string, WorkflowHandler> = {
{{WORKFLOW_ENTRIES}}
};

const SWAGGER_UI_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{SERVICE_NAME}} API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>\`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Serve OpenAPI spec
    if (path === '/api/openapi.json' && method === 'GET') {
      return new Response(JSON.stringify(openApiSpec), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Serve Swagger UI
    if (path === '/api/docs' && method === 'GET') {
      return new Response(SWAGGER_UI_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // List available functions
    if (path === '/api/functions' && method === 'GET') {
      const category = url.searchParams.get('category');
      const functions = functionRegistry.list(category as any);
      return new Response(JSON.stringify(functions), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Route to workflow
    const workflowMatch = path.match(/^\\/api\\/([^\\/]+)$/);
    if (!workflowMatch) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const workflowName = workflowMatch[1];
    const workflow = workflows[workflowName];

    if (!workflow) {
      return new Response(JSON.stringify({
        error: \`Workflow '\${workflowName}' not found\`,
        availableWorkflows: Object.keys(workflows),
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Only POST for workflow execution
    if (method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are allowed for workflow execution' },
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const requestId = request.headers.get('cf-ray') || crypto.randomUUID();

    try {
      const body = await request.json() as Record<string, unknown>;
      const startTime = performance.now();

      const result = await workflow(true, body);

      return new Response(JSON.stringify({
        success: true,
        result,
        executionTime: Math.round(performance.now() - startTime),
        requestId,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
          'X-Execution-Time': \`\${Math.round(performance.now() - startTime)}ms\`,
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
        requestId,
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        },
      });
    }
  },
} satisfies ExportedHandler<Env>;
`;

/**
 * Bundle handler template for Cloudflare Workers - unified workflows and node types
 */
const CLOUDFLARE_BUNDLE_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
{{WORKFLOW_IMPORTS}}
{{NODE_TYPE_IMPORTS}}
import { functionRegistry } from './runtime/function-registry.js';
import './runtime/builtin-functions.js';
import { openApiSpec } from './openapi.js';

interface Env {
  // Add your bindings here (D1, KV, R2, etc.)
}

// Handler type for workflow/nodeType functions
type FunctionHandler = (execute: boolean, params: Record<string, unknown>) => unknown;

// Exposed workflows (have HTTP endpoints)
const exposedWorkflows: Record<string, FunctionHandler> = {
{{EXPOSED_WORKFLOW_ENTRIES}}
};

// Exposed node types (have HTTP endpoints)
const exposedNodeTypes: Record<string, FunctionHandler> = {
{{EXPOSED_NODE_TYPE_ENTRIES}}
};

const SWAGGER_UI_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{SERVICE_NAME}} API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>\`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Serve OpenAPI spec
    if (path === '/api/openapi.json' && method === 'GET') {
      return new Response(JSON.stringify(openApiSpec), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Serve Swagger UI
    if (path === '/api/docs' && method === 'GET') {
      return new Response(SWAGGER_UI_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // List available functions
    if (path === '/api/functions' && method === 'GET') {
      const category = url.searchParams.get('category');
      const functions = functionRegistry.list(category as any);
      return new Response(JSON.stringify(functions), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Route to workflow: /api/workflows/{name}
    const workflowMatch = path.match(/^\\/api\\/workflows\\/([^\\/]+)$/);
    if (workflowMatch) {
      const workflowName = workflowMatch[1];
      const workflow = exposedWorkflows[workflowName];

      if (!workflow) {
        return new Response(JSON.stringify({
          error: \`Workflow '\${workflowName}' not found\`,
          availableWorkflows: Object.keys(exposedWorkflows),
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method !== 'POST') {
        return new Response(JSON.stringify({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are allowed for workflow execution' },
        }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const requestId = request.headers.get('cf-ray') || crypto.randomUUID();

      try {
        const body = await request.json() as Record<string, unknown>;
        const startTime = performance.now();

        const result = await workflow(true, body);

        return new Response(JSON.stringify({
          success: true,
          result,
          executionTime: Math.round(performance.now() - startTime),
          requestId,
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Request-Id': requestId,
            'X-Execution-Time': \`\${Math.round(performance.now() - startTime)}ms\`,
          },
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: { code: 'EXECUTION_ERROR', message: error instanceof Error ? error.message : String(error) },
          requestId,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
        });
      }
    }

    // Route to node type: /api/nodes/{name}
    const nodeTypeMatch = path.match(/^\\/api\\/nodes\\/([^\\/]+)$/);
    if (nodeTypeMatch) {
      const nodeTypeName = nodeTypeMatch[1];
      const nodeType = exposedNodeTypes[nodeTypeName];

      if (!nodeType) {
        return new Response(JSON.stringify({
          error: \`Node type '\${nodeTypeName}' not found\`,
          availableNodeTypes: Object.keys(exposedNodeTypes),
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method !== 'POST') {
        return new Response(JSON.stringify({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are allowed for node type execution' },
        }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const requestId = request.headers.get('cf-ray') || crypto.randomUUID();

      try {
        const body = await request.json() as Record<string, unknown>;
        const startTime = performance.now();

        const result = await nodeType(true, body);

        return new Response(JSON.stringify({
          success: true,
          result,
          executionTime: Math.round(performance.now() - startTime),
          requestId,
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Request-Id': requestId,
            'X-Execution-Time': \`\${Math.round(performance.now() - startTime)}ms\`,
          },
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: { code: 'EXECUTION_ERROR', message: error instanceof Error ? error.message : String(error) },
          requestId,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },
} satisfies ExportedHandler<Env>;
`;

/**
 * Cloudflare Workers export target
 */
export class CloudflareTarget extends BaseExportTarget {
  readonly name = 'cloudflare';
  readonly description = 'Cloudflare Workers';

  async generate(options: ExportOptions): Promise<ExportArtifacts> {
    const files = [];
    const includeDocs = options.includeDocs ?? false;

    // Select appropriate handler template
    const handlerTemplate = includeDocs
      ? CLOUDFLARE_HANDLER_WITH_DOCS_TEMPLATE
      : CLOUDFLARE_HANDLER_TEMPLATE;

    // Generate handler
    const handlerContent = handlerTemplate
      .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target cloudflare'))
      .replace('{{WORKFLOW_IMPORT}}', `import { ${options.workflowName} } from './workflow.js';`)
      .replace(/\{\{FUNCTION_NAME\}\}/g, options.workflowName)
      .replace(/\{\{WORKFLOW_NAME\}\}/g, options.displayName);

    files.push(this.createFile(options.outputDir, 'index.ts', handlerContent, 'handler'));

    // Generate OpenAPI spec file if docs are enabled
    if (includeDocs) {
      const openApiSpec = this.generateOpenAPISpec(options);
      const openApiContent = OPENAPI_SPEC_TEMPLATE.replace(
        '{{OPENAPI_SPEC}}',
        JSON.stringify(openApiSpec, null, 2)
      );
      files.push(this.createFile(options.outputDir, 'openapi.ts', openApiContent, 'config'));
    }

    // Generate wrangler.toml
    const wranglerContent = WRANGLER_TEMPLATE.replace(
      /\{\{WORKFLOW_NAME\}\}/g,
      options.displayName
    );

    files.push(this.createFile(options.outputDir, 'wrangler.toml', wranglerContent, 'config'));

    // Generate package.json
    const packageJson = this.generatePackageJson({
      name: options.displayName,
      description: options.description,
      main: 'dist/index.js',
      scripts: {
        build: 'tsc',
        dev: 'wrangler dev',
        deploy: 'wrangler deploy',
      },
      devDependencies: {
        '@cloudflare/workers-types': '^4.0.0',
        wrangler: '^3.0.0',
      },
    });

    files.push(this.createFile(options.outputDir, 'package.json', packageJson, 'package'));

    // Generate tsconfig.json
    const tsConfig = this.generateTsConfig({
      outDir: './dist',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      types: ['@cloudflare/workers-types'],
    });

    files.push(this.createFile(options.outputDir, 'tsconfig.json', tsConfig, 'config'));

    // Generate README from deploy instructions
    const artifacts: ExportArtifacts = { files, target: this.name, workflowName: options.displayName, entryPoint: 'index.ts' };
    const instructions = this.getDeployInstructions(artifacts);
    const readme = this.generateReadme(instructions, options.displayName, 'Cloudflare Workers');
    files.push(this.createFile(options.outputDir, 'README.md', readme, 'other'));

    return artifacts;
  }

  /**
   * Generate OpenAPI specification for the workflow
   */
  private generateOpenAPISpec(options: ExportOptions): object {
    return {
      openapi: '3.0.3',
      info: {
        title: `${options.displayName} API`,
        version: '1.0.0',
        description: options.description || `API for the ${options.displayName} workflow`,
      },
      servers: [{ url: '/', description: 'Cloudflare Worker' }],
      paths: {
        '/': {
          post: {
            operationId: `execute_${options.workflowName}`,
            summary: `Execute ${options.displayName} workflow`,
            description: options.description || `Execute the ${options.displayName} workflow`,
            tags: ['workflows'],
            requestBody: {
              description: 'Workflow input parameters',
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            responses: {
              '200': {
                description: 'Successful workflow execution',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        result: { type: 'object' },
                        executionTime: { type: 'number' },
                        requestId: { type: 'string' },
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
                        error: { type: 'object' },
                        requestId: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/docs': {
          get: {
            operationId: 'get_docs',
            summary: 'API Documentation',
            description: 'Swagger UI documentation',
            tags: ['documentation'],
            responses: {
              '200': {
                description: 'Swagger UI HTML page',
                content: {
                  'text/html': {},
                },
              },
            },
          },
        },
        '/openapi.json': {
          get: {
            operationId: 'get_openapi',
            summary: 'OpenAPI Specification',
            description: 'OpenAPI 3.0 specification in JSON format',
            tags: ['documentation'],
            responses: {
              '200': {
                description: 'OpenAPI specification',
                content: {
                  'application/json': {},
                },
              },
            },
          },
        },
      },
      tags: [
        { name: 'workflows', description: 'Workflow execution endpoints' },
        { name: 'documentation', description: 'API documentation endpoints' },
      ],
    };
  }

  async generateMultiWorkflow(
    workflows: CompiledWorkflow[],
    options: ExportOptions
  ): Promise<MultiWorkflowArtifacts> {
    const files = [];
    const serviceName = options.displayName || 'multi-workflow-service';

    // Generate workflow imports and entries
    const workflowImports = workflows
      .map((w) => `import { ${w.functionName} } from './workflows/${w.name}.js';`)
      .join('\n');

    const workflowEntries = workflows.map((w) => `  '${w.name}': ${w.functionName},`).join('\n');

    // Generate multi-workflow handler
    const handlerContent = CLOUDFLARE_MULTI_HANDLER_TEMPLATE
      .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target cloudflare --multi'))
      .replace('{{WORKFLOW_IMPORTS}}', workflowImports)
      .replace('{{WORKFLOW_ENTRIES}}', workflowEntries)
      .replace(/\{\{SERVICE_NAME\}\}/g, serviceName);

    files.push(this.createFile(options.outputDir, 'index.ts', handlerContent, 'handler'));

    // Generate consolidated OpenAPI spec
    const openApiSpec = this.generateConsolidatedOpenAPI(workflows, {
      title: `${serviceName} API`,
      version: '1.0.0',
    });

    const openApiContent = `// Generated OpenAPI specification
export const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};
`;
    files.push(this.createFile(options.outputDir, 'openapi.ts', openApiContent, 'config'));

    // Generate wrangler.toml
    const wranglerContent = WRANGLER_TEMPLATE.replace(/\{\{WORKFLOW_NAME\}\}/g, serviceName);
    files.push(this.createFile(options.outputDir, 'wrangler.toml', wranglerContent, 'config'));

    // Generate package.json
    const packageJson = this.generatePackageJson({
      name: serviceName,
      description: `Multi-workflow service with ${workflows.length} workflows`,
      main: 'dist/index.js',
      scripts: {
        build: 'tsc',
        dev: 'wrangler dev',
        deploy: 'wrangler deploy',
      },
      devDependencies: {
        '@cloudflare/workers-types': '^4.0.0',
        wrangler: '^3.0.0',
      },
    });

    files.push(this.createFile(options.outputDir, 'package.json', packageJson, 'package'));

    // Generate tsconfig.json
    const tsConfig = this.generateTsConfig({
      outDir: './dist',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      types: ['@cloudflare/workers-types'],
    });

    files.push(this.createFile(options.outputDir, 'tsconfig.json', tsConfig, 'config'));

    // Generate workflow content files
    files.push(...this.generateWorkflowContentFiles(workflows, options.outputDir));

    return {
      files,
      target: this.name,
      workflowName: serviceName,
      workflowNames: workflows.map((w) => w.name),
      entryPoint: 'index.ts',
      openApiSpec,
    };
  }

  async generateNodeTypeService(
    nodeTypes: NodeTypeInfo[],
    options: NodeTypeExportOptions
  ): Promise<NodeTypeArtifacts> {
    const files = [];
    const serviceName = options.serviceName || 'node-type-service';

    // Generate node type imports and entries
    // Use lowercase functionName for import paths to match the generated file names
    const nodeTypeImports = nodeTypes
      .map((nt) => `import { ${nt.functionName} } from './node-types/${nt.functionName.toLowerCase()}.js';`)
      .join('\n');

    const nodeTypeEntries = nodeTypes.map((nt) => `  '${nt.name}': ${nt.functionName},`).join('\n');

    // Generate node type handler
    const handlerContent = CLOUDFLARE_NODE_TYPE_HANDLER_TEMPLATE
      .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target cloudflare --node-types'))
      .replace('{{NODE_TYPE_IMPORTS}}', nodeTypeImports)
      .replace('{{NODE_TYPE_ENTRIES}}', nodeTypeEntries)
      .replace(/\{\{SERVICE_NAME\}\}/g, serviceName);

    files.push(this.createFile(options.outputDir, 'index.ts', handlerContent, 'handler'));

    // Generate OpenAPI spec
    const openApiSpec = this.generateNodeTypeOpenAPI(nodeTypes, {
      title: `${serviceName} API`,
      version: '1.0.0',
    });

    const openApiContent = `// Generated OpenAPI specification
export const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};
`;
    files.push(this.createFile(options.outputDir, 'openapi.ts', openApiContent, 'config'));

    // Generate wrangler.toml
    const wranglerContent = WRANGLER_TEMPLATE.replace(/\{\{WORKFLOW_NAME\}\}/g, serviceName);
    files.push(this.createFile(options.outputDir, 'wrangler.toml', wranglerContent, 'config'));

    // Generate package.json
    const packageJson = this.generatePackageJson({
      name: serviceName,
      description: `Node type service with ${nodeTypes.length} endpoints`,
      main: 'dist/index.js',
      scripts: {
        build: 'tsc',
        dev: 'wrangler dev',
        deploy: 'wrangler deploy',
      },
      devDependencies: {
        '@cloudflare/workers-types': '^4.0.0',
        wrangler: '^3.0.0',
      },
    });

    files.push(this.createFile(options.outputDir, 'package.json', packageJson, 'package'));

    // Generate tsconfig.json
    const tsConfig = this.generateTsConfig({
      outDir: './dist',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      types: ['@cloudflare/workers-types'],
    });

    files.push(this.createFile(options.outputDir, 'tsconfig.json', tsConfig, 'config'));

    // Generate node-type content files
    files.push(...this.generateNodeTypeContentFiles(nodeTypes, options.outputDir));

    return {
      files,
      target: this.name,
      workflowName: serviceName,
      nodeTypeNames: nodeTypes.map((nt) => nt.name),
      entryPoint: 'index.ts',
      openApiSpec,
    };
  }

  async generateBundle(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[],
    options: ExportOptions
  ): Promise<BundleArtifacts> {
    const files = [];
    const serviceName = options.displayName || 'bundle-service';

    // Separate exposed and bundled-only items
    const exposedWorkflows = workflows.filter((w) => w.expose);
    const exposedNodeTypes = nodeTypes.filter((nt) => nt.expose);

    // Filter to only include items that have generated code
    // Also skip npm imports (names containing '/') as they should be installed via package.json
    const workflowsWithCode = workflows.filter((w) => w.code);
    const nodeTypesWithCode = nodeTypes.filter((nt) => nt.code && !nt.name.includes('/'));

    // Detect name collisions between workflows and nodeTypes
    const workflowNames = new Set(workflowsWithCode.map((w) => w.functionName));
    const nodeTypeAliases = new Map<string, string>();
    for (const nt of nodeTypesWithCode) {
      if (workflowNames.has(nt.functionName)) {
        // Use alias for colliding nodeType names
        nodeTypeAliases.set(nt.functionName, `${nt.functionName}_nodeType`);
      }
    }

    // Generate all workflow imports (both exposed and bundled-only) - only for those with code
    const workflowImports =
      workflowsWithCode.length > 0
        ? workflowsWithCode
            .map((w) => `import { ${w.functionName} } from './workflows/${w.name}.js';`)
            .join('\n')
        : '// No workflows';

    // Generate all node type imports (both exposed and bundled-only) with aliases for collisions - only for those with code
    // Use lowercase functionName for import paths to match the generated file names
    const nodeTypeImports =
      nodeTypesWithCode.length > 0
        ? nodeTypesWithCode
            .map((nt) => {
              const alias = nodeTypeAliases.get(nt.functionName);
              const lowerFunctionName = nt.functionName.toLowerCase();
              if (alias) {
                return `import { ${nt.functionName} as ${alias} } from './node-types/${lowerFunctionName}.js';`;
              }
              return `import { ${nt.functionName} } from './node-types/${lowerFunctionName}.js';`;
            })
            .join('\n')
        : '// No node types';

    // Generate entries only for exposed items
    // Filter exposed items to only include those with code
    const exposedWorkflowsWithCode = exposedWorkflows.filter((w) => w.code);
    const exposedNodeTypesWithCode = exposedNodeTypes.filter((nt) => nt.code);

    const exposedWorkflowEntries =
      exposedWorkflowsWithCode.length > 0
        ? exposedWorkflowsWithCode.map((w) => `  '${w.name}': ${w.functionName},`).join('\n')
        : '  // No exposed workflows';

    const exposedNodeTypeEntries =
      exposedNodeTypesWithCode.length > 0
        ? exposedNodeTypesWithCode
            .map((nt) => {
              const alias = nodeTypeAliases.get(nt.functionName);
              return `  '${nt.name}': ${alias || nt.functionName},`;
            })
            .join('\n')
        : '  // No exposed node types';

    // Generate bundle handler
    const handlerContent = CLOUDFLARE_BUNDLE_HANDLER_TEMPLATE
      .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target cloudflare --bundle'))
      .replace('{{WORKFLOW_IMPORTS}}', workflowImports)
      .replace('{{NODE_TYPE_IMPORTS}}', nodeTypeImports)
      .replace('{{EXPOSED_WORKFLOW_ENTRIES}}', exposedWorkflowEntries)
      .replace('{{EXPOSED_NODE_TYPE_ENTRIES}}', exposedNodeTypeEntries)
      .replace(/\{\{SERVICE_NAME\}\}/g, serviceName);

    files.push(this.createFile(options.outputDir, 'index.ts', handlerContent, 'handler'));

    // Generate OpenAPI spec for exposed items only
    const openApiSpec = this.generateBundleOpenAPI(workflows, nodeTypes, {
      title: `${serviceName} API`,
      version: '1.0.0',
    });

    const openApiContent = `// Generated OpenAPI specification
export const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};
`;
    files.push(this.createFile(options.outputDir, 'openapi.ts', openApiContent, 'config'));

    // Generate wrangler.toml
    const wranglerContent = WRANGLER_TEMPLATE.replace(/\{\{WORKFLOW_NAME\}\}/g, serviceName);
    files.push(this.createFile(options.outputDir, 'wrangler.toml', wranglerContent, 'config'));

    // Generate package.json
    const packageJson = this.generatePackageJson({
      name: serviceName,
      description: `Bundle service with ${workflows.length} workflows and ${nodeTypes.length} node types`,
      main: 'dist/index.js',
      scripts: {
        build: 'tsc',
        dev: 'wrangler dev',
        deploy: 'wrangler deploy',
      },
      devDependencies: {
        '@cloudflare/workers-types': '^4.0.0',
        wrangler: '^3.0.0',
      },
    });

    files.push(this.createFile(options.outputDir, 'package.json', packageJson, 'package'));

    // Generate tsconfig.json
    const tsConfig = this.generateTsConfig({
      outDir: './dist',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      types: ['@cloudflare/workers-types'],
    });

    files.push(this.createFile(options.outputDir, 'tsconfig.json', tsConfig, 'config'));

    // Generate shared runtime types module (workflows import from this)
    const isProduction = options.production ?? true;
    const runtimeTypesContent = generateStandaloneRuntimeModule(isProduction, 'esm');
    files.push(
      this.createFile(options.outputDir, 'runtime/types.ts', runtimeTypesContent, 'other')
    );

    // Generate real runtime files (function registry, builtin functions, parameter resolver)
    files.push(...this.generateRuntimeFiles(options.outputDir, workflows, nodeTypes));

    // Generate workflow and node-type content files
    files.push(...this.generateBundleContentFiles(workflows, nodeTypes, options.outputDir));

    return {
      files,
      target: this.name,
      workflowName: serviceName,
      workflowNames: workflows.map((w) => w.name),
      nodeTypeNames: nodeTypes.map((nt) => nt.name),
      entryPoint: 'index.ts',
      openApiSpec,
    };
  }

  getDeployInstructions(artifacts: ExportArtifacts): DeployInstructions {
    const outputDir = artifacts.files[0]?.absolutePath
      ? artifacts.files[0].absolutePath.replace(/\/[^/]+$/, '')
      : '.';

    const hasDocs = artifacts.files.some((f) => f.relativePath === 'openapi.ts');

    const steps = [`cd ${outputDir}`, 'npm install', 'npm run deploy'];

    if (hasDocs) {
      steps.push('Visit /docs for API documentation');
    }

    return {
      title: 'Deploy to Cloudflare Workers',
      prerequisites: [
        'Wrangler CLI installed (npm install -g wrangler)',
        'Cloudflare account',
        'First run: wrangler login',
      ],
      steps,
      localTestSteps: [
        `cd ${outputDir}`,
        'npm install',
        'npm run dev',
        '# Worker will be available at http://localhost:8787',
        '# Test with: curl -X POST http://localhost:8787 -H "Content-Type: application/json" -d \'{"key": "value"}\'',
      ],
      links: [
        {
          label: 'Cloudflare Workers Documentation',
          url: 'https://developers.cloudflare.com/workers/',
        },
        {
          label: 'Wrangler CLI',
          url: 'https://developers.cloudflare.com/workers/wrangler/',
        },
      ],
    };
  }
}
