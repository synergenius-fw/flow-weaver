/**
 * Vercel export target
 *
 * Generates Vercel serverless functions.
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
 * Handler template for Vercel - Basic version
 */
const VERCEL_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
import type { VercelRequest, VercelResponse } from '@vercel/node';
{{WORKFLOW_IMPORT}}

export const config = {
  runtime: 'nodejs20.x',
  maxDuration: {{MAX_DURATION}},
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are allowed' },
    });
  }

  const requestId = req.headers['x-vercel-id'] as string || crypto.randomUUID();

  try {
    const params = req.body || {};
    const startTime = Date.now();

    const result = await {{FUNCTION_NAME}}(true, params);

    return res
      .setHeader('X-Request-Id', requestId)
      .setHeader('X-Execution-Time', \`\${Date.now() - startTime}ms\`)
      .status(200)
      .json({
        success: true,
        result,
        executionTime: Date.now() - startTime,
        requestId,
      });
  } catch (error) {
    return res
      .setHeader('X-Request-Id', requestId)
      .status(500)
      .json({
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
        requestId,
      });
  }
}
`;

/**
 * OpenAPI endpoint handler for Vercel
 */
const VERCEL_OPENAPI_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { openApiSpec } from '../openapi.js';

export const config = {
  runtime: 'nodejs20.x',
  maxDuration: 10,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return res.status(200).json(openApiSpec);
}
`;

/**
 * Swagger UI docs endpoint handler for Vercel
 */
const VERCEL_DOCS_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  runtime: 'nodejs20.x',
  maxDuration: 10,
};

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
      url: '/api/openapi',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>\`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(SWAGGER_UI_HTML);
}
`;

/**
 * OpenAPI spec file template
 */
const OPENAPI_SPEC_TEMPLATE = `// Generated OpenAPI specification
export const openApiSpec = {{OPENAPI_SPEC}};
`;

/**
 * Node type handler template for Vercel
 */
const VERCEL_NODE_TYPE_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
import type { VercelRequest, VercelResponse } from '@vercel/node';
{{NODE_TYPE_IMPORTS}}
import { openApiSpec } from '../openapi.js';

export const config = {
  runtime: 'nodejs20.x',
  maxDuration: {{MAX_DURATION}},
};

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { nodeType: nodeTypeName } = req.query;
  const requestId = req.headers['x-vercel-id'] as string || crypto.randomUUID();

  // Handle special routes
  if (nodeTypeName === 'openapi.json' && req.method === 'GET') {
    return res.status(200).json(openApiSpec);
  }

  if (nodeTypeName === 'docs' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(SWAGGER_UI_HTML);
  }

  // Find node type
  const nodeType = typeof nodeTypeName === 'string' ? nodeTypes[nodeTypeName] : undefined;

  if (!nodeType) {
    return res.status(404).json({
      error: \`Node type '\${nodeTypeName}' not found\`,
      availableNodeTypes: Object.keys(nodeTypes),
    });
  }

  // Only POST for node type execution
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are allowed for node type execution' },
    });
  }

  try {
    const params = req.body || {};
    const startTime = Date.now();

    const result = await nodeType(true, params);

    return res
      .setHeader('X-Request-Id', requestId)
      .setHeader('X-Execution-Time', \`\${Date.now() - startTime}ms\`)
      .status(200)
      .json({
        success: true,
        result,
        executionTime: Date.now() - startTime,
        requestId,
      });
  } catch (error) {
    return res
      .setHeader('X-Request-Id', requestId)
      .status(500)
      .json({
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
        requestId,
      });
  }
}
`;

/**
 * Multi-workflow router handler for Vercel
 */
const VERCEL_MULTI_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
import type { VercelRequest, VercelResponse } from '@vercel/node';
{{WORKFLOW_IMPORTS}}
import { functionRegistry } from '../runtime/function-registry.js';
import '../runtime/builtin-functions.js';
import { openApiSpec } from '../openapi.js';

export const config = {
  runtime: 'nodejs20.x',
  maxDuration: {{MAX_DURATION}},
};

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { workflow: workflowName } = req.query;
  const requestId = req.headers['x-vercel-id'] as string || crypto.randomUUID();

  // Handle special routes
  if (workflowName === 'openapi.json' && req.method === 'GET') {
    return res.status(200).json(openApiSpec);
  }

  if (workflowName === 'docs' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(SWAGGER_UI_HTML);
  }

  if (workflowName === 'functions' && req.method === 'GET') {
    const category = req.query.category as string | undefined;
    const functions = functionRegistry.list(category as any);
    return res.status(200).json(functions);
  }

  // Find workflow
  const workflow = typeof workflowName === 'string' ? workflows[workflowName] : undefined;

  if (!workflow) {
    return res.status(404).json({
      error: \`Workflow '\${workflowName}' not found\`,
      availableWorkflows: Object.keys(workflows),
    });
  }

  // Only POST for workflow execution
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are allowed for workflow execution' },
    });
  }

  try {
    const params = req.body || {};
    const startTime = Date.now();

    const result = await workflow(true, params);

    return res
      .setHeader('X-Request-Id', requestId)
      .setHeader('X-Execution-Time', \`\${Date.now() - startTime}ms\`)
      .status(200)
      .json({
        success: true,
        result,
        executionTime: Date.now() - startTime,
        requestId,
      });
  } catch (error) {
    return res
      .setHeader('X-Request-Id', requestId)
      .status(500)
      .json({
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
        requestId,
      });
  }
}
`;

/**
 * Bundle handler template for Vercel - unified workflows and node types
 */
const VERCEL_BUNDLE_HANDLER_TEMPLATE = `{{GENERATED_HEADER}}
import type { VercelRequest, VercelResponse } from '@vercel/node';
{{WORKFLOW_IMPORTS}}
{{NODE_TYPE_IMPORTS}}
import { functionRegistry } from '../runtime/function-registry.js';
import '../runtime/builtin-functions.js';
import { openApiSpec } from '../openapi.js';

export const config = {
  runtime: 'nodejs20.x',
  maxDuration: {{MAX_DURATION}},
};

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = req.headers['x-vercel-id'] as string || crypto.randomUUID();
  const url = new URL(req.url || '/', \`http://\${req.headers.host}\`);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // Handle special routes
  if (pathParts[1] === 'openapi.json' && req.method === 'GET') {
    return res.status(200).json(openApiSpec);
  }

  if (pathParts[1] === 'docs' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(SWAGGER_UI_HTML);
  }

  if (pathParts[1] === 'functions' && req.method === 'GET') {
    const category = req.query.category as string | undefined;
    const functions = functionRegistry.list(category as any);
    return res.status(200).json(functions);
  }

  // Route to workflow: /api/workflows/{name}
  if (pathParts[1] === 'workflows' && pathParts[2]) {
    const workflowName = pathParts[2];
    const workflow = exposedWorkflows[workflowName];

    if (!workflow) {
      return res.status(404).json({
        error: \`Workflow '\${workflowName}' not found\`,
        availableWorkflows: Object.keys(exposedWorkflows),
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are allowed for workflow execution' },
      });
    }

    try {
      const params = req.body || {};
      const startTime = Date.now();
      const result = await workflow(true, params);

      return res
        .setHeader('X-Request-Id', requestId)
        .setHeader('X-Execution-Time', \`\${Date.now() - startTime}ms\`)
        .status(200)
        .json({
          success: true,
          result,
          executionTime: Date.now() - startTime,
          requestId,
        });
    } catch (error) {
      return res
        .setHeader('X-Request-Id', requestId)
        .status(500)
        .json({
          success: false,
          error: { code: 'EXECUTION_ERROR', message: error instanceof Error ? error.message : String(error) },
          requestId,
        });
    }
  }

  // Route to node type: /api/nodes/{name}
  if (pathParts[1] === 'nodes' && pathParts[2]) {
    const nodeTypeName = pathParts[2];
    const nodeType = exposedNodeTypes[nodeTypeName];

    if (!nodeType) {
      return res.status(404).json({
        error: \`Node type '\${nodeTypeName}' not found\`,
        availableNodeTypes: Object.keys(exposedNodeTypes),
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are allowed for node type execution' },
      });
    }

    try {
      const params = req.body || {};
      const startTime = Date.now();
      const result = await nodeType(true, params);

      return res
        .setHeader('X-Request-Id', requestId)
        .setHeader('X-Execution-Time', \`\${Date.now() - startTime}ms\`)
        .status(200)
        .json({
          success: true,
          result,
          executionTime: Date.now() - startTime,
          requestId,
        });
    } catch (error) {
      return res
        .setHeader('X-Request-Id', requestId)
        .status(500)
        .json({
          success: false,
          error: { code: 'EXECUTION_ERROR', message: error instanceof Error ? error.message : String(error) },
          requestId,
        });
    }
  }

  return res.status(404).json({ error: 'Not found' });
}
`;

/**
 * Vercel export target
 */
export class VercelTarget extends BaseExportTarget {
  readonly name = 'vercel';
  readonly description = 'Vercel Serverless Functions';

  async generate(options: ExportOptions): Promise<ExportArtifacts> {
    const files = [];
    const maxDuration = (options.targetOptions?.maxDuration as number) || 60;
    const includeDocs = options.includeDocs ?? false;

    // Generate handler - filename becomes the route
    const handlerContent = VERCEL_HANDLER_TEMPLATE
      .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target vercel'))
      .replace('{{WORKFLOW_IMPORT}}', `import { ${options.workflowName} } from '../workflow.js';`)
      .replace(/\{\{FUNCTION_NAME\}\}/g, options.workflowName)
      .replace('{{MAX_DURATION}}', String(maxDuration));

    // Vercel uses file-based routing under api/
    const handlerFileName = `api/${options.displayName}.ts`;
    files.push(this.createFile(options.outputDir, handlerFileName, handlerContent, 'handler'));

    // Generate docs handlers if enabled
    if (includeDocs) {
      // OpenAPI spec file
      const openApiSpec = this.generateOpenAPISpec(options);
      const openApiContent = OPENAPI_SPEC_TEMPLATE.replace(
        '{{OPENAPI_SPEC}}',
        JSON.stringify(openApiSpec, null, 2)
      );
      files.push(this.createFile(options.outputDir, 'openapi.ts', openApiContent, 'config'));

      // OpenAPI endpoint handler
      const openApiHandlerContent = VERCEL_OPENAPI_HANDLER_TEMPLATE
        .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target vercel --docs'));
      files.push(
        this.createFile(
          options.outputDir,
          'api/openapi.ts',
          openApiHandlerContent,
          'handler'
        )
      );

      // Docs endpoint handler
      const docsContent = VERCEL_DOCS_HANDLER_TEMPLATE
        .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target vercel --docs'))
        .replace(/\{\{WORKFLOW_NAME\}\}/g, options.displayName);
      files.push(this.createFile(options.outputDir, 'api/docs.ts', docsContent, 'handler'));
    }

    // Generate package.json
    const packageJson = this.generatePackageJson({
      name: options.displayName,
      description: options.description,
      scripts: {
        dev: 'vercel dev',
        deploy: 'vercel deploy',
      },
      devDependencies: {
        '@vercel/node': '^3.0.0',
      },
    });

    files.push(this.createFile(options.outputDir, 'package.json', packageJson, 'package'));

    // Generate vercel.json
    const functionsConfig: Record<string, object> = {
      [`api/${options.displayName}.ts`]: {
        memory: 1024,
        maxDuration,
      },
    };

    if (includeDocs) {
      functionsConfig['api/openapi.ts'] = { memory: 256, maxDuration: 10 };
      functionsConfig['api/docs.ts'] = { memory: 256, maxDuration: 10 };
    }

    const vercelConfig = { functions: functionsConfig };

    files.push(
      this.createFile(
        options.outputDir,
        'vercel.json',
        JSON.stringify(vercelConfig, null, 2),
        'config'
      )
    );

    // Generate README from deploy instructions
    const artifacts: ExportArtifacts = { files, target: this.name, workflowName: options.displayName, entryPoint: handlerFileName };
    const instructions = this.getDeployInstructions(artifacts);
    const readme = this.generateReadme(instructions, options.displayName, 'Vercel');
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
      servers: [{ url: '/api', description: 'Vercel API routes' }],
      paths: {
        [`/${options.displayName}`]: {
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
      },
      tags: [{ name: 'workflows', description: 'Workflow execution endpoints' }],
    };
  }

  async generateMultiWorkflow(
    workflows: CompiledWorkflow[],
    options: ExportOptions
  ): Promise<MultiWorkflowArtifacts> {
    const files = [];
    const maxDuration = (options.targetOptions?.maxDuration as number) || 60;
    const serviceName = options.displayName || 'multi-workflow-service';

    // Generate workflow imports and entries
    const workflowImports = workflows
      .map((w) => `import { ${w.functionName} } from '../workflows/${w.name}.js';`)
      .join('\n');

    const workflowEntries = workflows.map((w) => `  '${w.name}': ${w.functionName},`).join('\n');

    // Generate multi-workflow handler
    const handlerContent = VERCEL_MULTI_HANDLER_TEMPLATE
      .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target vercel --multi'))
      .replace('{{WORKFLOW_IMPORTS}}', workflowImports)
      .replace('{{WORKFLOW_ENTRIES}}', workflowEntries)
      .replace(/\{\{SERVICE_NAME\}\}/g, serviceName)
      .replace('{{MAX_DURATION}}', String(maxDuration));

    // Vercel catch-all route handler
    files.push(this.createFile(options.outputDir, 'api/[workflow].ts', handlerContent, 'handler'));

    // Generate consolidated OpenAPI spec
    const openApiSpec = this.generateConsolidatedOpenAPI(workflows, {
      title: `${serviceName} API`,
      version: '1.0.0',
      baseUrl: '/api',
    });

    const openApiContent = `// Generated OpenAPI specification
export const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};
`;
    files.push(this.createFile(options.outputDir, 'openapi.ts', openApiContent, 'config'));

    // Generate vercel.json with rewrites
    const vercelConfig = {
      functions: {
        'api/[workflow].ts': {
          memory: 1024,
          maxDuration,
        },
      },
    };

    files.push(
      this.createFile(
        options.outputDir,
        'vercel.json',
        JSON.stringify(vercelConfig, null, 2),
        'config'
      )
    );

    // Generate workflow content files
    files.push(...this.generateWorkflowContentFiles(workflows, options.outputDir));

    return {
      files,
      target: this.name,
      workflowName: serviceName,
      workflowNames: workflows.map((w) => w.name),
      entryPoint: 'api/[workflow].ts',
      openApiSpec,
    };
  }

  async generateNodeTypeService(
    nodeTypes: NodeTypeInfo[],
    options: NodeTypeExportOptions
  ): Promise<NodeTypeArtifacts> {
    const files = [];
    const maxDuration = 60;
    const serviceName = options.serviceName || 'node-type-service';

    // Generate node type imports and entries
    // Use lowercase functionName for import paths to match the generated file names
    const nodeTypeImports = nodeTypes
      .map((nt) => `import { ${nt.functionName} } from '../node-types/${nt.functionName.toLowerCase()}.js';`)
      .join('\n');

    const nodeTypeEntries = nodeTypes.map((nt) => `  '${nt.name}': ${nt.functionName},`).join('\n');

    // Generate node type handler
    const handlerContent = VERCEL_NODE_TYPE_HANDLER_TEMPLATE
      .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target vercel --node-types'))
      .replace('{{NODE_TYPE_IMPORTS}}', nodeTypeImports)
      .replace('{{NODE_TYPE_ENTRIES}}', nodeTypeEntries)
      .replace(/\{\{SERVICE_NAME\}\}/g, serviceName)
      .replace('{{MAX_DURATION}}', String(maxDuration));

    // Vercel catch-all route handler
    files.push(this.createFile(options.outputDir, 'api/[nodeType].ts', handlerContent, 'handler'));

    // Generate OpenAPI spec
    const openApiSpec = this.generateNodeTypeOpenAPI(nodeTypes, {
      title: `${serviceName} API`,
      version: '1.0.0',
      baseUrl: '/api',
    });

    const openApiContent = `// Generated OpenAPI specification
export const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};
`;
    files.push(this.createFile(options.outputDir, 'openapi.ts', openApiContent, 'config'));

    // Generate vercel.json
    const vercelConfig = {
      functions: {
        'api/[nodeType].ts': {
          memory: 1024,
          maxDuration,
        },
      },
    };

    files.push(
      this.createFile(
        options.outputDir,
        'vercel.json',
        JSON.stringify(vercelConfig, null, 2),
        'config'
      )
    );

    // Generate node-type content files
    files.push(...this.generateNodeTypeContentFiles(nodeTypes, options.outputDir));

    return {
      files,
      target: this.name,
      workflowName: serviceName,
      nodeTypeNames: nodeTypes.map((nt) => nt.name),
      entryPoint: 'api/[nodeType].ts',
      openApiSpec,
    };
  }

  async generateBundle(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[],
    options: ExportOptions
  ): Promise<BundleArtifacts> {
    const files = [];
    const maxDuration = (options.targetOptions?.maxDuration as number) || 60;
    const serviceName = options.displayName || 'bundle-service';

    // Filter to only include items that have generated code
    // Also skip npm imports (names containing '/') as they should be installed via package.json
    const workflowsWithCode = workflows.filter((w) => w.code);
    const nodeTypesWithCode = nodeTypes.filter((nt) => nt.code && !nt.name.includes('/'));

    // Separate exposed and bundled-only items
    const exposedWorkflows = workflows.filter((w) => w.expose);
    const exposedNodeTypes = nodeTypes.filter((nt) => nt.expose);

    // Detect name collisions between workflows and nodeTypes
    const workflowNames = new Set(workflowsWithCode.map((w) => w.functionName));
    const nodeTypeAliases = new Map<string, string>();
    for (const nt of nodeTypesWithCode) {
      if (workflowNames.has(nt.functionName)) {
        nodeTypeAliases.set(nt.functionName, `${nt.functionName}_nodeType`);
      }
    }

    // Generate all workflow imports (both exposed and bundled-only) - only for those with code
    const workflowImports =
      workflowsWithCode.length > 0
        ? workflowsWithCode
            .map((w) => `import { ${w.functionName} } from '../workflows/${w.name}.js';`)
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
                return `import { ${nt.functionName} as ${alias} } from '../node-types/${lowerFunctionName}.js';`;
              }
              return `import { ${nt.functionName} } from '../node-types/${lowerFunctionName}.js';`;
            })
            .join('\n')
        : '// No node types';

    // Filter exposed items to only include those with code
    const exposedWorkflowsWithCode = exposedWorkflows.filter((w) => w.code);
    const exposedNodeTypesWithCode = exposedNodeTypes.filter((nt) => nt.code);

    // Generate entries only for exposed items with code
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
    const handlerContent = VERCEL_BUNDLE_HANDLER_TEMPLATE
      .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header('export --target vercel --bundle'))
      .replace('{{WORKFLOW_IMPORTS}}', workflowImports)
      .replace('{{NODE_TYPE_IMPORTS}}', nodeTypeImports)
      .replace('{{EXPOSED_WORKFLOW_ENTRIES}}', exposedWorkflowEntries)
      .replace('{{EXPOSED_NODE_TYPE_ENTRIES}}', exposedNodeTypeEntries)
      .replace(/\{\{SERVICE_NAME\}\}/g, serviceName)
      .replace('{{MAX_DURATION}}', String(maxDuration));

    // Vercel catch-all route handler
    files.push(this.createFile(options.outputDir, 'api/[...path].ts', handlerContent, 'handler'));

    // Generate OpenAPI spec for exposed items only
    const openApiSpec = this.generateBundleOpenAPI(workflows, nodeTypes, {
      title: `${serviceName} API`,
      version: '1.0.0',
      baseUrl: '/api',
    });

    const openApiContent = `// Generated OpenAPI specification
export const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};
`;
    files.push(this.createFile(options.outputDir, 'openapi.ts', openApiContent, 'config'));

    // Generate vercel.json
    const vercelConfig = {
      functions: {
        'api/[...path].ts': {
          memory: 1024,
          maxDuration,
        },
      },
    };

    files.push(
      this.createFile(
        options.outputDir,
        'vercel.json',
        JSON.stringify(vercelConfig, null, 2),
        'config'
      )
    );

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
      entryPoint: 'api/[...path].ts',
      openApiSpec,
    };
  }

  getDeployInstructions(artifacts: ExportArtifacts): DeployInstructions {
    const outputDir = artifacts.files[0]?.absolutePath
      ? artifacts.files[0].absolutePath.replace(/\/[^/]+$/, '')
      : '.';

    const steps = [
      `cd ${outputDir}`,
      'npm install',
      'vercel deploy',
    ];

    return {
      title: 'Deploy to Vercel',
      prerequisites: ['Vercel CLI installed (npm install -g vercel)', 'Vercel account'],
      steps,
      localTestSteps: [
        `cd ${outputDir}`,
        'npm install',
        'npm run dev',
        '# API will be available at http://localhost:3000',
        `# Test with: curl -X POST http://localhost:3000/api/${artifacts.workflowName} -H "Content-Type: application/json" -d '{"key": "value"}'`,
      ],
      links: [
        {
          label: 'Vercel Serverless Functions',
          url: 'https://vercel.com/docs/functions/serverless-functions',
        },
        {
          label: 'Vercel CLI',
          url: 'https://vercel.com/docs/cli',
        },
      ],
    };
  }
}
