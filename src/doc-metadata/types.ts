/**
 * Types for documentation metadata extraction
 */

/**
 * Documentation for a Flow Weaver JSDoc annotation
 */
export interface TAnnotationDoc {
  /** Annotation name (e.g., '@input', '@connect') */
  name: string;
  /** Category for grouping (marker, port, workflow, metadata, pattern, standard) */
  category: 'marker' | 'port' | 'workflow' | 'metadata' | 'pattern' | 'standard';
  /** Syntax example */
  syntax: string;
  /** Human-readable description */
  description: string;
  /** Text to insert (for IDE completions) */
  insertText: string;
  /** Insert text format ('plain' or 'snippet') */
  insertTextFormat: 'plain' | 'snippet';
  /** EBNF grammar rule (hand-written for clarity, or auto-derived) */
  ebnf?: string;
  /** Usage examples (code lines) */
  examples?: string[];
  /** Which block types accept this tag */
  contexts?: ('nodeType' | 'workflow' | 'pattern')[];
}

/**
 * Documentation for annotation modifiers (e.g., [order:N], [placement:TOP])
 */
export interface TAnnotationModifierDoc {
  /** Modifier name */
  name: string;
  /** Syntax example */
  syntax: string;
  /** Human-readable description */
  description: string;
  /** Enum values if applicable */
  enum?: string[];
}

/**
 * Documentation for an MCP tool
 */
export interface TMcpToolDoc {
  /** Tool name (e.g., 'fw_describe') */
  name: string;
  /** Human-readable description */
  description: string;
  /** Category for grouping */
  category: 'query' | 'template' | 'pattern' | 'modify' | 'editor' | 'execution';
  /** Tool parameters */
  params: TMcpToolParam[];
}

/**
 * Documentation for an MCP tool parameter
 */
export interface TMcpToolParam {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** Human-readable description */
  description: string;
  /** Whether the parameter is required */
  required: boolean;
  /** Enum values if applicable */
  enum?: string[];
}

/**
 * Documentation for a plugin API field (schema-tied description layer)
 */
export interface TPluginApiFieldDoc {
  /** Field name as it appears in the Zod schema */
  name: string;
  /** Display type string */
  type: string;
  /** Whether the field is required */
  required: boolean;
  /** Human-readable description */
  description: string;
  /** Enum values if applicable */
  enum?: string[];
  /** Nested child fields for object types */
  children?: TPluginApiFieldDoc[];
}

/**
 * Documentation for a CLI command option/flag
 */
export interface TCliOptionDoc {
  /** Flag string, e.g. "-o, --output" */
  flags: string;
  /** Argument placeholder, e.g. "<path>" or "esm|cjs|auto" */
  arg?: string;
  /** Human-readable description */
  description: string;
  /** Default value shown as "(default: value)" */
  defaultValue?: string;
  /** Mutual exclusivity group — options sharing the same group become a single select */
  exclusive?: string;
  /** Whether this option is required */
  required?: boolean;
}

/**
 * Documentation for a CLI command
 */
export interface TCliCommandDoc {
  /** Command name, e.g. "compile", "create workflow", "ui focus-node" */
  name: string;
  /** Full syntax string, e.g. "flow-weaver compile <input> [options]" */
  syntax: string;
  /** Human-readable description */
  description: string;
  /** Command options/flags */
  options: TCliOptionDoc[];
  /** Pre-computed list items (used verbatim instead of auto-generating from options) */
  list?: string[];
  /** Parent group for subcommands: "create", "pattern", "ui", "plugin" */
  group?: string;
  /** Override list style (default: 'cli') */
  listStyle?: string;
  /** Valid choices for positional arguments — keyed by arg name */
  positionalChoices?: Record<string, { id: string; label: string }[]>;
}
