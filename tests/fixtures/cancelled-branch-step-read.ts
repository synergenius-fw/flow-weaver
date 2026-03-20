/**
 * Fixture: reproduces "Variable not found: branchNode.onSuccess[undefined]"
 * when a DISJUNCTION merge node reads onSuccess from a branch that was NOT taken.
 *
 * The route node branches: success -> mainPath, failure -> altPath.
 * The merge node reads onSuccess from both paths. When route succeeds,
 * altPath is CANCELLED — but merge still tries to read altPath.onSuccess.
 */

/**
 * @flowWeaver nodeType
 * @expression
 * @label Route
 * @input ctx - Context
 * @output ctx - Context
 */
function routeNode(ctx: string): string {
  const parsed = JSON.parse(ctx);
  if (parsed.mode === 'alt') throw new Error('take alt path');
  return ctx;
}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Main Path
 * @input ctx - Context
 * @output ctx - Context
 */
function mainPath(ctx: string): string {
  return JSON.stringify({ ...JSON.parse(ctx), mainDone: true });
}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Alt Path
 * @input ctx - Context
 * @output ctx - Context
 */
function altPath(ctx: string): string {
  return JSON.stringify({ ...JSON.parse(ctx), altDone: true });
}

/**
 * @flowWeaver nodeType
 * @label Merge
 * @executeWhen DISJUNCTION
 * @input [mainCtx] - From main path
 * @input [altCtx] - From alt path
 * @output result - Merged result
 */
function mergeNode(
  execute: boolean,
  mainCtx?: string,
  altCtx?: string,
): { onSuccess: boolean; onFailure: boolean; result: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  const result = mainCtx ?? altCtx ?? '{}';
  return { onSuccess: true, onFailure: false, result };
}

/**
 * @flowWeaver workflow
 * @param ctx - Input context
 * @returns result - Output
 *
 * @node route  routeNode  [position: 200 200]
 * @node main   mainPath   [position: 400 100]
 * @node alt    altPath    [position: 400 300]
 * @node merge  mergeNode  [position: 600 200]
 *
 * @path Start -> route -> main -> merge -> Exit
 * @path route:fail -> alt
 *
 * @connect main.onSuccess -> merge.execute
 * @connect alt.onSuccess -> merge.execute
 *
 * @connect main.ctx -> merge.mainCtx
 * @connect alt.ctx -> merge.altCtx
 *
 * @connect merge.result -> Exit.result
 */
export function cancelledBranchWorkflow(
  execute: boolean,
  params: { ctx: string },
): { onSuccess: boolean; onFailure: boolean; result: string } {
  // @flow-weaver-body-start
  // @flow-weaver-body-end
  return { onSuccess: false, onFailure: true, result: '' };
}
