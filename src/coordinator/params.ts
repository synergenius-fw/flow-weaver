/**
 * The parameters a workflow needs before it can start.
 *
 * A run started without a required parameter used to run anyway and return
 * nothing for it, which reads as success. Every driver -- the CLI, the MCP
 * tools, the console, the API -- refuses it here instead, naming what is
 * missing.
 */
import type { TWorkflowAST } from '../ast/types.js';

/** The `@param` names the workflow requires that `params` does not provide. */
export function missingParams(ast: TWorkflowAST, params: Record<string, unknown> | undefined): string[] {
  const given = params ?? {};
  return Object.entries(ast.startPorts ?? {})
    .filter(([name, port]) => name !== 'execute' && port.dataType !== 'STEP' && !port.optional && (port as { defaultValue?: unknown }).defaultValue === undefined && (!Object.hasOwn(given, name) || given[name] === undefined))
    .map(([name]) => name);
}

export class MissingParamsError extends Error {
  readonly name = 'MissingParamsError';
  constructor(readonly workflowName: string, readonly missing: string[]) {
    super(`${workflowName} needs ${missing.length === 1 ? 'a parameter' : 'parameters'} it was not given: ${missing.join(', ')}`);
  }
}
