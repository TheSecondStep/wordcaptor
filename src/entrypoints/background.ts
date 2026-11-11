import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createModelGate } from '@/lib/gate';
import { ModelError, chat } from '@/lib/llm';
import { MODEL_SLOTS, PRIORITY, rateWaitMs } from '@/lib/pace';
import {
  TOGGLE_MESSAGE,
  TRANSLATE_PORT,
  type Failure,
  type Reply,
  type Request,
  type Task,
  type TranslateEvent,
  type TranslateRequest,
} from '@/lib/messages';
import { cacheKey, getCached, pruneCache, putCached } from '@/lib/cache';
import {
  addKnown,
  isConfigured,
  loadReader,
  loadSettings,
  saveMode,
  saveReader,
  setSiteMuted,
  type Reader,
  type Settings,
} from '@/lib/settings';
import {
  annotatePrompt,
  briefPrompt,
  captionsPrompt,
  commandPrompt,
  createSegmentReader,
  explainPrompt,
  parseCommand,
  PROMPT_VERSION,
  translatePrompt,
  type Command,
} from '@/lib/translator';

const NOT_CONFIGURED: Failure = { ok: false, error: '还没有设置模型', notConfigured: true };
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Copied into the extension at build time; see wxt.config.ts. */
const FONT_DIR = '/fonts/xiaolai/';
const PROMPTS = { translate: translatePrompt, learn: annotatePrompt, captions: captionsPrompt };
/** One queue for every model call this worker makes, so a page and a video share the key's limit. */
const gate = createModelGate(MODEL_SLOTS, rateWaitMs);

// Model calls run here rather than in the page so they are not subject to the
// page's CORS and CSP rules.
export default defineBackground(() => {
  // Runs each time the worker starts, which is often enough to keep the cache from growing without bound.
  pruneCache(CACHE_MAX_AGE_MS).catch(() => {});
  browser.runtime.onMessage.addListener((request: Request, sender, sendResponse) => {
    handle(request, sender).then(sendResponse);
    return true; // keep the channel open for the async reply
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== TRANSLATE_PORT) return;
    // The tab closing or navigating away cancels the model call.
    const abort = new AbortController();
    port.onDisconnect.addListener(() => abort.abort());
    port.onMessage.addListener((request: TranslateRequest) => void translate(port, request, abort.signal));
  });

  browser.action.onClicked.addListener((tab) => toggleTab(tab.id));

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    toggleTab(tab?.id);
  });
});

function toggleTab(tabId: number | undefined) {
  if (tabId === undefined) return;
  // Rejects on pages where content scripts cannot run (browser pages, the
  // extension store). There is nothing to toggle there.
  browser.tabs.sendMessage(tabId, { type: TOGGLE_MESSAGE }).catch(() => {});
}

async function handle(request: Request, sender: Browser.runtime.MessageSender): Promise<Reply<unknown>> {
  try {
    if (request.type === 'load-font') {
      // Put in by the browser rather than by a link in the page, which a page can refuse to load. The
      // stylesheet only names the font's many small files; the page fetches the few it has characters for.
      if (sender.tab?.id !== undefined) {
        await browser.scripting.insertCSS({
          target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] },
          css: await (fontStyles ??= readFontStyles()),
        });
      }
      return { ok: true, value: null };
    }
    if (request.type === 'open-options') {
      await browser.runtime.openOptionsPage();
      return { ok: true, value: null };
    }
    const settings = await loadSettings();
    if (!isConfigured(settings)) return NOT_CONFIGURED;

    const reader = await loadReader();

    if (request.type === 'cached') {
      const keys = await Promise.all(request.texts.map((text) => outputKey(request.mode, settings, reader, text)));
      return { ok: true, value: await getCached(keys) };
    }
    if (request.type === 'explain') {
      const { selection, paragraph, title } = request;
      const value = await askModel(PRIORITY.interactive, neverAbort, () =>
        chat(settings, explainPrompt(selection, paragraph, title, reader)),
      );
      return { ok: true, value };
    }
    if (request.type === 'command') {
      const command = parseCommand(
        await askModel(PRIORITY.interactive, neverAbort, () => chat(settings, commandPrompt(request.said, reader, request.brief))),
      );
      await apply(command, reader, request.site);
      return { ok: true, value: command };
    }

    const key = await cacheKey('brief', PROMPT_VERSION, settings.model, request.title, request.text);
    const [saved] = await getCached([key]).catch(() => [null]);
    if (saved) return { ok: true, value: saved };
    const brief = await askModel(PRIORITY.page, neverAbort, () => chat(settings, briefPrompt(request.title, request.text)));
    save(key, brief);
    return { ok: true, value: brief };
  } catch (error) {
    return failure(error);
  }
}

let fontStyles: Promise<string> | undefined;

/**
 * The font's stylesheet, with the addresses of its files written out in full:
 * in a stylesheet the browser puts into a page, a relative address would be
 * looked for on the page's own site.
 */
async function readFontStyles(): Promise<string> {
  // WXT only types paths it finds in the public directory; the font is added by a build hook.
  const dir = (browser.runtime.getURL as (path: string) => string)(FONT_DIR);
  const styles = await (await fetch(`${dir}result.css`)).text();
  return styles.replaceAll('url("./', `url("${dir}`);
}

/** Stores what the reader asked for. Pages hear of it through the storage and adjust themselves. */
async function apply(command: Command, reader: Reader, site: string) {
  if (command.level || command.remember || command.forget) {
    const dropped = new Set(command.forget);
    await saveReader({
      level: command.level ?? reader.level,
      preferences: [...reader.preferences.filter((wish) => !dropped.has(wish)), ...(command.remember ?? [])],
    });
  }
  for (const phrase of command.known ?? []) await addKnown(phrase);
  if (command.mode) await saveMode(command.mode);
  if (command.muteSite && site) await setSiteMuted(site, true);
}

/**
 * Model output for a segment is saved under the segment's text, the mode, the
 * model that produced it, and what the prompt said about the reader, so a
 * change to any of them gives fresh output.
 */
function outputKey(mode: Task, settings: Settings, reader: Reader, text: string): Promise<string> {
  // The reader's level only shapes the notes of learn mode.
  const level = mode === 'learn' ? reader.level : '';
  return cacheKey(mode, PROMPT_VERSION, settings.model, level, reader.preferences.join('\n'), text);
}

/** Saving is best effort: if the cache cannot be written, the text is simply translated again next time. */
function save(key: string, value: string) {
  putCached(key, value).catch(() => {});
}

/** Translates or annotates one batch, posting each segment to the port as soon as the model finishes it. */
async function translate(port: Browser.runtime.Port, request: TranslateRequest, signal: AbortSignal) {
  const send = (event: TranslateEvent) => {
    if (!signal.aborted) port.postMessage(event);
  };
  try {
    const settings = await loadSettings();
    if (!isConfigured(settings)) {
      send({ type: 'end', failure: NOT_CONFIGURED });
      return;
    }
    const reader = await loadReader();
    const { mode, brief, context, segments } = request;
    const onDelta = createSegmentReader(segments.length, (index, text) => {
      // An empty translation is a failed one. An empty list of annotations is a valid answer.
      if (mode !== 'learn' && !text) return;
      send({ type: 'segment', index, text });
      void outputKey(mode, settings, reader, segments[index]!).then((key) => save(key, text));
    });
    const prompt = PROMPTS[mode](brief, context, segments, reader);
    await askModel(request.priority ?? PRIORITY.page, signal, () => chat(settings, prompt, { onDelta, signal }));
    send({ type: 'end' });
  } catch (error) {
    send({ type: 'end', failure: failure(error) });
  }
}

/** A signal that never aborts, for a call that has no caller to hang up on. */
const neverAbort = new AbortController().signal;

/**
 * Runs one model call in the shared queue. A rate limit comes back as a wait
 * the caller can show; the queue itself also holds whatever else is waiting.
 */
async function askModel(priority: number, signal: AbortSignal, run: () => Promise<string>): Promise<string> {
  await gate.acquire(priority, signal);
  try {
    const text = await run();
    gate.release('ok');
    return text;
  } catch (error) {
    if (error instanceof ModelError && error.retry === 'rate') {
      const wait = gate.release('rate', error.retryAfterMs);
      throw new ModelError(error.message, 'rate', wait);
    }
    gate.release('other');
    throw error;
  }
}

function failure(error: unknown): Failure {
  if (error instanceof ModelError) return { ok: false, error: error.message, retry: error.retry, retryAfterMs: error.retryAfterMs };
  const message = error instanceof Error ? error.message : String(error);
  // The tab went away. Retrying would talk to nobody.
  const aborted = error instanceof Error && error.name === 'AbortError';
  return { ok: false, error: message, retry: aborted ? 'stop' : 'once' };
}
