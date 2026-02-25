import { describe, it, expect, vi } from 'vitest';

// The grammar-rules extractor imports from chevrotain-parser which pulls in
// heavy parser infrastructure. Mock it to keep this test focused on the
// extractor logic itself.
vi.mock('../../../src/chevrotain-parser/grammar-diagrams.js', () => ({
  getAllGrammars: vi.fn(() => ({
    nodeParser: [{ name: 'nodeRule', definition: [] }],
    connectParser: [{ name: 'connectRule', definition: [] }],
    empty: [],
  })),
  serializedToEBNF: vi.fn((productions: any[]) => {
    if (productions.length === 0) return '';
    return productions.map((p: any) => `${p.name} ::= ...`).join('\n');
  }),
}));

// cli-commands imports from the actual template registries. Mock those
// so the test doesn't need the full template infrastructure.
vi.mock('../../../src/cli/templates/index.js', () => ({
  workflowTemplates: [
    { id: 'simple', description: 'Simple sequential workflow' },
    { id: 'parallel', description: 'Parallel execution workflow' },
  ],
  nodeTemplates: [
    { id: 'processor', description: 'Data processor node' },
    { id: 'validator', description: 'Input validator node' },
  ],
}));

vi.mock('../../../src/defaults.js', () => ({
  DEFAULT_SERVER_URL: 'http://localhost:6546',
}));

import {
  extractMcpTools,
  MCP_TOOLS,
} from '../../../src/doc-metadata/extractors/mcp-tools.js';

import {
  extractCliCommands,
  CLI_COMMANDS,
} from '../../../src/doc-metadata/extractors/cli-commands.js';

import {
  PLUGIN_DEFINITION_FIELDS,
  PLUGIN_CAPABILITIES,
  PLUGIN_COMPONENT_CONFIG_FIELDS,
  PLUGIN_COMPONENT_AREAS,
  PLUGIN_UI_KIT_COMPONENTS,
} from '../../../src/doc-metadata/extractors/plugin-api.js';

import {
  ALL_ANNOTATIONS,
  PORT_MODIFIERS,
  NODE_MODIFIERS,
} from '../../../src/doc-metadata/extractors/annotations.js';

import { VALIDATION_CODES } from '../../../src/doc-metadata/extractors/error-codes.js';

import {
  extractGrammarEBNF,
  extractTerminals,
} from '../../../src/doc-metadata/extractors/grammar-rules.js';

// ---------------------------------------------------------------------------
// MCP Tools
// ---------------------------------------------------------------------------

describe('MCP Tools extractor', () => {
  it('extractMcpTools returns the MCP_TOOLS array', () => {
    const tools = extractMcpTools();
    expect(tools).toBe(MCP_TOOLS);
  });

  it('contains expected tool names', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names).toContain('fw_describe');
    expect(names).toContain('fw_validate');
    expect(names).toContain('fw_compile');
    expect(names).toContain('fw_diff');
    expect(names).toContain('fw_query');
    expect(names).toContain('fw_scaffold');
    expect(names).toContain('fw_modify');
    expect(names).toContain('fw_modify_batch');
    expect(names).toContain('fw_export');
    expect(names).toContain('fw_execute_workflow');
  });

  it('every tool has a non-empty name, description, and category', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.category).toBeTruthy();
    }
  });

  it('categories are drawn from the allowed set', () => {
    const allowed = new Set(['query', 'template', 'pattern', 'modify', 'editor', 'execution']);
    for (const tool of MCP_TOOLS) {
      expect(allowed.has(tool.category)).toBe(true);
    }
  });

  it('every tool param has name, type, description, and required fields', () => {
    for (const tool of MCP_TOOLS) {
      for (const param of tool.params) {
        expect(param.name).toBeTruthy();
        expect(param.type).toBeTruthy();
        expect(param.description).toBeTruthy();
        expect(typeof param.required).toBe('boolean');
      }
    }
  });

  it('param types are drawn from the allowed set', () => {
    const allowed = new Set(['string', 'number', 'boolean', 'object', 'array']);
    for (const tool of MCP_TOOLS) {
      for (const param of tool.params) {
        expect(allowed.has(param.type)).toBe(true);
      }
    }
  });

  it('tools with no params have an empty array', () => {
    const noParamTools = MCP_TOOLS.filter((t) => t.params.length === 0);
    expect(noParamTools.length).toBeGreaterThan(0);
    // fw_get_state and fw_get_workflow_details have no params
    const names = noParamTools.map((t) => t.name);
    expect(names).toContain('fw_get_state');
    expect(names).toContain('fw_get_workflow_details');
  });

  it('fw_describe has filePath as a required string param', () => {
    const describe = MCP_TOOLS.find((t) => t.name === 'fw_describe')!;
    const filePathParam = describe.params.find((p) => p.name === 'filePath')!;
    expect(filePathParam.type).toBe('string');
    expect(filePathParam.required).toBe(true);
  });

  it('fw_describe format param has enum values', () => {
    const describe = MCP_TOOLS.find((t) => t.name === 'fw_describe')!;
    const formatParam = describe.params.find((p) => p.name === 'format')!;
    expect(formatParam.enum).toBeDefined();
    expect(formatParam.enum).toContain('json');
    expect(formatParam.enum).toContain('mermaid');
  });

  it('no duplicate tool names', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// CLI Commands
// ---------------------------------------------------------------------------

describe('CLI Commands extractor', () => {
  it('extractCliCommands returns the CLI_COMMANDS array', () => {
    const cmds = extractCliCommands();
    expect(cmds).toBe(CLI_COMMANDS);
  });

  it('contains core command names', () => {
    const names = CLI_COMMANDS.map((c) => c.name);
    expect(names).toContain('compile');
    expect(names).toContain('validate');
    expect(names).toContain('describe');
    expect(names).toContain('run');
    expect(names).toContain('serve');
    expect(names).toContain('init');
    expect(names).toContain('watch');
    expect(names).toContain('doctor');
    expect(names).toContain('export');
    expect(names).toContain('diff');
  });

  it('contains subcommand entries', () => {
    const names = CLI_COMMANDS.map((c) => c.name);
    expect(names).toContain('create workflow');
    expect(names).toContain('create node');
    expect(names).toContain('pattern list');
    expect(names).toContain('pattern apply');
    expect(names).toContain('pattern extract');
    expect(names).toContain('mcp-server');
  });

  it('every command has name, syntax, description, and options array', () => {
    for (const cmd of CLI_COMMANDS) {
      expect(cmd.name).toBeTruthy();
      expect(cmd.syntax).toBeTruthy();
      expect(cmd.description).toBeTruthy();
      expect(Array.isArray(cmd.options)).toBe(true);
    }
  });

  it('options have flags and description', () => {
    for (const cmd of CLI_COMMANDS) {
      for (const opt of cmd.options) {
        expect(opt.flags).toBeTruthy();
        expect(opt.description).toBeTruthy();
      }
    }
  });

  it('compile command has expected options', () => {
    const compile = CLI_COMMANDS.find((c) => c.name === 'compile')!;
    const flagSet = compile.options.map((o) => o.flags);
    expect(flagSet).toContain('-o, --output');
    expect(flagSet).toContain('-p, --production');
    expect(flagSet).toContain('--dry-run');
    expect(flagSet).toContain('--verbose');
  });

  it('create workflow has positionalChoices for template', () => {
    const createWorkflow = CLI_COMMANDS.find((c) => c.name === 'create workflow')!;
    expect(createWorkflow.positionalChoices).toBeDefined();
    expect(createWorkflow.positionalChoices!.template).toBeDefined();
    expect(createWorkflow.positionalChoices!.template.length).toBeGreaterThan(0);
    const ids = createWorkflow.positionalChoices!.template.map((c) => c.id);
    expect(ids).toContain('simple');
  });

  it('subcommands have group property', () => {
    const createWorkflow = CLI_COMMANDS.find((c) => c.name === 'create workflow')!;
    expect(createWorkflow.group).toBe('create');
    const patternList = CLI_COMMANDS.find((c) => c.name === 'pattern list')!;
    expect(patternList.group).toBe('pattern');
  });

  it('template listing commands have list property', () => {
    const templates = CLI_COMMANDS.find((c) => c.name === 'templates')!;
    expect(templates.list).toBeDefined();
    expect(templates.list!.length).toBeGreaterThan(0);
    // Each entry should contain " - " separator
    for (const entry of templates.list!) {
      expect(entry).toContain(' - ');
    }
  });
});

// ---------------------------------------------------------------------------
// Plugin API
// ---------------------------------------------------------------------------

describe('Plugin API metadata', () => {
  describe('PLUGIN_DEFINITION_FIELDS', () => {
    it('is a non-empty array', () => {
      expect(PLUGIN_DEFINITION_FIELDS.length).toBeGreaterThan(0);
    });

    it('contains required top-level fields', () => {
      const names = PLUGIN_DEFINITION_FIELDS.map((f) => f.name);
      expect(names).toContain('name');
      expect(names).toContain('version');
      expect(names).toContain('description');
      expect(names).toContain('entry');
      expect(names).toContain('capabilities');
    });

    it('every field has name, type, required, and description', () => {
      for (const field of PLUGIN_DEFINITION_FIELDS) {
        expect(field.name).toBeTruthy();
        expect(field.type).toBeTruthy();
        expect(typeof field.required).toBe('boolean');
        expect(field.description).toBeTruthy();
      }
    });

    it('entry field has children', () => {
      const entry = PLUGIN_DEFINITION_FIELDS.find((f) => f.name === 'entry')!;
      expect(entry.children).toBeDefined();
      expect(entry.children!.length).toBeGreaterThan(0);
      const childNames = entry.children!.map((c) => c.name);
      expect(childNames).toContain('client');
      expect(childNames).toContain('system');
    });

    it('dependencies field has children with plugins and system', () => {
      const deps = PLUGIN_DEFINITION_FIELDS.find((f) => f.name === 'dependencies')!;
      expect(deps.required).toBe(false);
      expect(deps.children).toBeDefined();
      const childNames = deps.children!.map((c) => c.name);
      expect(childNames).toContain('plugins');
      expect(childNames).toContain('system');
    });
  });

  describe('PLUGIN_CAPABILITIES', () => {
    it('defines filesystem, network, process, and interop capabilities', () => {
      const names = PLUGIN_CAPABILITIES.map((c) => c.name);
      expect(names).toContain('filesystem');
      expect(names).toContain('network');
      expect(names).toContain('process');
      expect(names).toContain('interop');
    });

    it('filesystem capability has children with operations enum', () => {
      const fs = PLUGIN_CAPABILITIES.find((c) => c.name === 'filesystem')!;
      expect(fs.children).toBeDefined();
      const operations = fs.children!.find((c) => c.name === 'operations')!;
      expect(operations.enum).toBeDefined();
      expect(operations.enum).toContain('read');
      expect(operations.enum).toContain('write');
      expect(operations.enum).toContain('delete');
    });

    it('network capability has protocols enum', () => {
      const net = PLUGIN_CAPABILITIES.find((c) => c.name === 'network')!;
      const protocols = net.children!.find((c) => c.name === 'protocols')!;
      expect(protocols.enum).toContain('http');
      expect(protocols.enum).toContain('wss');
    });

    it('all capabilities are optional', () => {
      for (const cap of PLUGIN_CAPABILITIES) {
        expect(cap.required).toBe(false);
      }
    });

    it('each capability requires an "allowed" boolean child', () => {
      for (const cap of PLUGIN_CAPABILITIES) {
        const allowed = cap.children!.find((c) => c.name === 'allowed');
        expect(allowed).toBeDefined();
        expect(allowed!.type).toBe('boolean');
        expect(allowed!.required).toBe(true);
      }
    });
  });

  describe('PLUGIN_COMPONENT_CONFIG_FIELDS', () => {
    it('contains name, displayName, area as required fields', () => {
      const required = PLUGIN_COMPONENT_CONFIG_FIELDS.filter((f) => f.required);
      const names = required.map((f) => f.name);
      expect(names).toContain('name');
      expect(names).toContain('displayName');
      expect(names).toContain('area');
    });

    it('description and icon are optional', () => {
      const desc = PLUGIN_COMPONENT_CONFIG_FIELDS.find((f) => f.name === 'description')!;
      const icon = PLUGIN_COMPONENT_CONFIG_FIELDS.find((f) => f.name === 'icon')!;
      expect(desc.required).toBe(false);
      expect(icon.required).toBe(false);
    });
  });

  describe('PLUGIN_COMPONENT_AREAS', () => {
    it('defines all standard areas', () => {
      expect(Object.keys(PLUGIN_COMPONENT_AREAS)).toEqual(
        expect.arrayContaining(['sidebar', 'main', 'toolbar', 'modal', 'panel']),
      );
    });

    it('every area has a non-empty description', () => {
      for (const [area, desc] of Object.entries(PLUGIN_COMPONENT_AREAS)) {
        expect(desc.length).toBeGreaterThan(0);
      }
    });
  });

  describe('PLUGIN_UI_KIT_COMPONENTS', () => {
    it('defines Display, Feedback, Input, Layout, Navigation, and Hooks categories', () => {
      const categories = Object.keys(PLUGIN_UI_KIT_COMPONENTS);
      expect(categories).toContain('Display');
      expect(categories).toContain('Feedback');
      expect(categories).toContain('Input');
      expect(categories).toContain('Layout');
      expect(categories).toContain('Navigation');
      expect(categories).toContain('Hooks');
    });

    it('every category has at least one component', () => {
      for (const [category, components] of Object.entries(PLUGIN_UI_KIT_COMPONENTS)) {
        expect(components.length).toBeGreaterThan(0);
      }
    });

    it('contains known components', () => {
      expect(PLUGIN_UI_KIT_COMPONENTS.Display).toContain('Icon');
      expect(PLUGIN_UI_KIT_COMPONENTS.Display).toContain('CodeBlock');
      expect(PLUGIN_UI_KIT_COMPONENTS.Input).toContain('Button');
      expect(PLUGIN_UI_KIT_COMPONENTS.Feedback).toContain('Tooltip');
      expect(PLUGIN_UI_KIT_COMPONENTS.Layout).toContain('Modal');
      expect(PLUGIN_UI_KIT_COMPONENTS.Navigation).toContain('Breadcrumbs');
      expect(PLUGIN_UI_KIT_COMPONENTS.Hooks).toContain('useVerticalResize');
    });

    it('no duplicate components within a category', () => {
      for (const [category, components] of Object.entries(PLUGIN_UI_KIT_COMPONENTS)) {
        expect(new Set(components).size).toBe(components.length);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

describe('Annotations extractor', () => {
  it('ALL_ANNOTATIONS is a non-empty array', () => {
    expect(ALL_ANNOTATIONS.length).toBeGreaterThan(0);
  });

  it('contains all expected categories', () => {
    const categories = new Set(ALL_ANNOTATIONS.map((a) => a.category));
    expect(categories).toContain('marker');
    expect(categories).toContain('port');
    expect(categories).toContain('workflow');
    expect(categories).toContain('metadata');
    expect(categories).toContain('pattern');
    expect(categories).toContain('standard');
  });

  it('every annotation has name, category, syntax, description, insertText, and insertTextFormat', () => {
    for (const ann of ALL_ANNOTATIONS) {
      expect(ann.name).toBeTruthy();
      expect(ann.category).toBeTruthy();
      expect(ann.syntax).toBeTruthy();
      expect(ann.description).toBeTruthy();
      expect(ann.insertText).toBeTruthy();
      expect(['plain', 'snippet']).toContain(ann.insertTextFormat);
    }
  });

  it('core annotations include @flowWeaver variants', () => {
    const names = ALL_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@flowWeaver');
    expect(names).toContain('@flowWeaver nodeType');
    expect(names).toContain('@flowWeaver workflow');
    expect(names).toContain('@flowWeaver pattern');
  });

  it('port annotations include @input, @output, @step', () => {
    const names = ALL_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@input');
    expect(names).toContain('@output');
    expect(names).toContain('@step');
  });

  it('workflow annotations include @node, @connect, @path, @map, @fanOut, @fanIn, @coerce', () => {
    const names = ALL_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@node');
    expect(names).toContain('@connect');
    expect(names).toContain('@path');
    expect(names).toContain('@map');
    expect(names).toContain('@fanOut');
    expect(names).toContain('@fanIn');
    expect(names).toContain('@coerce');
  });

  it('metadata annotations include @name, @label, @description, @expression, @strictTypes', () => {
    const names = ALL_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@name');
    expect(names).toContain('@label');
    expect(names).toContain('@description');
    expect(names).toContain('@expression');
    expect(names).toContain('@strictTypes');
  });

  it('pattern annotations include @port IN and @port OUT', () => {
    const names = ALL_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@port IN');
    expect(names).toContain('@port OUT');
  });

  it('standard annotations include @param and @returns', () => {
    const names = ALL_ANNOTATIONS.map((a) => a.name);
    expect(names).toContain('@param');
    expect(names).toContain('@returns');
  });

  it('annotations with examples have non-empty example arrays', () => {
    const withExamples = ALL_ANNOTATIONS.filter((a) => a.examples);
    expect(withExamples.length).toBeGreaterThan(0);
    for (const ann of withExamples) {
      expect(ann.examples!.length).toBeGreaterThan(0);
    }
  });

  it('annotations with contexts list only valid context values', () => {
    const validContexts = new Set(['nodeType', 'workflow', 'pattern']);
    for (const ann of ALL_ANNOTATIONS) {
      if (ann.contexts) {
        for (const ctx of ann.contexts) {
          expect(validContexts.has(ctx)).toBe(true);
        }
      }
    }
  });

  it('annotations are unique by name+category (allowing same name in different categories)', () => {
    // @scope appears in both 'workflow' (assigns nodes to scope) and
    // 'metadata' (declares scope on node type), so name alone is not unique.
    const keys = ALL_ANNOTATIONS.map((a) => `${a.name}::${a.category}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('PORT_MODIFIERS', () => {
  it('is a non-empty array', () => {
    expect(PORT_MODIFIERS.length).toBeGreaterThan(0);
  });

  it('contains order, placement, type, hidden, optional', () => {
    const names = PORT_MODIFIERS.map((m) => m.name);
    expect(names).toContain('order');
    expect(names).toContain('placement');
    expect(names).toContain('type');
    expect(names).toContain('hidden');
    expect(names).toContain('optional');
  });

  it('every modifier has name, syntax, and description', () => {
    for (const mod of PORT_MODIFIERS) {
      expect(mod.name).toBeTruthy();
      expect(mod.syntax).toBeTruthy();
      expect(mod.description).toBeTruthy();
    }
  });

  it('placement modifier has enum values', () => {
    const placement = PORT_MODIFIERS.find((m) => m.name === 'placement')!;
    expect(placement.enum).toBeDefined();
    expect(placement.enum).toContain('TOP');
    expect(placement.enum).toContain('BOTTOM');
  });
});

describe('NODE_MODIFIERS', () => {
  it('is a non-empty array', () => {
    expect(NODE_MODIFIERS.length).toBeGreaterThan(0);
  });

  it('contains label, expr, minimized, pullExecution, portOrder, portLabel, size', () => {
    const names = NODE_MODIFIERS.map((m) => m.name);
    expect(names).toContain('label');
    expect(names).toContain('expr');
    expect(names).toContain('minimized');
    expect(names).toContain('pullExecution');
    expect(names).toContain('portOrder');
    expect(names).toContain('portLabel');
    expect(names).toContain('size');
  });

  it('every modifier has name, syntax, and description', () => {
    for (const mod of NODE_MODIFIERS) {
      expect(mod.name).toBeTruthy();
      expect(mod.syntax).toBeTruthy();
      expect(mod.description).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Validation Error Codes
// ---------------------------------------------------------------------------

describe('VALIDATION_CODES', () => {
  it('is a non-empty array', () => {
    expect(VALIDATION_CODES.length).toBeGreaterThan(0);
  });

  it('every entry has code, severity, title, description, and category', () => {
    for (const entry of VALIDATION_CODES) {
      expect(entry.code).toBeTruthy();
      expect(entry.severity).toBeTruthy();
      expect(entry.title).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.category).toBeTruthy();
    }
  });

  it('severity is either error or warning', () => {
    for (const entry of VALIDATION_CODES) {
      expect(['error', 'warning']).toContain(entry.severity);
    }
  });

  it('categories are drawn from the allowed set', () => {
    const allowed = new Set([
      'structural', 'naming', 'connection', 'type',
      'node-ref', 'graph', 'data-flow', 'agent',
    ]);
    for (const entry of VALIDATION_CODES) {
      expect(allowed.has(entry.category)).toBe(true);
    }
  });

  it('no duplicate codes', () => {
    const codes = VALIDATION_CODES.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('contains key structural codes', () => {
    const codes = VALIDATION_CODES.map((e) => e.code);
    expect(codes).toContain('MISSING_WORKFLOW_NAME');
    expect(codes).toContain('DUPLICATE_NODE_NAME');
  });

  it('contains key connection codes', () => {
    const codes = VALIDATION_CODES.map((e) => e.code);
    expect(codes).toContain('UNKNOWN_SOURCE_NODE');
    expect(codes).toContain('UNKNOWN_TARGET_NODE');
    expect(codes).toContain('UNKNOWN_SOURCE_PORT');
    expect(codes).toContain('UNKNOWN_TARGET_PORT');
    expect(codes).toContain('MULTIPLE_CONNECTIONS_TO_INPUT');
  });

  it('contains key graph codes', () => {
    const codes = VALIDATION_CODES.map((e) => e.code);
    expect(codes).toContain('CYCLE_DETECTED');
  });

  it('contains agent codes', () => {
    const codes = VALIDATION_CODES.map((e) => e.code);
    expect(codes).toContain('AGENT_LLM_MISSING_ERROR_HANDLER');
    expect(codes).toContain('AGENT_UNGUARDED_TOOL_EXECUTOR');
    expect(codes).toContain('AGENT_MISSING_MEMORY_IN_LOOP');
  });

  it('contains scope codes', () => {
    const codes = VALIDATION_CODES.map((e) => e.code);
    expect(codes).toContain('SCOPE_MISSING_REQUIRED_INPUT');
    expect(codes).toContain('SCOPE_WRONG_SCOPE_NAME');
    expect(codes).toContain('SCOPE_CONNECTION_OUTSIDE');
  });

  it('has both errors and warnings', () => {
    const errors = VALIDATION_CODES.filter((e) => e.severity === 'error');
    const warnings = VALIDATION_CODES.filter((e) => e.severity === 'warning');
    expect(errors.length).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Grammar Rules
// ---------------------------------------------------------------------------

describe('Grammar Rules extractor', () => {
  describe('extractGrammarEBNF', () => {
    it('returns non-empty groups from mocked grammars', () => {
      const groups = extractGrammarEBNF();
      // The mock has nodeParser and connectParser with non-empty productions,
      // and 'empty' with no productions (serializedToEBNF returns '')
      expect(groups.length).toBe(2);
    });

    it('each group has a name and ebnf string', () => {
      const groups = extractGrammarEBNF();
      for (const group of groups) {
        expect(group.name).toBeTruthy();
        expect(group.ebnf).toBeTruthy();
      }
    });

    it('skips groups with empty ebnf output', () => {
      const groups = extractGrammarEBNF();
      const names = groups.map((g) => g.name);
      // 'empty' should be excluded because serializedToEBNF returns ''
      expect(names).not.toContain('empty');
    });
  });

  describe('extractTerminals', () => {
    it('returns terminal definitions', () => {
      const terminals = extractTerminals();
      expect(terminals.length).toBeGreaterThan(0);
    });

    it('contains IDENTIFIER, INTEGER, STRING, and TEXT terminals', () => {
      const terminals = extractTerminals();
      const names = terminals.map((t) => t.name);
      expect(names).toContain('IDENTIFIER');
      expect(names).toContain('INTEGER');
      expect(names).toContain('STRING');
      expect(names).toContain('TEXT');
    });

    it('every terminal has name, pattern, and description', () => {
      const terminals = extractTerminals();
      for (const terminal of terminals) {
        expect(terminal.name).toBeTruthy();
        expect(terminal.pattern).toBeTruthy();
        expect(terminal.description).toBeTruthy();
      }
    });

    it('IDENTIFIER pattern mentions npm package naming support', () => {
      const terminals = extractTerminals();
      const identifier = terminals.find((t) => t.name === 'IDENTIFIER')!;
      expect(identifier.description).toContain('npm');
    });
  });
});

// ---------------------------------------------------------------------------
// Barrel exports from index.ts
// ---------------------------------------------------------------------------

describe('doc-metadata barrel exports', () => {
  it('re-exports extractMcpTools and MCP_TOOLS', async () => {
    const barrel = await import('../../../src/doc-metadata/index.js');
    expect(barrel.extractMcpTools).toBe(extractMcpTools);
    expect(barrel.MCP_TOOLS).toBe(MCP_TOOLS);
  });

  it('re-exports extractCliCommands and CLI_COMMANDS', async () => {
    const barrel = await import('../../../src/doc-metadata/index.js');
    expect(barrel.extractCliCommands).toBe(extractCliCommands);
    expect(barrel.CLI_COMMANDS).toBe(CLI_COMMANDS);
  });

  it('re-exports plugin API constants', async () => {
    const barrel = await import('../../../src/doc-metadata/index.js');
    expect(barrel.PLUGIN_DEFINITION_FIELDS).toBe(PLUGIN_DEFINITION_FIELDS);
    expect(barrel.PLUGIN_CAPABILITIES).toBe(PLUGIN_CAPABILITIES);
    expect(barrel.PLUGIN_COMPONENT_CONFIG_FIELDS).toBe(PLUGIN_COMPONENT_CONFIG_FIELDS);
    expect(barrel.PLUGIN_COMPONENT_AREAS).toBe(PLUGIN_COMPONENT_AREAS);
    expect(barrel.PLUGIN_UI_KIT_COMPONENTS).toBe(PLUGIN_UI_KIT_COMPONENTS);
  });

  it('re-exports annotation constants', async () => {
    const barrel = await import('../../../src/doc-metadata/index.js');
    expect(barrel.ALL_ANNOTATIONS).toBe(ALL_ANNOTATIONS);
    expect(barrel.PORT_MODIFIERS).toBe(PORT_MODIFIERS);
    expect(barrel.NODE_MODIFIERS).toBe(NODE_MODIFIERS);
  });

  it('re-exports VALIDATION_CODES', async () => {
    const barrel = await import('../../../src/doc-metadata/index.js');
    expect(barrel.VALIDATION_CODES).toBe(VALIDATION_CODES);
  });

  it('re-exports grammar extractors', async () => {
    const barrel = await import('../../../src/doc-metadata/index.js');
    expect(barrel.extractGrammarEBNF).toBe(extractGrammarEBNF);
    expect(barrel.extractTerminals).toBe(extractTerminals);
  });
});
