/**
 * TagHandlerRegistry: dispatch table for pack-contributed JSDoc tag handlers.
 *
 * Packs declare tag handlers in their manifest. The parser populates this
 * registry at startup and delegates unknown tags to it before emitting
 * "unknown tag" warnings.
 */

export type TTagHandlerContext = {
  /** The deploy map for this handler's namespace. Handlers mutate this directly. */
  deploy: Record<string, unknown>;
  /** Accumulator for parser warnings. */
  warnings: string[];
};

/**
 * A handler function for a pack-contributed tag.
 * Receives the tag name, the comment text after the tag, and a context
 * object with the deploy map for the handler's namespace.
 */
export type TTagHandlerFn = (
  tagName: string,
  comment: string,
  ctx: TTagHandlerContext,
) => void;

export type TRegisteredTagHandler = {
  namespace: string;
  scope: 'workflow' | 'nodeType' | 'both';
  handler: TTagHandlerFn;
};

/**
 * Registry mapping tag names to pack-provided handler functions.
 * Used by the JSDoc parser to delegate tags it doesn't natively handle.
 */
export class TagHandlerRegistry {
  private handlers = new Map<string, TRegisteredTagHandler>();

  /** Register a handler for one or more tag names. */
  register(
    tags: string[],
    namespace: string,
    scope: 'workflow' | 'nodeType' | 'both',
    handler: TTagHandlerFn,
  ): void {
    const entry: TRegisteredTagHandler = { namespace, scope, handler };
    for (const tag of tags) {
      this.handlers.set(tag, entry);
    }
  }

  /** Check if a handler is registered for the given tag. */
  has(tagName: string): boolean {
    return this.handlers.has(tagName);
  }

  /** Get all registered tag names. */
  getRegisteredTags(): string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Handle a tag by delegating to the registered handler.
   * The handler writes parsed data into `deployMap[namespace]`.
   *
   * @returns true if the tag was handled, false if no handler was found.
   */
  handle(
    tagName: string,
    comment: string,
    blockScope: 'workflow' | 'nodeType',
    deployMap: Record<string, Record<string, unknown>>,
    warnings: string[],
  ): boolean {
    const entry = this.handlers.get(tagName);
    if (!entry) return false;

    // Check scope compatibility
    if (entry.scope !== 'both' && entry.scope !== blockScope) {
      warnings.push(
        `@${tagName} is registered for ${entry.scope} blocks, not ${blockScope} blocks.`,
      );
      return true; // consumed, but with a warning
    }

    // Ensure the namespace slot exists
    if (!deployMap[entry.namespace]) {
      deployMap[entry.namespace] = {};
    }

    entry.handler(tagName, comment, {
      deploy: deployMap[entry.namespace],
      warnings,
    });

    return true;
  }
}

/** Global tag handler registry singleton. Extensions register handlers here at startup. */
export const tagHandlerRegistry = new TagHandlerRegistry();
