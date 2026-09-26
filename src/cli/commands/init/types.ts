/**
 * The shapes init passes between its steps: the options from the command
 * line, the config every later step reads once flags, defaults and prompts
 * are settled, and the report printed with --json.
 */
import type { TModuleFormat } from '../../../ast/types.js';
import type { PersonaId } from '../init-personas.js';

export interface InitOptions {
  name?: string;
  template?: string;
  format?: TModuleFormat;
  yes?: boolean;
  install?: boolean;
  git?: boolean;
  force?: boolean;
  json?: boolean;
  preset?: string;
  useCase?: string;
  mcp?: boolean;
  agent?: boolean;
}

export interface InitConfig {
  projectName: string;
  targetDir: string;
  template: string;
  format: TModuleFormat;
  install: boolean;
  git: boolean;
  force: boolean;
  persona: PersonaId;
  useCase?: string;
  /** Free-text description when user picked "Something else" */
  useCaseDescription?: string;
  mcp: boolean;
}

/** How a step that reports instead of throwing went (npm install, git init, compile). */
export interface StepResult {
  success: boolean;
  error?: string;
}

export interface InitReport {
  projectDir: string;
  filesCreated: string[];
  filesSkipped: string[];
  template: string;
  format: TModuleFormat;
  persona: PersonaId;
  installResult?: StepResult;
  gitResult?: StepResult;
  mcpConfigured?: string[];
  agentLaunched?: boolean;
}
