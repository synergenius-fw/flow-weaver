/**
 * Scratch copies Flow Weaver writes beside a source file, so that the copy's
 * relative imports resolve as the original's do.
 *
 * Both are dot-files, which the listings of a project's workflows skip: the
 * console's scan, `fw serve`'s discovery and `fw_find_workflows`. A watcher
 * of the project ignores them too, so writing one does not set off a rescan.
 */

/** The copy a run compiles and imports; a debug session holds it while paused. */
export const EXEC_SCRATCH_PREFIX = '.fw-exec-';

/** An older version of a file, parsed for the console's Changes pane. */
export const DIFF_SCRATCH_PREFIX = '.fw-diff-';

/** Whether a file name is one of Flow Weaver's scratch copies. */
export function isScratchFile(name: string): boolean {
  return name.startsWith(EXEC_SCRATCH_PREFIX) || name.startsWith(DIFF_SCRATCH_PREFIX);
}
