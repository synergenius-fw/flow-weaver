/**
 * Webhook Template
 * HTTP-triggered workflow entry point
 */

import type { WorkflowTemplate, WorkflowTemplateOptions } from "../index";

export const webhookTemplate: WorkflowTemplate = {
  id: "webhook",
  name: "Webhook Handler",
  description: "HTTP-triggered workflow with request/response handling",
  category: "integration",
  generate: (opts: WorkflowTemplateOptions): string => {
    const { workflowName, async: isAsync } = opts;
    const asyncKeyword = isAsync ? "async " : "";
    const returnType = isAsync
      ? "Promise<{ onSuccess: boolean; onFailure: boolean; statusCode: number; body: any }>"
      : "{ onSuccess: boolean; onFailure: boolean; statusCode: number; body: any }";

    return `
/**
 * Validates incoming webhook request
 *
 * @flowWeaver nodeType
 * @label Validate Request
 * @input headers [order:1] - Request headers
 * @input body [order:2] - Request body
 * @input execute [order:0] - Execute
 * @output isValid [order:2] - Whether request is valid
 * @output validatedData [order:3] - Validated request data
 * @output error [order:4] - Validation error message
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function validateRequest(
  execute: boolean,
  headers: Record<string, string>,
  body: any
): { onSuccess: boolean; onFailure: boolean; isValid: boolean; validatedData: any; error: string } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, isValid: false, validatedData: null, error: "" };
  }

  // TODO: Add your validation logic
  // Example: Check API key, validate body schema, etc.
  const apiKey = headers["x-api-key"] || headers["authorization"];

  if (!apiKey) {
    return { onSuccess: false, onFailure: true, isValid: false, validatedData: null, error: "Missing API key" };
  }

  return { onSuccess: true, onFailure: false, isValid: true, validatedData: body, error: "" };
}

/**
 * Processes the webhook payload
 *
 * @flowWeaver nodeType
 * @label Process Payload
 * @input data [order:1] - Validated payload data
 * @input execute [order:0] - Execute
 * @output result [order:2] - Processing result
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function processPayload(
  execute: boolean,
  data: any
): { onSuccess: boolean; onFailure: boolean; result: any } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, result: null };
  }

  // TODO: Add your business logic
  const result = {
    processed: true,
    timestamp: new Date().toISOString(),
    data
  };

  return { onSuccess: true, onFailure: false, result };
}

/**
 * Formats the HTTP response
 *
 * @flowWeaver nodeType
 * @label Format Response
 * @input result [order:1] - Processing result
 * @input error [order:2] - Error message if any
 * @input isSuccess [order:3] - Whether processing succeeded
 * @input execute [order:0] - Execute
 * @output statusCode [order:2] - HTTP status code
 * @output body [order:3] - Response body
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function formatResponse(
  execute: boolean,
  result: any,
  error: string,
  isSuccess: boolean
): { onSuccess: boolean; onFailure: boolean; statusCode: number; body: any } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, statusCode: 0, body: null };
  }

  if (isSuccess) {
    return {
      onSuccess: true,
      onFailure: false,
      statusCode: 200,
      body: { success: true, data: result }
    };
  } else {
    return {
      onSuccess: true,
      onFailure: false,
      statusCode: 400,
      body: { success: false, error: error || "Processing failed" }
    };
  }
}

/**
 * @flowWeaver workflow
 * @node validator validateRequest [position: -180 0]
 * @node processor processPayload [position: 90 -60]
 * @node responder formatResponse [position: 270 0]
 * @position Start -450 0
 * @position Exit 450 0
 * @connect Start.execute -> validator.execute
 * @connect Start.headers -> validator.headers
 * @connect Start.body -> validator.body
 * @connect validator.onSuccess -> processor.execute
 * @connect validator.validatedData -> processor.data
 * @connect validator.error -> responder.error
 * @connect processor.onSuccess -> responder.execute
 * @connect processor.result -> responder.result
 * @connect validator.isValid -> responder.isSuccess
 * @connect responder.statusCode -> Exit.statusCode
 * @connect responder.body -> Exit.body
 * @connect responder.onSuccess -> Exit.onSuccess
 * @connect responder.onFailure -> Exit.onFailure
 * @param execute [order:0] - Execute
 * @param headers [order:1] - HTTP request headers
 * @param body [order:2] - HTTP request body
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns statusCode [order:2] - HTTP response status code
 * @returns body [order:3] - HTTP response body
 */
export ${asyncKeyword}function ${workflowName}(
  execute: boolean,
  params: { headers: Record<string, string>; body: any }
): ${returnType} {
  throw new Error("Compile with: flow-weaver compile <file>");
}
`.trim();
  },
};
