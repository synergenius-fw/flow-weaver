/**
 * Editor Completions - Types
 *
 * Editor-agnostic types for Flow Weaver autocompletion.
 * These types are designed to work with any editor (CodeMirror, VS Code, Monaco, etc.)
 */

// =============================================================================
// Completion Result Types
// =============================================================================

/**
 * A single completion suggestion.
 * Editor adapters convert this to their native format.
 */
export type FlowWeaverCompletion = {
  /** Display text for the completion */
  label: string;
  /** Short description shown next to label */
  detail?: string;
  /** Full documentation (may be markdown) */
  documentation?: string;
  /** Text to insert when accepted */
  insertText: string;
  /** Whether insertText contains snippet placeholders like ${1:name} */
  insertTextFormat: 'plain' | 'snippet';
  /** Category for icon/grouping */
  kind: CompletionKind;
  /** Sort order (lower = higher priority) */
  sortOrder?: number;
};

export type CompletionKind =
  | 'annotation' // @flowWeaver, @input, etc.
  | 'type' // String, Number, STEP, etc.
  | 'nodeType' // Node type names
  | 'port' // Port names
  | 'node' // Node instance IDs
  | 'keyword' // Reserved words
  | 'value'; // Annotation values, modifier values

// =============================================================================
// Context Types
// =============================================================================

/**
 * Workflow context for completions that need AST data.
 * This is a simplified view of the workflow for completion purposes.
 */
export type WorkflowContext = {
  /** Available node types (name -> simplified node type info) */
  nodeTypes: Record<string, NodeTypeInfo>;
  /** Node instances in current workflow */
  instances?: NodeInstanceInfo[];
  /** Existing connections in current workflow */
  connections?: ConnectionInfo[];
};

/**
 * Connection info for completions (extracted from @connect lines).
 */
export type ConnectionInfo = {
  sourceNode: string;
  sourcePort: string;
  targetNode: string;
  targetPort: string;
};

/**
 * Simplified node type info for completions.
 */
export type NodeTypeInfo = {
  name: string;
  category?: string;
  description?: string;
  ports: PortInfo[];
  /** Source file path (for go-to-definition) */
  filePath?: string;
  /** Line number in source file */
  line?: number;
};

/**
 * Port information for completions.
 */
export type PortInfo = {
  name: string;
  direction: 'INPUT' | 'OUTPUT';
  dataType?: string;
  description?: string;
};

/**
 * Node instance info for completions.
 */
export type NodeInstanceInfo = {
  id: string;
  nodeType: string;
};

// =============================================================================
// Completion Context (Parsed Line State)
// =============================================================================

/**
 * Detected completion context from parsing the current line.
 */
export type CompletionContext = {
  /** What type of completion is expected */
  type: CompletionContextType;
  /** The current line text */
  lineText: string;
  /** Cursor position within the line (0-based) */
  cursorOffset: number;
  /** Text being typed (prefix to filter by) */
  prefix: string;
  /** For port completions: which node's ports to show */
  nodeId?: string;
  /** For port completions: filter by direction */
  portDirection?: 'input' | 'output';
  /** Detected block type from scanning preceding lines */
  blockType?: 'workflow' | 'nodeType' | null;
  /** For annotationValue context: which annotation we're completing values for */
  annotation?: string;
  /** For modifier/modifierValue context: which modifier we're completing */
  modifier?: string;
  /** For annotation context: annotations already present in the block */
  existingAnnotations?: string[];
};

export type CompletionContextType =
  | 'annotation' // After @ in JSDoc
  | 'dataType' // Inside {braces} after @input/@output
  | 'nodeType' // After @node nodeId (space)
  | 'nodeId' // After @connect (before dot)
  | 'port' // After nodeId. in @connect
  | 'annotationValue' // After @executeWhen, @flowWeaver, @color (value after annotation)
  | 'modifier' // After [ on annotation lines (modifier name)
  | 'modifierValue' // After [modifier: (modifier value)
  | null; // No completion context

// =============================================================================
// Go-To-Definition Types
// =============================================================================

/**
 * Result from go-to-definition lookup.
 */
export type DefinitionLocation = {
  /** What kind of symbol was found */
  type: 'nodeType' | 'workflow' | 'port' | 'node';
  /** Name of the symbol */
  name: string;
  /** File path (if external) */
  filePath?: string;
  /** Line number (1-based) */
  line?: number;
  /** Column number (1-based) */
  column?: number;
};
