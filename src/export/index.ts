/**
 * Serverless export orchestrator
 * Generates deployment-ready handlers for various platforms
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getGeneratedBranding } from '../generated-branding.js';
import { compileWorkflow } from '../api/compile.js';
import { AnnotationParser } from '../parser.js';
import {
  LAMBDA_TEMPLATE,
  VERCEL_TEMPLATE,
  CLOUDFLARE_TEMPLATE,
  INNGEST_TEMPLATE,
  SAM_TEMPLATE,
} from './templates.js';
import { generateInngestFunction } from '../generator/inngest.js';

/**
 * Supported export targets
 */
export type ExportTarget = 'lambda' | 'vercel' | 'cloudflare' | 'inngest';

/**
 * Options for exporting a workflow
 */
export interface ExportOptions {
  /** Target platform */
  target: ExportTarget;
  /** Input workflow file */
  input: string;
  /** Output directory */
  output: string;
  /** Specific workflow name (if file has multiple) */
  workflow?: string;
  /** Production mode (no debug events) */
  production?: boolean;
  /** Bundle workflow into single file (future feature) */
  bundle?: boolean;
  /** Dry run - preview without writing files */
  dryRun?: boolean;
  /** Export all workflows in file as a single multi-workflow service */
  multi?: boolean;
  /** Specific workflow names to export (subset when using multi) */
  workflows?: string[];
  /** Include API documentation routes */
  includeDocs?: boolean;
  /** Use deep generator with per-node Inngest steps for durability (inngest target only) */
  durableSteps?: boolean;
}

/**
 * Result of export operation
 */
export interface ExportResult {
  /** Target platform */
  target: ExportTarget;
  /** Generated files */
  files: Array<{ path: string; content: string }>;
  /** Workflow name */
  workflow: string;
  /** Workflow description */
  description?: string;
  /** All workflow names (for multi-workflow export) */
  workflows?: string[];
  /** OpenAPI spec (if generated) */
  openApiSpec?: object;
}

/**
 * Export multiple workflows as a single service
 */
export async function exportMultiWorkflow(options: ExportOptions): Promise<ExportResult> {
  const inputPath = path.resolve(options.input);
  const outputDir = path.resolve(options.output);
  const isDryRun = options.dryRun ?? false;

  // Validate input file exists
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  // Parse to find workflows
  const parser = new AnnotationParser();
  const parseResult = parser.parse(inputPath);

  if (parseResult.workflows.length === 0) {
    throw new Error(`No workflows found in ${inputPath}`);
  }

  // Filter workflows if specific ones are requested
  let selectedWorkflows = parseResult.workflows;
  if (options.workflows && options.workflows.length > 0) {
    selectedWorkflows = parseResult.workflows.filter(
      (w) => options.workflows!.includes(w.name) || options.workflows!.includes(w.functionName)
    );
    if (selectedWorkflows.length === 0) {
      const available = parseResult.workflows.map((w) => w.name).join(', ');
      throw new Error(`None of the requested workflows found. Available: ${available}`);
    }
  }

  // For dry-run, use temp directory for compilation
  const workDir = isDryRun
    ? path.join(os.tmpdir(), `fw-export-multi-dryrun-${Date.now()}`)
    : outputDir;

  // Create working directory
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.join(workDir, 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(workDir, 'runtime'), { recursive: true });

  const compiledWorkflows: Array<{
    name: string;
    functionName: string;
    description?: string;
    code: string;
  }> = [];

  try {
    // Compile each workflow
    for (const workflow of selectedWorkflows) {
      const workflowOutputPath = path.join(workDir, 'workflows', `${workflow.name}.ts`);

      // Copy source file
      fs.copyFileSync(inputPath, workflowOutputPath);

      // Compile in-place
      await compileWorkflow(workflowOutputPath, {
        write: true,
        inPlace: true,
        parse: { workflowName: workflow.functionName },
        generate: { production: options.production ?? true },
      });

      const compiledCode = fs.readFileSync(workflowOutputPath, 'utf8');

      compiledWorkflows.push({
        name: workflow.name,
        functionName: workflow.functionName,
        description: workflow.description,
        code: compiledCode,
      });
    }

    // Copy runtime files
    const runtimeDir = path.join(workDir, 'runtime');
    const libraryRuntimeDir = path.resolve(__dirname, '../runtime');

    // Copy function registry and builtin functions
    const runtimeFiles = ['function-registry.ts', 'parameter-resolver.ts', 'builtin-functions.ts'];
    for (const file of runtimeFiles) {
      const srcPath = path.join(libraryRuntimeDir, file);
      const destPath = path.join(runtimeDir, file);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
      }
    }

    // Generate handler and config based on target
    const result = generateMultiHandler(options.target, compiledWorkflows, workDir, options);

    // Write files if not dry-run
    if (!isDryRun) {
      for (const file of result.files) {
        const dirPath = path.dirname(file.path);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        fs.writeFileSync(file.path, file.content);
      }
    }

    return {
      target: options.target,
      files: result.files,
      workflow: result.serviceName,
      workflows: compiledWorkflows.map((w) => w.name),
      openApiSpec: result.openApiSpec,
    };
  } finally {
    // Clean up temp directory in dry-run mode
    if (isDryRun) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Generate multi-workflow handler and config files
 */
function generateMultiHandler(
  target: ExportTarget,
  workflows: Array<{ name: string; functionName: string; description?: string; code: string }>,
  outputDir: string,
  options: ExportOptions
): { files: Array<{ path: string; content: string }>; serviceName: string; openApiSpec: object } {
  const files: Array<{ path: string; content: string }> = [];
  const serviceName = path.basename(options.input, path.extname(options.input)) + '-service';

  // Generate workflow imports and entries
  const workflowImports = workflows
    .map((w) => `import { ${w.functionName} } from './workflows/${w.name}.js';`)
    .join('\n');

  const workflowEntries = workflows.map((w) => `  '${w.name}': ${w.functionName},`).join('\n');

  // Generate OpenAPI spec
  const openApiSpec = generateMultiWorkflowOpenAPI(workflows, serviceName);

  // Generate based on target
  switch (target) {
    case 'lambda':
      files.push({
        path: path.join(outputDir, 'handler.ts'),
        content: generateLambdaMultiHandler(workflowImports, workflowEntries, serviceName),
      });
      files.push({
        path: path.join(outputDir, 'openapi.ts'),
        content: `// Generated OpenAPI specification\nexport const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};\n`,
      });
      files.push({
        path: path.join(outputDir, 'template.yaml'),
        content: generateLambdaSAMMultiTemplate(serviceName, workflows.length),
      });
      files.push({
        path: path.join(outputDir, 'package.json'),
        content: JSON.stringify(
          {
            name: `fw-${serviceName}`,
            version: '1.0.0',
            type: 'module',
            main: 'handler.js',
            scripts: {
              build: 'tsc',
              deploy: 'sam build && sam deploy --guided',
            },
            devDependencies: {
              '@types/aws-lambda': '^8.10.0',
              typescript: '^5.0.0',
            },
          },
          null,
          2
        ),
      });
      files.push({
        path: path.join(outputDir, 'tsconfig.json'),
        content: JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              outDir: './dist',
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
            },
            include: ['*.ts', 'workflows/*.ts', 'runtime/*.ts'],
          },
          null,
          2
        ),
      });
      break;

    case 'vercel':
      files.push({
        path: path.join(outputDir, 'api', '[workflow].ts'),
        content: generateVercelMultiHandler(workflowImports, workflowEntries, serviceName),
      });
      files.push({
        path: path.join(outputDir, 'openapi.ts'),
        content: `// Generated OpenAPI specification\nexport const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};\n`,
      });
      files.push({
        path: path.join(outputDir, 'vercel.json'),
        content: JSON.stringify(
          {
            functions: {
              'api/[workflow].ts': {
                memory: 1024,
                maxDuration: 60,
              },
            },
          },
          null,
          2
        ),
      });
      break;

    case 'cloudflare':
      files.push({
        path: path.join(outputDir, 'index.ts'),
        content: generateCloudflareMultiHandler(workflowImports, workflowEntries, serviceName),
      });
      files.push({
        path: path.join(outputDir, 'openapi.ts'),
        content: `// Generated OpenAPI specification\nexport const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};\n`,
      });
      files.push({
        path: path.join(outputDir, 'wrangler.toml'),
        content: `name = "${serviceName}"\nmain = "dist/index.js"\ncompatibility_date = "2024-01-01"\n\n[build]\ncommand = "npm run build"\n`,
      });
      files.push({
        path: path.join(outputDir, 'package.json'),
        content: JSON.stringify(
          {
            name: `fw-${serviceName}`,
            version: '1.0.0',
            type: 'module',
            scripts: {
              build: 'tsc',
              deploy: 'wrangler deploy',
              dev: 'wrangler dev',
            },
            devDependencies: {
              '@cloudflare/workers-types': '^4.0.0',
              typescript: '^5.0.0',
              wrangler: '^3.0.0',
            },
          },
          null,
          2
        ),
      });
      files.push({
        path: path.join(outputDir, 'tsconfig.json'),
        content: JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              outDir: './dist',
              strict: true,
              skipLibCheck: true,
              types: ['@cloudflare/workers-types'],
            },
            include: ['*.ts', 'workflows/*.ts', 'runtime/*.ts'],
          },
          null,
          2
        ),
      });
      break;

    case 'inngest':
      files.push({
        path: path.join(outputDir, 'handler.ts'),
        content: generateInngestMultiHandler(workflowImports, workflowEntries, serviceName, workflows),
      });
      files.push({
        path: path.join(outputDir, 'openapi.ts'),
        content: `// Generated OpenAPI specification\nexport const openApiSpec = ${JSON.stringify(openApiSpec, null, 2)};\n`,
      });
      files.push({
        path: path.join(outputDir, 'package.json'),
        content: JSON.stringify(
          {
            name: `fw-${serviceName}`,
            version: '1.0.0',
            type: 'module',
            main: 'handler.js',
            scripts: {
              build: 'tsc',
              dev: 'npx inngest-cli@latest dev & npx tsx handler.ts',
              serve: 'npx tsx handler.ts',
            },
            dependencies: {
              inngest: '^3.0.0',
              express: '^4.18.0',
            },
            devDependencies: {
              '@types/express': '^4.17.0',
              typescript: '^5.0.0',
            },
          },
          null,
          2
        ),
      });
      files.push({
        path: path.join(outputDir, 'tsconfig.json'),
        content: JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              outDir: './dist',
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
            },
            include: ['*.ts', 'workflows/*.ts', 'runtime/*.ts'],
          },
          null,
          2
        ),
      });
      break;
  }

  return { files, serviceName, openApiSpec };
}

/**
 * Generate consolidated OpenAPI spec for multiple workflows
 */
function generateMultiWorkflowOpenAPI(
  workflows: Array<{ name: string; functionName: string; description?: string }>,
  serviceName: string
): object {
  const paths: Record<string, object> = {};

  for (const workflow of workflows) {
    paths[`/api/${workflow.name}`] = {
      post: {
        operationId: `execute_${workflow.functionName}`,
        summary: `Execute ${workflow.name} workflow`,
        description: workflow.description || `Execute the ${workflow.name} workflow`,
        tags: ['workflows'],
        requestBody: {
          description: 'Workflow input parameters',
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', additionalProperties: true },
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
          '404': { description: 'Workflow not found' },
          '500': { description: 'Execution error' },
        },
      },
    };
  }

  // Add functions endpoint
  paths['/api/functions'] = {
    get: {
      operationId: 'list_functions',
      summary: 'List available functions',
      description: 'Returns all registered functions that can be used as parameters',
      tags: ['functions'],
      responses: {
        '200': {
          description: 'List of registered functions',
          content: { 'application/json': { schema: { type: 'array' } } },
        },
      },
    },
  };

  return {
    openapi: '3.0.3',
    info: {
      title: `${serviceName} API`,
      version: '1.0.0',
      description: `Multi-workflow service with ${workflows.length} workflows`,
    },
    paths,
    tags: [
      { name: 'workflows', description: 'Workflow execution endpoints' },
      { name: 'functions', description: 'Function registry endpoints' },
    ],
  };
}

/**
 * Generate Lambda multi-workflow handler
 */
function generateLambdaMultiHandler(imports: string, entries: string, serviceName: string): string {
  return `${getGeneratedBranding().header('export --target lambda --multi')}
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
${imports}
import { functionRegistry } from './runtime/function-registry.js';
import './runtime/builtin-functions.js';
import { openApiSpec } from './openapi.js';

const workflows: Record<string, (execute: boolean, params: unknown) => Promise<unknown>> = {
${entries}
};

const SWAGGER_UI_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${serviceName} API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: './openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>\`;

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  context.callbackWaitsForEmptyEventLoop = false;
  const path = event.rawPath || event.requestContext?.http?.path || '/';
  const method = event.requestContext?.http?.method || 'GET';

  if (path === '/api/openapi.json' && method === 'GET') {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(openApiSpec) };
  }

  if (path === '/api/docs' && method === 'GET') {
    return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: SWAGGER_UI_HTML };
  }

  if (path === '/api/functions' && method === 'GET') {
    const category = event.queryStringParameters?.category;
    const functions = functionRegistry.list(category as any);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(functions) };
  }

  const workflowMatch = path.match(/^\\/api\\/([^\\/]+)$/);
  if (!workflowMatch) {
    return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not found' }) };
  }

  const workflowName = workflowMatch[1];
  const workflow = workflows[workflowName];

  if (!workflow) {
    return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: \`Workflow '\${workflowName}' not found\`, availableWorkflows: Object.keys(workflows) }) };
  }

  if (method !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
    const startTime = Date.now();
    const result = await workflow(true, body);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'X-Execution-Time': \`\${Date.now() - startTime}ms\`, 'X-Request-Id': context.awsRequestId },
      body: JSON.stringify({ success: true, result, executionTime: Date.now() - startTime, requestId: context.awsRequestId }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error), requestId: context.awsRequestId }),
    };
  }
};
`;
}

/**
 * Generate Lambda SAM template for multi-workflow
 */
function generateLambdaSAMMultiTemplate(serviceName: string, workflowCount: number): string {
  return `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Flow Weaver multi-workflow service - ${serviceName}

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs20.x
    MemorySize: 256

Resources:
  WorkflowFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      CodeUri: .
      Description: Multi-workflow service with ${workflowCount} workflows
      Events:
        ApiProxy:
          Type: HttpApi
          Properties:
            Path: /api/{proxy+}
            Method: ANY

Outputs:
  ApiEndpoint:
    Description: API base URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/api"
`;
}

/**
 * Generate Vercel multi-workflow handler
 */
function generateVercelMultiHandler(imports: string, entries: string, serviceName: string): string {
  const adjustedImports = imports.replace(/\.\//g, '../');
  return `${getGeneratedBranding().header('export --target vercel --multi')}
import type { VercelRequest, VercelResponse } from '@vercel/node';
${adjustedImports}
import { functionRegistry } from '../runtime/function-registry.js';
import '../runtime/builtin-functions.js';
import { openApiSpec } from '../openapi.js';

export const config = { runtime: 'nodejs20.x', maxDuration: 60 };

const workflows: Record<string, (execute: boolean, params: unknown) => Promise<unknown>> = {
${entries}
};

const SWAGGER_UI_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${serviceName} API Documentation</title>
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

  const workflow = typeof workflowName === 'string' ? workflows[workflowName] : undefined;

  if (!workflow) {
    return res.status(404).json({ error: \`Workflow '\${workflowName}' not found\`, availableWorkflows: Object.keys(workflows) });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const params = req.body || {};
    const startTime = Date.now();
    const result = await workflow(true, params);

    return res.setHeader('X-Request-Id', requestId).setHeader('X-Execution-Time', \`\${Date.now() - startTime}ms\`).status(200).json({ success: true, result, executionTime: Date.now() - startTime, requestId });
  } catch (error) {
    return res.setHeader('X-Request-Id', requestId).status(500).json({ success: false, error: { code: 'EXECUTION_ERROR', message: error instanceof Error ? error.message : String(error) }, requestId });
  }
}
`;
}

/**
 * Generate Cloudflare multi-workflow handler
 */
function generateCloudflareMultiHandler(
  imports: string,
  entries: string,
  serviceName: string
): string {
  return `${getGeneratedBranding().header('export --target cloudflare --multi')}
${imports}
import { functionRegistry } from './runtime/function-registry.js';
import './runtime/builtin-functions.js';
import { openApiSpec } from './openapi.js';

interface Env {}

const workflows: Record<string, (execute: boolean, params: unknown) => Promise<unknown>> = {
${entries}
};

const SWAGGER_UI_HTML = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${serviceName} API Documentation</title>
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

    if (path === '/api/openapi.json' && method === 'GET') {
      return new Response(JSON.stringify(openApiSpec), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (path === '/api/docs' && method === 'GET') {
      return new Response(SWAGGER_UI_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    if (path === '/api/functions' && method === 'GET') {
      const category = url.searchParams.get('category');
      const functions = functionRegistry.list(category as any);
      return new Response(JSON.stringify(functions), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const workflowMatch = path.match(/^\\/api\\/([^\\/]+)$/);
    if (!workflowMatch) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const workflowName = workflowMatch[1];
    const workflow = workflows[workflowName];

    if (!workflow) {
      return new Response(JSON.stringify({ error: \`Workflow '\${workflowName}' not found\`, availableWorkflows: Object.keys(workflows) }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    }

    const requestId = request.headers.get('cf-ray') || crypto.randomUUID();

    try {
      const body = await request.json() as Record<string, unknown>;
      const startTime = performance.now();
      const result = await workflow(true, body);

      return new Response(JSON.stringify({ success: true, result, executionTime: Math.round(performance.now() - startTime), requestId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, 'X-Execution-Time': \`\${Math.round(performance.now() - startTime)}ms\` },
      });
    } catch (error) {
      return new Response(JSON.stringify({ success: false, error: { code: 'EXECUTION_ERROR', message: error instanceof Error ? error.message : String(error) }, requestId }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
      });
    }
  },
} satisfies ExportedHandler<Env>;
`;
}

/**
 * Generate Inngest multi-workflow handler
 */
function generateInngestMultiHandler(
  imports: string,
  entries: string,
  serviceName: string,
  workflows: Array<{ name: string; functionName: string; description?: string }>
): string {
  const serviceId = serviceName
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();

  const functionDefs = workflows.map((w) => {
    const fnId = w.name
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .toLowerCase();
    const fnVar = `fn_${w.functionName.replace(/[^a-zA-Z0-9_$]/g, '_')}`;
    return `const ${fnVar} = inngest.createFunction(
  { id: '${fnId}', name: '${w.name}' },
  { event: 'fw/${fnId}.execute' },
  async ({ event, step }) => {
    const params = event.data ?? {};
    const result = await step.run('execute-workflow', async () => {
      return ${w.functionName}(true, params);
    });
    return { success: true, result };
  }
);`;
  }).join('\n\n');

  const functionList = workflows
    .map((w) => `fn_${w.functionName.replace(/[^a-zA-Z0-9_$]/g, '_')}`)
    .join(', ');

  return `${getGeneratedBranding().header('export --target inngest --multi')}
import { Inngest } from 'inngest';
import { serve } from 'inngest/express';
import express from 'express';
${imports}
import { functionRegistry } from './runtime/function-registry.js';
import './runtime/builtin-functions.js';
import { openApiSpec } from './openapi.js';

const inngest = new Inngest({ id: '${serviceId}' });

${functionDefs}

const functions = [${functionList}];

type WorkflowHandler = (execute: boolean, params: unknown) => Promise<unknown>;
const directHandlers: Record<string, WorkflowHandler> = {
${entries}
};

const app = express();
app.use(express.json());

app.use('/api/inngest', serve({ client: inngest, functions }));

app.get('/api/openapi.json', (_req, res) => { res.json(openApiSpec); });

app.get('/api/functions', (req, res) => {
  const category = req.query.category as string | undefined;
  res.json(functionRegistry.list(category as any));
});

app.post('/api/invoke/:workflowName', async (req, res) => {
  const workflow = directHandlers[req.params.workflowName];
  if (!workflow) {
    return res.status(404).json({ error: \`Workflow '\${req.params.workflowName}' not found\`, availableWorkflows: Object.keys(directHandlers) });
  }
  try {
    const startTime = Date.now();
    const result = await workflow(true, req.body || {});
    res.json({ success: true, result, executionTime: Date.now() - startTime });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

export const handler = app;
export default app;
`;
}

/**
 * Export a workflow for serverless deployment
 */
export async function exportWorkflow(options: ExportOptions): Promise<ExportResult> {
  // If multi mode, use multi-workflow export
  if (options.multi) {
    return exportMultiWorkflow(options);
  }

  const inputPath = path.resolve(options.input);
  const outputDir = path.resolve(options.output);
  const isDryRun = options.dryRun ?? false;

  // Validate input file exists
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  // Parse to find workflows
  const parser = new AnnotationParser();
  const parseResult = parser.parse(inputPath);

  if (parseResult.workflows.length === 0) {
    throw new Error(`No workflows found in ${inputPath}`);
  }

  // Select workflow
  const workflow = options.workflow
    ? parseResult.workflows.find(
        (w) => w.name === options.workflow || w.functionName === options.workflow
      )
    : parseResult.workflows[0];

  if (!workflow) {
    const available = parseResult.workflows.map((w) => w.name).join(', ');
    throw new Error(`Workflow "${options.workflow}" not found. Available: ${available}`);
  }

  // For dry-run, use temp directory for compilation
  const workDir = isDryRun ? path.join(os.tmpdir(), `fw-export-dryrun-${Date.now()}`) : outputDir;

  // Create working directory
  fs.mkdirSync(workDir, { recursive: true });

  let compiledContent: string;
  let compiledPath: string;

  try {
    // Compile workflow to working directory
    compiledPath = await compileToOutput(
      inputPath,
      workflow.functionName,
      workDir,
      options.production
    );
    compiledContent = fs.readFileSync(compiledPath, 'utf8');
  } finally {
    // Clean up temp directory in dry-run mode
    if (isDryRun) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // Generate handler based on target
  let handler: string;

  if (options.target === 'inngest' && options.durableSteps) {
    // Use deep generator for durable Inngest steps
    const allNodeTypes = [...(workflow.nodeTypes || [])];
    handler = generateInngestFunction(workflow, allNodeTypes, {
      production: options.production ?? true,
    });
  } else {
    handler = generateHandler(options.target, compiledPath, workflow.functionName);
  }

  // Determine output file name
  const handlerFileName = getHandlerFileName(options.target, workflow.name);
  const handlerPath = path.join(outputDir, handlerFileName);
  const workflowOutputPath = path.join(outputDir, 'workflow.ts');

  // Generate config files (use outputDir for paths even in dry-run)
  const configFiles = generateConfigFiles(
    options.target,
    workflow.name,
    outputDir,
    workflow.description
  );

  // Only write files if not a dry-run
  if (!isDryRun) {
    // Create output directory
    fs.mkdirSync(outputDir, { recursive: true });

    // Write handler file (ensure parent directory exists for api/ subdirectory)
    const handlerDir = path.dirname(handlerPath);
    if (!fs.existsSync(handlerDir)) {
      fs.mkdirSync(handlerDir, { recursive: true });
    }
    fs.writeFileSync(handlerPath, handler);

    // Write config files
    for (const file of configFiles) {
      fs.writeFileSync(file.path, file.content);
    }

    // Write compiled workflow
    fs.writeFileSync(workflowOutputPath, compiledContent);
  }

  const files = [
    { path: handlerPath, content: handler },
    ...configFiles,
    { path: workflowOutputPath, content: compiledContent },
  ];

  return {
    target: options.target,
    files,
    workflow: workflow.name,
    description: workflow.description,
  };
}

/**
 * Compile workflow to output directory
 */
async function compileToOutput(
  inputPath: string,
  functionName: string,
  outputDir: string,
  production?: boolean
): Promise<string> {
  const outputPath = path.join(outputDir, 'workflow.ts');

  // Copy source file to output
  fs.copyFileSync(inputPath, outputPath);

  // Compile in-place in the output directory
  await compileWorkflow(outputPath, {
    write: true,
    inPlace: true,
    parse: { workflowName: functionName },
    generate: { production: production ?? true },
  });

  return outputPath;
}

/**
 * Generate handler code from template
 */
function generateHandler(target: ExportTarget, workflowPath: string, functionName: string): string {
  const template = getTemplate(target);
  // Vercel handlers live in api/ subdirectory, so import from parent
  const relativePath = target === 'vercel'
    ? `../${path.basename(workflowPath).replace('.ts', '.js')}`
    : `./${path.basename(workflowPath).replace('.ts', '.js')}`;

  return template
    .replace('{{GENERATED_HEADER}}', getGeneratedBranding().header(`export --target ${target}`))
    .replace('{{WORKFLOW_IMPORT}}', `import { ${functionName} } from '${relativePath}';`)
    .replace(/\{\{FUNCTION_NAME\}\}/g, functionName)
    .replace('{{MAX_DURATION}}', '60');
}

/**
 * Get template for target platform
 */
function getTemplate(target: ExportTarget): string {
  switch (target) {
    case 'lambda':
      return LAMBDA_TEMPLATE;
    case 'vercel':
      return VERCEL_TEMPLATE;
    case 'cloudflare':
      return CLOUDFLARE_TEMPLATE;
    case 'inngest':
      return INNGEST_TEMPLATE;
  }
}

/**
 * Get handler file name for target platform
 */
function getHandlerFileName(target: ExportTarget, workflowName: string): string {
  switch (target) {
    case 'lambda':
      return 'handler.ts';
    case 'vercel':
      // Vercel uses file-based routing under api/
      return `api/${workflowName}.ts`;
    case 'cloudflare':
      return 'index.ts';
    case 'inngest':
      return 'handler.ts';
  }
}

/**
 * Generate config files for target platform
 */
function generateConfigFiles(
  target: ExportTarget,
  workflowName: string,
  outputDir: string,
  description?: string
): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  switch (target) {
    case 'lambda':
      // Generate SAM template
      files.push({
        path: path.join(outputDir, 'template.yaml'),
        content: SAM_TEMPLATE.replace(/\{\{WORKFLOW_NAME\}\}/g, workflowName)
          .replace(
            '{{WORKFLOW_DESCRIPTION}}',
            description || `Flow Weaver workflow: ${workflowName}`
          )
          .replace(/\{\{WORKFLOW_PATH\}\}/g, workflowName),
      });

      // Generate package.json for Lambda
      files.push({
        path: path.join(outputDir, 'package.json'),
        content: JSON.stringify(
          {
            name: `fw-${workflowName}`,
            version: '1.0.0',
            type: 'module',
            main: 'handler.js',
            scripts: {
              build: 'tsc',
              deploy: 'sam build && sam deploy --guided',
            },
            devDependencies: {
              '@types/aws-lambda': '^8.10.0',
              typescript: '^5.0.0',
            },
          },
          null,
          2
        ),
      });

      // Generate tsconfig.json
      files.push({
        path: path.join(outputDir, 'tsconfig.json'),
        content: JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              outDir: './dist',
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
            },
            include: ['*.ts'],
          },
          null,
          2
        ),
      });
      break;

    case 'vercel':
      // Generate vercel.json
      files.push({
        path: path.join(outputDir, 'vercel.json'),
        content: JSON.stringify(
          {
            functions: {
              [`api/${workflowName}.ts`]: {
                memory: 1024,
                maxDuration: 60,
              },
            },
          },
          null,
          2
        ),
      });
      break;

    case 'cloudflare':
      // Generate wrangler.toml
      files.push({
        path: path.join(outputDir, 'wrangler.toml'),
        content: `name = "${workflowName}"
main = "dist/index.js"
compatibility_date = "2024-01-01"

[build]
command = "npm run build"
`,
      });

      // Generate package.json for Cloudflare
      files.push({
        path: path.join(outputDir, 'package.json'),
        content: JSON.stringify(
          {
            name: `fw-${workflowName}`,
            version: '1.0.0',
            type: 'module',
            scripts: {
              build: 'tsc',
              deploy: 'wrangler deploy',
              dev: 'wrangler dev',
            },
            devDependencies: {
              '@cloudflare/workers-types': '^4.0.0',
              typescript: '^5.0.0',
              wrangler: '^3.0.0',
            },
          },
          null,
          2
        ),
      });

      // Generate tsconfig.json
      files.push({
        path: path.join(outputDir, 'tsconfig.json'),
        content: JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              outDir: './dist',
              strict: true,
              skipLibCheck: true,
              types: ['@cloudflare/workers-types'],
            },
            include: ['*.ts'],
          },
          null,
          2
        ),
      });
      break;

    case 'inngest':
      // Generate package.json for Inngest
      files.push({
        path: path.join(outputDir, 'package.json'),
        content: JSON.stringify(
          {
            name: `fw-${workflowName}`,
            version: '1.0.0',
            type: 'module',
            main: 'handler.js',
            scripts: {
              build: 'tsc',
              dev: 'npx inngest-cli@latest dev & npx tsx handler.ts',
              serve: 'npx tsx handler.ts',
            },
            dependencies: {
              inngest: '^3.0.0',
            },
            devDependencies: {
              typescript: '^5.0.0',
            },
          },
          null,
          2
        ),
      });

      // Generate tsconfig.json
      files.push({
        path: path.join(outputDir, 'tsconfig.json'),
        content: JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              outDir: './dist',
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
            },
            include: ['*.ts'],
          },
          null,
          2
        ),
      });
      break;
  }

  return files;
}

/**
 * List supported export targets
 */
export function getSupportedTargets(): ExportTarget[] {
  return ['lambda', 'vercel', 'cloudflare', 'inngest'];
}
