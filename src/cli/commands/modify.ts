import * as fs from 'fs';
import * as path from 'path';
import { parseWorkflow } from '../../api/index.js';
import { generateInPlace } from '../../api/generate-in-place.js';
import { applyModifyOperation, validateModifyParams } from '../../api/modify-operation.js';
import { logger } from '../utils/logger.js';

async function readParseModifyWrite(
  file: string,
  operation: string,
  params: Record<string, unknown>,
): Promise<void> {
  const validation = validateModifyParams(operation, params);
  if (!validation.success) {
    throw new Error(validation.error);
  }
  const filePath = path.resolve(file);
  const source = fs.readFileSync(filePath, 'utf-8');
  const parseResult = await parseWorkflow(filePath);
  if (parseResult.errors.length > 0) {
    throw new Error(`Parse errors:\n${parseResult.errors.join('\n')}`);
  }
  const { ast: modifiedAST, warnings } = applyModifyOperation(parseResult.ast, operation, params);
  const result = generateInPlace(source, modifiedAST);
  fs.writeFileSync(filePath, result.code, 'utf-8');
  for (const w of warnings) {
    logger.warn(w);
  }
}

export async function modifyAddNodeCommand(
  file: string,
  opts: { nodeId: string; nodeType: string },
): Promise<void> {
  await readParseModifyWrite(file, 'addNode', { nodeId: opts.nodeId, nodeType: opts.nodeType });
  logger.success(`Added node "${opts.nodeId}" (type: ${opts.nodeType}) to ${file}`);
}

export async function modifyRemoveNodeCommand(
  file: string,
  opts: { nodeId: string },
): Promise<void> {
  await readParseModifyWrite(file, 'removeNode', { nodeId: opts.nodeId });
  logger.success(`Removed node "${opts.nodeId}" from ${file}`);
}

export async function modifyAddConnectionCommand(
  file: string,
  opts: { from: string; to: string },
): Promise<void> {
  await readParseModifyWrite(file, 'addConnection', { from: opts.from, to: opts.to });
  logger.success(`Added connection ${opts.from} -> ${opts.to} in ${file}`);
}

export async function modifyRemoveConnectionCommand(
  file: string,
  opts: { from: string; to: string },
): Promise<void> {
  await readParseModifyWrite(file, 'removeConnection', { from: opts.from, to: opts.to });
  logger.success(`Removed connection ${opts.from} -> ${opts.to} from ${file}`);
}


export async function modifyRenameNodeCommand(
  file: string,
  opts: { oldId: string; newId: string },
): Promise<void> {
  await readParseModifyWrite(file, 'renameNode', { oldId: opts.oldId, newId: opts.newId });
  logger.success(`Renamed node "${opts.oldId}" to "${opts.newId}" in ${file}`);
}

export async function modifySetPositionCommand(
  file: string,
  opts: { nodeId: string; x: string; y: string },
): Promise<void> {
  await readParseModifyWrite(file, 'setNodePosition', {
    nodeId: opts.nodeId,
    x: Number(opts.x),
    y: Number(opts.y),
  });
  logger.success(`Set position of "${opts.nodeId}" to (${opts.x}, ${opts.y}) in ${file}`);
}

export async function modifySetLabelCommand(
  file: string,
  opts: { nodeId: string; label: string },
): Promise<void> {
  await readParseModifyWrite(file, 'setNodeLabel', { nodeId: opts.nodeId, label: opts.label });
  logger.success(`Set label of "${opts.nodeId}" to "${opts.label}" in ${file}`);
}
