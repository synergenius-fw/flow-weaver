/**
 * Persona-specific logic for the init command.
 * Types, use-case mappings, template selection, and post-scaffold output.
 */

import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';
import { getAllWorkflowTemplates } from '../templates/index.js';
import { buildContext } from '../../context/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type PersonaId = 'nocode' | 'vibecoder' | 'lowcode' | 'expert';
export type UseCaseId = 'data' | 'ai' | 'api' | 'automation' | 'minimal';

// ── Prompt choices ───────────────────────────────────────────────────────────

export const PERSONA_CHOICES = [
  { value: 'nocode' as PersonaId, name: 'AI does everything', description: 'Describe in plain language, AI builds the workflow. Guided setup included.' },
  { value: 'vibecoder' as PersonaId, name: 'AI-assisted coding', description: 'Collaborate with AI, iterate by describing changes. Hands-on setup with AI.' },
  { value: 'lowcode' as PersonaId, name: 'Template-based', description: 'Pick a template, customize the code. AI helps with initial setup.' },
  { value: 'expert' as PersonaId, name: 'Full TypeScript', description: 'Write workflows from scratch. Minimal setup, full control.' },
];

/** One-liner printed after persona selection to set expectations. null = skip. */
export const PERSONA_CONFIRMATIONS: Record<PersonaId, string | null> = {
  nocode: 'AI will handle the code. You describe, it builds.',
  vibecoder: 'You and AI will build this together.',
  lowcode: 'Starting from a template, you customize from there.',
  expert: null,
};

export const USE_CASE_CHOICES = [
  { value: 'data' as UseCaseId, name: 'Data pipeline', description: 'Process, transform, and validate data' },
  { value: 'ai' as UseCaseId, name: 'AI agent', description: 'LLM with tools, reasoning, or retrieval' },
  { value: 'api' as UseCaseId, name: 'API / webhook', description: 'HTTP endpoints and integrations' },
  { value: 'automation' as UseCaseId, name: 'Automation', description: 'Conditional logic, error handling, routing' },
  { value: 'minimal' as UseCaseId, name: 'Something else', description: 'Start with a minimal template' },
];

// ── Template mapping ─────────────────────────────────────────────────────────

export interface UseCaseMapping {
  default: string;
  all: string[];
}

export const USE_CASE_TEMPLATES: Record<string, UseCaseMapping> = {
  data: { default: 'sequential', all: ['sequential', 'foreach', 'aggregator'] },
  ai: { default: 'ai-agent', all: ['ai-agent', 'ai-react', 'ai-rag', 'ai-chat'] },
  api: { default: 'webhook', all: ['webhook'] },
  automation: { default: 'conditional', all: ['conditional', 'error-handler'] },
  minimal: { default: 'sequential', all: ['sequential'] },
};

/**
 * Register a use case contributed by a pack.
 * Adds the use case choice and template mapping so it appears in fw init.
 */
export function registerPackUseCase(
  useCase: { id: string; name: string; description: string },
  templates: string[],
): void {
  // Add to choices if not already present
  if (!USE_CASE_CHOICES.some((c) => c.value === useCase.id)) {
    // Insert before "minimal" (last entry)
    const minimalIdx = USE_CASE_CHOICES.findIndex((c) => c.value === 'minimal');
    const entry = { value: useCase.id, name: useCase.name, description: useCase.description } as (typeof USE_CASE_CHOICES)[number];
    if (minimalIdx >= 0) {
      USE_CASE_CHOICES.splice(minimalIdx, 0, entry);
    } else {
      USE_CASE_CHOICES.push(entry);
    }
  }

  // Add template mapping
  if (!USE_CASE_TEMPLATES[useCase.id] && templates.length > 0) {
    USE_CASE_TEMPLATES[useCase.id] = {
      default: templates[0],
      all: templates,
    };
  }
}

/**
 * Select the template for a given persona and use-case.
 * For lowcode, returns the full list when the category has multiple templates.
 * For nocode/vibecoder, always returns the single default.
 */
export function selectTemplateForPersona(
  persona: PersonaId,
  useCase: UseCaseId | string,
): { template: string; choices?: string[] } {
  const mapping = USE_CASE_TEMPLATES[useCase];
  if (!mapping) {
    return { template: 'sequential' };
  }

  if (persona === 'lowcode' && mapping.all.length > 1) {
    return { template: mapping.default, choices: mapping.all };
  }

  return { template: mapping.default };
}

/**
 * Build the template sub-choice list for inquirer, when lowcode needs to pick
 * from multiple templates within a use-case category.
 */
export function getTemplateSubChoices(templateIds: string[]): Array<{ value: string; name: string; description: string }> {
  return templateIds.map((id) => {
    const tmpl = getAllWorkflowTemplates().find((t) => t.id === id);
    return {
      value: id,
      name: id,
      description: tmpl?.description ?? '',
    };
  });
}

// ── Workflow preview ─────────────────────────────────────────────────────────

/**
 * Extract @path annotations from generated workflow code and format as a
 * visual flow line. Falls back to extracting @node labels if no @path found.
 */
export function extractWorkflowPreview(workflowCode: string): string | null {
  // Try @path first
  const pathMatches = workflowCode.match(/@path\s+(.+)/g);
  if (pathMatches && pathMatches.length > 0) {
    // Use the first (main) path
    const raw = pathMatches[0].replace(/@path\s+/, '').trim();
    // Extract node instance IDs from the path
    const steps = raw.split(/\s*->\s*/);

    // Build a label map from @node annotations: @node instanceId nodeType [...]
    // and from @label annotations on node types
    const labelMap = buildLabelMap(workflowCode);

    const labeled = steps.map((step) => labelMap.get(step) ?? step);
    return labeled.join(' ──▶ ');
  }

  // Fallback: extract @node annotations and show them in order
  const nodeAnnotations = workflowCode.match(/@node\s+(\w+)\s+\w+/g);
  if (nodeAnnotations && nodeAnnotations.length > 0) {
    const labelMap = buildLabelMap(workflowCode);
    const names = nodeAnnotations.map((m) => {
      const id = m.replace(/@node\s+/, '').split(/\s+/)[0];
      return labelMap.get(id) ?? id;
    });
    return ['Start', ...names, 'Exit'].join(' ──▶ ');
  }

  return null;
}

/**
 * Build a map from node instance ID to display label.
 * Reads @node annotations to find the nodeType, then scans for @label on that nodeType.
 */
function buildLabelMap(code: string): Map<string, string> {
  const map = new Map<string, string>();
  map.set('Start', 'Start');
  map.set('Exit', 'Exit');

  // Parse @node instanceId nodeTypeName [...]
  const nodeRegex = /@node\s+(\w+)\s+(\w+)/g;
  const instanceToType = new Map<string, string>();
  let match: RegExpExecArray | null;
  while ((match = nodeRegex.exec(code)) !== null) {
    instanceToType.set(match[1], match[2]);
  }

  // Parse @label annotations from node type definitions
  // Pattern: function functionName(...) preceded by @label LabelText
  const labelRegex = /@label\s+(.+)\n[\s\S]*?function\s+(\w+)/g;
  const typeToLabel = new Map<string, string>();
  while ((match = labelRegex.exec(code)) !== null) {
    typeToLabel.set(match[2], match[1].trim());
  }

  // Map instance IDs to labels
  for (const [instanceId, typeName] of instanceToType) {
    const label = typeToLabel.get(typeName);
    if (label) {
      map.set(instanceId, label);
    }
  }

  return map;
}

// ── File descriptions ────────────────────────────────────────────────────────

export const FILE_DESCRIPTIONS: Record<string, string> = {
  'package.json': 'Dependencies and npm scripts',
  'tsconfig.json': 'TypeScript configuration',
  '.gitignore': 'Git ignore rules',
  '.flowweaver/config.yaml': 'Flow Weaver project settings',
  'src/main.ts': 'Runs the workflow with sample input',
};

/** Generate a description for a workflow file */
function workflowFileDesc(persona: PersonaId): string {
  if (persona === 'nocode') return 'Your workflow (AI will modify this for you)';
  return 'Your workflow definition';
}

// ── README generation ────────────────────────────────────────────────────────

export function generateReadme(projectName: string, persona: PersonaId, _template: string): string {
  const lines: string[] = [`# ${projectName}`, ''];

  if (persona === 'nocode') {
    lines.push(
      'A Flow Weaver workflow project configured for AI-assisted development.',
      '',
      '## Working with AI',
      '',
      'Open this project in your AI editor (Claude Code, Cursor, VS Code) and describe',
      'what you want to build:',
      '',
      '- "Create a workflow that processes customer orders"',
      '- "Add retry logic to the data pipeline"',
      '- "Show me a diagram of the current workflow"',
      '',
      'The AI has access to Flow Weaver\'s 48 tools and will create, modify, and validate',
      'workflows for you.',
      '',
    );
  } else if (persona === 'vibecoder') {
    lines.push(
      'A Flow Weaver workflow project.',
      '',
      '## Development',
      '',
      '```sh',
      'npm run dev       # Compile and run',
      'npm run compile   # Compile only',
      'npm run validate  # Check for errors',
      '```',
      '',
      '## AI-Assisted Editing',
      '',
      'With your AI editor connected, you can describe changes in plain language:',
      '',
      '- "Add error handling to the pipeline"',
      '- "Replace the mock LLM with OpenAI"',
      '- "Add a validation step before processing"',
      '',
    );
  } else if (persona === 'lowcode') {
    lines.push(
      'A Flow Weaver workflow project.',
      '',
      '## Development',
      '',
      '```sh',
      'npm run dev       # Compile and run',
      'npm run compile   # Compile only',
      'npm run validate  # Check for errors',
      '```',
      '',
      '## Templates',
      '',
      'Browse and add more workflows:',
      '',
      '```sh',
      'flow-weaver templates                         # List all templates',
      'flow-weaver create workflow <template> <file>  # Add a workflow',
      'flow-weaver describe src/*.ts --format ascii   # See workflow structure',
      '```',
      '',
    );
  } else {
    // expert: minimal
    lines.push(
      'A Flow Weaver workflow project.',
      '',
      '## Commands',
      '',
      '```sh',
      'npm run dev       # Compile and run',
      'npm run compile   # Compile only',
      'npm run validate  # Check for errors',
      '```',
      '',
    );
  }

  lines.push(
    '## Learn more',
    '',
    '- `flow-weaver docs` to browse reference documentation',
    '- `flow-weaver mcp-setup` to connect AI editors',
    '',
  );

  return lines.join('\n');
}

// ── Example workflow for lowcode persona ──────────────────────────────────────

export function generateExampleWorkflow(projectName: string): string {
  const name = projectName.replace(/[-_.]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^[^a-zA-Z_$]+/, '')
    .replace(/^./, (c) => c.toLowerCase());
  const fnName = (name || 'example') + 'Example';

  return `/**
 * Example: a minimal workflow to study and experiment with.
 * Copy patterns from here into your main workflow.
 */

/**
 * @flowWeaver nodeType
 * @expression
 * @label Greet
 * @input name [order:0] - Name to greet
 * @output greeting [order:0] - Greeting message
 */
function greet(name: string): { greeting: string } {
  return { greeting: \`Hello, \${name}!\` };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Uppercase
 * @input text [order:0] - Text to uppercase
 * @output result [order:0] - Uppercased text
 */
function uppercase(text: string): { result: string } {
  return { result: text.toUpperCase() };
}

/**
 * @flowWeaver workflow
 * @node greeter greet [position: -200 0]
 * @node upper uppercase [position: 100 0]
 * @position Start -500 0
 * @position Exit 400 0
 * @path Start -> greeter -> upper -> Exit
 * @connect greeter.greeting -> upper.text
 * @param execute [order:0] - Execute
 * @param name [order:1] - Name to greet
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns result [order:2] - Final greeting
 */
export function ${fnName}(
  execute: boolean,
  params: { name: string }
): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error("Compile with: flow-weaver compile <file>");
}
`;
}

// ── Post-scaffold output ─────────────────────────────────────────────────────

export interface PrintNextStepsOptions {
  projectName: string;
  persona: PersonaId;
  template: string;
  displayDir: string | null;
  installSkipped: boolean;
  workflowCode: string | null;
  workflowFile: string;
  mcpConfigured?: string[];
  /** When true, skip persona-specific guidance (the agent handles it) */
  agentLaunched?: boolean;
  /** When true, the workflow was auto-compiled and npm start works immediately */
  compiled?: boolean;
}

export function printNextSteps(opts: PrintNextStepsOptions): void {
  const { projectName, persona, displayDir, installSkipped, workflowCode, workflowFile, agentLaunched, compiled } = opts;

  // Workflow preview
  if (workflowCode) {
    const preview = extractWorkflowPreview(workflowCode);
    if (preview) {
      logger.newline();
      logger.log(`  ${logger.bold('Your workflow')}`);
      logger.newline();
      logger.log(`    ${logger.dim(preview)}`);
    }
  }

  // File descriptions (non-expert only)
  if (persona !== 'expert') {
    logger.newline();
    logger.log(`  ${logger.bold('Project files')}`);
    logger.newline();
    const wfDesc = workflowFileDesc(persona);
    logger.log(`    ${logger.highlight(`src/${workflowFile}`)}${pad(`src/${workflowFile}`, 32)}${wfDesc}`);
    logger.log(`    ${logger.highlight('src/main.ts')}${pad('src/main.ts', 32)}${FILE_DESCRIPTIONS['src/main.ts']}`);
    logger.log(`    ${logger.highlight('package.json')}${pad('package.json', 32)}${FILE_DESCRIPTIONS['package.json']}`);
    logger.log(`    ${logger.highlight('tsconfig.json')}${pad('tsconfig.json', 32)}${FILE_DESCRIPTIONS['tsconfig.json']}`);
  }

  // Next steps
  logger.newline();
  logger.log(`  ${logger.bold('Next steps')}`);
  logger.newline();

  if (displayDir) {
    logger.log(`    cd ${displayDir}`);
  }
  if (installSkipped) {
    logger.log('    npm install');
  }
  if (compiled) {
    logger.log(`    npm start${' '.repeat(14)}${logger.dim('Run your compiled workflow')}`);
    logger.log(`    npm run dev${' '.repeat(12)}${logger.dim('Recompile + run (after editing)')}`);
  } else {
    logger.log('    npm run dev');
  }

  // Persona-specific guidance (skip if agent was launched, it handles this)
  if (!agentLaunched) {
    if (persona === 'nocode') {
      printNocodeGuidance(projectName);
    } else if (persona === 'vibecoder') {
      printVibecoderGuidance();
    } else if (persona === 'lowcode') {
      printLowcodeGuidance();
    } else {
      printExpertGuidance();
    }
  }

  logger.newline();
}

function printNocodeGuidance(_projectName: string): void {
  logger.newline();
  logger.log(`  ${logger.bold('Your project is ready for AI-assisted building.')}`);
  logger.log('  Open it in your AI editor and describe what you want:');
  logger.newline();
  logger.log(`    ${logger.dim('"Change this to fetch data from an API and validate the response"')}`);
  logger.log(`    ${logger.dim('"Add error handling so failures get logged and retried"')}`);
  logger.log(`    ${logger.dim('"Show me a diagram of my workflow"')}`);
  logger.newline();
  logger.log(`  ${logger.bold('Useful commands')}`);
  logger.newline();
  logger.log(`    flow-weaver run src/*.ts         ${logger.dim('Run your workflow')}`);
  logger.log(`    flow-weaver diagram src/*.ts     ${logger.dim('See a visual diagram')}`);
  logger.log(`    flow-weaver mcp-setup            ${logger.dim('Connect more AI editors')}`);
}

function printVibecoderGuidance(): void {
  logger.newline();
  logger.log(`  ${logger.bold('Describe what you want, AI handles the code.')}`);
  logger.newline();
  logger.log(`    ${logger.dim('"Add a retry loop when the model call fails"')}`);
  logger.log(`    ${logger.dim('"Connect this to a Postgres database"')}`);
  logger.log(`    ${logger.dim('"Show me a diagram of the current workflow"')}`);
  logger.newline();
  logger.log(`  ${logger.bold('When you want to see the structure')}`);
  logger.newline();
  logger.log(`    npm run diagram                  ${logger.dim('Visual diagram of your workflow')}`);
}

function printLowcodeGuidance(): void {
  logger.newline();
  logger.log(`  ${logger.bold('Explore and customize')}`);
  logger.newline();
  logger.log(`    flow-weaver templates            ${logger.dim('List all 16 workflow templates')}`);
  logger.log(`    flow-weaver describe src/*.ts     ${logger.dim('See the workflow structure')}`);
  logger.log(`    flow-weaver docs annotations     ${logger.dim('Annotation reference')}`);
  logger.newline();
  logger.log(`  Your project includes an example in ${logger.highlight('examples/')} to study.`);
  logger.log(`  With MCP connected, AI can help modify nodes and connections.`);
}

function printExpertGuidance(): void {
  logger.newline();
  logger.log(`    flow-weaver mcp-setup            ${logger.dim('Connect AI editors (Claude, Cursor, VS Code)')}`);
  logger.log(`    flow-weaver docs                 ${logger.dim('Browse reference docs')}`);
}

/** Pad a filename to align descriptions */
function pad(displayName: string, width: number): string {
  const padding = Math.max(1, width - displayName.length);
  return ' '.repeat(padding);
}

// ── Agent handoff ─────────────────────────────────────────────────────────────

/** Maps each persona to the fw_context preset used for agent knowledge bootstrap. */
export const AGENT_CONTEXT_PRESETS: Record<PersonaId, string> = {
  nocode: 'core',
  vibecoder: 'authoring',
  lowcode: 'authoring',
  expert: 'authoring',
};

const AGENT_PROMPTS: Record<PersonaId, string> = {
  nocode: `Before doing anything else, call fw_context(preset="core", profile="assistant") to learn Flow Weaver's annotation syntax and workflow conventions.

I just created a new Flow Weaver project called "{name}" using the {template} template.
Help me set it up step by step:

1. Show the current workflow as a diagram (use fw_diagram, ascii-compact)
2. Walk me through what each step does in plain language
3. Ask me what I want this workflow to do
4. Based on my answer:
   - Customize the workflow (add/remove/rename steps with fw_modify)
   - Implement each step with real working code (fw_implement_node)
   - Set up supporting files if needed (.env template, basic tests)
5. Show the final result as a step list and diagram

Keep everything in plain language. Don't show code unless I ask.`,

  vibecoder: `Before doing anything else, call fw_context(preset="authoring", profile="assistant") to load Flow Weaver reference.

I just created a new Flow Weaver project called "{name}" using the {template} template.
Let's set it up together:

1. Show the workflow diagram and briefly explain the structure
2. Ask what I want to build, then iterate with me
3. Customize the workflow, implement the nodes, add supporting files
4. Show code when it's relevant, I'm comfortable reading and tweaking it
5. Show the final diagram when we're done`,

  lowcode: `Before doing anything else, call fw_context(preset="authoring", profile="assistant") to load Flow Weaver reference.

I just created a new Flow Weaver project called "{name}" using the {template} template.
Help me customize it:

1. Show the workflow diagram and explain what the template gives me
2. Ask what I want this workflow to do
3. Customize: rename nodes, adjust connections, implement the functions
4. Add supporting files if needed (.env, tests)
5. Show the final diagram

I prefer working from templates and making targeted changes.`,

  expert: `Before doing anything else, call fw_context(preset="authoring", profile="assistant") to load Flow Weaver reference.

New Flow Weaver project "{name}" (template: {template}).
Show the workflow diagram and current implementation status (fw_workflow_status).
Then ask what I'd like to build.`,
};

/**
 * Generate the initial prompt for a CLI agent (Claude Code, Codex).
 * Interpolates project name and template into the persona-specific template.
 */
export function generateAgentPrompt(projectName: string, persona: PersonaId, template: string, useCaseDescription?: string): string {
  let prompt = AGENT_PROMPTS[persona]
    .replace(/\{name\}/g, projectName)
    .replace(/\{template\}/g, template);
  if (useCaseDescription) {
    // Insert the user's description after the template mention line
    prompt = prompt.replace(
      /(using the .+ template\.?\n)/,
      `$1The user wants to build: ${useCaseDescription}\n`,
    );
  }
  return prompt;
}

/**
 * Generate a shorter prompt suitable for pasting into a GUI editor.
 * Persona-aware but more concise than the full agent prompt.
 */
export function generateEditorPrompt(projectName: string, persona: PersonaId, template: string, useCaseDescription?: string): string {
  const preset = AGENT_CONTEXT_PRESETS[persona];
  const bootstrap = `Start by calling fw_context(preset="${preset}", profile="assistant") to learn Flow Weaver.`;
  const desc = useCaseDescription ? ` I want to build: ${useCaseDescription}.` : '';
  if (persona === 'nocode') {
    return `${bootstrap}\nThis is a Flow Weaver project called "${projectName}" using the ${template} template.${desc} Show me the workflow diagram, walk me through what each step does in plain language, then ask me what I want to build. Keep it simple, no code.`;
  }
  if (persona === 'vibecoder') {
    return `${bootstrap}\nThis is a Flow Weaver project called "${projectName}" using the ${template} template.${desc} Show me the workflow diagram, then let's iterate on it together. I'll describe what I want and you handle the implementation.`;
  }
  if (persona === 'lowcode') {
    return `${bootstrap}\nThis is a Flow Weaver project called "${projectName}" using the ${template} template.${desc} Show me the workflow diagram and explain the template, then help me customize it for my use case.`;
  }
  return `${bootstrap}\nFlow Weaver project "${projectName}" (template: ${template}). Show the workflow diagram and implementation status.`;
}

/**
 * Generate the full content for a PROJECT_SETUP.md file.
 * Includes the agent prompt plus project context.
 */
export function generateSetupPromptFile(
  projectName: string,
  persona: PersonaId,
  template: string,
  filesCreated: string[],
  useCaseDescription?: string,
): string {
  const prompt = generateAgentPrompt(projectName, persona, template, useCaseDescription);

  // Embed Flow Weaver knowledge directly so the file is self-contained.
  // GUI editors may not have MCP tools configured when first reading this file.
  const contextResult = buildContext({ preset: 'core', profile: 'assistant' });

  const lines = [
    `# ${projectName} Setup`,
    '',
    'Paste this into your AI editor chat, or ask it to "follow the instructions in PROJECT_SETUP.md".',
    '',
    '---',
    '',
    prompt,
    '',
    '---',
    '',
    '## Flow Weaver Reference',
    '',
    'The following is embedded Flow Weaver documentation so you can work with this project',
    'even before MCP tools are connected. For deeper topics, call `fw_docs` once MCP is available.',
    '',
    contextResult.content,
    '',
    '---',
    '',
    '## Project context',
    '',
    `- **Template**: ${template}`,
    `- **Persona**: ${persona}`,
    '',
    '### Files created',
    '',
    ...filesCreated.map((f) => `- \`${f}\``),
    '',
    '### Available Flow Weaver MCP tools',
    '',
    'Your AI editor has access to 48 Flow Weaver tools including:',
    '- `fw_diagram` - Generate workflow diagrams',
    '- `fw_modify` / `fw_modify_batch` - Add/remove/rename nodes and connections',
    '- `fw_implement_node` - Write function bodies for stub nodes',
    '- `fw_validate` - Check for errors',
    '- `fw_compile` - Generate executable code',
    '- `fw_describe` - Inspect workflow structure',
    '',
    '*Delete this file after your initial setup is complete.*',
    '',
  ];
  return lines.join('\n');
}

/**
 * Print a copyable prompt in a bordered box.
 * Long lines are word-wrapped to fit within the box.
 */
export function printCopyablePrompt(prompt: string): void {
  const maxInner = 70; // content width inside the box
  const wrapped: string[] = [];
  for (const raw of prompt.split('\n')) {
    if (raw.length <= maxInner) {
      wrapped.push(raw);
    } else {
      // Word-wrap at maxInner
      let remaining = raw;
      while (remaining.length > maxInner) {
        let breakAt = remaining.lastIndexOf(' ', maxInner);
        if (breakAt <= 0) breakAt = maxInner;
        wrapped.push(remaining.slice(0, breakAt));
        remaining = remaining.slice(breakAt).replace(/^ /, '');
      }
      if (remaining) wrapped.push(remaining);
    }
  }

  const width = maxInner + 2; // +2 for padding inside borders

  logger.newline();
  logger.log(`  ${logger.bold('Paste this into your AI editor to get started:')}`);
  logger.newline();
  logger.log(`  ${'┌' + '─'.repeat(width) + '┐'}`);
  for (const line of wrapped) {
    const padded = line + ' '.repeat(Math.max(0, maxInner - line.length));
    logger.log(`  │ ${padded} │`);
  }
  logger.log(`  ${'└' + '─'.repeat(width) + '┘'}`);

  // Auto-copy to clipboard (best-effort)
  try {
    const clipCmd = process.platform === 'darwin' ? 'pbcopy'
      : process.platform === 'linux' ? 'xclip -selection clipboard'
      : null;
    if (clipCmd) {
      execSync(clipCmd, { input: prompt, stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000 });
      logger.newline();
      logger.success('Copied to clipboard');
    }
  } catch {
    // Clipboard not available, box is still there
  }
}

/** Default for the "Launch agent?" confirm prompt per persona */
export const AGENT_LAUNCH_DEFAULTS: Record<PersonaId, boolean> = {
  nocode: true,
  vibecoder: true,
  lowcode: true,
  expert: false,
};
