/**
 * Function Registry for Flow Weaver
 *
 * Provides a global registry of functions that can be referenced by string IDs
 * in external HTTP calls while allowing direct function passing in internal calls.
 */

export type FunctionCategory = 'transform' | 'filter' | 'validate' | 'format' | 'custom';

export interface RegisteredFunction<TIn = unknown, TOut = unknown> {
  id: string;
  name: string;
  description: string;
  category: FunctionCategory;
  fn: (input: TIn) => TOut | Promise<TOut>;
  inputType: string;
  outputType: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  examples?: Array<{ input: TIn; output: TOut }>;
}

export type RegisteredFunctionMetadata = Omit<RegisteredFunction, 'fn'>;

export class FunctionRegistry {
  private functions = new Map<string, RegisteredFunction>();

  /**
   * Register a function with the registry
   */
  register<TIn, TOut>(config: RegisteredFunction<TIn, TOut>): void {
    if (this.functions.has(config.id)) {
      throw new Error(`Function with ID '${config.id}' is already registered`);
    }
    this.functions.set(config.id, config as RegisteredFunction);
  }

  /**
   * Get a function by ID
   */
  get<TIn, TOut>(id: string): ((input: TIn) => TOut | Promise<TOut>) | undefined {
    const registered = this.functions.get(id);
    return registered?.fn as ((input: TIn) => TOut | Promise<TOut>) | undefined;
  }

  /**
   * Get function metadata without the function itself
   */
  getMetadata(id: string): RegisteredFunctionMetadata | undefined {
    const registered = this.functions.get(id);
    if (!registered) return undefined;

    const { fn: _, ...metadata } = registered;
    return metadata;
  }

  /**
   * List all registered functions, optionally filtered by category
   */
  list(category?: FunctionCategory): RegisteredFunctionMetadata[] {
    const all = Array.from(this.functions.values());
    const filtered = category ? all.filter((f) => f.category === category) : all;

    return filtered.map(({ fn: _, ...metadata }) => metadata);
  }

  /**
   * Check if a function is registered
   */
  has(id: string): boolean {
    return this.functions.has(id);
  }

  /**
   * Clear all registered functions (useful for testing)
   */
  clear(): void {
    this.functions.clear();
  }

  /**
   * Get the count of registered functions
   */
  get size(): number {
    return this.functions.size;
  }
}

/**
 * Global function registry singleton
 */
export const functionRegistry = new FunctionRegistry();
