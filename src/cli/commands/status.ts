/**
 * Status command — reports implementation progress for stub workflows
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseWorkflow } from '../../api/index.js';
import { validator } from '../../validator.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';
import type { TNodeTypeAST, TPortDefinition } from '../../ast/types.js';

export interface StatusOptions {
  workflowName?: string;
  json?: boolean;
}

interface NodeStatus {
  name: string;
  status: 'STUB' | 'OK';
  inputs: string[];
  outputs: string[];
}

interface WorkflowStatus {
  name: string;
  implemented: number;
  total: number;
  nodes: NodeStatus[];
  structurallyValid: boolean;
  structuralErrors: string[];
}

function formatPortList(ports: Record<string, TPortDefinition>): string[] {
  return Object.entries(ports)
    .filter(([name]) => name !== 'execute' && name !== 'onSuccess' && name !== 'onFailure')
    .map(([name, port]) => `${name}(${port.dataType.toLowerCase()})`);
}

export async function statusCommand(input: string, options: StatusOptions = {}): Promise<void> {
  const { workflowName, json = false } = options;

  try {
    const filePath = path.resolve(input);

    if (!fs.existsSync(filePath)) {
      if (json) {
        console.log(JSON.stringify({ error: `File not found: ${input}` }));
      } else {
        logger.error(`File not found: ${input}`);
      }
      process.exit(1);
    }

    const parseResult = await parseWorkflow(filePath, { workflowName });

    if (parseResult.errors.length > 0) {
      if (json) {
        console.log(JSON.stringify({ error: `Parse errors: ${parseResult.errors.join(', ')}` }));
      } else {
        logger.error('Parse errors:');
        parseResult.errors.forEach((e) => logger.error(`  ${e}`));
      }
      process.exit(1);
    }

    const ast = parseResult.ast;

    // Collect node statuses
    const instanceTypeMap = new Map<string, TNodeTypeAST>();
    for (const nt of ast.nodeTypes) {
      instanceTypeMap.set(nt.name, nt);
      if (nt.functionName !== nt.name) {
        instanceTypeMap.set(nt.functionName, nt);
      }
    }

    const nodes: NodeStatus[] = [];
    const seen = new Set<string>();

    for (const instance of ast.instances) {
      const nt = instanceTypeMap.get(instance.nodeType);
      if (!nt || seen.has(nt.functionName)) continue;
      seen.add(nt.functionName);

      nodes.push({
        name: nt.functionName,
        status: nt.variant === 'STUB' ? 'STUB' : 'OK',
        inputs: formatPortList(nt.inputs),
        outputs: formatPortList(nt.outputs),
      });
    }

    const implemented = nodes.filter((n) => n.status === 'OK').length;
    const total = nodes.length;

    // Run draft validation for structural checks
    const validation = validator.validate(ast, { mode: 'draft' });
    const structuralErrors = validation.errors
      .filter((e) => e.code !== 'STUB_NODE')
      .map((e) => e.message);

    const result: WorkflowStatus = {
      name: ast.name,
      implemented,
      total,
      nodes,
      structurallyValid: structuralErrors.length === 0,
      structuralErrors,
    };

    if (json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
    } else {
      logger.section(`${ast.name}: ${implemented}/${total} nodes implemented`);
      logger.newline();

      const maxNameLen = Math.max(...nodes.map((n) => n.name.length), 0);

      for (const node of nodes) {
        const tag = node.status === 'STUB' ? '[STUB]' : '[OK]  ';
        const paddedName = node.name.padEnd(maxNameLen);
        const inputStr = node.inputs.length > 0 ? `inputs: ${node.inputs.join(', ')}` : '';
        const outputStr = node.outputs.length > 0 ? `outputs: ${node.outputs.join(', ')}` : '';
        const arrow = inputStr && outputStr ? ' → ' : '';
        const portsStr = `${inputStr}${arrow}${outputStr}`;

        if (node.status === 'STUB') {
          logger.warn(`  ${paddedName}  ${tag}  ${portsStr}`);
        } else {
          logger.success(`  ${paddedName}  ${tag}  ${portsStr}`);
        }
      }

      if (structuralErrors.length > 0) {
        logger.newline();
        logger.error(`Structural errors (${structuralErrors.length}):`);
        structuralErrors.forEach((e) => logger.error(`  - ${e}`));
      } else {
        logger.newline();
        logger.success('Graph structure is valid.');
      }
    }
  } catch (error) {
    if (json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ error: getErrorMessage(error) }));
    } else {
      logger.error(`Status failed: ${getErrorMessage(error)}`);
    }
    process.exit(1);
  }
}
