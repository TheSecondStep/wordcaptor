import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';

const EXTENSION_DIR = path.resolve(import.meta.dirname, '../.output/chrome-mv3');
const ARTICLE = path.resolve(import.meta.dirname, 'article.html');

export const LONG_ARTICLE_PARAGRAPHS = 16;
const SLOW_MODEL_DELAY_MS = 600;

/**
 * One page server plus a stand-in for an OpenAI-compatible streaming model.
 * The model name picks its behavior: `broken-model` answers 500, `slow-model`
 * waits before answering, anything else answers at once.
 */
interface FakeSite {
  origin: string;
  /** The system and user text of every model call, in order. */
  prompts: string[];
  /** The most translation calls that were ever in flight at the same time. */
  maxConcurrentTranslations: number;
}

interface Fixtures {
  site: FakeSite;
  context: BrowserContext;
  /** Fills in and saves the options page. */
  configure: (model: string) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  site: async ({}, use) => {
    const site: FakeSite = { origin: '', prompts: [], maxConcurrentTranslations: 0 };
    let translating = 0;
    let rateLimitedOnce = false;

    const server = createServer(async (request, response) => {
      if (request.url === '/article') {
        response.writeHead(200, { 'content-type': 'text/html' }).end(await readFile(ARTICLE));
        return;
      }
      if (request.url === '/strict') {
        // The same article behind a security policy that allows nothing but the site's own resources.
        // Its one inline style is dropped so that the page itself does not violate the policy.
        const html = (await readFile(ARTICLE, 'utf8')).replace(/ style="[^"]*"/, '');
        response
          .writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'" })
          .end(html);
        return;
      }
      if (request.url === '/feed') {
        response.writeHead(200, { 'content-type': 'text/html' }).end(feed());
        return;
      }
      if (request.url === '/long') {
        response.writeHead(200, { 'content-type': 'text/html' }).end(longArticle());
        return;
      }
      if (request.url === '/empty') {
        response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Nothing</title><body>');
        return;
      }
      if (request.url === '/embed') {
        response.writeHead(200, { 'content-type': 'text/html' }).end(embed(site.origin));
        return;
      }
      if (request.url === '/v1/models') {
        const data = [{ id: 'good-model' }, { id: 'slow-model' }];
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data }));
        return;
      }
      if (request.url === '/v1/chat/completions') {
        let raw = '';
        for await (const chunk of request) raw += chunk;
        const body = JSON.parse(raw);
        if (body.model === 'broken-model') {
          response.writeHead(500).end('model exploded');
          return;
        }
        const [system, user] = body.messages.map((message: { content: string }) => message.content);
        site.prompts.push(`${system}\n${user}`);
        // The first translation is told to slow down, so a caller can be seen waiting and then sending a later stretch.
        if (body.model === 'once-limited' && user.includes('<s id=') && !rateLimitedOnce) {
          rateLimitedOnce = true;
          response.writeHead(429, { 'retry-after': '3' }).end('too many requests');
          return;
        }
        const reply = fakeReply(system, user);
        const isTranslation = reply.startsWith('<s');

        if (isTranslation) site.maxConcurrentTranslations = Math.max(site.maxConcurrentTranslations, ++translating);
        if (body.model === 'slow-model') await sleep(SLOW_MODEL_DELAY_MS);

        // Streamed a few characters at a time, so tags arrive split across events.
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        for (let i = 0; i < reply.length; i += 7) {
          const delta = { choices: [{ delta: { content: reply.slice(i, i + 7) } }] };
          response.write(`data: ${JSON.stringify(delta)}\n\n`);
        }
        response.end('data: [DONE]\n\n');
        if (isTranslation) translating--;
        return;
      }
      response.writeHead(404).end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    site.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await use(site);
    server.close();
  },

  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      // The sprite never holds still otherwise, and Playwright waits for stillness before clicking.
      reducedMotion: 'reduce',
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    await use(context);
    await context.close();
  },

  configure: async ({ context, site }, use) => {
    await use(async (model) => {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const extensionId = new URL(worker.url()).host;
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId}/options.html`);
      await options.getByLabel('接口地址').fill(`${site.origin}/v1`);
      await options.getByLabel('密钥').fill('test-key');
      await options.getByLabel('模型', { exact: true }).fill(model);
      await options.getByRole('button', { name: '保存', exact: true }).click();
      await expect(options.getByRole('status')).toHaveText('已保存');
      await options.close();
    });
  },
});

/** The expressions the fake model annotates in learn mode, wherever they occur. */
const FAKE_GLOSSES: Record<string, string> = {
  'source code': '源代码',
  'several passes': '好几遍',
  'far below': '远在下方',
};

/** What the fake model makes of things said to the sprite. Anything else gets a plain answer. */
const FAKE_COMMANDS: Record<string, object> = {
  '译文口语一点': { reply: '记住啦', remember: ['译文口语一点'] },
  '我过六级了': { reply: '好的，按六级来', level: 'cet6' },
};

/**
 * Translation calls get each segment back prefixed with 译：. Calls for
 * subtitles get each segment back five words to a line, as a sentence and its
 * translation. Learn-mode calls
 * get the known expressions in each segment, and a whole translation for the
 * far paragraph. Of the calls without segments, one about a selection is a
 * request to explain it, one that asks for JSON is something said to the
 * sprite, and the rest are briefs.
 */
function fakeReply(system: string, user: string): string {
  const segments = [...user.matchAll(/<s id="(\d+)">([\s\S]*?)<\/s>/g)];
  if (segments.length === 0) {
    const selection = /他选中的是：(.*)$/.exec(user)?.[1];
    if (selection) return `解释：${selection}`;
    if (system.includes('JSON')) return JSON.stringify(FAKE_COMMANDS[user] ?? { reply: '收到' });
    return '主题：编译器入门';
  }
  const isLearnMode = system.includes('批注');
  return segments
    .map(([, id, text]) => {
      if (system.includes('双语字幕')) {
        const words = text!.split(' ');
        const lines = Array.from({ length: Math.ceil(words.length / 5) }, (_, line) => {
          const said = words.slice(line * 5, line * 5 + 5).join(' ');
          return `${said[0]!.toUpperCase()}${said.slice(1)}. || 译：${said}`;
        });
        return `<s id="${id}">${lines.join('\n')}</s>`;
      }
      const lines = Object.entries(FAKE_GLOSSES)
        .filter(([phrase]) => text!.includes(phrase))
        .map(([phrase, gloss]) => `${phrase} = ${gloss}`);
      if (text!.includes('far below')) lines.push(`>> 整段：${text}`);
      return `<s id="${id}">${isLearnMode ? lines.join('\n') : `译：${text}`}</s>`;
    })
    .join('\n');
}

/** A feed in the shape of X: posts are not paragraphs, and more of them arrive later. */
function feed(): string {
  const post = (text: string) => `<article><div data-testid="tweetText" lang="en"><span>${text}</span></div></article>`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>A feed</title></head>
    <body><main id="feed">
      ${post('The first post in the feed.')}
      ${post('The second post in the feed.')}
      ${post('The third post in the feed.')}
    </main></body></html>`;
}

/**
 * A page in the shape of a Hugging Face Space: nothing to read of its own, the
 * article shown in a large frame from another origin, and the same article
 * again in a frame the size of a widget.
 */
function embed(origin: string): string {
  // The same server under its other name, which the browser treats as another origin.
  const article = `${origin.replace('127.0.0.1', 'localhost')}/article`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>An embedded article</title></head>
    <body style="margin: 0">
      <iframe id="content" src="${article}" style="display: block; width: 100%; height: 560px; border: 0"></iframe>
      <iframe id="widget" src="${article}" style="width: 300px; height: 100px; border: 0"></iframe>
    </body></html>`;
}

/** A page whose first screen needs several translation batches. */
function longArticle(): string {
  const paragraphs = Array.from(
    { length: LONG_ARTICLE_PARAGRAPHS },
    (_, i) => `<p>Paragraph number ${i + 1} of a long article.</p>`,
  );
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>A long article</title></head>
    <body><article>${paragraphs.join('')}</article></body></html>`;
}

/** Whether the page has finished loading at least one file of the handwriting font. */
export function handwritingFontLoaded(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.fonts].some((face) => face.family.includes('Xiaolai') && face.status === 'loaded'),
  );
}

export function sprite(page: Page) {
  return page.locator('#wisp-sprite .body');
}

/** The small button on the sprite that switches between translate mode and learn mode. */
export function modeButton(page: Page) {
  return page.locator('#wisp-sprite .mode');
}

/** Stands in for a click on the extension's toolbar icon while the given page is the active tab. */
export async function clickToolbarIcon(context: BrowserContext, page: Page) {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async (url) => {
    // Runs inside the extension's worker, where `chrome` exists. Events there can be fired by hand.
    const { tabs, action } = (globalThis as any).chrome;
    const [tab] = await tabs.query({ url });
    action.onClicked.dispatch(tab);
  }, page.url());
}

/** The button on the sprite that opens the box for talking to her. */
export function talkButton(page: Page) {
  return page.locator('#wisp-sprite .talk');
}

export function bubble(page: Page) {
  return page.locator('#wisp-sprite .bubble');
}

export { expect };
