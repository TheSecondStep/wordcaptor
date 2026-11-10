import type { BrowserContext } from '@playwright/test';
import {
  bubble,
  clickToolbarIcon,
  expect,
  handwritingFontLoaded,
  LONG_ARTICLE_PARAGRAPHS,
  modeButton,
  sprite,
  talkButton,
  test,
} from './fixtures';

const translationOf = (id: string) => `#${id} .wisp-translation`;

test('translates the reading content near the viewport and nothing else', async ({ context, site, configure }) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);

  await expect(page.locator('.wisp-translation')).toHaveCount(0); // nothing happens uninvited
  await sprite(page).click();

  await expect(page.locator(translationOf('title'))).toHaveText('译：How compilers work');
  await expect(page.locator(translationOf('first'))).toHaveText('译：A compiler turns source code into machine code.');
  await expect(page.locator(translationOf('second'))).toHaveText('译：It does so in several passes over the program.');

  // Site chrome, code, and content far below the screen are left alone.
  await expect(page.locator('.wisp-translation')).toHaveCount(3);
  expect(site.prompts.join('\n')).not.toMatch(/site header|Home page link|Copyright notice|let answer/);

  // Scrolling to the far paragraph translates it, with the brief and the preceding text as context.
  await page.locator('#far').scrollIntoViewIfNeeded();
  await expect(page.locator(translationOf('far'))).toHaveText('译：This paragraph sits far below the first screen.');
  expect(site.prompts.at(-1)).toContain('主题：编译器入门');
  expect(site.prompts.at(-1)).toContain('<context>It does so in several passes over the program.</context>');
});

test('writes translations in the handwriting font, loaded only once translating starts', async ({
  context,
  site,
  configure,
}) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);
  expect(await handwritingFontLoaded(page)).toBe(false);

  await sprite(page).click();

  const translation = page.locator(translationOf('first'));
  await expect(translation).toHaveCSS('font-family', /^"Xiaolai SC"/);
  await expect.poll(() => handwritingFontLoaded(page)).toBe(true);
});

test('works on a page with a strict content security policy', async ({ context, site, configure }) => {
  await configure('good-model');
  const page = await context.newPage();
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });
  await page.goto(`${site.origin}/strict`);

  await sprite(page).click();

  await expect(page.locator(translationOf('first'))).toBeVisible();
  await expect.poll(() => handwritingFontLoaded(page)).toBe(true);
  expect(violations).toEqual([]);
});

test('translates several batches at once, each with its own light', async ({ context, site, configure }) => {
  await configure('slow-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/long`);

  await sprite(page).click();

  // Three batches: the sprite takes the first, two smaller lights split off for the others.
  const motes = page.locator('#wisp-sprite .mote');
  await expect(motes).toHaveCount(2);

  await expect(page.locator('.wisp-translation')).toHaveCount(LONG_ARTICLE_PARAGRAPHS);
  await expect(motes).toHaveCount(0);
  expect(site.maxConcurrentTranslations).toBeGreaterThan(1);

  // The first batch did not wait for the page brief; the later ones carry it.
  const translations = site.prompts.filter((prompt) => prompt.includes('<s id="1">'));
  expect(translations).toHaveLength(3);
  expect(translations.filter((prompt) => prompt.includes('主题：编译器入门'))).toHaveLength(2);
});

test('reuses saved translations when the page is opened again', async ({ context, site, configure }) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);
  await sprite(page).click();
  await expect(page.locator('.wisp-translation')).toHaveCount(3);
  const callsOnFirstVisit = site.prompts.length;

  // Wordcaptor is still on after the reload, so the page starts by itself.
  await page.reload();

  await expect(page.locator(translationOf('first'))).toHaveText('译：A compiler turns source code into machine code.');
  await expect(page.locator('.wisp-translation')).toHaveCount(3);
  expect(site.prompts).toHaveLength(callsOnFirstVisit); // the model was not called again

  // A paragraph not translated last time still goes to the model; the saved brief is reused.
  await page.locator('#far').scrollIntoViewIfNeeded();
  await expect(page.locator(translationOf('far'))).toBeVisible();
  expect(site.prompts).toHaveLength(callsOnFirstVisit + 1);

  // Translations are kept per model.
  await configure('another-model');
  await page.reload();
  await page.locator('#first').scrollIntoViewIfNeeded(); // the reload kept the scroll position at the far paragraph
  await expect(page.locator(translationOf('first'))).toBeVisible();
  expect(site.prompts.length).toBeGreaterThan(callsOnFirstVisit + 1);
});

test('learn mode notes hard expressions instead of translating, and forgets the ones marked as known', async ({
  context,
  site,
  configure,
}) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);
  const glosses = page.locator('.wisp-gloss');
  const noteOn = (phrase: string) => page.locator('.wisp-gloss', { hasText: phrase }).locator('rt');

  await modeButton(page).click();

  await expect(modeButton(page)).toHaveText('学');
  await expect(noteOn('source code')).toHaveText('源代码');
  await expect(noteOn('several passes')).toHaveText('好几遍');
  await expect(glosses).toHaveCount(2);
  await expect(page.locator('.wisp-translation')).toHaveCount(0);
  // The page's own text is intact around the notes.
  await expect(page.locator('#first')).toHaveText('A compiler turns source code源代码 into machine code.');

  // Clicking a note marks the expression as known and takes the note away.
  await noteOn('source code').click();
  await expect(glosses).toHaveCount(1);
  await expect(page.locator('#first')).toHaveText('A compiler turns source code into machine code.');

  // The mode and the known expression are remembered, and the notes come from the cache.
  const calls = site.prompts.length;
  await page.reload();
  await expect(noteOn('several passes')).toBeVisible();
  await expect(glosses).toHaveCount(1);
  expect(site.prompts).toHaveLength(calls);

  // Switching back writes translations and hides the notes, without losing them.
  await modeButton(page).click();
  await expect(page.locator(translationOf('first'))).toBeVisible();
  await expect(noteOn('several passes')).toBeHidden();
  await modeButton(page).click();
  await expect(noteOn('several passes')).toBeVisible();
  await expect(page.locator(translationOf('first'))).toBeHidden();
});

test('picks up posts in a feed, including ones that load later', async ({ context, site, configure }) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/feed`);

  await sprite(page).click();
  await expect(page.locator('.wisp-translation')).toHaveCount(3);

  await page.evaluate(() => {
    document.querySelector('#feed')!.insertAdjacentHTML(
      'beforeend',
      '<article><div data-testid="tweetText" lang="en"><span>A post that arrived later.</span></div></article>',
    );
  });

  await expect(page.locator('.wisp-translation').last()).toHaveText('译：A post that arrived later.');
  await expect(page.locator('.wisp-translation')).toHaveCount(4);
});

test('translates a menu only once the pointer rests in it', async ({ context, site, configure }) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);
  await sprite(page).click();
  await expect(page.locator('.wisp-translation')).toHaveCount(3);

  // Passing over the menu on the way somewhere else does not count.
  await page.locator('#nav-item').hover();
  await page.locator('#first').hover();
  await page.waitForTimeout(600);
  await expect(page.locator('.wisp-translation')).toHaveCount(3);

  await page.locator('#nav-item').hover();
  await expect(page.locator(translationOf('nav-item'))).toHaveText('译：Home page link');
  // Only that region: the site header and footer are still left alone.
  await expect(page.locator('.wisp-translation')).toHaveCount(4);

  // The same goes for text in the article that was not recognized as a paragraph.
  await page.locator('#loose').hover();
  await expect(page.locator(translationOf('loose'))).toHaveText(
    '译：A loose line that is not marked up as a paragraph.',
  );
  await expect(page.locator('.wisp-translation')).toHaveCount(5);
});

test('alt-clicking a translation asks the model for a new one', async ({ context, site, configure }) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);
  await sprite(page).click();
  const translation = page.locator(translationOf('first'));
  await expect(page.locator('.wisp-translation')).toHaveCount(3);
  const calls = site.prompts.length;

  await translation.click(); // a plain click does nothing
  await translation.click({ modifiers: ['Alt'] });

  await expect.poll(() => site.prompts.length).toBe(calls + 1);
  expect(site.prompts.at(-1)).toContain('<s id="1">A compiler turns source code into machine code.</s>');
  await expect(translation).toHaveText('译：A compiler turns source code into machine code.');
  await expect(page.locator('.wisp-translation')).toHaveCount(3);
});

test('the toolbar icon starts translating and then hides and shows, like the sprite', async ({
  context,
  site,
  configure,
}) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);
  const translation = page.locator(translationOf('first'));

  await clickToolbarIcon(context, page);
  await expect(translation).toBeVisible();

  await clickToolbarIcon(context, page);
  await expect(translation).toBeHidden();
});

test('works inside a large frame from another origin, and leaves widget-sized frames alone', async ({
  context,
  site,
  configure,
}) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/embed`);
  const content = page.frameLocator('#content');
  const widget = page.frameLocator('#widget');

  // The sprite lives in the frame that has something to read.
  await expect(content.locator('#wisp-sprite .body')).toBeVisible();
  await expect(page.locator('#wisp-sprite')).toHaveCount(0);

  await clickToolbarIcon(context, page);
  await expect(content.locator(translationOf('first'))).toHaveText(
    '译：A compiler turns source code into machine code.',
  );

  // The outer page does not complain that it has nothing to read, and the widget is not touched.
  await expect(page.locator('#wisp-sprite')).toHaveCount(0);
  await expect(widget.locator('#wisp-sprite')).toHaveCount(0);
  await expect(widget.locator('.wisp-translation')).toHaveCount(0);
});

test('the toolbar icon says so when the page has nothing to read', async ({ context, site, configure }) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/empty`);

  await clickToolbarIcon(context, page);
  await expect(bubble(page)).toContainText('没找到英文正文');
});

test('stays on, or off, from one page to the next and across open tabs', async ({ context, site, configure }) => {
  await configure('good-model');
  const first = await context.newPage();
  await first.goto(`${site.origin}/article`);
  await sprite(first).click();
  await expect(first.locator(translationOf('first'))).toBeVisible();

  // A page opened afterwards starts by itself, in the same mode.
  const second = await context.newPage();
  await second.goto(`${site.origin}/long`);
  await expect(second.locator('.wisp-translation').first()).toBeVisible();

  // Turned off there, it is off in the tab that was already open, and stays off on the next page.
  await sprite(second).click();
  await expect(second.locator('.wisp-translation').first()).toBeHidden();
  await expect(first.locator(translationOf('first'))).toBeHidden();
  await second.goto(`${site.origin}/feed`);
  await expect(sprite(second)).toBeVisible();
  await second.waitForTimeout(600);
  await expect(second.locator('.wisp-translation')).toHaveCount(0);

  // The mode travels the same way.
  await modeButton(second).click();
  await expect(modeButton(first)).toHaveText('学');
  await expect(first.locator('.wisp-gloss').first()).toBeVisible();
});

test('sent away from a site, stays away until called back with the toolbar icon', async ({
  context,
  site,
  configure,
}) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);
  await sprite(page).click();
  await expect(page.locator(translationOf('first'))).toBeVisible();

  await page.locator('#wisp-sprite .close').click();
  await expect(page.locator('#wisp-sprite')).toHaveCount(0);
  await expect(page.locator(translationOf('first'))).toBeHidden();

  await page.goto(`${site.origin}/long`);
  await page.waitForTimeout(600);
  await expect(page.locator('#wisp-sprite')).toHaveCount(0);
  await expect(page.locator('.wisp-translation')).toHaveCount(0);

  await clickToolbarIcon(context, page);
  await expect(sprite(page)).toBeVisible();
  await expect(page.locator('.wisp-translation').first()).toBeVisible();
});

test('explains a selection the reader asks about, in a note that is clicked away', async ({
  context,
  site,
  configure,
}) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);
  await sprite(page).click();
  await expect(page.locator(translationOf('first'))).toBeVisible();

  await page.locator('#second').dblclick({ position: { x: 100, y: 8 } }); // selects one word
  const selected = await page.evaluate(() => getSelection()!.toString().trim());
  await page.locator('#wisp-sprite .question').click();

  const note = page.locator('#second .wisp-note');
  await expect(note).toHaveText(`解释：${selected}`);
  expect(site.prompts.at(-1)).toContain('所在段落：It does so in several passes over the program.');

  await note.click();
  await expect(note).toHaveCount(0);
});

test('takes on the one paragraph the sprite is dropped on, without being switched on', async ({
  context,
  site,
  configure,
}) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);

  await sprite(page).dragTo(page.locator('#second'), { targetPosition: { x: 60, y: 8 } });

  await expect(page.locator('#second .wisp-sentence')).toHaveText('译：It does so in several passes over the program.');
  await expect(page.locator('.wisp-sentence')).toHaveCount(1);
  await expect(page.locator('.wisp-translation')).toHaveCount(0);

  // Dropped on nothing, she stays where she was put, and the drop is not taken for a click.
  await sprite(page).dragTo(page.locator('body'), { targetPosition: { x: 300, y: 300 } });
  await page.waitForTimeout(300);
  const box = (await sprite(page).boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 300)).toBeLessThan(40);
  await expect(page.locator('.wisp-translation')).toHaveCount(0);
});

test('learn mode gives a whole translation where notes are not enough, and wherever it is asked for', async ({
  context,
  site,
  configure,
}) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);
  await modeButton(page).click();
  await expect(page.locator('.wisp-gloss')).toHaveCount(2);
  await expect(page.locator('.wisp-sentence')).toHaveCount(0);

  await page.locator('#second').click({ modifiers: ['Alt'], position: { x: 300, y: 8 } });
  await expect(page.locator('#second .wisp-sentence')).toHaveText('译：It does so in several passes over the program.');

  await page.locator('#far').scrollIntoViewIfNeeded();
  await expect(page.locator('#far .wisp-sentence')).toHaveText('整段：This paragraph sits far below the first screen.');
});

test('keeps what the reader tells the sprite, and follows it from then on', async ({ context, site, configure }) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);
  await sprite(page).click();
  await expect(page.locator('.wisp-translation')).toHaveCount(3);

  await talkButton(page).click();
  await page.locator('#wisp-sprite input').fill('译文口语一点');
  await page.keyboard.press('Enter');
  await expect(bubble(page)).toHaveText('记住啦');

  await page.locator('#far').scrollIntoViewIfNeeded();
  await expect(page.locator(translationOf('far'))).toBeVisible();
  expect(site.prompts.at(-1)).toContain('- 译文口语一点');
});

test('the options page fills in a known provider, and lists the models a key can use', async ({ context, site }) => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const options = await context.newPage();
  await options.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);

  await options.getByLabel('用哪家的模型').selectOption({ label: '智谱 GLM Coding Plan' });
  await expect(options.getByLabel('接口地址')).toBeHidden();
  await expect(options.getByLabel('接口地址')).toHaveValue('https://open.bigmodel.cn/api/coding/paas/v4');
  await expect(options.locator('#plan-note')).toBeVisible();

  await options.getByLabel('用哪家的模型').selectOption('');
  await expect(options.locator('#plan-note')).toBeHidden();
  await options.getByLabel('接口地址').fill(`${site.origin}/v1`);
  await options.getByLabel('密钥').fill('test-key');
  await options.getByLabel('密钥').blur();
  await expect(options.getByLabel('模型', { exact: true })).toHaveValue('good-model');
  await expect(options.locator('#models option')).toHaveCount(2);

  // The key is hidden while typed, and shown on demand, so it can be checked and replaced.
  await expect(options.getByLabel('密钥')).toHaveAttribute('type', 'password');
  await options.getByRole('button', { name: '显示' }).click();
  await expect(options.getByLabel('密钥')).toHaveAttribute('type', 'text');
  await options.getByLabel('密钥').fill('another-key');
  await options.getByRole('button', { name: '保存', exact: true }).click();
  await expect(options.getByRole('status')).toHaveText('已保存');

  await options.reload();
  await expect(options.getByLabel('密钥')).toHaveValue('another-key');
  await options.getByRole('button', { name: '显示' }).click();
  await options.getByRole('button', { name: '隐藏' }).click();
  await expect(options.getByLabel('密钥')).toHaveAttribute('type', 'password');
});

test('clicking the sprite again hides and re-shows the translations', async ({ context, site, configure }) => {
  await configure('good-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);

  await sprite(page).click();
  const translation = page.locator(translationOf('first'));
  await expect(translation).toBeVisible();

  await sprite(page).click();
  await expect(translation).toBeHidden();

  await sprite(page).click();
  await expect(translation).toBeVisible();
  expect(site.prompts.filter((prompt) => prompt.includes('<s id="1">'))).toHaveLength(1); // no re-translation
});

test('reports a model failure and retries on the next click', async ({ context, site, configure }) => {
  await configure('broken-model');
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);

  await sprite(page).click();
  await expect(bubble(page)).toContainText('500');
  await expect(bubble(page)).toContainText('model exploded');
  await expect(page.locator('.wisp-translation')).toHaveCount(0);

  await configure('good-model');
  await sprite(page).click();
  await expect(page.locator(translationOf('first'))).toBeVisible();
});

test('opens the options page when no model is configured', async ({ context, site }) => {
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);

  const optionsPage = context.waitForEvent('page');
  await sprite(page).click();

  expect((await optionsPage).url()).toMatch(/^chrome-extension:\/\/.+\/options\.html$/);
  await expect(bubble(page)).toContainText('先告诉我用哪个模型');
});

/** The extension API, as the service worker sees it. */
declare const chrome: typeof import('wxt/browser').browser;

test('notes fade with reading, come back when looked at, and the level follows what the reader does', async ({
  context,
  site,
  configure,
}) => {
  await configure('good-model');
  const worker = context.serviceWorkers()[0]!;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await worker.evaluate(
    (stored) => chrome.storage.local.set(stored),
    {
      // One expression read on eight earlier days, and a reader one sealed note short of the next level.
      seen: { 'source code': { count: 8, day: yesterday, page: 'elsewhere' } },
      evidence: { level: 'cet4', known: 11, stuck: 0 },
    },
  );
  const stored = (key: string): Promise<any> =>
    worker.evaluate(async (name) => (await chrome.storage.local.get(name))[name], key);
  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);
  await modeButton(page).click();
  const gloss = (phrase: string) => page.locator('.wisp-gloss', { hasText: phrase });

  // The well-read note is hidden, the new one is not.
  await expect(gloss('source code')).toHaveAttribute('data-wisp-fade', '3');
  await expect(gloss('source code').locator('rt')).toHaveCSS('opacity', '0');
  await expect(gloss('several passes')).not.toHaveAttribute('data-wisp-fade');

  // Staying on the page for as long as the paragraph takes to read counts as one reading.
  await expect.poll(async () => (await stored('seen'))['several passes']?.count, { timeout: 10_000 }).toBe(1);

  // Resting the pointer on a faded note says it is still needed.
  await gloss('source code').hover();
  await expect(gloss('source code')).not.toHaveAttribute('data-wisp-fade');
  expect((await stored('seen'))['source code']).toBeUndefined();

  // The twelfth note put away raises the level, and she says so.
  await gloss('several passes').locator('rt').click();
  await expect(bubble(page)).toContainText('六级');
  expect((await stored('reader')).level).toBe('cet6');
});

/**
 * Opens a stand-in for YouTube's watch page: a player with captions turned on,
 * which loads its caption track the way YouTube's does. Returns the page, the
 * two lines Wordcaptor shows over the player, and a way to move the video.
 */
async function watchVideo(context: BrowserContext, captions: { events: object[]; automatic: boolean }) {
  await context.serviceWorkers()[0]!.evaluate(() => chrome.storage.local.set({ enabled: true }));
  const sound = silence(300);
  await context.route('https://www.youtube.com/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/timedtext') return route.fulfill({ json: { events: captions.events } });
    if (pathname === '/silence.wav') {
      // Served in ranges, as a player asks for it, or the browser will not seek in it.
      const [, first = '0', last] = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '') ?? [];
      const end = last ? Number(last) : sound.length - 1;
      return route.fulfill({
        status: 206,
        contentType: 'audio/wav',
        headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${first}-${end}/${sound.length}` },
        body: sound.subarray(Number(first), end + 1),
      });
    }
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><title>A talk</title><body>
        <div id="movie_player" class="html5-video-player" style="position: relative; width: 800px; height: 450px">
          <video src="/silence.wav" muted></video>
          <button class="ytp-subtitles-button" aria-pressed="true"></button>
        </div>
        <script>fetch('/api/timedtext?v=talk&lang=en&fmt=srv3${captions.automatic ? '&kind=asr' : ''}')</script>
      </body></html>`,
    });
  });
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=talk');
  const video = page.locator('video');
  return {
    page,
    lines: page.locator('.wisp-subtitle > span'),
    async seek(seconds: number) {
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThan(0);
      await video.evaluate((element: HTMLVideoElement, time: number) => void (element.currentTime = time), seconds);
    },
  };
}

test('YouTube captions get a handwritten translation, ahead of the video, and from the cache the second time', async ({
  context,
  site,
  configure,
}) => {
  await configure('good-model');
  // A hundred captions of three seconds each.
  const events = Array.from({ length: 100 }, (_, i) => ({
    tStartMs: i * 3000,
    dDurationMs: 3000,
    segs: [{ utf8: `Caption number ${i + 1}.` }],
  }));
  const { page, lines, seek } = await watchVideo(context, { events, automatic: false });
  const translationCalls = () => site.prompts.filter((prompt) => prompt.includes('<s id=')).length;

  await seek(7.5);
  await expect(lines).toHaveText(['Caption number 3.', '译：Caption number 3.']);
  await expect(lines.last()).toHaveCSS('font-family', /Xiaolai/);
  await expect.poll(() => handwritingFontLoaded(page)).toBe(true);
  // Never written under, as text on a page would be.
  await expect(page.locator('.wisp-translation')).toHaveCount(0);

  // The next three minutes are translated before they play, the video standing still, and no more than that.
  await expect.poll(() => site.prompts.some((prompt) => prompt.includes('Caption number 63.'))).toBe(true);
  expect(translationCalls()).toBe(4);
  expect(site.prompts.some((prompt) => prompt.includes('Caption number 64.'))).toBe(false);

  // A jump lands outside of what is translated: only the stretch from there on is asked for.
  await seek(271.5);
  await expect(lines).toHaveText(['Caption number 91.', '译：Caption number 91.']);
  await expect.poll(translationCalls).toBe(5);

  // Watched again, everything seen before comes from the cache.
  await page.reload();
  await seek(7.5);
  await expect(lines).toHaveText(['Caption number 3.', '译：Caption number 3.']);
  await seek(286.5);
  await expect(lines).toHaveText(['Caption number 96.', '译：Caption number 96.']);
  expect(translationCalls()).toBe(5);
});

test("YouTube's automatic captions are shown as the sentences the model makes of them, each when it is spoken", async ({
  context,
  site,
  configure,
}) => {
  await configure('slow-model');
  // Thirty words half a second apart, with nothing to say where a sentence ends.
  const segs = Array.from({ length: 30 }, (_, i) => ({ utf8: ` w${i + 1}`, tOffsetMs: i * 500 }));
  const { page, lines, seek } = await watchVideo(context, { events: [{ tStartMs: 0, segs }], automatic: true });

  // Until the model has answered, the words as they come.
  await seek(3.2);
  await expect(lines.first()).toHaveText(/^w1 w2 w3 /);
  await expect(lines.last()).toBeHidden();

  // Then its sentences. The one on screen is the one whose words are being spoken: w7 is, at 3.2 seconds.
  await expect(lines).toHaveText(['W6 w7 w8 w9 w10.', '译：w6 w7 w8 w9 w10']);
  await seek(12.7);
  await expect(lines).toHaveText(['W26 w27 w28 w29 w30.', '译：w26 w27 w28 w29 w30']);
  expect(site.prompts.filter((prompt) => prompt.includes('<s id='))).toHaveLength(1);

  // The sentences are saved with the passage they were made of.
  await page.reload();
  await seek(5.1);
  await expect(lines).toHaveText(['W11 w12 w13 w14 w15.', '译：w11 w12 w13 w14 w15']);
  expect(site.prompts.filter((prompt) => prompt.includes('<s id='))).toHaveLength(1);
});

/** A sound file of nothing, for a video element to have a timeline. */
function silence(seconds: number): Buffer {
  const RATE = 8000;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + seconds * RATE, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34); // bits per sample; 128 is silence
  header.write('data', 36);
  header.writeUInt32LE(seconds * RATE, 40);
  return Buffer.concat([header, Buffer.alloc(seconds * RATE, 128)]);
}
