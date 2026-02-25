/**
 * Implement command — replaces a stub node with a real function skeleton
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseWorkflow } from '../../api/index.js';
import { generateFunctionSignature } from '../../annotation-generator.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';
import type { TNodeTypeAST } from '../../ast/types.js';

export interface ImplementOptions {
  workflowName?: string;
  preview?: boolean;
}

/**
 * Find a `declare function <name>(...): ...;` declaration in source text,
 * handling multiline signatures. Returns the full matched text and its
 * leading indentation, or null if not found.
 */
function findDeclareFunction(source: string, functionName: string): { match: string; indent: string } | null {
  const lines = source.split('\n');
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = new RegExp(`^(\\s*)declare\\s+function\\s+${escaped}\\s*\\(`);

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(startPattern);
    if (!m) continue;

    const indent = m[1] || '';
    // Accumulate lines until we find one ending with ;
    let accumulated = lines[i];
    let j = i;
    while (!accumulated.trimEnd().endsWith(';') && j < lines.length - 1) {
      j++;
      accumulated += '\n' + lines[j];
    }
    return { match: accumulated, indent };
  }
  return null;
}

export async function implementCommand(
  input: string,
  nodeName: string,
  options: ImplementOptions = {},
): Promise<void> {
  const { workflowName, preview = false } = options;

  try {
    const filePath = path.resolve(input);

    if (!fs.existsSync(filePath)) {
      logger.error(`File not found: ${input}`);
      process.exit(1);
    }

    const parseResult = await parseWorkflow(filePath, { workflowName });

    if (parseResult.errors.length > 0) {
      logger.error('Parse errors:');
      parseResult.errors.forEach((e) => logger.error(`  ${e}`));
      process.exit(1);
    }

    const ast = parseResult.ast;

    // Find the stub node type
    const stubNodeType = ast.nodeTypes.find(
      (nt: TNodeTypeAST) => nt.variant === 'STUB' && (nt.functionName === nodeName || nt.name === nodeName),
    );

    if (!stubNodeType) {
      const existingNt = ast.nodeTypes.find(
        (nt: TNodeTypeAST) => nt.functionName === nodeName || nt.name === nodeName,
      );
      if (existingNt) {
        logger.warn(`Node "${nodeName}" is already implemented.`);
        process.exit(0);
      }

      const available = ast.nodeTypes
        .filter((nt: TNodeTypeAST) => nt.variant === 'STUB')
        .map((nt: TNodeTypeAST) => nt.functionName);

      if (available.length === 0) {
        logger.error('No stub nodes found in this workflow.');
      } else {
        logger.error(`Stub node "${nodeName}" not found. Available stubs: ${available.join(', ')}`);
      }
      process.exit(1);
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const found = findDeclareFunction(source, stubNodeType.functionName);

    if (!found) {
      logger.error(`Could not find "declare function ${stubNodeType.functionName}" in source file.`);
      process.exit(1);
    }

    // Generate the real function signature
    const implementedType: TNodeTypeAST = { ...stubNodeType, variant: 'FUNCTION' };
    const signatureLines = generateFunctionSignature(implementedType);
    const replacement = signatureLines.map((line: string) => found.indent + line).join('\n');

    if (preview) {
      logger.section(`Preview: ${stubNodeType.functionName}`);
      logger.newline();
      // eslint-disable-next-line no-console
      console.log(replacement);
    } else {
      const updated = source.replace(found.match, replacement);
      fs.writeFileSync(filePath, updated, 'utf8');
      logger.success(`Implemented ${stubNodeType.functionName} in ${path.basename(filePath)}`);
    }
  } catch (error) {
    logger.error(`Implement failed: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}
