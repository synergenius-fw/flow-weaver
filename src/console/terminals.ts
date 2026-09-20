/**
 * What `Start` hands out and what `Exit` takes in, port by port.
 *
 * The process model knows which steps `Start` leads to and which arms reach
 * `Exit`, but not which parameter feeds which input, or which step's output
 * becomes which return value. That is the part a person clicks `Start` or
 * `Exit` to learn, and it is in the connections -- `@path` name matching,
 * `@connect` and `[expr:]` references all end up there.
 */
import type { TWorkflowAST } from '../ast/types.js';

export interface PortEnd { node: string; port: string }

export interface TerminalWiring {
  /** For each `Start` port, every input it is wired to, in connection order. */
  start: Record<string, PortEnd[]>;
  /** For each `Exit` port, the output that feeds it. A port fed twice keeps the first. */
  exit: Record<string, PortEnd>;
}

const CONTROL = new Set(['execute', 'onSuccess', 'onFailure']);

export function terminalWiring(ast: Pick<TWorkflowAST, 'connections'>): TerminalWiring {
  const start: Record<string, PortEnd[]> = {};
  const exit: Record<string, PortEnd> = {};
  for (const c of ast.connections) {
    if (c.from.node === 'Start' && !CONTROL.has(c.from.port)) {
      (start[c.from.port] ??= []).push({ node: c.to.node, port: c.to.port });
    }
    if (c.to.node === 'Exit' && !CONTROL.has(c.to.port) && !exit[c.to.port]) {
      exit[c.to.port] = { node: c.from.node, port: c.from.port };
    }
  }
  return { start, exit };
}
