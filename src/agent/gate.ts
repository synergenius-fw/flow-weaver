/**
 * Answering one agent gate with a model.
 *
 * A paused `waitForAgent` step is a task with three labelled inputs --
 * `agentId`, `context`, `prompt` -- and one or more data outputs the run
 * needs before it can go on. This turns that into an agent-loop call: the
 * profile says which model and what it stands for, the gate's own output
 * shape becomes the schema of a `submit_answer` tool, and the model is asked
 * to do the task and call that tool once. A tool call is used rather than
 * "reply in JSON" because every provider here supports tools, the arguments
 * arrive already parsed, and the shape is enforced by the model rather than
 * by a regex afterwards.
 *
 * The result is the gate's answer as `buildGateResolution` takes it, or a
 * rejection when the gate has a failure port and the model gives up, or a
 * failure when the model never submitted anything -- in which case the gate
 * stays waiting for a person, with the transcript kept beside it.
 */
import { runAgentLoop } from './agent-loop.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createOpenAICompatProvider } from './providers/openai-compat.js';
import { createClaudeCliProvider } from './providers/claude-cli.js';
import { DEFAULT_MAX_ITERATIONS, DEFAULT_MODEL, keyEnvOf, readiness, type AgentProfile } from './profiles.js';
import { stripMcpToolPrefix, type AgentMessage, type AgentProvider, type StreamEvent, type ToolDefinition, type ToolEvent } from './types.js';

/** The field schema the console derives from TypeScript types (`src/console/schema.ts`), structurally. */
export type FieldSchema =
  | { type: 'string'; optional?: boolean }
  | { type: 'number'; optional?: boolean }
  | { type: 'boolean'; optional?: boolean }
  | { type: 'enum'; values: Array<string | number>; optional?: boolean }
  | { type: 'array'; items: FieldSchema; optional?: boolean; text?: string }
  | { type: 'object'; fields?: Record<string, FieldSchema>; text?: string; optional?: boolean }
  | { type: 'any'; text?: string; optional?: boolean };

/** What the coordinator recorded about the paused gate, plus what is known of its output shape. */
export interface GateToAnswer {
  node: string;
  inputs: Record<string, unknown>;
  absent: string[];
  outputs: string[];
  hasFailurePort: boolean;
  outputSchema?: Record<string, FieldSchema> | null;
  outputTypes?: Record<string, string>;
}

/** What the model is told the gate belongs to. */
export interface GateWorkflow {
  name: string;
  description?: string;
}

export type GateOutcome =
  | { kind: 'answer'; answer: unknown }
  | { kind: 'reject'; reason: string }
  | { kind: 'failed'; error: string };

export interface GateUsage { promptTokens: number; completionTokens: number; costUsd?: number }

/** One thing that happened while the model worked, compact enough to stream and to keep. */
export type AgentGateEvent =
  | { type: 'agent'; phase: 'start'; profile: string; provider: string; model?: string }
  | { type: 'agent'; phase: 'text'; text: string }
  | { type: 'agent'; phase: 'thinking'; text: string }
  | { type: 'agent'; phase: 'tool'; stage: 'start' | 'result'; name: string; args?: Record<string, unknown>; result?: string; isError?: boolean }
  | { type: 'agent'; phase: 'usage'; promptTokens: number; completionTokens: number; costUsd?: number }
  | { type: 'agent'; phase: 'done'; outcome: GateOutcome['kind']; ms: number; error?: string; reason?: string };

export interface GateAgentResult {
  outcome: GateOutcome;
  usage: GateUsage;
  toolCalls: number;
  ms: number;
  /** The conversation as it stood at the end, for the transcript. */
  transcript: AgentMessage[];
  /** What the model said in prose, if anything. */
  text: string;
}

export interface AnswerGateOptions {
  gate: GateToAnswer;
  workflow: GateWorkflow;
  profile: AgentProfile;
  /** The provider to call; built from the profile and environment when omitted. */
  provider?: AgentProvider;
  env?: NodeJS.ProcessEnv;
  /** Working directory for a CLI provider. */
  cwd?: string;
  signal?: AbortSignal;
  onEvent?: (event: AgentGateEvent) => void;
}

export const SUBMIT_TOOL = 'submit_answer';
export const REJECT_TOOL = 'reject';

/** A provider for a profile, or a thrown error naming what is missing. */
export function providerFor(profile: AgentProfile, env: NodeJS.ProcessEnv = process.env, cwd?: string): AgentProvider {
  const ready = readiness(profile, env);
  if (!ready.ready) throw new Error(`agent profile ${profile.name} is not ready: ${ready.reason}`);
  const model = profile.model || DEFAULT_MODEL[profile.provider] || undefined;
  switch (profile.provider) {
    case 'anthropic':
      return createAnthropicProvider({ apiKey: env[keyEnvOf(profile)!]!, model, baseUrl: profile.baseUrl, maxTokens: profile.maxTokens });
    case 'openai':
      return createOpenAICompatProvider({ apiKey: env[keyEnvOf(profile)!] ?? 'none', model, baseUrl: profile.baseUrl, maxTokens: profile.maxTokens });
    case 'claude-cli':
      // Unattended: no built-in tools, so the only things the model can do
      // are the two bridged tools below. Its own credentials come from its
      // own store, which is why the environment is passed through.
      return createClaudeCliProvider({ binPath: profile.bin, model: model || undefined, cwd, env, allowedTools: [] });
  }
}

/** A field schema as JSON Schema, for a tool's input. */
export function fieldToJsonSchema(f: FieldSchema | undefined): Record<string, unknown> {
  if (!f) return {};
  switch (f.type) {
    case 'string': return { type: 'string' };
    case 'number': return { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'enum': return { enum: f.values };
    case 'array': return { type: 'array', items: fieldToJsonSchema(f.items) };
    case 'object': {
      if (!f.fields) return { type: 'object', additionalProperties: true, ...(f.text ? { description: f.text } : {}) };
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(f.fields)) {
        properties[k] = fieldToJsonSchema(v);
        if (!v.optional) required.push(k);
      }
      return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
    }
    default: return f.text ? { description: f.text } : {};
  }
}

/**
 * The `submit_answer` tool's schema for a gate, and how its arguments become
 * the gate's answer. One object-shaped output is the tool's whole input;
 * one scalar output rides under `value`; several outputs are one property
 * each, all required, exactly as `buildGateResolution` will want them.
 */
export function answerTool(gate: GateToAnswer): { tool: ToolDefinition; unwrap: (args: Record<string, unknown>) => unknown } {
  const schemaOf = (o: string): FieldSchema | undefined => gate.outputSchema?.[o] ?? undefined;
  const describe = (o: string): string => gate.outputTypes?.[o] ? ` (${gate.outputTypes[o]})` : '';
  if (gate.outputs.length === 0) {
    return { tool: { name: SUBMIT_TOOL, description: 'Mark the task as done. It has no result to return.', inputSchema: { type: 'object', properties: {} } }, unwrap: () => null };
  }
  if (gate.outputs.length === 1) {
    const o = gate.outputs[0];
    const s = schemaOf(o);
    const isObject = !s || s.type === 'object' || s.type === 'any';
    if (isObject) {
      const js = fieldToJsonSchema(s ?? { type: 'object' });
      const properties = (js.properties as Record<string, unknown> | undefined) ?? {};
      const inputSchema = { type: 'object', properties, ...(js.required ? { required: js.required as string[] } : {}), ...(js.additionalProperties === undefined ? { additionalProperties: true } : { additionalProperties: js.additionalProperties }) };
      return { tool: { name: SUBMIT_TOOL, description: `Return the result of the task: the value for \`${o}\`${describe(o)}.`, inputSchema }, unwrap: (args) => args };
    }
    return {
      tool: { name: SUBMIT_TOOL, description: `Return the result of the task as \`value\`: the gate's \`${o}\`${describe(o)}.`, inputSchema: { type: 'object', properties: { value: fieldToJsonSchema(s) }, required: ['value'] } },
      unwrap: (args) => args.value,
    };
  }
  const properties: Record<string, unknown> = {};
  for (const o of gate.outputs) properties[o] = { ...fieldToJsonSchema(schemaOf(o)), ...(gate.outputTypes?.[o] ? { description: gate.outputTypes[o] } : {}) };
  return {
    tool: { name: SUBMIT_TOOL, description: `Return the result of the task: one value per output (${gate.outputs.join(', ')}).`, inputSchema: { type: 'object', properties, required: [...gate.outputs] } },
    unwrap: (args) => Object.fromEntries(gate.outputs.map((o) => [o, args[o]])),
  };
}

const rejectTool: ToolDefinition = {
  name: REJECT_TOOL,
  description: 'Give the task up. The workflow continues along its failure path. Say why in one sentence.',
  inputSchema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
};

/** The frame every gate-answering conversation is set in; the profile's own text comes first. */
export function systemPromptFor(profile: AgentProfile, workflow: GateWorkflow, gate: GateToAnswer): string {
  const lines = [
    profile.system?.trim() ?? '',
    `You are completing one step of the workflow "${workflow.name}"${workflow.description ? ` (${workflow.description})` : ''}: the agent gate "${gate.node}".`,
    'You receive the gate\'s inputs as JSON: `agentId` names the task, `context` is the material to work from, `prompt` is the instruction when there is one.',
    `Do the task, then call \`${SUBMIT_TOOL}\` exactly once with the result.${gate.hasFailurePort ? ` If the task cannot be done from what you were given, call \`${REJECT_TOOL}\` with a short reason instead.` : ''}`,
    'Only the tool call counts; anything you write in prose is discarded.',
  ];
  return lines.filter(Boolean).join('\n\n');
}

/** The one user message: the inputs, and the prompt again on its own so it reads as the instruction. */
export function userMessageFor(gate: GateToAnswer): string {
  const shown = { ...gate.inputs };
  const parts = [`Inputs:\n${JSON.stringify(shown, null, 2)}`];
  if (typeof gate.inputs.prompt === 'string' && gate.inputs.prompt.trim()) parts.push(`Instruction:\n${gate.inputs.prompt}`);
  parts.push(`When done, call ${SUBMIT_TOOL}.`);
  return parts.join('\n\n');
}

export interface TryResult {
  ok: boolean;
  ms: number;
  /** What the model said, trimmed. */
  text?: string;
  usage?: GateUsage;
  error?: string;
}

/**
 * One short round trip through a profile, to learn whether it works at all:
 * the key is right, the endpoint answers, the model exists. No tools, one
 * turn, a one-word task. The only way to know before a real gate depends
 * on it.
 */
export async function tryProfile(profile: AgentProfile, env: NodeJS.ProcessEnv = process.env, opts: { provider?: AgentProvider; cwd?: string; signal?: AbortSignal } = {}): Promise<TryResult> {
  const started = Date.now();
  let provider: AgentProvider;
  try {
    provider = opts.provider ?? providerFor(profile, env, opts.cwd);
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const result = await runAgentLoop(provider, [], async () => ({ result: '', isError: true }), [{ role: 'user', content: 'Reply with the single word OK.' }], {
      systemPrompt: { prefix: profile.system?.trim() || 'You are a terse assistant.', suffix: '' },
      maxIterations: 1,
      maxTokens: Math.min(profile.maxTokens ?? 64, 256),
      model: profile.model || undefined,
      signal: opts.signal,
    });
    const text = result.summary.trim();
    const usage: GateUsage = { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, ...(result.usage.costUsd ? { costUsd: result.usage.costUsd } : {}) };
    // An HTTP provider reports a refused key or a wrong model as an error
    // stop with the body as text, not a throw.
    if (!result.success) return { ok: false, ms: Date.now() - started, text, usage, error: text || 'the provider returned an error' };
    return { ok: true, ms: Date.now() - started, text, usage };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A last resort when the model answered in prose: JSON in the text that fits the outputs. */
export function answerFromText(text: string, gate: GateToAnswer): unknown | undefined {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!m) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(m[1]); } catch { return undefined; }
  if (gate.outputs.length > 1) {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    if (!gate.outputs.every((o) => o in (parsed as Record<string, unknown>))) return undefined;
    return Object.fromEntries(gate.outputs.map((o) => [o, (parsed as Record<string, unknown>)[o]]));
  }
  if (gate.outputs.length === 1) {
    const s = gate.outputSchema?.[gate.outputs[0]];
    const one = parsed as Record<string, unknown>;
    // The model may have wrapped the value under the port's name.
    if (s && s.type !== 'object' && s.type !== 'any' && typeof one === 'object' && one !== null && gate.outputs[0] in one) return one[gate.outputs[0]];
    return parsed;
  }
  return null;
}

/** Run the model against the gate and say what it decided. Never throws for a model failure; only for a misconfiguration. */
export async function answerGate(opts: AnswerGateOptions): Promise<GateAgentResult> {
  const { gate, workflow, profile } = opts;
  const env = opts.env ?? process.env;
  const provider = opts.provider ?? providerFor(profile, env, opts.cwd);
  const started = Date.now();
  const emit = (e: AgentGateEvent) => opts.onEvent?.(e);
  emit({ type: 'agent', phase: 'start', profile: profile.name, provider: profile.provider, model: profile.model || DEFAULT_MODEL[profile.provider] || undefined });

  const { tool, unwrap } = answerTool(gate);
  const tools: ToolDefinition[] = gate.hasFailurePort ? [tool, rejectTool] : [tool];
  let captured: GateOutcome | undefined;
  let usage: GateUsage = { promptTokens: 0, completionTokens: 0 };
  let text = '';

  const executor = async (rawName: string, args: Record<string, unknown>) => {
    const name = stripMcpToolPrefix(rawName);
    if (name === SUBMIT_TOOL) {
      captured = { kind: 'answer', answer: unwrap(args ?? {}) };
      return { result: 'Recorded. You are done.', isError: false };
    }
    if (name === REJECT_TOOL && gate.hasFailurePort) {
      captured = { kind: 'reject', reason: typeof args?.reason === 'string' && args.reason.trim() ? args.reason : 'rejected by the agent' };
      return { result: 'Recorded. You are done.', isError: false };
    }
    return { result: `Unknown tool ${name}. Call ${SUBMIT_TOOL}${gate.hasFailurePort ? ` or ${REJECT_TOOL}` : ''}.`, isError: true };
  };
  const onStreamEvent = (ev: StreamEvent) => {
    if (ev.type === 'text_delta') { text += ev.text; emit({ type: 'agent', phase: 'text', text: ev.text }); }
    else if (ev.type === 'thinking_delta') emit({ type: 'agent', phase: 'thinking', text: ev.text });
    else if (ev.type === 'usage') emit({ type: 'agent', phase: 'usage', promptTokens: ev.promptTokens, completionTokens: ev.completionTokens, costUsd: ev.costUsd });
  };
  const onToolEvent = (ev: ToolEvent) => {
    emit({ type: 'agent', phase: 'tool', stage: ev.type === 'tool_call_start' ? 'start' : 'result', name: stripMcpToolPrefix(ev.name), args: ev.args, result: ev.result, isError: ev.isError });
  };
  const system = { prefix: systemPromptFor(profile, workflow, gate), suffix: '' };
  const messages: AgentMessage[] = [{ role: 'user', content: userMessageFor(gate) }];
  const maxIterations = profile.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  const run = async (conversation: AgentMessage[], iterations: number) => runAgentLoop(provider, tools, executor, conversation, {
    systemPrompt: system,
    maxIterations: iterations,
    maxTokens: profile.maxTokens,
    model: profile.model || undefined,
    signal: opts.signal,
    onStreamEvent,
    onToolEvent,
    // Once the answer is in hand there is nothing more to ask; stop before
    // another model turn is paid for.
    onTurnEnd: async () => (captured ? { continue: false } : undefined),
  });

  let transcript: AgentMessage[] = messages;
  let toolCalls = 0;
  try {
    let result = await run(messages, maxIterations);
    transcript = result.messages; toolCalls = result.toolCallCount;
    usage = { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, ...(result.usage.costUsd ? { costUsd: result.usage.costUsd } : {}) };
    // The model finished in prose without submitting: one nudge, then read
    // its text for JSON before giving up.
    if (!captured && result.success && !opts.signal?.aborted) {
      const nudged: AgentMessage[] = [...result.messages, { role: 'user', content: `You have not called ${SUBMIT_TOOL}. Call it now with your result${gate.hasFailurePort ? `, or ${REJECT_TOOL} if you cannot` : ''}.` }];
      result = await run(nudged, 2);
      transcript = result.messages; toolCalls += result.toolCallCount;
      usage = { promptTokens: usage.promptTokens + result.usage.promptTokens, completionTokens: usage.completionTokens + result.usage.completionTokens, ...(usage.costUsd || result.usage.costUsd ? { costUsd: (usage.costUsd ?? 0) + (result.usage.costUsd ?? 0) } : {}) };
    }
    if (!captured) {
      const fromText = answerFromText(text, gate);
      if (fromText !== undefined) captured = { kind: 'answer', answer: fromText };
    }
    if (!captured) {
      captured = { kind: 'failed', error: opts.signal?.aborted ? 'stopped before an answer was submitted' : result.success ? `the model did not call ${SUBMIT_TOOL}` : result.summary };
    }
  } catch (e) {
    captured = { kind: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
  const ms = Date.now() - started;
  emit({ type: 'agent', phase: 'done', outcome: captured.kind, ms, ...(captured.kind === 'failed' ? { error: captured.error } : {}), ...(captured.kind === 'reject' ? { reason: captured.reason } : {}) });
  return { outcome: captured, usage, toolCalls, ms, transcript, text };
}
