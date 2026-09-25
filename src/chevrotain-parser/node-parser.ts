/**
 * @module chevrotain-parser/node-parser
 *
 * Parser for @node declarations using Chevrotain.
 */

import { CstParser, type CstNode } from 'chevrotain';
import {
  JSDocLexer,
  NodeTag,
  Identifier,
  Dot,
  Integer,
  LabelPrefix,
  ExprPrefix,
  PortOrderPrefix,
  PortLabelPrefix,
  MinimizedKeyword,
  PullExecutionPrefix,
  SizePrefix,
  ColorPrefix,
  IconPrefix,
  TagsPrefix,
  SuppressPrefix,
  StringLiteral,
  Colon,
  LBracket,
  RBracket,
  Comma,
  Equals,
  allTokens,
} from './tokens';

// =============================================================================
// Parser Result Types
// =============================================================================

export interface NodeParseResult {
  instanceId: string;
  nodeType: string;
  parentScope?: string;
  label?: string;
  expressions?: Record<string, string>;
  portOrder?: Record<string, number>;
  portLabel?: Record<string, string>;
  minimized?: boolean;
  pullExecution?: string; // triggerPort name, not boolean
  size?: { width: number; height: number };
  color?: string;
  icon?: string;
  tags?: Array<{ label: string; tooltip?: string }>;
  /**
   * Generic `[key: "value"]` bracket attributes not claimed by a named
   * attribute above. Core does not interpret these; a pack reads them from the
   * node instance and gives them meaning (validation, export, serialization).
   * This is the extension point for domain vocabularies on `@node`.
   */
  attributes?: Record<string, string>;
  /** Warning codes to suppress for this instance */
  suppress?: string[];
}

// =============================================================================
// Parser Definition
// =============================================================================

class NodeParser extends CstParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // Entry rule for node line
  // @node instanceId nodeType [parentNode.scope] [attributes]
  public nodeLine = this.RULE('nodeLine', () => {
    this.CONSUME(NodeTag);
    this.CONSUME(Identifier, { LABEL: 'instanceId' });
    this.CONSUME2(Identifier, { LABEL: 'nodeType' });
    // Optional parentScope: parent.scope
    this.OPTION(() => {
      this.SUBRULE(this.parentScopeRef);
    });
    // Optional attribute brackets
    this.MANY(() => {
      this.SUBRULE(this.attributeBracket);
    });
  });

  // parent.scope
  private parentScopeRef = this.RULE('parentScopeRef', () => {
    this.CONSUME(Identifier, { LABEL: 'parentNode' });
    this.CONSUME(Dot);
    this.CONSUME2(Identifier, { LABEL: 'scopeName' });
  });

  // [label: "...", expr: port="value", portOrder: port=N, portLabel: port="label", minimized, pullExecution: triggerPort, size: W H]
  private attributeBracket = this.RULE('attributeBracket', () => {
    this.CONSUME(LBracket);
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        this.OR([
          { ALT: () => this.SUBRULE(this.labelAttr) },
          { ALT: () => this.SUBRULE(this.exprAttr) },
          { ALT: () => this.SUBRULE(this.portOrderAttr) },
          { ALT: () => this.SUBRULE(this.portLabelAttr) },
          { ALT: () => this.SUBRULE(this.minimizedAttr) },
          { ALT: () => this.SUBRULE(this.pullExecutionAttr) },
          { ALT: () => this.SUBRULE(this.sizeAttr) },
          { ALT: () => this.SUBRULE(this.colorAttr) },
          { ALT: () => this.SUBRULE(this.iconAttr) },
          { ALT: () => this.SUBRULE(this.tagsAttr) },
          { ALT: () => this.SUBRULE(this.suppressAttr) },
          // Catch-all LAST: any `key: "value"` not claimed above lands in the
          // node's `attributes` for a pack to read. INVARIANT: every named
          // attribute above must have its OWN prefix token (label:, color:,
          // size:, …) tokenised before `Identifier`. A named attribute added as
          // a bare `word:` with no dedicated token would tokenise as
          // `Identifier Colon` and be swallowed here instead of parsed as
          // itself. Add a prefix token in tokens.ts for any new named attribute.
          { ALT: () => this.SUBRULE(this.customAttr) },
        ]);
      },
    });
    this.CONSUME(RBracket);
  });

  // label: "..."
  private labelAttr = this.RULE('labelAttr', () => {
    this.CONSUME(LabelPrefix);
    this.CONSUME(StringLiteral, { LABEL: 'labelValue' });
  });

  // expr: port="value", port2="value2"  (comma optional between assignments)
  private exprAttr = this.RULE('exprAttr', () => {
    this.CONSUME(ExprPrefix);
    this.SUBRULE(this.exprAssignment);
    this.MANY(() => {
      this.OPTION(() => this.CONSUME(Comma));
      this.SUBRULE2(this.exprAssignment);
    });
  });

  // port="value"
  private exprAssignment = this.RULE('exprAssignment', () => {
    this.CONSUME(Identifier, { LABEL: 'portName' });
    this.CONSUME(Equals);
    this.CONSUME(StringLiteral, { LABEL: 'portValue' });
  });

  // portOrder: port=N,port=N
  private portOrderAttr = this.RULE('portOrderAttr', () => {
    this.CONSUME(PortOrderPrefix);
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        this.SUBRULE(this.portOrderAssignment);
      },
    });
  });

  // port=N
  private portOrderAssignment = this.RULE('portOrderAssignment', () => {
    this.CONSUME(Identifier, { LABEL: 'portName' });
    this.CONSUME(Equals);
    this.CONSUME(Integer, { LABEL: 'orderValue' });
  });

  // portLabel: port="label",port2="label2"
  private portLabelAttr = this.RULE('portLabelAttr', () => {
    this.CONSUME(PortLabelPrefix);
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        this.SUBRULE(this.portLabelAssignment);
      },
    });
  });

  // port="label"
  private portLabelAssignment = this.RULE('portLabelAssignment', () => {
    this.CONSUME(Identifier, { LABEL: 'portName' });
    this.CONSUME(Equals);
    this.CONSUME(StringLiteral, { LABEL: 'labelValue' });
  });

  // minimized
  private minimizedAttr = this.RULE('minimizedAttr', () => {
    this.CONSUME(MinimizedKeyword);
  });

  // pullExecution: triggerPortName or true/false
  private pullExecutionAttr = this.RULE('pullExecutionAttr', () => {
    this.CONSUME(PullExecutionPrefix);
    this.CONSUME(Identifier, { LABEL: 'pullValue' });
  });

  // size: width height
  private sizeAttr = this.RULE('sizeAttr', () => {
    this.CONSUME(SizePrefix);
    this.CONSUME(Integer, { LABEL: 'widthValue' });
    this.CONSUME2(Integer, { LABEL: 'heightValue' });
  });

  // color: "value"
  private colorAttr = this.RULE('colorAttr', () => {
    this.CONSUME(ColorPrefix);
    this.CONSUME(StringLiteral, { LABEL: 'colorValue' });
  });

  // icon: "value"
  private iconAttr = this.RULE('iconAttr', () => {
    this.CONSUME(IconPrefix);
    this.CONSUME(StringLiteral, { LABEL: 'iconValue' });
  });

  // key: "value" — a generic bracket attribute a pack interprets. Matched last,
  // so it never shadows a named attribute above.
  private customAttr = this.RULE('customAttr', () => {
    this.CONSUME(Identifier, { LABEL: 'attrKey' });
    this.CONSUME(Colon);
    this.CONSUME(StringLiteral, { LABEL: 'attrValue' });
  });

  // tags: "label" "tooltip", "label2"
  private tagsAttr = this.RULE('tagsAttr', () => {
    this.CONSUME(TagsPrefix);
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        this.SUBRULE(this.tagEntry);
      },
    });
  });

  // suppress: "CODE", "CODE2"
  private suppressAttr = this.RULE('suppressAttr', () => {
    this.CONSUME(SuppressPrefix);
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        this.CONSUME(StringLiteral, { LABEL: 'suppressCode' });
      },
    });
  });

  // "label" ["tooltip"]
  private tagEntry = this.RULE('tagEntry', () => {
    this.CONSUME(StringLiteral, { LABEL: 'tagLabel' });
    this.OPTION(() => {
      this.CONSUME2(StringLiteral, { LABEL: 'tagTooltip' });
    });
  });
}

// =============================================================================
// Parser Instance (singleton)
// =============================================================================

const parserInstance = new NodeParser();

// =============================================================================
// CST Visitor
// =============================================================================

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

// CST Context types for the visitor
interface CstNodeWithImage {
  image: string;
}

interface NodeLineContext {
  instanceId: CstNodeWithImage[];
  nodeType: CstNodeWithImage[];
  parentScopeRef?: CstNode[];
  attributeBracket?: CstNode[];
}

interface ParentScopeRefContext {
  parentNode: CstNodeWithImage[];
  scopeName: CstNodeWithImage[];
}

interface AttributeBracketContext {
  labelAttr?: CstNode[];
  exprAttr?: CstNode[];
  portOrderAttr?: CstNode[];
  portLabelAttr?: CstNode[];
  minimizedAttr?: CstNode[];
  pullExecutionAttr?: CstNode[];
  sizeAttr?: CstNode[];
  colorAttr?: CstNode[];
  iconAttr?: CstNode[];
  tagsAttr?: CstNode[];
  suppressAttr?: CstNode[];
  customAttr?: CstNode[];
}

interface SuppressAttrContext {
  suppressCode: CstNodeWithImage[];
}

interface LabelAttrContext {
  labelValue: CstNodeWithImage[];
}

interface ExprAttrContext {
  exprAssignment?: CstNode[];
}

interface ExprAssignmentContext {
  portName: CstNodeWithImage[];
  portValue: CstNodeWithImage[];
}

interface PortOrderAttrContext {
  portOrderAssignment?: CstNode[];
}

interface PortOrderAssignmentContext {
  portName: CstNodeWithImage[];
  orderValue: CstNodeWithImage[];
}

interface PortLabelAttrContext {
  portLabelAssignment?: CstNode[];
}

interface PortLabelAssignmentContext {
  portName: CstNodeWithImage[];
  labelValue: CstNodeWithImage[];
}

interface PullExecutionAttrContext {
  pullValue: CstNodeWithImage[];
}

interface SizeAttrContext {
  widthValue: CstNodeWithImage[];
  heightValue: CstNodeWithImage[];
}

interface ColorAttrContext {
  colorValue: CstNodeWithImage[];
}

interface IconAttrContext {
  iconValue: CstNodeWithImage[];
}

interface CustomAttrContext {
  attrKey: CstNodeWithImage[];
  attrValue: CstNodeWithImage[];
}

interface TagsAttrContext {
  tagEntry?: CstNode[];
}

interface TagEntryContext {
  tagLabel: CstNodeWithImage[];
  tagTooltip?: CstNodeWithImage[];
}

class NodeVisitor extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  nodeLine(ctx: NodeLineContext): NodeParseResult {
    const instanceId = ctx.instanceId[0].image;
    const nodeType = ctx.nodeType[0].image;

    let parentScope: string | undefined;
    let label: string | undefined;
    let expressions: Record<string, string> | undefined;
    let portOrder: Record<string, number> | undefined;
    let portLabel: Record<string, string> | undefined;
    let minimized: boolean | undefined;
    let pullExecution: string | undefined;
    let size: { width: number; height: number } | undefined;
    let color: string | undefined;
    let icon: string | undefined;
    let tags: Array<{ label: string; tooltip?: string }> | undefined;
    let attributes: Record<string, string> | undefined;
    let suppress: string[] | undefined;

    if (ctx.parentScopeRef) {
      parentScope = this.visit(ctx.parentScopeRef);
    }

    if (ctx.attributeBracket) {
      for (const bracket of ctx.attributeBracket) {
        const attrs = this.visit(bracket);
        if (attrs.label) label = attrs.label;
        if (attrs.expressions) expressions = { ...expressions, ...attrs.expressions };
        if (attrs.portOrder) portOrder = { ...portOrder, ...attrs.portOrder };
        if (attrs.portLabel) portLabel = { ...portLabel, ...attrs.portLabel };
        if (attrs.minimized) minimized = attrs.minimized;
        if (attrs.pullExecution) pullExecution = attrs.pullExecution;
        if (attrs.size) size = attrs.size;
        if (attrs.color) color = attrs.color;
        if (attrs.icon) icon = attrs.icon;
        if (attrs.tags) tags = [...(tags || []), ...attrs.tags];
        if (attrs.attributes) attributes = { ...(attributes || {}), ...attrs.attributes };
        if (attrs.suppress) suppress = [...(suppress || []), ...attrs.suppress];
      }
    }

    return {
      instanceId,
      nodeType,
      ...(parentScope && { parentScope }),
      ...(label && { label }),
      ...(expressions && { expressions }),
      ...(portOrder && { portOrder }),
      ...(portLabel && { portLabel }),
      ...(minimized && { minimized }),
      ...(pullExecution && { pullExecution }),
      ...(size && { size }),
      ...(color && { color }),
      ...(icon && { icon }),
      ...(tags && { tags }),
      ...(attributes && { attributes }),
      ...(suppress && { suppress }),
    };
  }

  parentScopeRef(ctx: ParentScopeRefContext): string {
    const parentNode = ctx.parentNode[0].image;
    const scopeName = ctx.scopeName[0].image;
    return `${parentNode}.${scopeName}`;
  }

  attributeBracket(ctx: AttributeBracketContext): {
    label?: string;
    expressions?: Record<string, string>;
    portOrder?: Record<string, number>;
    portLabel?: Record<string, string>;
    minimized?: boolean;
    pullExecution?: string;
    size?: { width: number; height: number };
      color?: string;
    icon?: string;
    tags?: Array<{ label: string; tooltip?: string }>;
    attributes?: Record<string, string>;
    suppress?: string[];
  } {
    let label: string | undefined;
    let expressions: Record<string, string> | undefined;
    let portOrder: Record<string, number> | undefined;
    let portLabel: Record<string, string> | undefined;
    let minimized: boolean | undefined;
    let pullExecution: string | undefined;
    let size: { width: number; height: number } | undefined;
    let color: string | undefined;
    let icon: string | undefined;
    let tags: Array<{ label: string; tooltip?: string }> | undefined;
    let attributes: Record<string, string> | undefined;
    let suppress: string[] | undefined;

    if (ctx.labelAttr) {
      for (const attr of ctx.labelAttr) {
        label = this.visit(attr);
      }
    }

    if (ctx.exprAttr) {
      for (const attr of ctx.exprAttr) {
        const exprs = this.visit(attr);
        expressions = { ...expressions, ...exprs };
      }
    }

    if (ctx.portOrderAttr) {
      for (const attr of ctx.portOrderAttr) {
        const orders = this.visit(attr);
        portOrder = { ...portOrder, ...orders };
      }
    }

    if (ctx.portLabelAttr) {
      for (const attr of ctx.portLabelAttr) {
        const labels = this.visit(attr);
        portLabel = { ...portLabel, ...labels };
      }
    }

    if (ctx.minimizedAttr) {
      minimized = true;
    }

    if (ctx.pullExecutionAttr) {
      for (const attr of ctx.pullExecutionAttr) {
        pullExecution = this.visit(attr);
      }
    }

    if (ctx.sizeAttr) {
      for (const attr of ctx.sizeAttr) {
        size = this.visit(attr);
      }
    }

    if (ctx.colorAttr) {
      for (const attr of ctx.colorAttr) {
        color = this.visit(attr);
      }
    }

    if (ctx.iconAttr) {
      for (const attr of ctx.iconAttr) {
        icon = this.visit(attr);
      }
    }

    if (ctx.tagsAttr) {
      for (const attr of ctx.tagsAttr) {
        const parsed = this.visit(attr);
        tags = [...(tags || []), ...parsed];
      }
    }

    if (ctx.customAttr) {
      for (const attr of ctx.customAttr) {
        const { key, value } = this.visit(attr);
        attributes = { ...(attributes || {}), [key]: value };
      }
    }

    if (ctx.suppressAttr) {
      for (const attr of ctx.suppressAttr) {
        const codes = this.visit(attr);
        suppress = [...(suppress || []), ...codes];
      }
    }

    return {
      label,
      expressions,
      portOrder,
      portLabel,
      minimized,
      pullExecution,
      size,
      color,
      icon,
      tags,
      attributes,
      suppress,
    };
  }

  labelAttr(ctx: LabelAttrContext): string {
    // Remove surrounding quotes and unescape
    const raw = ctx.labelValue[0].image;
    return this.unescapeString(raw);
  }

  exprAttr(ctx: ExprAttrContext): Record<string, string> {
    const result: Record<string, string> = {};
    if (ctx.exprAssignment) {
      for (const assignment of ctx.exprAssignment) {
        const { name, value } = this.visit(assignment);
        result[name] = value;
      }
    }
    return result;
  }

  exprAssignment(ctx: ExprAssignmentContext): { name: string; value: string } {
    const name = ctx.portName[0].image;
    const rawValue = ctx.portValue[0].image;
    const value = this.unescapeString(rawValue);
    return { name, value };
  }

  portOrderAttr(ctx: PortOrderAttrContext): Record<string, number> {
    const result: Record<string, number> = {};
    if (ctx.portOrderAssignment) {
      for (const assignment of ctx.portOrderAssignment) {
        const { name, order } = this.visit(assignment);
        result[name] = order;
      }
    }
    return result;
  }

  portOrderAssignment(ctx: PortOrderAssignmentContext): { name: string; order: number } {
    const name = ctx.portName[0].image;
    const order = parseInt(ctx.orderValue[0].image, 10);
    return { name, order };
  }

  portLabelAttr(ctx: PortLabelAttrContext): Record<string, string> {
    const result: Record<string, string> = {};
    if (ctx.portLabelAssignment) {
      for (const assignment of ctx.portLabelAssignment) {
        const { name, label } = this.visit(assignment);
        result[name] = label;
      }
    }
    return result;
  }

  portLabelAssignment(ctx: PortLabelAssignmentContext): { name: string; label: string } {
    const name = ctx.portName[0].image;
    const rawLabel = ctx.labelValue[0].image;
    const label = this.unescapeString(rawLabel);
    return { name, label };
  }

  minimizedAttr(): boolean {
    return true;
  }

  pullExecutionAttr(ctx: PullExecutionAttrContext): string {
    return ctx.pullValue[0].image;
  }

  sizeAttr(ctx: SizeAttrContext): { width: number; height: number } {
    const width = parseInt(ctx.widthValue[0].image, 10);
    const height = parseInt(ctx.heightValue[0].image, 10);
    return { width, height };
  }

  colorAttr(ctx: ColorAttrContext): string {
    return this.unescapeString(ctx.colorValue[0].image);
  }

  iconAttr(ctx: IconAttrContext): string {
    return this.unescapeString(ctx.iconValue[0].image);
  }

  customAttr(ctx: CustomAttrContext): { key: string; value: string } {
    return {
      key: ctx.attrKey[0].image,
      value: this.unescapeString(ctx.attrValue[0].image),
    };
  }

  suppressAttr(ctx: SuppressAttrContext): string[] {
    return ctx.suppressCode.map((tok) => this.unescapeString(tok.image));
  }

  tagsAttr(ctx: TagsAttrContext): Array<{ label: string; tooltip?: string }> {
    const result: Array<{ label: string; tooltip?: string }> = [];
    if (ctx.tagEntry) {
      for (const entry of ctx.tagEntry) {
        result.push(this.visit(entry));
      }
    }
    return result;
  }

  tagEntry(ctx: TagEntryContext): { label: string; tooltip?: string } {
    const label = this.unescapeString(ctx.tagLabel[0].image);
    const tooltip = ctx.tagTooltip?.[0] ? this.unescapeString(ctx.tagTooltip[0].image) : undefined;
    return { label, ...(tooltip && { tooltip }) };
  }

  private unescapeString(raw: string): string {
    // Remove surrounding quotes
    const inner = raw.slice(1, -1);
    // Unescape \" to " and *\/ to */ (JSDoc comment-closer escape)
    return inner.replace(/\\"/g, '"').replace(/\*\\\//g, '*/');
  }
}

const visitorInstance = new NodeVisitor();

// =============================================================================
// Public API
// =============================================================================

/**
 * Every `@node` attribute takes a quoted value: `[color: "blue"]`,
 * `[expr: timeout="24h"]`. When the quotes are missing the grammar reports
 * only that it expected a `StringLiteral`, which names neither the attribute
 * nor the quoting -- and because a failed `@node` line is a warning, the
 * author's actual error ends up being `node "g" not found` on a `@path` line
 * that is correct.
 *
 * This recovers the attribute and value from the raw text and says what to
 * write instead. `[expr:]` is a special case twice over: its value is
 * JavaScript, so text needs quotes *inside* the attribute (`timeout="'24h'"`),
 * while an upstream port reference is already an expression and needs only
 * the attribute's own quotes (`agentId="prep.agentId"`).
 *
 * @param input - The full `@node ...` line as written.
 * @returns A message naming the fix, or null when the failure is something else.
 */
function unquotedValueHint(input: string): string | null {
  // The first attribute whose value is not quoted, e.g. `[color: blue]` or
  // `[expr: timeout=24h]`. A quoted value is left alone.
  const attribute = /\[\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*([^\]"]+?)\s*\]/.exec(input);
  if (!attribute) return null;

  const [, name, rawValue] = attribute;
  if (name === 'expr') {
    const binding = /^([A-Za-z_$][\w$]*)\s*=\s*(.+)$/.exec(rawValue);
    if (!binding) return null;
    const [, port, value] = binding;
    // `prep.agentId` is a port reference and already an expression; `24h` is
    // text that has to survive as a JavaScript string literal.
    const isReference = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(value);
    const quoted = isReference ? `${port}="${value}"` : `${port}="'${value}'"`;
    return (
      `the [expr:] value for "${port}" is not quoted. ` +
      `An [expr:] value is JavaScript and the attribute itself takes a quoted string, so write [expr: ${quoted}].`
    );
  }

  return `the [${name}:] value is not quoted. Write [${name}: "${rawValue}"].`;
}

/**
 * Parse a @node line and return structured result.
 * Returns null if the line is not a node declaration.
 */
export function parseNodeLine(input: string, warnings: string[]): NodeParseResult | null {
  const lexResult = JSDocLexer.tokenize(input);

  if (lexResult.errors.length > 0) {
    const truncatedInput = input.length > 60 ? input.substring(0, 60) + '...' : input;
    warnings.push(
      `Failed to tokenize node line: "${truncatedInput}"\n` +
        `  Error: ${lexResult.errors[0].message}\n` +
        `  Expected format: @node instanceId NodeType`
    );
    return null;
  }

  // Check if starts with @node
  if (lexResult.tokens.length === 0) {
    return null;
  }

  const firstToken = lexResult.tokens[0];
  if (firstToken.tokenType !== NodeTag) {
    return null;
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.nodeLine();

  if (parserInstance.errors.length > 0) {
    const firstError = parserInstance.errors[0];
    const truncatedInput = input.length > 60 ? input.substring(0, 60) + '...' : input;
    const hint = unquotedValueHint(input);
    warnings.push(
      `Failed to parse node line: "${truncatedInput}"\n` +
        `  Error: ${hint ?? firstError.message}\n` +
        `  Expected format: @node instanceId NodeType`
    );
    return null;
  }

  return visitorInstance.visit(cst);
}

/**
 * Get serialized grammar for documentation/diagram generation.
 */
export function getNodeGrammar() {
  return parserInstance.getSerializedGastProductions();
}
