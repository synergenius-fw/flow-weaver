/**
 * The MCP tool mirror in doc-metadata feeds `fw docs` and `fw context`, and
 * is written by hand. This keeps it honest: it must list exactly the tools
 * the server registers, and for each one exactly its parameters, with the
 * same required-ness and the same enum values.
 */
import { describe, it, expect } from 'vitest';
import type { ZodType } from 'zod';
import { MCP_TOOLS } from '../../../src/doc-metadata/extractors/mcp-tools';
import { registerQueryTools } from '../../../src/mcp/tools-query';
import { registerTemplateTools } from '../../../src/mcp/tools-template';
import { registerWorkflowTools } from '../../../src/mcp/tools-workflow';
import { registerExportTools } from '../../../src/mcp/tools-export';
import { registerMarketplaceTools } from '../../../src/mcp/tools-marketplace';
import { registerDiagramTools } from '../../../src/mcp/tools-diagram';
import { registerDocsTools } from '../../../src/mcp/tools-docs';
import { registerDebugTools } from '../../../src/mcp/tools-debug';
import { registerRunTools } from '../../../src/mcp/tools-run';
import { registerContextTools } from '../../../src/mcp/tools-context';
import { registerResourceTools } from '../../../src/mcp/tools-resources';

type Shape = Record<string, ZodType>;

/** The tools the server registers, by name, with their parameter schemas. */
function registeredTools(): Map<string, Shape> {
  const tools = new Map<string, Shape>();
  const fake = {
    tool(name: string, _description: string, schemaOrHandler: unknown) {
      tools.set(name, typeof schemaOrHandler === 'function' ? {} : (schemaOrHandler as Shape));
    },
    registerPrompt() {},
    prompt() {},
  };
  const mcp = fake as never;
  // The same set, in the same order, as src/mcp/server.ts.
  registerQueryTools(mcp);
  registerTemplateTools(mcp);
  registerWorkflowTools(mcp);
  registerExportTools(mcp);
  registerMarketplaceTools(mcp);
  registerDiagramTools(mcp);
  registerDocsTools(mcp);
  registerDebugTools(mcp);
  registerRunTools(mcp);
  registerContextTools(mcp);
  registerResourceTools(mcp);
  return tools;
}

/**
 * Whether a parameter may be left out: it is wrapped in `.optional()` or has
 * a default. (`z.unknown()` accepts undefined but is still a required key.)
 */
function isOptional(schema: ZodType): boolean {
  const type = (schema as { def?: { type?: string } }).def?.type;
  return type === 'optional' || type === 'default' || type === 'prefault';
}

/** The enum values of a parameter, if it is one (through optional and default wrappers). */
function enumValues(schema: ZodType): string[] | undefined {
  let s: unknown = schema;
  for (let i = 0; i < 4 && s; i++) {
    const def = (s as { def?: { type?: string; innerType?: unknown; entries?: Record<string, string> } }).def;
    if (!def) return undefined;
    if (def.type === 'enum' && def.entries) return Object.values(def.entries).sort();
    s = def.innerType;
  }
  return undefined;
}

describe('MCP tool mirror', () => {
  const live = registeredTools();

  it('lists exactly the tools the server registers', () => {
    expect(MCP_TOOLS.map((t) => t.name).sort()).toEqual([...live.keys()].sort());
  });

  for (const doc of MCP_TOOLS) {
    it(`describes ${doc.name}'s parameters as registered`, () => {
      const shape = live.get(doc.name);
      expect(shape, `${doc.name} is not registered`).toBeDefined();
      const liveParams = Object.entries(shape!).map(([name, schema]) => ({
        name,
        required: !isOptional(schema),
        enum: enumValues(schema),
      }));
      const documented = doc.params.map((p) => ({
        name: p.name,
        required: p.required,
        enum: p.enum ? [...p.enum].sort() : undefined,
      }));
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
      expect(documented.sort(byName)).toEqual(liveParams.sort(byName));
    });
  }
});
