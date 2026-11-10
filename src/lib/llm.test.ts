import { afterEach, describe, expect, it, vi } from 'vitest';
import { chat } from './llm';
import type { Settings } from './settings';

const prompt = { system: 'be brief', user: 'hello' };

function stubFetch(makeResponse: () => Response) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => makeResponse());
  vi.stubGlobal('fetch', fetchMock);
  return {
    url: () => fetchMock.mock.calls[0]![0],
    headers: () => fetchMock.mock.calls[0]![1].headers as Record<string, string>,
    body: () => JSON.parse(fetchMock.mock.calls[0]![1].body as string),
    signal: () => fetchMock.mock.calls[0]![1].signal as AbortSignal,
  };
}

/** A streamed reply. The event text is cut into byte chunks of `chunkSize` to mimic network framing. */
function eventStream(events: unknown[], chunkSize = 1024): Response {
  const text = events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

const openaiDelta = (content: string) => ({ choices: [{ delta: { content } }] });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat over the OpenAI protocol', () => {
  const settings: Settings = {
    protocol: 'openai',
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'sk-test',
    model: 'some-model',
  };

  it('posts a streaming request to chat/completions', async () => {
    const sent = stubFetch(() => eventStream([openaiDelta('ok'), '[DONE]']));

    await chat(settings, prompt);

    expect(sent.url()).toBe('https://api.example.com/v1/chat/completions');
    expect(sent.headers().authorization).toBe('Bearer sk-test');
    expect(sent.body()).toEqual({
      model: 'some-model',
      stream: true,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
      ],
    });
  });

  it('reports each piece of text as it arrives and returns the whole', async () => {
    stubFetch(() =>
      eventStream([{ choices: [{ delta: { role: 'assistant' } }] }, openaiDelta('你'), openaiDelta('好'), '[DONE]']),
    );
    const deltas: string[] = [];

    await expect(chat(settings, prompt, { onDelta: (text) => deltas.push(text) })).resolves.toBe('你好');
    expect(deltas).toEqual(['你', '好']);
  });

  it('reassembles events and multi-byte characters split across network chunks', async () => {
    for (const chunkSize of [1, 2, 3, 7]) {
      stubFetch(() => eventStream([openaiDelta('编译器'), openaiDelta('很好'), '[DONE]'], chunkSize));
      await expect(chat(settings, prompt)).resolves.toBe('编译器很好');
    }
  });

  it('ignores reasoning text from thinking models', async () => {
    stubFetch(() =>
      eventStream([{ choices: [{ delta: { reasoning_content: 'let me think' } }] }, openaiDelta('好'), '[DONE]']),
    );
    await expect(chat(settings, prompt)).resolves.toBe('好');
  });

  it('accepts a plain JSON reply from a provider that does not stream', async () => {
    stubFetch(() => Response.json({ choices: [{ message: { content: '你好' } }] }));
    const deltas: string[] = [];

    await expect(chat(settings, prompt, { onDelta: (text) => deltas.push(text) })).resolves.toBe('你好');
    expect(deltas).toEqual(['你好']);
  });

  it('throws with the status and response body on an HTTP error', async () => {
    stubFetch(() => new Response('invalid api key', { status: 401 }));
    await expect(chat(settings, prompt)).rejects.toThrow(/401.*invalid api key/);
  });

  it('throws when the provider reports an error in the middle of the stream', async () => {
    stubFetch(() => eventStream([openaiDelta('你'), { error: { message: 'rate limited' } }]));
    await expect(chat(settings, prompt)).rejects.toThrow('rate limited');
  });

  it('throws when the reply has no text', async () => {
    stubFetch(() => eventStream(['[DONE]']));
    await expect(chat(settings, prompt)).rejects.toThrow('空内容');
  });

  it('passes on cancellation from the caller', async () => {
    const sent = stubFetch(() => eventStream([openaiDelta('ok')]));
    const abort = new AbortController();

    await chat(settings, prompt, { signal: abort.signal });
    expect(sent.signal().aborted).toBe(false);

    abort.abort();
    expect(sent.signal().aborted).toBe(true);
  });
});

describe('chat over the Anthropic protocol', () => {
  const settings: Settings = {
    protocol: 'anthropic',
    baseUrl: 'https://api.example.com',
    apiKey: 'key-test',
    model: 'some-model',
  };

  const textDelta = (text: string) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text } });

  it('posts a streaming request to v1/messages and joins the text deltas', async () => {
    const sent = stubFetch(() =>
      eventStream([
        { type: 'message_start', message: {} },
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
        textDelta('你'),
        textDelta('好'),
        { type: 'message_stop' },
      ]),
    );

    await expect(chat(settings, prompt)).resolves.toBe('你好');

    expect(sent.url()).toBe('https://api.example.com/v1/messages');
    expect(sent.headers()['x-api-key']).toBe('key-test');
    expect(sent.body()).toMatchObject({
      model: 'some-model',
      stream: true,
      system: 'be brief',
      messages: [{ role: 'user', content: 'hello' }],
    });
  });

  it('accepts a base URL that already ends in /v1', async () => {
    const sent = stubFetch(() => eventStream([textDelta('ok')]));

    await chat({ ...settings, baseUrl: 'https://api.example.com/v1' }, prompt);

    expect(sent.url()).toBe('https://api.example.com/v1/messages');
  });

  it('throws on an error event', async () => {
    stubFetch(() => eventStream([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]));
    await expect(chat(settings, prompt)).rejects.toThrow('Overloaded');
  });
});
