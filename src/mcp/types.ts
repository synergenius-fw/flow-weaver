/** Options for initializing the MCP server. */
export interface McpServerOptions {
  /** Whether to use stdio transport instead of SSE. */
  stdio?: boolean;
  /** Called with the tool's name on every call. This is how the server reports what it is doing. */
  onToolCall?: (name: string) => void;
  /** Called once the client has introduced itself, with its name and version. */
  onClient?: (client: string) => void;
}
