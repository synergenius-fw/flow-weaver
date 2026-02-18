/**
 * HTTP Node Template
 * HTTP request with configurable method, headers, body
 */

import type { NodeTemplate } from "../index";
import { toPascalCase } from "../index";

export const httpNodeTemplate: NodeTemplate = {
  id: "http",
  name: "HTTP Request",
  description: "Make HTTP requests to external APIs",
  category: "integration",
  generate: (name: string): string => {
    const pascalName = toPascalCase(name);

    return `
/**
 * Makes an HTTP request
 *
 * @flowWeaver nodeType
 * @label ${pascalName}
 * @color blue
 * @icon api
 * @input url [order:1] - Request URL
 * @input method [order:2] - HTTP method (GET, POST, PUT, DELETE)
 * @input headers [order:3] - Request headers
 * @input body [order:4] - Request body
 * @input execute [order:0] - Execute
 * @output response [order:2] - Response data
 * @output statusCode [order:3] - HTTP status code
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function ${name}(
  execute: boolean,
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  headers: Record<string, string>,
  body: any
): Promise<{ onSuccess: boolean; onFailure: boolean; response: any; statusCode: number }> {
  if (!execute) {
    return { onSuccess: false, onFailure: false, response: null, statusCode: 0 };
  }

  try {
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers
      }
    };

    if (method !== "GET" && body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);
    const statusCode = res.status;

    let response;
    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      response = await res.json();
    } else {
      response = await res.text();
    }

    if (!res.ok) {
      console.error("[${pascalName}] HTTP error:", statusCode, response);
      return { onSuccess: false, onFailure: true, response, statusCode };
    }

    return { onSuccess: true, onFailure: false, response, statusCode };
  } catch (err) {
    console.error("[${pascalName}] Request failed:", err);
    return { onSuccess: false, onFailure: true, response: null, statusCode: 0 };
  }
}
`.trim();
  },
};
