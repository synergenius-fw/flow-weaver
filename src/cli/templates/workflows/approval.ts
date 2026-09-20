/**
 * Approval Template
 * A request is prepared, a person approves or refuses it at a durable gate,
 * and the approved request is carried out. The run pauses at the gate and
 * resumes -- from the console, over HTTP, or from an assistant -- with the
 * approver's note.
 */

import type { WorkflowTemplate, WorkflowTemplateOptions, ConfigSchema } from '../index';

const configSchema: ConfigSchema = {
  input: {
    type: 'string',
    label: 'Input Port Name',
    description: 'Name of the parameter that carries what needs approval',
    default: 'request',
    placeholder: 'request',
  },
  output: {
    type: 'string',
    label: 'Output Port Name',
    description: 'Name of the return value',
    default: 'outcome',
    placeholder: 'outcome',
  },
};

export const approvalTemplate: WorkflowTemplate = {
  id: 'approval',
  name: 'Approval',
  description: 'Prepare a request, pause for a person to approve it, then carry it out',
  category: 'automation',
  configSchema,
  generate: (opts: WorkflowTemplateOptions): string => {
    const { workflowName, config } = opts;
    const input = (config?.input as string) || 'request';
    const output = (config?.output as string) || 'outcome';
    // A gated workflow is always async: the run pauses and resumes.
    return `
/**
 * Summarises the ${input} for the person who will decide.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Prepare
 * @input ${input} - What needs approval
 * @output summary - One line for the approver
 * @output ${input} - The same, passed on
 */
function prepare${cap(input)}(${input}: any): { summary: string; ${input}: any } {
  // TODO: say what is being asked, in one line
  return { summary: typeof ${input} === 'string' ? ${input} : JSON.stringify(${input}), ${input} };
}

/**
 * A person approves or refuses. The run pauses here and resumes with the
 * answer: the approver's note on onSuccess, or a refusal along onFailure.
 * The body never runs; the coordinator substitutes the answer.
 *
 * @flowWeaver nodeType
 * @durableGate approval
 * @label Approve
 * @input summary - What the approver sees
 * @output note - What the approver said
 */
async function approve(
  execute: boolean,
  summary: string
): Promise<{ onSuccess: boolean; onFailure: boolean; note: string }> {
  throw new Error(\`durable gate: never executes (\${execute}:\${summary})\`);
}

/**
 * Carries out the approved ${input}.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Apply
 * @input ${input} - The approved ${input}, from Prepare
 * @input note - The approver's note
 * @output ${output} - What happened
 */
function apply${cap(input)}(${input}: any, note: string): { ${output}: string } {
  // TODO: do the thing
  return { ${output}: \`applied \${JSON.stringify(${input})} -- \${note}\` };
}

/**
 * @flowWeaver workflow
 * @node prepare prepare${cap(input)} [color: "blue"] [icon: "description"]
 * @node approval approve [color: "purple"] [icon: "how_to_reg"]
 * @node apply apply${cap(input)} [color: "green"] [icon: "task_alt"]
 * @path Start -> prepare -> approval -> apply -> Exit
 * @path approval:fail -> Exit
 * @param ${input} - What needs approval
 * @returns ${output} - What happened
 */
export async function ${workflowName}(
  execute: boolean,
  params: { ${input}: any }
): Promise<{ onSuccess: boolean; onFailure: boolean; ${output}: string }> {
  throw new Error("Compile with: fw compile <file>");
}
`.trim();
  },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
