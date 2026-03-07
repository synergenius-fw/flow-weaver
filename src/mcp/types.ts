/** Options for initializing the MCP server. */
export interface McpServerOptions {
  /** Whether to use stdio transport instead of SSE. */
  stdio?: boolean;
}

/** Dependencies injected into tool registration functions for CLI interaction and logging. */
export interface RegistrationDeps {
  /** Execute a shell command and return its stdout and exit code. */
  execCommand: (cmd: string) => Promise<{ stdout: string; exitCode: number }>;
  /** Prompt the user for interactive input. */
  prompt: (question: string) => Promise<string>;
  /** Log a message to the console. */
  log: (msg: string) => void;
  /** Resolve the path to the Flow Weaver CLI executable. */
  resolveCliPath: () => string;
}
