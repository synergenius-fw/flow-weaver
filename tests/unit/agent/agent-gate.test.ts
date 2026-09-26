/**
 * Answering a gate with a model: the tool the gate becomes, the prompt, and
 * what the answer is when the model submits, rejects, answers in prose, or
 * never answers at all. The provider is a fake that plays back events.
 */
import { describe, it, expect } from 'vitest';
import { answerGate, answerTool, answerFromText, fieldToJsonSchema, systemPromptFor, tryProfile, SUBMIT_TOOL, REJECT_TOOL, type GateToAnswer } from '../../../src/agent/gate';
import type { AgentProvider, StreamEvent, ToolDefinition, AgentMessage, StreamOptions } from '../../../src/agent/types';

const profile = { name: 'reviewer', provider: 'anthropic' as const, model: 'test-model', system: 'Be terse.' };
const workflow = { name: 'reviewFile' };

const agentGate: GateToAnswer = {
  node: 'agent', inputs: { agentId: 'review', context: { path: 'notes.md', excerpt: 'TODO' }, prompt: 'Review it.' }, absent: [],
  outputs: ['agentResult'], hasFailurePort: true, outputSchema: null, outputTypes: { agentResult: 'object' },
};

/** A provider that plays one event list per model turn and records what it was asked. */
function fake(turns: StreamEvent[][]) {
  const seen: Array<{ messages: AgentMessage[]; tools: ToolDefinition[]; options?: StreamOptions }> = [];
  let i = 0;
  const provider: AgentProvider = {
    async *stream(messages, tools, options) {
      seen.push({ messages: [...messages], tools, options });
      for (const ev of turns[i++] ?? [{ type: 'message_stop', finishReason: 'stop' }]) yield ev;
    },
  };
  return { provider, seen };
}
const submit = (args: Record<string, unknown>, name = SUBMIT_TOOL): StreamEvent[] => [
  { type: 'tool_use_start', id: 't1', name },
  { type: 'tool_use_end', id: 't1', arguments: args },
  { type: 'usage', promptTokens: 100, completionTokens: 20 },
  { type: 'message_stop', finishReason: 'tool_calls' },
];

describe('answerTool', () => {
  it('makes one object output the whole tool input', () => {
    const { tool, unwrap } = answerTool(agentGate);
    expect(tool.name).toBe(SUBMIT_TOOL);
    expect(tool.inputSchema.type).toBe('object');
    expect(unwrap({ summary: 's', risk: 'low' })).toEqual({ summary: 's', risk: 'low' });
  });

  it('uses the output schema when it is known, and wraps a scalar under value', () => {
    const typed = answerTool({ ...agentGate, outputSchema: { agentResult: { type: 'object', fields: { summary: { type: 'string' }, risk: { type: 'enum', values: ['low', 'high'] } } } } });
    expect(typed.tool.inputSchema.properties).toEqual({ summary: { type: 'string' }, risk: { enum: ['low', 'high'] } });
    expect(typed.tool.inputSchema.required).toEqual(['summary', 'risk']);
    const scalar = answerTool({ ...agentGate, outputs: ['score'], outputSchema: { score: { type: 'number' } } });
    expect(scalar.tool.inputSchema.properties).toEqual({ value: { type: 'number' } });
    expect(scalar.unwrap({ value: 7 })).toBe(7);
  });

  it('asks for every output of a multi-output gate and returns exactly those', () => {
    const { tool, unwrap } = answerTool({ ...agentGate, outputs: ['approved', 'note'], outputSchema: { approved: { type: 'boolean' }, note: { type: 'string', optional: true } } });
    expect(tool.inputSchema.required).toEqual(['approved', 'note']);
    expect(unwrap({ approved: true, note: 'ok', extra: 1 })).toEqual({ approved: true, note: 'ok' });
  });

  it('has nothing to return for a gate without data outputs', () => {
    const { unwrap } = answerTool({ ...agentGate, outputs: [] });
    expect(unwrap({})).toBeNull();
  });
});

describe('fieldToJsonSchema', () => {
  it('leaves an any field unconstrained, keeping only its description', () => {
    expect(fieldToJsonSchema({ type: 'any' })).toEqual({});
    expect(fieldToJsonSchema({ type: 'any', text: 'whatever the step returns' })).toEqual({ description: 'whatever the step returns' });
  });
});

describe('systemPromptFor', () => {
  it('puts the profile first and names the workflow, the gate and the tools', () => {
    const s = systemPromptFor(profile, workflow, agentGate);
    expect(s.startsWith('Be terse.')).toBe(true);
    expect(s).toContain('"reviewFile"');
    expect(s).toContain('"agent"');
    expect(s).toContain(SUBMIT_TOOL);
    expect(s).toContain(REJECT_TOOL);
    expect(systemPromptFor(profile, workflow, { ...agentGate, hasFailurePort: false })).not.toContain(REJECT_TOOL);
  });
});

describe('answerGate', () => {
  it('returns what the model submitted, with its usage and the events along the way', async () => {
    const { provider, seen } = fake([[{ type: 'text_delta', text: 'Looking…' }, ...submit({ summary: 'No tests.', risk: 'high' })]]);
    const events: string[] = [];
    const r = await answerGate({ gate: agentGate, workflow, profile, provider, onEvent: (e) => events.push(e.phase + (e.phase === 'tool' ? `:${e.stage}` : '')) });
    expect(r.outcome).toEqual({ kind: 'answer', answer: { summary: 'No tests.', risk: 'high' } });
    expect(r.usage).toEqual({ promptTokens: 100, completionTokens: 20 });
    expect(r.toolCalls).toBe(1);
    expect(events).toEqual(['start', 'text', 'usage', 'tool:start', 'tool:result', 'done']);
    // One model turn: the loop stopped as soon as the answer was in hand.
    expect(seen).toHaveLength(1);
    expect(seen[0].tools.map((t) => t.name)).toEqual([SUBMIT_TOOL, REJECT_TOOL]);
    expect(seen[0].options?.systemPrompt?.prefix).toContain('Be terse.');
    expect(String(seen[0].messages[0].content)).toContain('"agentId": "review"');
    expect(String(seen[0].messages[0].content)).toContain('Instruction:\nReview it.');
  });

  it('accepts the CLI\'s prefixed tool name', async () => {
    const { provider } = fake([submit({ ok: true }, `mcp__fw-agent__${SUBMIT_TOOL}`)]);
    const r = await answerGate({ gate: agentGate, workflow, profile, provider });
    expect(r.outcome).toEqual({ kind: 'answer', answer: { ok: true } });
  });

  it('rejects when the model calls reject on a gate with a failure port', async () => {
    const { provider } = fake([submit({ reason: 'nothing to review' }, REJECT_TOOL)]);
    const r = await answerGate({ gate: agentGate, workflow, profile, provider });
    expect(r.outcome).toEqual({ kind: 'reject', reason: 'nothing to review' });
  });

  it('does not offer reject to a gate without a failure port', async () => {
    const { provider, seen } = fake([submit({ reason: 'x' }, REJECT_TOOL), submit({ a: 1 })]);
    const r = await answerGate({ gate: { ...agentGate, hasFailurePort: false }, workflow, profile, provider });
    expect(seen[0].tools.map((t) => t.name)).toEqual([SUBMIT_TOOL]);
    // The unknown-tool error went back to the model, which then submitted.
    expect(r.outcome).toEqual({ kind: 'answer', answer: { a: 1 } });
  });

  it('nudges once when the model stops in prose, then takes the submission', async () => {
    const { provider, seen } = fake([
      [{ type: 'text_delta', text: 'Here is my review: it is fine.' }, { type: 'message_stop', finishReason: 'stop' }],
      submit({ summary: 'fine', risk: 'low' }),
    ]);
    const r = await answerGate({ gate: agentGate, workflow, profile, provider });
    expect(r.outcome).toEqual({ kind: 'answer', answer: { summary: 'fine', risk: 'low' } });
    expect(seen).toHaveLength(2);
    const last = seen[1].messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(String(last.content)).toContain(`You have not called ${SUBMIT_TOOL}`);
  });

  it('reads JSON out of the prose when the model never submits', async () => {
    const { provider } = fake([
      [{ type: 'text_delta', text: 'Result:\n```json\n{"summary":"ok","risk":"low"}\n```' }, { type: 'message_stop', finishReason: 'stop' }],
      [{ type: 'text_delta', text: 'As I said.' }, { type: 'message_stop', finishReason: 'stop' }],
    ]);
    const r = await answerGate({ gate: agentGate, workflow, profile, provider });
    expect(r.outcome).toEqual({ kind: 'answer', answer: { summary: 'ok', risk: 'low' } });
  });

  it('fails, without throwing, when nothing usable comes back', async () => {
    const { provider } = fake([
      [{ type: 'text_delta', text: 'I would rather not.' }, { type: 'message_stop', finishReason: 'stop' }],
      [{ type: 'text_delta', text: 'No.' }, { type: 'message_stop', finishReason: 'stop' }],
    ]);
    const events: unknown[] = [];
    const r = await answerGate({ gate: agentGate, workflow, profile, provider, onEvent: (e) => events.push(e) });
    expect(r.outcome).toEqual({ kind: 'failed', error: `the model did not call ${SUBMIT_TOOL}` });
    expect(events.at(-1)).toMatchObject({ phase: 'done', outcome: 'failed' });
  });

  it('turns a provider error into a failed outcome', async () => {
    const provider: AgentProvider = { async *stream() { throw new Error('401 from the API'); } };
    const r = await answerGate({ gate: agentGate, workflow, profile, provider });
    expect(r.outcome).toEqual({ kind: 'failed', error: '401 from the API' });
  });
});

describe('answerFromText', () => {
  it('fits prose JSON to the outputs', () => {
    expect(answerFromText('{"a":1}', { ...agentGate, outputs: ['x'] })).toEqual({ a: 1 });
    expect(answerFromText('{"approved":true,"note":"n"}', { ...agentGate, outputs: ['approved', 'note'] })).toEqual({ approved: true, note: 'n' });
    expect(answerFromText('{"approved":true}', { ...agentGate, outputs: ['approved', 'note'] })).toBeUndefined();
    expect(answerFromText('{"score": 9}', { ...agentGate, outputs: ['score'], outputSchema: { score: { type: 'number' } } })).toBe(9);
    expect(answerFromText('no json here', agentGate)).toBeUndefined();
  });
});

describe('tryProfile', () => {
  it('reports a working profile with its timing and usage', async () => {
    const { provider, seen } = fake([[{ type: 'text_delta', text: 'OK' }, { type: 'usage', promptTokens: 20, completionTokens: 1 }, { type: 'message_stop', finishReason: 'stop' }]]);
    const r = await tryProfile(profile, {}, { provider });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('OK');
    expect(r.usage).toEqual({ promptTokens: 20, completionTokens: 1 });
    expect(seen[0].tools).toEqual([]);
    expect(String(seen[0].messages[0].content)).toMatch(/single word OK/);
  });

  it('reports a provider error stop as not ok, with the provider\'s words', async () => {
    const { provider } = fake([[{ type: 'text_delta', text: 'OpenAI API error 401: invalid key' }, { type: 'message_stop', finishReason: 'error' }]]);
    const r = await tryProfile(profile, {}, { provider });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401/);
  });

  it('reports a profile that is not ready without calling anything', async () => {
    const r = await tryProfile({ name: 'x', provider: 'anthropic' }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ANTHROPIC_API_KEY is not set/);
  });
});
