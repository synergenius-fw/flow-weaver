/**
 * Turning init's flags, defaults and prompts into an InitConfig.
 *
 * Each setting is decided in the order the questions are asked: project
 * name, persona, template (the --template flag, the expert list, or a use
 * case), the "Something else" description, editor integration, npm install,
 * git init and module format. A flag always wins. With --yes or without a
 * terminal every question takes its default. Otherwise the persona decides
 * which questions are asked: experts pick from the full template list and
 * choose install, git and format; everyone else picks a use case and is asked
 * about editor integration.
 */
import * as path from 'path';
import input from '@inquirer/input';
import select, { Separator } from '@inquirer/select';
import confirm from '@inquirer/confirm';
import { getAllWorkflowTemplates } from '../../templates/index.js';
import { logger } from '../../utils/logger.js';
import { isNonInteractive } from '../../utils/interactive.js';
import type { TModuleFormat } from '../../../ast/types.js';
import type { PersonaId } from '../init-personas.js';
import {
  PERSONA_CHOICES,
  PERSONA_CONFIRMATIONS,
  USE_CASE_CHOICES,
  selectTemplateForPersona,
  getTemplateSubChoices,
} from '../init-personas.js';
import { validateProjectName } from './naming.js';
import type { InitConfig, InitOptions } from './types.js';

// Dynamic: includes core templates plus any registered by extensions/packs
function getValidTemplates(): string[] {
  return getAllWorkflowTemplates().map((t) => t.id);
}
const VALID_PERSONAS: PersonaId[] = ['nocode', 'vibecoder', 'lowcode', 'expert'];
// Dynamic: includes core use cases plus any registered by extensions/packs
function getValidUseCases(): string[] {
  return USE_CASE_CHOICES.map((c) => c.value);
}

export async function resolveInitConfig(
  dirArg: string | undefined,
  options: InitOptions
): Promise<InitConfig> {
  const skipPrompts = options.yes || isNonInteractive();
  const force = options.force ?? false;

  const projectName = await resolveProjectName(dirArg, options, skipPrompts);
  const targetDir = path.resolve(dirArg ?? projectName);

  const persona = await resolvePersona(options, skipPrompts);
  if (!skipPrompts) announcePersona(persona);

  const { template, useCase } = await resolveTemplate(options, persona, skipPrompts);
  const useCaseDescription = await askUseCaseDescription(useCase, persona, skipPrompts);
  const mcp = await resolveMcp(options, persona, skipPrompts);
  const installDeps = await resolveExpertToggle(options.install, persona, skipPrompts, 'Install dependencies (npm install)?');
  const gitInit = await resolveExpertToggle(options.git, persona, skipPrompts, 'Initialize a git repository?');
  const format = await resolveFormat(options, persona, skipPrompts);

  return {
    projectName,
    targetDir,
    template,
    format,
    install: installDeps,
    git: gitInit,
    force,
    persona,
    useCase,
    useCaseDescription,
    mcp,
  };
}

/** --name, else the target directory's name, else asked (default my-project); then validated. */
async function resolveProjectName(
  dirArg: string | undefined,
  options: InitOptions,
  skipPrompts: boolean
): Promise<string> {
  let projectName: string;
  if (options.name) {
    projectName = options.name;
  } else if (dirArg) {
    projectName = path.basename(dirArg);
  } else if (skipPrompts) {
    projectName = 'my-project';
  } else {
    projectName = await input({
      message: 'Project name:',
      default: 'my-project',
      validate: (v) => validateProjectName(v),
    });
  }

  const valid = validateProjectName(projectName);
  if (valid !== true) {
    throw new Error(valid);
  }
  return projectName;
}

/** --preset, else expert when skipping prompts or given --template, else asked. */
async function resolvePersona(options: InitOptions, skipPrompts: boolean): Promise<PersonaId> {
  if (options.preset) {
    if (!VALID_PERSONAS.includes(options.preset as PersonaId)) {
      throw new Error(`Unknown preset "${options.preset}". Available: ${VALID_PERSONAS.join(', ')}`);
    }
    return options.preset as PersonaId;
  }
  if (skipPrompts || options.template) {
    return 'expert';
  }
  return select<PersonaId>({
    message: 'How do you plan to build?',
    choices: PERSONA_CHOICES,
    default: 'vibecoder',
  });
}

/** Prints the one-line summary of what the chosen persona gets (interactive only). */
function announcePersona(persona: PersonaId): void {
  const confirmation = PERSONA_CONFIRMATIONS[persona];
  if (confirmation) {
    logger.log(`  ${logger.dim(confirmation)}`);
    logger.newline();
  }
}

/**
 * The template, and the use case it came from for non-experts. --template
 * bypasses everything; experts pick from the flat list; everyone else picks
 * a use case, which maps to a template.
 */
async function resolveTemplate(
  options: InitOptions,
  persona: PersonaId,
  skipPrompts: boolean
): Promise<{ template: string; useCase?: string }> {
  if (options.template) {
    const template = options.template;
    if (!getValidTemplates().includes(template)) {
      throw new Error(`Unknown template "${template}". Available: ${getValidTemplates().join(', ')}`);
    }
    return { template };
  }
  if (persona === 'expert') {
    return { template: skipPrompts ? 'sequential' : await askExpertTemplate() };
  }
  const useCase = await resolveUseCase(options, skipPrompts);
  return { template: await pickUseCaseTemplate(persona, useCase, skipPrompts), useCase };
}

function askExpertTemplate(): Promise<string> {
  return select<string>({
    message: 'Workflow template:',
    choices: [
      new Separator('── Data Processing ──'),
      { value: 'sequential', name: 'sequential', description: 'Linear pipeline' },
      { value: 'foreach', name: 'foreach', description: 'Batch iteration' },
      { value: 'aggregator', name: 'aggregator', description: 'Collect and aggregate results' },
      new Separator('── Automation ──'),
      { value: 'conditional', name: 'conditional', description: 'Route by condition' },
      { value: 'approval', name: 'approval', description: 'Pause for a person to approve, then carry on' },
      new Separator('── AI ──'),
      { value: 'ai-agent', name: 'ai-agent', description: 'LLM agent with tool calling' },
      { value: 'ai-react', name: 'ai-react', description: 'ReAct pattern' },
      { value: 'ai-rag', name: 'ai-rag', description: 'Retrieval-Augmented Generation' },
      { value: 'ai-chat', name: 'ai-chat', description: 'Conversational AI' },
      new Separator('── Integration ──'),
      { value: 'webhook', name: 'webhook', description: 'HTTP webhook handler' },
      new Separator('── Utility ──'),
      { value: 'error-handler', name: 'error-handler', description: 'Error handling and recovery' },
    ],
    default: 'sequential',
  });
}

/** --use-case (validated), else data when skipping prompts, else asked. */
async function resolveUseCase(options: InitOptions, skipPrompts: boolean): Promise<string> {
  if (options.useCase) {
    if (!getValidUseCases().includes(options.useCase)) {
      throw new Error(`Unknown use case "${options.useCase}". Available: ${getValidUseCases().join(', ')}`);
    }
    return options.useCase;
  }
  if (skipPrompts) {
    return 'data';
  }
  return select<string>({
    message: 'What are you building?',
    choices: USE_CASE_CHOICES,
    default: 'data',
  });
}

/** The use case's template; low-code picks among several when the use case has more than one. */
async function pickUseCaseTemplate(persona: PersonaId, useCase: string, skipPrompts: boolean): Promise<string> {
  const selection = selectTemplateForPersona(persona, useCase);
  if (selection.choices && !skipPrompts) {
    return select<string>({
      message: 'Pick a template:',
      choices: getTemplateSubChoices(selection.choices),
      default: selection.template,
    });
  }
  return selection.template;
}

/** "Something else" follow-up: ask what they're building. Blank answers become undefined. */
async function askUseCaseDescription(
  useCase: string | undefined,
  persona: PersonaId,
  skipPrompts: boolean
): Promise<string | undefined> {
  if (useCase !== 'minimal' || skipPrompts || persona === 'expert') return undefined;
  const answer = await input({
    message: 'Briefly describe what you want to build:',
  });
  if (!answer) return undefined;
  return answer.trim() || undefined;
}

/** Editor (MCP) setup: --mcp, else asked of nocode, vibecoder and lowcode, else no. */
async function resolveMcp(options: InitOptions, persona: PersonaId, skipPrompts: boolean): Promise<boolean> {
  if (options.mcp !== undefined) return options.mcp;
  if (skipPrompts) return false;
  if (persona === 'nocode' || persona === 'vibecoder' || persona === 'lowcode') {
    return confirm({
      message: 'Set up AI editor integration? (Claude Code, Cursor, VS Code, etc.)',
      default: true,
    });
  }
  return false;
}

/** A yes/no step only experts are asked (npm install, git init): the flag wins, everyone else gets yes. */
async function resolveExpertToggle(
  flag: boolean | undefined,
  persona: PersonaId,
  skipPrompts: boolean,
  message: string
): Promise<boolean> {
  if (flag !== undefined) return flag;
  if (skipPrompts || persona !== 'expert') return true;
  return confirm({ message, default: true });
}

/** --format (esm or cjs), else asked of experts, else esm. */
async function resolveFormat(options: InitOptions, persona: PersonaId, skipPrompts: boolean): Promise<TModuleFormat> {
  if (options.format) {
    const format = options.format;
    if (format !== 'esm' && format !== 'cjs') {
      throw new Error(`Invalid format "${format}". Use "esm" or "cjs".`);
    }
    return format;
  }
  if (skipPrompts || persona !== 'expert') {
    return 'esm';
  }
  return select<TModuleFormat>({
    message: 'Module format:',
    choices: [
      { value: 'esm', name: 'ESM (Recommended)', description: 'ECMAScript modules (import/export)' },
      { value: 'cjs', name: 'CommonJS', description: 'CommonJS modules (require/module.exports)' },
    ],
    default: 'esm',
  });
}
