/**
 * Extension point for custom compile targets.
 *
 * Extensions and packs register their compile targets here.
 * The compile command and MCP tool look up targets from this registry.
 */

import type { TNodeTypeAST, TWorkflowAST } from '../ast/types.js';

export interface CompileTarget {
  name: string;
  compile(
    workflow: TWorkflowAST,
    nodeTypes: TNodeTypeAST[],
    options: Record<string, unknown>,
  ): string;
}

class CompileTargetRegistry {
  private targets = new Map<string, CompileTarget>();

  register(target: CompileTarget): void {
    this.targets.set(target.name, target);
  }

  get(name: string): CompileTarget | undefined {
    return this.targets.get(name);
  }

  getNames(): string[] {
    return [...this.targets.keys()];
  }
}

export const compileTargetRegistry = new CompileTargetRegistry();
