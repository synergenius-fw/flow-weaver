/**
 * Node types the caller supplies at parse time instead of the parser finding
 * them in source (runtime-loaded or foreign pack nodes described by a wire
 * manifest).
 *
 * Decides how such a descriptor becomes a full node type (which mandatory
 * STEP ports it gets, which async/expression/durable flags carry over) and
 * how it merges with the node types found in source: it fills a missing name,
 * replaces a port-less `@fwImport` stub, and otherwise yields to the source.
 */
import type { TDataType, TNodeTypeAST, TPortDefinition } from '../ast/types';
import { EXECUTION_STRATEGIES } from '../constants';
import { isImportStub } from './import-stub';

/**
 * Minimal external node type descriptor.
 * Carries just enough information for the parser to validate node references
 * and infer port directions. Passed with each request from the client layer.
 */
export type TExternalNodeType = {
  name: string;
  functionName?: string;
  ports?: Array<{ name: string; type?: string; direction?: string; defaultLabel?: string }>;
  /**
   * Whether the node's implementation is async (returns a Promise). The
   * code generator emits `await` for the node's call ONLY when its
   * nodeType is async. A missing/false value generates a synchronous
   * call. Carrying it on the wire matters for runtime-provided foreign
   * nodes resolved from a pack manifest (the on-device case): e.g.
   * pack-core's `waitForApproval` is async, and without `isAsync` the
   * generated workflow calls it un-awaited, so its resolved
   * `{ approved, onSuccess, ... }` read back as `undefined` on a pending
   * Promise and every downstream gate silently takes its `!execute` /
   * failure path.
   */
  isAsync?: boolean;
  /**
   * Whether the node is an `@expression` node (data-in, data-out, no
   * `execute` step port, so the generator calls it WITHOUT the leading
   * `execute` argument and auto-sets `onSuccess`/`onFailure`). Carrying
   * it on the wire matters for runtime-provided foreign nodes resolved
   * from a pack manifest (the on-device case): e.g. pack-core's
   * `resolveMonth(spec)` / `resolveFiscalYear(spec)` are expression
   * nodes, and without `expression` the generated workflow calls them
   * with the regular `(execute, ...args)` signature, so the boolean
   * `execute` lands in the first data parameter (`spec`) and the node
   * throws (`(spec ?? '').trim is not a function`) at run time.
   */
  expression?: boolean;
  /** Explicit compiler-known durable gate boundary. */
  durableGate?: 'approval' | 'input' | 'agent' | 'timer';
  /** Requires the durable idempotency/receipt effect contract. */
  durableEffect?: boolean;
  /** Explicitly safe to restore/skip without an effect receipt. */
  durablePure?: boolean;
  /** Retry/fallback behavior implemented inside the external adapter. */
  resilience?: { retries?: number; fallback?: string };
};

/**
 * Convert a TExternalNodeType to a TNodeTypeAST with sensible defaults.
 * Used to merge runtime-loaded node types into the parser's available types.
 */
function externalToAST(ext: TExternalNodeType): TNodeTypeAST {
  const inputs: Record<string, TPortDefinition> = {};
  const outputs: Record<string, TPortDefinition> = {};
  const isExpression = ext.expression === true;

  if (ext.ports) {
    for (const port of ext.ports) {
      const def: TPortDefinition = {
        dataType: (port.type as TDataType) || 'ANY',
        ...(port.defaultLabel && { label: port.defaultLabel }),
      };
      if (port.direction === 'OUTPUT') {
        outputs[port.name] = def;
      } else {
        inputs[port.name] = def;
      }
    }
  }

  // Ensure mandatory ports exist. EVERY node -- expression nodes included --
  // gets the `execute` STEP input and onSuccess/onFailure STEP outputs, exactly
  // as source-parsed node types do (see the mandatory-port merge in
  // `extractNodeTypes`). These STEP ports are what `@path` / `@connect` wire
  // and what the validator checks. Dropping `execute` for expression nodes
  // breaks `@path Start -> ... -> <exprNode> -> ...` with "does not have input
  // port execute". The `expression` flag below only changes CODEGEN (the call
  // omits the leading `execute` arg), never the port set.
  if (!inputs.execute) {
    inputs.execute = { dataType: 'STEP', label: 'Execute' };
  }
  if (!outputs.onSuccess) {
    outputs.onSuccess = { dataType: 'STEP', label: 'On Success', isControlFlow: true };
  }
  if (!outputs.onFailure) {
    outputs.onFailure = {
      dataType: 'STEP',
      label: 'On Failure',
      isControlFlow: true,
      failure: true,
    };
  }

  return {
    type: 'NodeType',
    name: ext.name,
    functionName: ext.functionName || ext.name,
    inputs,
    outputs,
    hasSuccessPort: 'onSuccess' in outputs,
    hasFailurePort: 'onFailure' in outputs,
    // Honor the supplied async flag so codegen emits `await` for an async
    // foreign node (e.g. pack-core `waitForApproval`). Defaults to sync
    // when the caller doesn't say, preserving prior behavior.
    isAsync: ext.isAsync === true || ext.durableEffect === true,
    executeWhen: EXECUTION_STRATEGIES.CONJUNCTION,
    variant: 'FUNCTION',
    // Honor the expression flag so codegen calls the node WITHOUT the
    // leading `execute` arg (e.g. pack-core `resolveMonth(spec)`).
    ...(isExpression && { expression: true }),
    ...(ext.durableGate && { durableGate: ext.durableGate }),
    ...(ext.durableEffect === true && { durableEffect: true }),
    ...(ext.durablePure === true && { durablePure: true }),
    ...(ext.resilience && { resilience: ext.resilience }),
  };
}

/**
 * Merge external (runtime-loaded) node types into `nodeTypes`, in place, so the
 * parser can validate references to them.
 */
export function mergeExternalNodeTypes(
  nodeTypes: TNodeTypeAST[],
  externalNodeTypes: TExternalNodeType[],
): void {
  for (const ext of externalNodeTypes) {
    const existingIdx = nodeTypes.findIndex(
      (nt) => nt.name === ext.name || nt.functionName === ext.name
    );
    if (existingIdx === -1) {
      nodeTypes.push(externalToAST(ext));
      continue;
    }
    // A same-named type already exists. If it is a port-less import
    // STUB (the fallback `extractImportedNodeTypes` produces when an
    // `@fwImport` package cannot be resolved on disk -- the on-device
    // case: a Console install dir has no `node_modules` to read the
    // package `.d.ts` from), the caller-supplied external type carries
    // the REAL port shape (resolved from the install's wire manifest)
    // and must win. Without this, the stub's `{ result }` output + empty
    // inputs would shadow the real ports and every `@connect` to the
    // node fails validation with "does not have port ...".
    if (isImportStub(nodeTypes[existingIdx])) {
      // Preserve the stub's `importSource` so downstream `@fwImport`
      // re-emission (generate-in-place) still writes the import line;
      // only the ports come from the external type.
      const replacement = externalToAST(ext);
      const stubImportSource = (nodeTypes[existingIdx] as { importSource?: string })
        .importSource;
      if (stubImportSource) {
        (replacement as { importSource?: string }).importSource = stubImportSource;
      }
      nodeTypes[existingIdx] = replacement;
    }
  }
}
