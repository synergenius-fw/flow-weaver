/**
 * Edge-Case Migration Registry
 *
 * The parse → generate round-trip handles ~95% of migrations automatically:
 * the parser adds defaults for missing fields, and the generator writes
 * current syntax. This registry is only for rare cases where that
 * round-trip can't handle a change (e.g., semantic renames, removed features).
 *
 * Expected growth: ~1-2 entries per year.
 */

import type { TWorkflowAST } from '../ast/types.js';

export type MigrationFn = (ast: TWorkflowAST) => TWorkflowAST;

export interface Migration {
  /** Short descriptive name (e.g., "rename-executeWhen-to-branchingStrategy") */
  name: string;
  /** The migration transform */
  apply: MigrationFn;
}

/**
 * Registry of edge-case migrations. Starts empty.
 * Add entries only when the parse→generate round-trip can't handle a change.
 */
const migrations: Migration[] = [];

/**
 * Apply all registered edge-case migrations to a workflow AST.
 * Called after parsing, before regeneration.
 */
export function applyMigrations(ast: TWorkflowAST): TWorkflowAST {
  return migrations.reduce((current, migration) => migration.apply(current), ast);
}

/**
 * Get the list of registered migrations (for diagnostics/logging).
 */
export function getRegisteredMigrations(): ReadonlyArray<{ name: string }> {
  return migrations.map((m) => ({ name: m.name }));
}
