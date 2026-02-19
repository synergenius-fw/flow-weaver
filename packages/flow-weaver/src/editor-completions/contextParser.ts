/**
 * Editor Completions - Context Parser
 *
 * Parses the current line to detect what type of completion is expected.
 */

import type { CompletionContext, CompletionContextType } from './types';

// =============================================================================
// Patterns for detecting completion context
// =============================================================================

// Match @ at start of word (for annotation completions)
const ANNOTATION_PATTERN = /@(\w*)$/;

// Match @input or @output followed by { and optional partial type
const DATA_TYPE_PATTERN = /@(?:input|output)\s+\{(\w*)$/;

// Match @node followed by nodeId and space (for nodeType completions)
const NODE_TYPE_PATTERN = /@node\s+(\w+)\s+(\w*)$/;

// Match @connect followed by nodeId (before the dot)
const CONNECT_NODE_PATTERN = /@connect\s+(\w*)$/;

// Match @connect nodeId. (after the dot, for source port)
const CONNECT_SOURCE_PORT_PATTERN = /@connect\s+(\w+)\.(\w*)$/;

// Match @connect nodeId.port -> (for target node)
const CONNECT_TARGET_NODE_PATTERN = /@connect\s+\w+\.\w+\s*->\s*(\w*)$/;

// Match @connect nodeId.port -> nodeId. (for target port)
const CONNECT_TARGET_PORT_PATTERN = /@connect\s+\w+\.\w+\s*->\s*(\w+)\.(\w*)$/;

// Annotation value patterns (checked before generic annotation pattern)
const EXECUTE_WHEN_VALUE_PATTERN = /@executeWhen\s+(\w*)$/;
const FLOW_WEAVER_VALUE_PATTERN = /@flowWeaver\s+(\w*)$/;
const COLOR_VALUE_PATTERN = /@color\s+(\w*)$/;

// Sugar annotation patterns — node ID completions
// @path ... -> | (after arrow in path chain)
const PATH_NODE_PATTERN = /@path\s+(?:\w+(?::\w+)?\s*->\s*)+(\w*)$/;
// @position |
const POSITION_NODE_PATTERN = /@position\s+(\w*)$/;
// @scope name [... , | (node IDs inside brackets)
const SCOPE_NODE_PATTERN = /@scope\s+\w+\s*\[(?:\w+\s*,\s*)*(\w*)$/;
// @map id type over node.| (output port on source)
const MAP_PORT_PATTERN = /@map\s+\w+\s+\w+\s+over\s+(\w+)\.(\w*)$/;
// @map id type over | (source node)
const MAP_OVER_NODE_PATTERN = /@map\s+\w+\s+\w+\s+over\s+(\w*)$/;
// @map id | (node type after instance id)
const MAP_TYPE_PATTERN = /@map\s+\w+\s+(\w*)$/;
// @map | (instance id = node id)
const MAP_NODE_PATTERN = /@map\s+(\w*)$/;

// Bracket modifier patterns
const MODIFIER_NAME_PATTERN = /\[(\w*)$/;
const MODIFIER_VALUE_PATTERN = /\[(\w+):\s*(\w*)$/;

// =============================================================================
// Block Type Detection
// =============================================================================

/**
 * Detect whether we're inside a @flowWeaver workflow or nodeType block.
 * Scans preceding lines in the JSDoc block for the @flowWeaver annotation.
 */
export function detectBlockType(precedingBlockLines: string[]): 'workflow' | 'nodeType' | null {
  for (const line of precedingBlockLines) {
    const match = line.match(/@flowWeaver\s+(nodeType|workflow)\b/);
    if (match) {
      return match[1] as 'workflow' | 'nodeType';
    }
    // Bare @flowWeaver (no qualifier) defaults to workflow
    if (/@flowWeaver\s*$/.test(line.trim()) || /@flowWeaver\s+(?!nodeType|workflow)\w/.test(line)) {
      return 'workflow';
    }
  }
  return null;
}

/**
 * Detect the annotation on the current line (for modifier context).
 * Returns the annotation name if the line contains one (e.g., "@input", "@node").
 */
function detectLineAnnotation(lineText: string): string | null {
  const match = lineText.match(/@(\w+)/);
  return match ? '@' + match[1] : null;
}

// =============================================================================
// Main Parser
// =============================================================================

/**
 * Parse the current line to detect completion context.
 *
 * @param lineText - The full text of the current line
 * @param cursorOffset - Cursor position within the line (0-based)
 * @param isInJSDoc - Whether the cursor is inside a JSDoc block
 * @param precedingBlockLines - Optional lines from /** to cursor for block type detection
 * @returns Completion context or null if no completion should be shown
 */
export function parseCompletionContext(
  lineText: string,
  cursorOffset: number,
  isInJSDoc: boolean,
  precedingBlockLines?: string[]
): CompletionContext | null {
  // Only provide completions inside JSDoc blocks
  if (!isInJSDoc) {
    return null;
  }

  // Get text from start of line to cursor
  const textBeforeCursor = lineText.slice(0, cursorOffset);

  // Detect block type from preceding lines
  const blockType = precedingBlockLines ? detectBlockType(precedingBlockLines) : null;

  // Try each pattern in priority order
  let match: RegExpMatchArray | null;

  // 0a. Check for @map port: @map id type over node.|
  match = textBeforeCursor.match(MAP_PORT_PATTERN);
  if (match) {
    return {
      type: 'port',
      lineText,
      cursorOffset,
      prefix: match[2],
      nodeId: match[1],
      portDirection: 'output',
      blockType,
    };
  }

  // 0b. Check for @map over node: @map id type over |
  match = textBeforeCursor.match(MAP_OVER_NODE_PATTERN);
  if (match) {
    return {
      type: 'nodeId',
      lineText,
      cursorOffset,
      prefix: match[1],
      blockType,
    };
  }

  // 0c. Check for @map type: @map id |
  match = textBeforeCursor.match(MAP_TYPE_PATTERN);
  if (match) {
    return {
      type: 'nodeType',
      lineText,
      cursorOffset,
      prefix: match[1],
      blockType,
    };
  }

  // 0d. Check for @map node: @map |
  match = textBeforeCursor.match(MAP_NODE_PATTERN);
  if (match) {
    return {
      type: 'nodeId',
      lineText,
      cursorOffset,
      prefix: match[1],
      blockType,
    };
  }

  // 0e. Check for @path node: @path ... -> |
  match = textBeforeCursor.match(PATH_NODE_PATTERN);
  if (match) {
    return {
      type: 'nodeId',
      lineText,
      cursorOffset,
      prefix: match[1],
      blockType,
    };
  }

  // 0h. Check for @position node: @position |
  match = textBeforeCursor.match(POSITION_NODE_PATTERN);
  if (match) {
    return {
      type: 'nodeId',
      lineText,
      cursorOffset,
      prefix: match[1],
      blockType,
    };
  }

  // 0i. Check for @scope node inside brackets: @scope name [a, |
  match = textBeforeCursor.match(SCOPE_NODE_PATTERN);
  if (match) {
    return {
      type: 'nodeId',
      lineText,
      cursorOffset,
      prefix: match[1],
      blockType,
    };
  }

  // 1. Check for @connect target port: @connect a.out -> b.|
  match = textBeforeCursor.match(CONNECT_TARGET_PORT_PATTERN);
  if (match) {
    return {
      type: 'port',
      lineText,
      cursorOffset,
      prefix: match[2],
      nodeId: match[1],
      portDirection: 'input', // Target receives, so needs input port
      blockType,
    };
  }

  // 2. Check for @connect target node: @connect a.out -> |
  match = textBeforeCursor.match(CONNECT_TARGET_NODE_PATTERN);
  if (match) {
    return {
      type: 'nodeId',
      lineText,
      cursorOffset,
      prefix: match[1],
      blockType,
    };
  }

  // 3. Check for @connect source port: @connect a.|
  match = textBeforeCursor.match(CONNECT_SOURCE_PORT_PATTERN);
  if (match) {
    return {
      type: 'port',
      lineText,
      cursorOffset,
      prefix: match[2],
      nodeId: match[1],
      portDirection: 'output', // Source sends, so needs output port
      blockType,
    };
  }

  // 4. Check for @connect node: @connect |
  match = textBeforeCursor.match(CONNECT_NODE_PATTERN);
  if (match) {
    return {
      type: 'nodeId',
      lineText,
      cursorOffset,
      prefix: match[1],
      blockType,
    };
  }

  // 5. Check for @node nodeType: @node myNode |
  match = textBeforeCursor.match(NODE_TYPE_PATTERN);
  if (match) {
    return {
      type: 'nodeType',
      lineText,
      cursorOffset,
      prefix: match[2],
      blockType,
    };
  }

  // 6. Check for data type in braces: @input {|
  match = textBeforeCursor.match(DATA_TYPE_PATTERN);
  if (match) {
    return {
      type: 'dataType',
      lineText,
      cursorOffset,
      prefix: match[1],
      blockType,
    };
  }

  // 7. Check for bracket modifier value: [placement:|
  match = textBeforeCursor.match(MODIFIER_VALUE_PATTERN);
  if (match) {
    return {
      type: 'modifierValue',
      lineText,
      cursorOffset,
      prefix: match[2],
      modifier: match[1],
      blockType,
    };
  }

  // 8. Check for bracket modifier name: [|
  match = textBeforeCursor.match(MODIFIER_NAME_PATTERN);
  if (match) {
    const lineAnnotation = detectLineAnnotation(lineText);
    return {
      type: 'modifier',
      lineText,
      cursorOffset,
      prefix: match[1],
      annotation: lineAnnotation ?? undefined,
      blockType,
    };
  }

  // 9. Check for annotation values (before generic annotation)
  match = textBeforeCursor.match(EXECUTE_WHEN_VALUE_PATTERN);
  if (match) {
    return {
      type: 'annotationValue',
      lineText,
      cursorOffset,
      prefix: match[1],
      annotation: '@executeWhen',
      blockType,
    };
  }

  match = textBeforeCursor.match(FLOW_WEAVER_VALUE_PATTERN);
  if (match) {
    return {
      type: 'annotationValue',
      lineText,
      cursorOffset,
      prefix: match[1],
      annotation: '@flowWeaver',
      blockType,
    };
  }

  match = textBeforeCursor.match(COLOR_VALUE_PATTERN);
  if (match) {
    return {
      type: 'annotationValue',
      lineText,
      cursorOffset,
      prefix: match[1],
      annotation: '@color',
      blockType,
    };
  }

  // 10. Check for annotation: @|
  match = textBeforeCursor.match(ANNOTATION_PATTERN);
  if (match) {
    // Extract existing annotations from preceding block lines
    let existingAnnotations: string[] | undefined;
    if (precedingBlockLines) {
      const annotations: string[] = [];
      for (const line of precedingBlockLines) {
        const annoMatch = line.match(/@(\w+)/);
        if (annoMatch) {
          annotations.push(annoMatch[1]);
        }
      }
      if (annotations.length > 0) {
        existingAnnotations = annotations;
      }
    }

    return {
      type: 'annotation',
      lineText,
      cursorOffset,
      prefix: match[1],
      blockType,
      existingAnnotations,
    };
  }

  return null;
}

/**
 * Get the word at the given position in the line.
 * Useful for go-to-definition to find what word was clicked.
 */
export function getWordAtPosition(
  lineText: string,
  offset: number
): { word: string; start: number; end: number } | null {
  // Check if cursor is on a word character
  const charAtOffset = lineText[offset];

  // If not on a word char, return null (cursor is on whitespace/punctuation)
  if (!/\w/.test(charAtOffset || '')) {
    return null;
  }

  // Find word boundaries
  let start = offset;
  let end = offset;

  // Expand left to find start of word
  while (start > 0 && /\w/.test(lineText[start - 1])) {
    start--;
  }

  // Expand right to find end of word
  while (end < lineText.length && /\w/.test(lineText[end])) {
    end++;
  }

  if (start === end) {
    return null;
  }

  return {
    word: lineText.slice(start, end),
    start,
    end,
  };
}

/**
 * Detect what kind of symbol is at the given position.
 * Used for go-to-definition to determine navigation target.
 */
export function detectSymbolType(
  lineText: string,
  offset: number
): { type: CompletionContextType; name: string; nodeId?: string } | null {
  const wordInfo = getWordAtPosition(lineText, offset);
  if (!wordInfo) {
    return null;
  }

  const { word, start } = wordInfo;
  const textBefore = lineText.slice(0, start);

  // Check if this is a nodeType in @node declaration
  // Pattern: @node nodeId NodeType
  const nodeTypeMatch = textBefore.match(/@node\s+\w+\s+$/);
  if (nodeTypeMatch) {
    return { type: 'nodeType', name: word };
  }

  // Check if this is a nodeId in @connect (before dot)
  // Pattern: @connect nodeId.port
  const connectNodeMatch = textBefore.match(/@connect\s+$/);
  if (connectNodeMatch) {
    return { type: 'nodeId', name: word };
  }

  // Check if this is a port after nodeId.
  // Pattern: @connect nodeId.port or nodeId.port ->
  const portMatch = textBefore.match(/@connect\s+(\w+)\.$/);
  if (portMatch) {
    return { type: 'port', name: word, nodeId: portMatch[1] };
  }

  // Check if target nodeId after ->
  const targetNodeMatch = textBefore.match(/@connect\s+\w+\.\w+\s*->\s*$/);
  if (targetNodeMatch) {
    return { type: 'nodeId', name: word };
  }

  // Check if target port after -> nodeId.
  const targetPortMatch = textBefore.match(/@connect\s+\w+\.\w+\s*->\s*(\w+)\.$/);
  if (targetPortMatch) {
    return { type: 'port', name: word, nodeId: targetPortMatch[1] };
  }

  // Check if this is a nodeId in sugar annotations (@path)
  // Matches identifiers separated by arrows, with optional :ok/:fail suffixes
  const sugarNodeMatch = textBefore.match(/@path\s+(?:(?:\w+(?::\w+)?\s*(?:->|,)\s*)*)$/);
  if (sugarNodeMatch) {
    return { type: 'nodeId', name: word };
  }

  return null;
}
