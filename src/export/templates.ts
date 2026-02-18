/**
 * Serverless handler templates for different platforms
 */

/**
 * AWS Lambda handler template
 */
export const LAMBDA_TEMPLATE = `{{GENERATED_HEADER}}
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
{{WORKFLOW_IMPORT}}

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    const body = typeof event.body === 'string'
      ? JSON.parse(event.body || '{}')
      : event.body || {};

    const startTime = Date.now();
    const result = await {{FUNCTION_NAME}}(true, body);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Execution-Time': \`\${Date.now() - startTime}ms\`,
      },
      body: JSON.stringify({ success: true, result }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        requestId: context.awsRequestId,
      }),
    };
  }
};
`;

/**
 * Vercel serverless function template
 */
export const VERCEL_TEMPLATE = `{{GENERATED_HEADER}}
import type { VercelRequest, VercelResponse } from '@vercel/node';
{{WORKFLOW_IMPORT}}

export const config = {
  runtime: 'nodejs20.x',
  maxDuration: {{MAX_DURATION}},
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const params = req.body || {};
    const startTime = Date.now();

    const result = await {{FUNCTION_NAME}}(true, params);

    return res.status(200).json({
      success: true,
      result,
      executionTime: Date.now() - startTime,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
`;

/**
 * Cloudflare Workers template
 */
export const CLOUDFLARE_TEMPLATE = `{{GENERATED_HEADER}}
{{WORKFLOW_IMPORT}}

interface Env {
  // Add your bindings here (D1, KV, R2, etc.)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await request.json() as Record<string, unknown>;
      const startTime = performance.now();

      const result = await {{FUNCTION_NAME}}(true, body);

      return new Response(JSON.stringify({
        success: true,
        result,
        executionTime: Math.round(performance.now() - startTime),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
} satisfies ExportedHandler<Env>;
`;

/**
 * Inngest durable function template
 */
export const INNGEST_TEMPLATE = `{{GENERATED_HEADER}}
import { Inngest } from 'inngest';
import { serve } from 'inngest/express';
{{WORKFLOW_IMPORT}}

const inngest = new Inngest({ id: 'fw-{{FUNCTION_NAME}}' });

const workflowFn = inngest.createFunction(
  { id: '{{FUNCTION_NAME}}', name: '{{FUNCTION_NAME}}' },
  { event: 'fw/{{FUNCTION_NAME}}.execute' },
  async ({ event, step }) => {
    const params = event.data ?? {};

    const result = await step.run('execute-workflow', async () => {
      return {{FUNCTION_NAME}}(true, params);
    });

    return { success: true, result };
  }
);

export const handler = serve({ client: inngest, functions: [workflowFn] });
export default handler;
`;

/**
 * SAM (Serverless Application Model) template for AWS Lambda
 */
export const SAM_TEMPLATE = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Flow Weaver workflow - {{WORKFLOW_NAME}}

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
      Description: {{WORKFLOW_DESCRIPTION}}
      Events:
        ApiEvent:
          Type: HttpApi
          Properties:
            Path: /{{WORKFLOW_PATH}}
            Method: POST

Outputs:
  ApiEndpoint:
    Description: API endpoint URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/{{WORKFLOW_PATH}}"
`;
