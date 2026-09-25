/**
 * The OpenAI-compatible provider reaches the completions endpoint of any
 * server, whether its base URL carries the version or not, and asks a
 * streaming response to include usage.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { completionsUrl, createOpenAICompatProvider } from '../../src/agent/providers/openai-compat';

describe('completionsUrl', () => {
  it('appends /v1/chat/completions to a bare origin', () => {
    expect(completionsUrl('https://api.openai.com')).toBe('https://api.openai.com/v1/chat/completions');
    expect(completionsUrl('https://api.openai.com/')).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('keeps a base that already ends in a version', () => {
    expect(completionsUrl('https://api.groq.com/openai/v1')).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(completionsUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1/chat/completions');
    expect(completionsUrl('https://example.com/api/v2')).toBe('https://example.com/api/v2/chat/completions');
  });
});

describe('OpenAICompatProvider request', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts to the completions URL with stream usage turned on', async () => {
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenAICompatProvider({ apiKey: 'k', baseUrl: 'http://localhost:11434/v1' });
    const events = [];
    for await (const e of provider.stream([{ role: 'user', content: 'hi' }], [])) events.push(e);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(events.at(-1)).toEqual({ type: 'message_stop', finishReason: 'stop' });
  });
});
