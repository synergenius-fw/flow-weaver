/**
 * Method dispatcher for the self-contained tunnel.
 *
 * Maps RPC method names to handler functions and wraps them
 * in a standard try/catch envelope.
 */

import { fileOpsHandlers } from './handlers/file-ops.js';
import { astOpsHandlers } from './handlers/ast-ops.js';
import { mutationHandlers } from './handlers/mutations.js';
import { templateHandlers } from './handlers/templates.js';
import { executionHandlers } from './handlers/execution.js';
import { stubHandlers } from './handlers/stubs.js';

export interface TunnelContext {
  workspaceRoot: string;
}

export type HandlerFn = (
  params: Record<string, unknown>,
  ctx: TunnelContext,
) => Promise<unknown>;

const handlers: Record<string, HandlerFn> = {
  ...stubHandlers,
  ...fileOpsHandlers,
  ...astOpsHandlers,
  ...mutationHandlers,
  ...templateHandlers,
  ...executionHandlers,
};

export async function dispatch(
  method: string,
  params: Record<string, unknown>,
  ctx: TunnelContext,
): Promise<{ success: boolean; result?: unknown; error?: { message: string } }> {
  const handler = handlers[method];

  if (!handler) {
    // Unknown methods return undefined — matches platform behaviour
    return { success: true, result: undefined };
  }

  try {
    const result = await handler(params, ctx);
    return { success: true, result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: { message } };
  }
}
