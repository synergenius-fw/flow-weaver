/**
 * Which workflow of a file a run is of.
 *
 * Decides the workflow a start or a resume parses: the one named, refused
 * when the file does not declare it, or the file's only workflow when none
 * is named. A file with several workflows and no name is refused rather
 * than run as whichever comes first, since a driver could not tell which
 * one it got.
 */
import * as path from 'node:path';
import { parseWorkflow } from '../api/parse.js';
import type { TWorkflowAST } from '../ast/types.js';
import { AmbiguousWorkflowError, ParseError } from './errors.js';

export async function parseSelected(
  filePath: string,
  requested: string | undefined,
): Promise<{ ast: TWorkflowAST; workflowName: string }> {
  const projectDir = path.dirname(filePath);
  const first = await parseWorkflow(filePath, { workflowName: requested, projectDir });
  if (first.errors.length > 0) throw new ParseError(first.errors.join('\n'));

  // Given no name, the executor runs the first workflow in the file. A
  // driver cannot see which one it got, so ambiguity is refused here instead.
  const available = first.availableWorkflows;
  let workflowName = requested;
  if (workflowName === undefined) {
    if (available.length === 1) workflowName = available[0];
    else throw new AmbiguousWorkflowError(available);
  } else if (!available.includes(workflowName)) {
    throw new ParseError(`workflow ${workflowName} not found. Available: ${available.join(', ')}`);
  }

  if (first.ast.functionName === workflowName) return { ast: first.ast, workflowName };
  const second = await parseWorkflow(filePath, { workflowName, projectDir });
  if (second.errors.length > 0) throw new ParseError(second.errors.join('\n'));
  return { ast: second.ast, workflowName };
}
