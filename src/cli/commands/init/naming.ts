/**
 * Project and workflow names.
 *
 * Decides which project names init accepts (npm-safe: at most 214
 * characters, starting with a letter or digit, then letters, digits, hyphens,
 * dots and underscores) and derives the workflow function name and the
 * workflow file name from the project name.
 */

const PROJECT_NAME_RE = /^[a-zA-Z0-9][-a-zA-Z0-9_.]*$/;

export function validateProjectName(name: string): string | true {
  if (!name) return 'Project name cannot be empty';
  if (name.length > 214) return 'Project name must be at most 214 characters';
  if (!PROJECT_NAME_RE.test(name)) {
    return 'Project name must start with a letter or digit and contain only letters, digits, hyphens, dots, and underscores';
  }
  return true;
}

export function toWorkflowName(projectName: string): string {
  const camel = projectName
    .replace(/[-_.]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^[^a-zA-Z_$]+/, '')
    .replace(/^./, (c) => c.toLowerCase());
  return (camel || 'myProject') + 'Workflow';
}

/** The scaffolded workflow's file name under src/, e.g. `my-app-workflow.ts`. */
export function workflowFileName(projectName: string): string {
  return `${projectName}-workflow.ts`;
}
