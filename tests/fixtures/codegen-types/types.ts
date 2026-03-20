/** External types — imported by nodes, NOT by the workflow file directly. */
export interface AppConfig {
  name: string;
  debug: boolean;
  maxRetries: number;
}

export interface TaskResult {
  output: string;
  duration: number;
}
