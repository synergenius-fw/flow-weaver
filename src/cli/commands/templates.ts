/* eslint-disable no-console */
/**
 * Templates command - list available templates
 */

import { workflowTemplates, nodeTemplates } from "../templates/index.js";
import { logger } from "../utils/logger.js";

export interface TemplatesOptions {
  json?: boolean;
}

export async function templatesCommand(
  options: TemplatesOptions = {},
): Promise<void> {
  const { json = false } = options;

  if (json) {
    console.log(
      JSON.stringify(
        {
          workflows: workflowTemplates.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            category: t.category,
          })),
          nodes: nodeTemplates.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  logger.section("Workflow Templates");
  logger.newline();

  // Group by category
  const categories = new Map<string, typeof workflowTemplates>();
  for (const template of workflowTemplates) {
    const cat = template.category;
    if (!categories.has(cat)) {
      categories.set(cat, []);
    }
    categories.get(cat)!.push(template);
  }

  for (const [category, templates] of categories) {
    logger.info(`  ${category}:`);
    for (const t of templates) {
      logger.log(`    ${t.id.padEnd(15)} ${t.description}`);
    }
    logger.newline();
  }

  logger.section("Node Templates");
  logger.newline();

  for (const t of nodeTemplates) {
    logger.log(`  ${t.id.padEnd(15)} ${t.description}`);
  }

  logger.newline();
  logger.section("Usage");
  logger.log("  $ flow-weaver create workflow <template> <file> [--async] [--line N]");
  logger.log("  $ flow-weaver create node <template> <name> <file> [--line N]");
  logger.newline();
}
