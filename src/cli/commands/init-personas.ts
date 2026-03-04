/**
 * Persona-specific logic for the init command.
 * Types, use-case mappings, template selection, and post-scaffold output.
 */

import { logger } from '../utils/logger.js';
import { workflowTemplates } from '../templates/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type PersonaId = 'nocode' | 'vibecoder' | 'lowcode' | 'expert';
export type UseCaseId = 'data' | 'ai' | 'api' | 'automation' | 'cicd' | 'minimal';

// ── Prompt choices ───────────────────────────────────────────────────────────

export const PERSONA_CHOICES = [
  { value: 'nocode' as PersonaId, name: 'AI does everything', description: 'Describe in plain language, AI writes the code' },
  { value: 'vibecoder' as PersonaId, name: 'AI-assisted coding', description: 'Work with AI tools, iterate by describing changes' },
  { value: 'lowcode' as PersonaId, name: 'Template-based', description: 'Pick a template, customize the generated code' },
  { value: 'expert' as PersonaId, name: 'Full TypeScript', description: 'Write workflows from scratch with the full CLI' },
];

export const USE_CASE_CHOICES = [
  { value: 'data' as UseCaseId, name: 'Data pipeline', description: 'Process, transform, and validate data' },
  { value: 'ai' as UseCaseId, name: 'AI agent', description: 'LLM with tools, reasoning, or retrieval' },
  { value: 'api' as UseCaseId, name: 'API / webhook', description: 'HTTP endpoints and integrations' },
  { value: 'automation' as UseCaseId, name: 'Automation', description: 'Conditional logic, error handling, routing' },
  { value: 'cicd' as UseCaseId, name: 'CI/CD pipeline', description: 'Test, build, and deploy workflows' },
  { value: 'minimal' as UseCaseId, name: 'Something else', description: 'Start with a minimal template' },
];

// ── Template mapping ─────────────────────────────────────────────────────────

export interface UseCaseMapping {
  default: string;
  all: string[];
}

export const USE_CASE_TEMPLATES: Record<UseCaseId, UseCaseMapping> = {
  data: { default: 'sequential', all: ['sequential', 'foreach', 'aggregator'] },
  ai: { default: 'ai-agent', all: ['ai-agent', 'ai-react', 'ai-rag', 'ai-chat'] },
  api: { default: 'webhook', all: ['webhook'] },
  automation: { default: 'conditional', all: ['conditional', 'error-handler'] },
  cicd: { default: 'cicd-test-deploy', all: ['cicd-test-deploy', 'cicd-docker', 'cicd-multi-env', 'cicd-matrix'] },
  minimal: { default: 'sequential', all: ['sequential'] },
};

/**
 * Select the template for a given persona and use-case.
 * For lowcode, returns the full list when the category has multiple templates.
 * For nocode/vibecoder, always returns the single default.
 */
export function selectTemplateForPersona(
  persona: PersonaId,
  useCase: UseCaseId,
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
    const tmpl = workflowTemplates.find((t) => t.id === id);
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
}

export function printNextSteps(opts: PrintNextStepsOptions): void {
  const { projectName, persona, displayDir, installSkipped, workflowCode, workflowFile } = opts;

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
    logger.log(`    ${logger.highlight(`src/${workflowFile}`)}${pad(workflowFile, 32)}${wfDesc}`);
    logger.log(`    ${logger.highlight('src/main.ts')}${pad('main.ts', 32)}${FILE_DESCRIPTIONS['src/main.ts']}`);
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
  logger.log('    npm run dev');

  // Persona-specific guidance
  if (persona === 'nocode') {
    printNocodeGuidance(projectName);
  } else if (persona === 'vibecoder') {
    printVibecoderGuidance();
  } else if (persona === 'lowcode') {
    printLowcodeGuidance();
  } else {
    printExpertGuidance();
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
  logger.log('  With your AI editor connected, try:');
  logger.newline();
  logger.log(`    ${logger.dim('"Add a retry loop when the model call fails"')}`);
  logger.log(`    ${logger.dim('"Add a tool that searches a knowledge base"')}`);
  logger.newline();
  logger.log(`  ${logger.bold('Commands you\'ll use')}`);
  logger.newline();
  logger.log(`    flow-weaver diagram src/*.ts     ${logger.dim('See a visual diagram')}`);
  logger.log(`    flow-weaver validate src/*.ts    ${logger.dim('Check for errors')}`);
  logger.log(`    flow-weaver templates            ${logger.dim('Browse all templates')}`);
}

function printLowcodeGuidance(): void {
  logger.newline();
  logger.log(`  ${logger.bold('Explore and learn')}`);
  logger.newline();
  logger.log(`    flow-weaver templates            ${logger.dim('List all 16 workflow templates')}`);
  logger.log(`    flow-weaver create workflow ...   ${logger.dim('Add another workflow')}`);
  logger.log(`    flow-weaver describe src/*.ts     ${logger.dim('See workflow structure')}`);
  logger.log(`    flow-weaver docs annotations     ${logger.dim('Read the annotation reference')}`);
  logger.newline();
  logger.log(`  Your project includes an example in ${logger.highlight('examples/')} to study.`);
}

function printExpertGuidance(): void {
  logger.newline();
  logger.log(`    flow-weaver mcp-setup            ${logger.dim('Connect AI editors (Claude, Cursor, VS Code)')}`);
  logger.log(`    flow-weaver docs                 ${logger.dim('Browse reference docs')}`);
}

/** Pad a filename to align descriptions */
function pad(name: string, width: number): string {
  const padding = Math.max(1, width - name.length - 4); // 4 for "src/" prefix
  return ' '.repeat(padding);
}
