/**
 * The part of a compiled file the generator writes for the workflow itself,
 * without the inlined runtime. Tests that assert what the generator emits
 * (a parallel group, a sequential chain) look here, so a comment or a helper
 * in the runtime section cannot satisfy or break them.
 *
 * - In-place output: every `@flow-weaver-body` section, joined.
 * - A standalone module: the text from the workflow's declaration to the
 *   end, since the runtime and the node types come before it.
 */
export function generatedWorkflowCode(code: string, workflowName: string): string {
  const bodies = [...code.matchAll(/\/\/ @flow-weaver-body-start\n([\s\S]*?)\/\/ @flow-weaver-body-end/g)].map((m) => m[1]);
  if (bodies.length > 0) return bodies.join('\n');

  const declaration = new RegExp(`\\bfunction\\s+${workflowName}\\s*\\(`).exec(code);
  if (!declaration) throw new Error(`no function ${workflowName} in the generated code`);
  return code.slice(declaration.index);
}
