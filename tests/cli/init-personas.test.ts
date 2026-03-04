/**
 * Tests for init-personas module
 * Pure function tests for persona types, template mapping, and output generation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PERSONA_CHOICES,
  PERSONA_CONFIRMATIONS,
  USE_CASE_CHOICES,
  USE_CASE_TEMPLATES,
  selectTemplateForPersona,
  getTemplateSubChoices,
  extractWorkflowPreview,
  generateReadme,
  generateExampleWorkflow,
  printNextSteps,
  FILE_DESCRIPTIONS,
  generateAgentPrompt,
  generateEditorPrompt,
  generateSetupPromptFile,
  printCopyablePrompt,
  AGENT_LAUNCH_DEFAULTS,
  AGENT_CONTEXT_PRESETS,
} from '../../src/cli/commands/init-personas';
import type { PersonaId, UseCaseId } from '../../src/cli/commands/init-personas';
import { workflowTemplates } from '../../src/cli/templates/index';

// ── PERSONA_CHOICES ──────────────────────────────────────────────────────────

describe('PERSONA_CHOICES', () => {
  it('should have 4 personas', () => {
    expect(PERSONA_CHOICES).toHaveLength(4);
  });

  it('should include all persona IDs', () => {
    const ids = PERSONA_CHOICES.map((c) => c.value);
    expect(ids).toContain('nocode');
    expect(ids).toContain('vibecoder');
    expect(ids).toContain('lowcode');
    expect(ids).toContain('expert');
  });

  it('should have descriptions for all choices', () => {
    for (const choice of PERSONA_CHOICES) {
      expect(choice.description).toBeTruthy();
    }
  });
});

// ── USE_CASE_CHOICES ─────────────────────────────────────────────────────────

describe('USE_CASE_CHOICES', () => {
  it('should have 6 use cases', () => {
    expect(USE_CASE_CHOICES).toHaveLength(6);
  });

  it('should include all use case IDs', () => {
    const ids = USE_CASE_CHOICES.map((c) => c.value);
    expect(ids).toContain('data');
    expect(ids).toContain('ai');
    expect(ids).toContain('api');
    expect(ids).toContain('automation');
    expect(ids).toContain('cicd');
    expect(ids).toContain('minimal');
  });
});

// ── USE_CASE_TEMPLATES ───────────────────────────────────────────────────────

describe('USE_CASE_TEMPLATES', () => {
  const validTemplateIds = new Set(workflowTemplates.map((t) => t.id));

  it('should have mappings for all use cases', () => {
    const useCases: UseCaseId[] = ['data', 'ai', 'api', 'automation', 'cicd', 'minimal'];
    for (const uc of useCases) {
      expect(USE_CASE_TEMPLATES[uc]).toBeDefined();
      expect(USE_CASE_TEMPLATES[uc].default).toBeTruthy();
      expect(USE_CASE_TEMPLATES[uc].all.length).toBeGreaterThan(0);
    }
  });

  it('should reference only valid template IDs', () => {
    for (const [, mapping] of Object.entries(USE_CASE_TEMPLATES)) {
      expect(validTemplateIds.has(mapping.default)).toBe(true);
      for (const id of mapping.all) {
        expect(validTemplateIds.has(id)).toBe(true);
      }
    }
  });

  it('should include the default in the all list', () => {
    for (const [, mapping] of Object.entries(USE_CASE_TEMPLATES)) {
      expect(mapping.all).toContain(mapping.default);
    }
  });
});

// ── selectTemplateForPersona ─────────────────────────────────────────────────

describe('selectTemplateForPersona', () => {
  it('should return default template for nocode persona', () => {
    const result = selectTemplateForPersona('nocode', 'data');
    expect(result.template).toBe('sequential');
    expect(result.choices).toBeUndefined();
  });

  it('should return default template for vibecoder persona', () => {
    const result = selectTemplateForPersona('vibecoder', 'ai');
    expect(result.template).toBe('ai-agent');
    expect(result.choices).toBeUndefined();
  });

  it('should return choices for lowcode persona when category has multiple templates', () => {
    const result = selectTemplateForPersona('lowcode', 'ai');
    expect(result.template).toBe('ai-agent');
    expect(result.choices).toBeDefined();
    expect(result.choices).toContain('ai-agent');
    expect(result.choices).toContain('ai-react');
    expect(result.choices).toContain('ai-rag');
    expect(result.choices).toContain('ai-chat');
  });

  it('should not return choices for lowcode when category has one template', () => {
    const result = selectTemplateForPersona('lowcode', 'api');
    expect(result.template).toBe('webhook');
    expect(result.choices).toBeUndefined();
  });

  it('should return sequential for unknown use case', () => {
    const result = selectTemplateForPersona('nocode', 'unknown' as UseCaseId);
    expect(result.template).toBe('sequential');
  });

  it.each([
    ['nocode', 'data', 'sequential'],
    ['nocode', 'ai', 'ai-agent'],
    ['nocode', 'api', 'webhook'],
    ['nocode', 'automation', 'conditional'],
    ['nocode', 'cicd', 'cicd-test-deploy'],
    ['nocode', 'minimal', 'sequential'],
    ['vibecoder', 'data', 'sequential'],
    ['vibecoder', 'ai', 'ai-agent'],
    ['lowcode', 'data', 'sequential'],
    ['lowcode', 'automation', 'conditional'],
  ] as [PersonaId, UseCaseId, string][])(
    'should select %s template for persona=%s useCase=%s',
    (persona, useCase, expected) => {
      const result = selectTemplateForPersona(persona, useCase);
      expect(result.template).toBe(expected);
    }
  );
});

// ── getTemplateSubChoices ────────────────────────────────────────────────────

describe('getTemplateSubChoices', () => {
  it('should return choices with descriptions', () => {
    const choices = getTemplateSubChoices(['ai-agent', 'ai-react']);
    expect(choices).toHaveLength(2);
    expect(choices[0].value).toBe('ai-agent');
    expect(choices[0].description).toBeTruthy();
    expect(choices[1].value).toBe('ai-react');
  });

  it('should handle unknown template IDs gracefully', () => {
    const choices = getTemplateSubChoices(['nonexistent']);
    expect(choices).toHaveLength(1);
    expect(choices[0].value).toBe('nonexistent');
    expect(choices[0].description).toBe('');
  });
});

// ── extractWorkflowPreview ───────────────────────────────────────────────────

describe('extractWorkflowPreview', () => {
  it('should extract flow from @path annotation', () => {
    const code = `
/**
 * @flowWeaver workflow
 * @node validator validateData [position: -300 0]
 * @node transformer transformData [position: 0 0]
 * @path Start -> validator -> transformer -> Exit
 */
`;
    const preview = extractWorkflowPreview(code);
    expect(preview).toContain('Start');
    expect(preview).toContain('──▶');
    expect(preview).toContain('Exit');
  });

  it('should use labels from @label annotations', () => {
    const code = `
/**
 * @flowWeaver nodeType
 * @label Validate
 */
function validateData() {}

/**
 * @flowWeaver nodeType
 * @label Transform
 */
function transformData() {}

/**
 * @flowWeaver workflow
 * @node validator validateData [position: -300 0]
 * @node transformer transformData [position: 0 0]
 * @path Start -> validator -> transformer -> Exit
 */
`;
    const preview = extractWorkflowPreview(code);
    expect(preview).toContain('Validate');
    expect(preview).toContain('Transform');
  });

  it('should fall back to @node annotations when no @path', () => {
    const code = `
/**
 * @flowWeaver workflow
 * @node loop agentLoop [position: 0 0]
 * @node llm callLLM [position: 100 0]
 * @connect Start.execute -> loop.execute
 */
`;
    const preview = extractWorkflowPreview(code);
    expect(preview).toBeTruthy();
    expect(preview).toContain('Start');
    expect(preview).toContain('Exit');
  });

  it('should return null for code with no annotations', () => {
    const preview = extractWorkflowPreview('function foo() {}');
    expect(preview).toBeNull();
  });
});

// ── generateReadme ───────────────────────────────────────────────────────────

describe('generateReadme', () => {
  it('should include project name as heading', () => {
    const readme = generateReadme('my-project', 'expert', 'sequential');
    expect(readme).toContain('# my-project');
  });

  it('should include AI guidance for nocode persona', () => {
    const readme = generateReadme('my-project', 'nocode', 'sequential');
    expect(readme).toContain('Working with AI');
    expect(readme).toContain('AI editor');
  });

  it('should include AI-assisted section for vibecoder persona', () => {
    const readme = generateReadme('my-project', 'vibecoder', 'ai-agent');
    expect(readme).toContain('AI-Assisted Editing');
  });

  it('should include template section for lowcode persona', () => {
    const readme = generateReadme('my-project', 'lowcode', 'sequential');
    expect(readme).toContain('Templates');
    expect(readme).toContain('flow-weaver templates');
  });

  it('should be minimal for expert persona', () => {
    const readme = generateReadme('my-project', 'expert', 'sequential');
    expect(readme).not.toContain('Working with AI');
    expect(readme).not.toContain('Templates');
    expect(readme).toContain('Commands');
  });

  it('should always include learn more section', () => {
    for (const persona of ['nocode', 'vibecoder', 'lowcode', 'expert'] as PersonaId[]) {
      const readme = generateReadme('test', persona, 'sequential');
      expect(readme).toContain('Learn more');
    }
  });
});

// ── generateExampleWorkflow ──────────────────────────────────────────────────

describe('generateExampleWorkflow', () => {
  it('should generate valid workflow annotations', () => {
    const code = generateExampleWorkflow('my-project');
    expect(code).toContain('@flowWeaver workflow');
    expect(code).toContain('@flowWeaver nodeType');
    expect(code).toContain('@path Start');
    expect(code).toContain('-> Exit');
  });

  it('should derive function name from project name', () => {
    const code = generateExampleWorkflow('data-pipeline');
    expect(code).toContain('dataPipelineExample');
  });

  it('should generate compilable exports', () => {
    const code = generateExampleWorkflow('test');
    expect(code).toContain('export function');
  });
});

// ── FILE_DESCRIPTIONS ────────────────────────────────────────────────────────

describe('FILE_DESCRIPTIONS', () => {
  it('should have descriptions for standard files', () => {
    expect(FILE_DESCRIPTIONS['package.json']).toBeTruthy();
    expect(FILE_DESCRIPTIONS['tsconfig.json']).toBeTruthy();
    expect(FILE_DESCRIPTIONS['src/main.ts']).toBeTruthy();
  });
});

// ── printNextSteps ───────────────────────────────────────────────────────────

describe('printNextSteps', () => {
  let logs: string[];
  const originalLog = console.log;
  const originalWarn = console.warn;

  beforeEach(() => {
    logs = [];
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.warn = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
  });

  const baseOpts = {
    projectName: 'test-project',
    template: 'sequential',
    displayDir: 'test-project',
    installSkipped: false,
    workflowFile: 'test-project-workflow.ts',
    workflowCode: '/** @path Start -> validator -> transformer -> Exit */',
  };

  it('should show workflow preview for all personas', () => {
    for (const persona of ['nocode', 'vibecoder', 'lowcode', 'expert'] as PersonaId[]) {
      logs = [];
      printNextSteps({ ...baseOpts, persona });
      const output = logs.join('\n');
      expect(output).toContain('Your workflow');
    }
  });

  it('should show file descriptions for non-expert personas', () => {
    for (const persona of ['nocode', 'vibecoder', 'lowcode'] as PersonaId[]) {
      logs = [];
      printNextSteps({ ...baseOpts, persona });
      const output = logs.join('\n');
      expect(output).toContain('Project files');
    }
  });

  it('should NOT show file descriptions for expert persona', () => {
    logs = [];
    printNextSteps({ ...baseOpts, persona: 'expert' });
    const output = logs.join('\n');
    expect(output).not.toContain('Project files');
  });

  it('should show AI guidance for nocode persona', () => {
    logs = [];
    printNextSteps({ ...baseOpts, persona: 'nocode' });
    const output = logs.join('\n');
    expect(output).toContain('AI-assisted building');
    expect(output).toContain('AI editor');
  });

  it('should show AI editor tips for vibecoder persona', () => {
    logs = [];
    printNextSteps({ ...baseOpts, persona: 'vibecoder' });
    const output = logs.join('\n');
    expect(output).toContain('AI editor connected');
  });

  it('should show template commands for lowcode persona', () => {
    logs = [];
    printNextSteps({ ...baseOpts, persona: 'lowcode' });
    const output = logs.join('\n');
    expect(output).toContain('flow-weaver templates');
    expect(output).toContain('examples/');
  });

  it('should show mcp-setup and docs for expert persona', () => {
    logs = [];
    printNextSteps({ ...baseOpts, persona: 'expert' });
    const output = logs.join('\n');
    expect(output).toContain('flow-weaver mcp-setup');
    expect(output).toContain('flow-weaver docs');
  });

  it('should show cd command when displayDir is set', () => {
    logs = [];
    printNextSteps({ ...baseOpts, persona: 'expert', displayDir: 'my-dir' });
    const output = logs.join('\n');
    expect(output).toContain('cd my-dir');
  });

  it('should show npm install when install was skipped', () => {
    logs = [];
    printNextSteps({ ...baseOpts, persona: 'expert', installSkipped: true });
    const output = logs.join('\n');
    expect(output).toContain('npm install');
  });

  it('should always show npm run dev', () => {
    for (const persona of ['nocode', 'vibecoder', 'lowcode', 'expert'] as PersonaId[]) {
      logs = [];
      printNextSteps({ ...baseOpts, persona });
      const output = logs.join('\n');
      expect(output).toContain('npm run dev');
    }
  });

  it('should skip persona guidance when agentLaunched is true', () => {
    logs = [];
    printNextSteps({ ...baseOpts, persona: 'nocode', agentLaunched: true });
    const output = logs.join('\n');
    // Should still show workflow preview and next steps
    expect(output).toContain('Your workflow');
    expect(output).toContain('npm run dev');
    // Should NOT show persona-specific guidance
    expect(output).not.toContain('AI-assisted building');
  });
});

// ── PERSONA_CONFIRMATIONS ────────────────────────────────────────────────────

describe('PERSONA_CONFIRMATIONS', () => {
  it('should have entries for all personas', () => {
    expect(PERSONA_CONFIRMATIONS.nocode).toBeTruthy();
    expect(PERSONA_CONFIRMATIONS.vibecoder).toBeTruthy();
    expect(PERSONA_CONFIRMATIONS.lowcode).toBeTruthy();
    expect(PERSONA_CONFIRMATIONS.expert).toBeNull();
  });
});

// ── AGENT_LAUNCH_DEFAULTS ────────────────────────────────────────────────────

describe('AGENT_LAUNCH_DEFAULTS', () => {
  it('should default to true for nocode, vibecoder, lowcode', () => {
    expect(AGENT_LAUNCH_DEFAULTS.nocode).toBe(true);
    expect(AGENT_LAUNCH_DEFAULTS.vibecoder).toBe(true);
    expect(AGENT_LAUNCH_DEFAULTS.lowcode).toBe(true);
  });

  it('should default to false for expert', () => {
    expect(AGENT_LAUNCH_DEFAULTS.expert).toBe(false);
  });
});

// ── generateAgentPrompt ──────────────────────────────────────────────────────

describe('generateAgentPrompt', () => {
  it('should interpolate project name and template', () => {
    const prompt = generateAgentPrompt('my-app', 'nocode', 'sequential');
    expect(prompt).toContain('my-app');
    expect(prompt).toContain('sequential');
  });

  it('should produce different prompts per persona', () => {
    const nocode = generateAgentPrompt('test', 'nocode', 'sequential');
    const vibecoder = generateAgentPrompt('test', 'vibecoder', 'sequential');
    const lowcode = generateAgentPrompt('test', 'lowcode', 'sequential');
    const expert = generateAgentPrompt('test', 'expert', 'sequential');
    // All should be unique
    const set = new Set([nocode, vibecoder, lowcode, expert]);
    expect(set.size).toBe(4);
  });

  it('nocode prompt should mention plain language', () => {
    const prompt = generateAgentPrompt('test', 'nocode', 'ai-agent');
    expect(prompt).toContain('plain language');
    expect(prompt).toContain("Don't show code");
  });

  it('vibecoder prompt should mention collaboration', () => {
    const prompt = generateAgentPrompt('test', 'vibecoder', 'ai-agent');
    expect(prompt).toContain('together');
    expect(prompt).toContain('comfortable reading');
  });

  it('lowcode prompt should mention templates', () => {
    const prompt = generateAgentPrompt('test', 'lowcode', 'sequential');
    expect(prompt).toContain('template');
    expect(prompt).toContain('customize');
  });

  it('expert prompt should be concise (excluding bootstrap)', () => {
    const prompt = generateAgentPrompt('test', 'expert', 'sequential');
    // The main body after the bootstrap line should be short
    const body = prompt.split('\n\n').slice(1).join('\n\n');
    expect(body.length).toBeLessThan(200);
  });

  it('nocode prompt should include fw_context with core preset', () => {
    const prompt = generateAgentPrompt('test', 'nocode', 'sequential');
    expect(prompt).toContain('fw_context(preset="core"');
    expect(prompt).toContain('profile="assistant"');
  });

  it('vibecoder prompt should include fw_context with authoring preset', () => {
    const prompt = generateAgentPrompt('test', 'vibecoder', 'sequential');
    expect(prompt).toContain('fw_context(preset="authoring"');
  });

  it('lowcode prompt should include fw_context with authoring preset', () => {
    const prompt = generateAgentPrompt('test', 'lowcode', 'sequential');
    expect(prompt).toContain('fw_context(preset="authoring"');
  });

  it('expert prompt should include fw_context with authoring preset', () => {
    const prompt = generateAgentPrompt('test', 'expert', 'sequential');
    expect(prompt).toContain('fw_context(preset="authoring"');
  });

  it('all prompts should start with fw_context bootstrap', () => {
    for (const persona of ['nocode', 'vibecoder', 'lowcode', 'expert'] as PersonaId[]) {
      const prompt = generateAgentPrompt('test', persona, 'sequential');
      expect(prompt).toMatch(/^Before doing anything else, call fw_context/);
    }
  });
});

// ── generateEditorPrompt ─────────────────────────────────────────────────────

describe('generateEditorPrompt', () => {
  it('should include project name and template', () => {
    const prompt = generateEditorPrompt('my-app', 'nocode', 'sequential');
    expect(prompt).toContain('my-app');
    expect(prompt).toContain('sequential');
  });

  it('should produce different prompts per persona', () => {
    const nocode = generateEditorPrompt('test', 'nocode', 'sequential');
    const expert = generateEditorPrompt('test', 'expert', 'sequential');
    expect(nocode).not.toBe(expert);
  });

  it('nocode prompt should mention no code', () => {
    const prompt = generateEditorPrompt('test', 'nocode', 'sequential');
    expect(prompt).toContain('no code');
  });

  it('should include fw_context call for all personas', () => {
    for (const persona of ['nocode', 'vibecoder', 'lowcode', 'expert'] as PersonaId[]) {
      const prompt = generateEditorPrompt('test', persona, 'sequential');
      expect(prompt).toContain('fw_context');
    }
  });

  it('nocode editor prompt should use core preset', () => {
    const prompt = generateEditorPrompt('test', 'nocode', 'sequential');
    expect(prompt).toContain('preset="core"');
  });

  it('expert editor prompt should use authoring preset', () => {
    const prompt = generateEditorPrompt('test', 'expert', 'sequential');
    expect(prompt).toContain('preset="authoring"');
  });
});

// ── generateSetupPromptFile ──────────────────────────────────────────────────

describe('generateSetupPromptFile', () => {
  it('should include project name as heading', () => {
    const content = generateSetupPromptFile('my-app', 'nocode', 'sequential', ['package.json', 'src/main.ts']);
    expect(content).toContain('# my-app Setup');
  });

  it('should include the agent prompt', () => {
    const content = generateSetupPromptFile('my-app', 'nocode', 'sequential', []);
    expect(content).toContain('plain language');
  });

  it('should list files created', () => {
    const content = generateSetupPromptFile('my-app', 'expert', 'sequential', ['package.json', 'src/main.ts']);
    expect(content).toContain('`package.json`');
    expect(content).toContain('`src/main.ts`');
  });

  it('should mention MCP tools', () => {
    const content = generateSetupPromptFile('my-app', 'expert', 'sequential', []);
    expect(content).toContain('fw_diagram');
    expect(content).toContain('fw_modify');
  });

  it('should mention deleting after use', () => {
    const content = generateSetupPromptFile('my-app', 'expert', 'sequential', []);
    expect(content).toContain('Delete this file');
  });

  it('should embed Flow Weaver reference documentation', () => {
    const content = generateSetupPromptFile('my-app', 'nocode', 'sequential', []);
    expect(content).toContain('## Flow Weaver Reference');
    // Should contain actual documentation content (annotation grammar, concepts)
    expect(content).toContain('@flowWeaver');
  });

  it('should include fw_context bootstrap in the agent prompt section', () => {
    const content = generateSetupPromptFile('my-app', 'nocode', 'sequential', []);
    expect(content).toContain('fw_context(preset="core"');
  });
});

// ── AGENT_CONTEXT_PRESETS ─────────────────────────────────────────────────────

describe('AGENT_CONTEXT_PRESETS', () => {
  it('should have entries for all personas', () => {
    const personas: PersonaId[] = ['nocode', 'vibecoder', 'lowcode', 'expert'];
    for (const persona of personas) {
      expect(AGENT_CONTEXT_PRESETS[persona]).toBeTruthy();
    }
  });

  it('nocode should use core preset', () => {
    expect(AGENT_CONTEXT_PRESETS.nocode).toBe('core');
  });

  it('vibecoder, lowcode, expert should use authoring preset', () => {
    expect(AGENT_CONTEXT_PRESETS.vibecoder).toBe('authoring');
    expect(AGENT_CONTEXT_PRESETS.lowcode).toBe('authoring');
    expect(AGENT_CONTEXT_PRESETS.expert).toBe('authoring');
  });
});

// ── printCopyablePrompt ──────────────────────────────────────────────────────

describe('printCopyablePrompt', () => {
  let logs: string[];
  const originalLog = console.log;
  const originalWarn = console.warn;

  beforeEach(() => {
    logs = [];
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.warn = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
  });

  it('should print a bordered box', () => {
    printCopyablePrompt('Hello world');
    const output = logs.join('\n');
    expect(output).toContain('┌');
    expect(output).toContain('┘');
    expect(output).toContain('Hello world');
  });

  it('should handle multi-line prompts', () => {
    printCopyablePrompt('Line 1\nLine 2\nLine 3');
    const output = logs.join('\n');
    expect(output).toContain('Line 1');
    expect(output).toContain('Line 2');
    expect(output).toContain('Line 3');
  });
});
