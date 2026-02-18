/**
 * Sequential Pipeline Template
 * Linear data processing: validate -> transform -> output
 */

import type { WorkflowTemplate, WorkflowTemplateOptions, ConfigSchema } from '../index';

const configSchema: ConfigSchema = {
  nodes: {
    type: 'string',
    label: 'Node Names',
    description: 'Comma-separated list of node function names (e.g. "fetch,parse,store")',
    placeholder: 'validateData,transformData,outputResult',
  },
  input: {
    type: 'string',
    label: 'Input Port Name',
    description: 'Name of the input data port',
    default: 'data',
    placeholder: 'data',
  },
  output: {
    type: 'string',
    label: 'Output Port Name',
    description: 'Name of the output data port',
    default: 'result',
    placeholder: 'result',
  },
};

function generateDefaultTemplate(
  workflowName: string,
  asyncKeyword: string,
  returnType: string
): string {
  return `
// Use @expression for pure functions, normal mode for branching

/**
 * Validates input data
 * Normal mode: explicit error routing with data on failure
 *
 * @flowWeaver nodeType
 * @label Validate
 * @input data [order:1] - Data to validate
 * @input execute [order:0] - Execute
 * @output data [order:2] - Validated data
 * @output isValid [order:3] - Validation passed
 * @output error [order:4] - Validation error message
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function validateData(
  execute: boolean,
  data: any
): { onSuccess: boolean; onFailure: boolean; data: any; isValid: boolean; error: string | null } {
  if (!execute) {
    return { onSuccess: false, onFailure: false, data: null, isValid: false, error: null };
  }

  // TODO: Add validation logic
  if (!data) {
    return { onSuccess: false, onFailure: true, data: null, isValid: false, error: "Data is required" };
  }

  return { onSuccess: true, onFailure: false, data, isValid: true, error: null };
}

/**
 * Transforms validated data
 *
 * @flowWeaver nodeType
 * @expression
 * @label Transform
 * @input data [order:0] - Data to transform
 * @output data [order:0] - Transformed data
 */
function transformData(data: any): { data: any } {
  // TODO: Add transformation logic
  return { data: { ...data, processedAt: new Date().toISOString() } };
}

/**
 * Outputs the final result
 *
 * @flowWeaver nodeType
 * @expression
 * @label Output
 * @input data [order:0] - Data to output
 * @output result [order:0] - Final result
 */
function outputResult(data: any): { result: any } {
  return { result: data };
}

/**
 * @flowWeaver workflow
 * @node validator validateData
 * @node transformer transformData
 * @node outputter outputResult
 * @position Start -600 0
 * @position validator -300 0
 * @position transformer 0 0
 * @position outputter 300 0
 * @position Exit 600 0
 * @path Start -> validator -> transformer -> outputter -> Exit
 * @connect validator.onFailure -> Exit.onFailure
 * @connect validator.error -> Exit.error
 * @param execute [order:0] - Execute
 * @param data [order:1] - Input data
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns result [order:2] - Processed result
 * @returns error [order:3] - Error message if failed
 */
export ${asyncKeyword}function ${workflowName}(
  execute: boolean,
  params: { data: any }
): ${returnType} {
  throw new Error("Compile with: flow-weaver compile <file>");
}
`.trim();
}

function generateCustomTemplate(
  workflowName: string,
  asyncKeyword: string,
  returnType: string,
  nodeNames: string[],
  inputPort: string,
  outputPort: string
): string {
  // Generate node type functions
  const nodeTypeDefs = nodeNames.map((name, i) => {
    const isFirst = i === 0;
    const isLast = i === nodeNames.length - 1;
    const inputPortName = isFirst ? inputPort : 'data';
    const outputPortName = isLast ? outputPort : 'data';

    return `/**
 * ${name} step
 *
 * @flowWeaver nodeType
 * @expression
 * @label ${name.charAt(0).toUpperCase() + name.slice(1)}
 * @input ${inputPortName} [order:0] - Input data
 * @output ${outputPortName} [order:0] - Output data
 */
function ${name}(${inputPortName}: any): { ${outputPortName}: any } {
  // TODO: Implement ${name} logic
  return { ${outputPortName}: ${inputPortName} };
}`;
  });

  // Generate workflow annotations
  const nodeAnnotations = nodeNames.map((name, i) => ` * @node step${i} ${name}`).join('\n');
  const spacing = 300;
  const startX = -(nodeNames.length * (spacing / 2) + spacing / 2);
  const positionAnnotations = [
    ` * @position Start ${startX} 0`,
    ...nodeNames.map((_, i) => ` * @position step${i} ${startX + (i + 1) * spacing} 0`),
    ` * @position Exit ${startX + (nodeNames.length + 1) * spacing} 0`,
  ].join('\n');

  // Build connections using @path sugar
  const pathNodes = ['Start', ...nodeNames.map((_, i) => `step${i}`), 'Exit'];
  const connections: string[] = [];
  connections.push(` * @path ${pathNodes.join(' -> ')}`);
  connections.push(` * @connect step0.onFailure -> Exit.onFailure`);

  return `${nodeTypeDefs.join('\n\n')}

/**
 * @flowWeaver workflow
${nodeAnnotations}
${positionAnnotations}
${connections.join('\n')}
 * @param execute [order:0] - Execute
 * @param ${inputPort} [order:1] - Input data
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns ${outputPort} [order:2] - Processed result
 * @returns error [order:3] - Error message if failed
 */
export ${asyncKeyword}function ${workflowName}(
  execute: boolean,
  params: { ${inputPort}: any }
): ${returnType} {
  throw new Error("Compile with: flow-weaver compile <file>");
}`.trim();
}

export const sequentialTemplate: WorkflowTemplate = {
  id: 'sequential',
  name: 'Sequential Pipeline',
  description: 'Linear pipeline: validate -> transform -> output',
  category: 'data-processing',
  configSchema,
  generate: (opts: WorkflowTemplateOptions): string => {
    const { workflowName, async: isAsync, config } = opts;
    const asyncKeyword = isAsync ? 'async ' : '';
    const returnType = isAsync
      ? 'Promise<{ onSuccess: boolean; onFailure: boolean; result: any; error?: string }>'
      : '{ onSuccess: boolean; onFailure: boolean; result: any; error?: string }';

    // If custom nodes are provided, generate custom template
    const customNodes = config?.nodes as string[] | undefined;
    const inputPort = (config?.input as string) || 'data';
    const outputPort = (config?.output as string) || 'result';

    if (customNodes && Array.isArray(customNodes) && customNodes.length > 0) {
      return generateCustomTemplate(
        workflowName,
        asyncKeyword,
        returnType,
        customNodes,
        inputPort,
        outputPort
      );
    }

    // If only input/output are customized but no custom nodes
    if (inputPort !== 'data' || outputPort !== 'result') {
      return generateCustomTemplate(
        workflowName,
        asyncKeyword,
        returnType,
        ['validateData', 'transformData', 'outputResult'],
        inputPort,
        outputPort
      );
    }

    return generateDefaultTemplate(workflowName, asyncKeyword, returnType);
  },
};
