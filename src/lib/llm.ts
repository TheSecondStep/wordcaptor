import { parseRetryAfter, retryFor, type Retry } from './pace';
import { findProvider } from './providers';
import type { Settings } from './settings';

/** A model call that failed. `retry` says whether trying again could succeed. */
export class ModelError extends Error {
  readonly retry: Retry;
  readonly retryAfterMs?: number;

  constructor(message: string, retry: Retry, retryAfterMs?: number) {
    super(message);
    this.name = 'ModelError';
    this.retry = retry;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface Prompt {
  system: string;
  user: string;
}

export interface ChatOptions {
  /** Called with each piece of text as the model produces it. */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

const TIMEOUT_MS = 90_000;
const MAX_OUTPUT_TOKENS = 8192;

/**
 * Sends one prompt to the configured model and returns its full text reply,
 * reporting the text piece by piece along the way. Two wire protocols cover
 * nearly every provider: OpenAI-compatible chat completions and
 * Anthropic-compatible messages.
 */
export async function chat(settings: Settings, prompt: Prompt, options: ChatOptions = {}): Promise<string> {
  const request = settings.protocol === 'anthropic' ? anthropicRequest(settings, prompt) : openaiRequest(settings, prompt);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
      signal,
    });
  } catch (error) {
    // The caller hanging up is its own business. A dropped connection can be tried once more.
    if (options.signal?.aborted) throw error;
    throw new ModelError(error instanceof Error ? error.message : String(error), 'once');
  }

  if (!response.ok) {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
    const detail = (await response.text()).slice(0, 300);
    throw new ModelError(`模型接口返回 ${response.status}：${detail}`, retryFor(response.status, detail), retryAfterMs);
  }

  let text: string;
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    text = await readEventStream(response, request.readDelta, options.onDelta);
  } else {
    // A provider that ignores `stream: true` answers with one JSON document.
    text = request.readWhole(await response.json()) ?? '';
    if (text) options.onDelta?.(text);
  }

  if (!text) throw new ModelError('模型接口返回了空内容', 'once');
  return text;
}

/**
 * Asks the service which models the key can use. Both protocols answer
 * `{ data: [{ id }] }`. Services without such a list make this reject, and the
 * model name is then typed by hand.
 */
export async function listModels(settings: Pick<Settings, 'protocol' | 'baseUrl' | 'apiKey'>): Promise<string[]> {
  const base = trimBase(settings.baseUrl);
  const response = await fetch(
    settings.protocol === 'anthropic' ? `${base.replace(/\/v1$/, '')}/v1/models` : `${base}/models`,
    {
      headers:
        settings.protocol === 'anthropic'
          ? { 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
          : { authorization: `Bearer ${settings.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error(`模型列表接口返回 ${response.status}`);
  const json = await response.json();
  return (json?.data ?? []).map((model: { id: string }) => model.id).filter(Boolean);
}

interface WireRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** Text carried by one stream event, if any. */
  readDelta: (event: any) => string | undefined;
  /** Text of a complete, non-streamed reply. */
  readWhole: (json: any) => string | undefined;
}

function openaiRequest(settings: Settings, prompt: Prompt): WireRequest {
  return {
    url: `${trimBase(settings.baseUrl)}/chat/completions`,
    headers: { authorization: `Bearer ${settings.apiKey}` },
    body: {
      model: settings.model,
      stream: true,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      // Only sent where the service is known to take it; others reject fields they do not know.
      ...(findProvider('openai', settings.baseUrl)?.thinkingSwitch && { thinking: { type: 'disabled' } }),
    },
    readDelta: (event) => event?.choices?.[0]?.delta?.content,
    readWhole: (json) => json?.choices?.[0]?.message?.content,
  };
}

function anthropicRequest(settings: Settings, prompt: Prompt): WireRequest {
  // Accept the base URL with or without a trailing /v1.
  const base = trimBase(settings.baseUrl).replace(/\/v1$/, '');
  return {
    url: `${base}/v1/messages`,
    headers: {
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      // Required by api.anthropic.com for requests that carry a browser Origin.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: {
      model: settings.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      stream: true,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    },
    readDelta: (event) => (event?.delta?.type === 'text_delta' ? event.delta.text : undefined),
    readWhole: (json) =>
      json?.content
        ?.filter((part: any) => part.type === 'text')
        .map((part: any) => part.text)
        .join(''),
  };
}

async function readEventStream(
  response: Response,
  readDelta: WireRequest['readDelta'],
  onDelta: ChatOptions['onDelta'],
): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop()!; // the last line may still be incomplete

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let event: any;
      try {
        event = JSON.parse(data);
      } catch {
        continue; // not ours to interpret
      }
      if (event.error) {
        const detail = JSON.stringify(event.error).slice(0, 300);
        throw new ModelError(`模型接口中途报错：${detail}`, retryFor(0, detail));
      }

      const delta = readDelta(event);
      if (delta) {
        text += delta;
        onDelta?.(delta);
      }
    }
    if (done) return text;
  }
}

function trimBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}
