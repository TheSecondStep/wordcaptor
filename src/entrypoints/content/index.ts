import './style.css';
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { recordEvidence } from '@/lib/familiarity';
import { blockText, findBlockAround, findHoverRegion, findReadableBlocks, findRegionBlocks } from '@/lib/extract';
import {
  TOGGLE_MESSAGE,
  TRANSLATE_PORT,
  type Failure,
  type Reply,
  type Request,
  type TranslateEvent,
  type TranslateRequest,
} from '@/lib/messages';
import { createBatchQueue } from '@/lib/queue';
import {
  GLOSS_CLASS,
  isRendered,
  NOTE_CLASS,
  removeTranslation,
  renderAnnotations,
  renderNote,
  renderSentence,
  renderTranslation,
  sealAnnotations,
  setShown,
  TRANSLATION_CLASS,
} from '@/lib/render';
import {
  addKnown,
  loadEnabled,
  loadKnown,
  loadMode,
  loadMutedSites,
  normalizePhrase,
  onStored,
  saveEnabled,
  saveMode,
  setSiteMuted,
  type Level,
  type Mode,
} from '@/lib/settings';
import { createSprite, type Sprite } from '@/lib/sprite';
import { parseAnnotations, parseSentenceTranslation, type Command } from '@/lib/translator';
import { watchReading } from './fading';
import { watchSubtitles } from './youtube';

/** Wordcaptor only starts uninvited on pages that have this much English to read. */
const MIN_BLOCKS_TO_START = 3;
const BRIEF_SAMPLE_CHARS = 6000;
const CONTEXT_CHARS = 500;
/** How long to let page changes settle before looking for new content. */
const RESCAN_MS = 400;
/** How long the pointer must rest in a menu or sidebar before it counts as interest. */
const HOVER_MS = 350;
/** The longest selection the question mark is offered for. Longer ones are not a place to be stuck on. */
const MAX_QUESTION_CHARS = 300;
/** A frame smaller than this is an ad, an embed, or a widget, not something to read. */
const MIN_FRAME_WIDTH = 400;
const MIN_FRAME_HEIGHT = 300;
/** A frame covering this share of the window is where the page shows its content. */
const CONTENT_FRAME_SHARE = 0.5;

const NOTHING_TO_READ = '这一页没找到英文正文';
const LOST_CONTACT: Failure = { ok: false, error: '和百变小译的后台失去了联系，请刷新页面' };

const MODE_LABEL: Record<Mode, string> = { translate: '译', learn: '学' };
const LEVEL_NAME: Record<Level, string> = { cet4: '四级', cet6: '六级', fluent: '流畅阅读' };
const MODE_HINT: Record<Mode, string> = {
  translate: '翻译模式：每段都写出译文',
  learn: '学习模式：只批注你可能看不懂的词。点一下批注表示「会了」',
};

/** The work of one mode on this page, from the moment it starts until it fails or the page goes away. */
interface Run {
  /** Picks up readable blocks that are new since the last scan. */
  scan(): Promise<void>;
  /** Takes on a part of the page that was not picked up as reading content. */
  include(region: HTMLElement): void;
  /** Sends a block to the model again, replacing what was written for it. */
  redo(block: HTMLElement): void;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  // Some sites show their content in a frame from another origin (Hugging Face
  // Spaces, embedded docs). Each frame is worked on by its own copy of this script.
  allFrames: true,
  runAt: 'document_idle',
  async main(ctx) {
    const isTopFrame = window === window.top;
    const site = location.hostname;

    // What is stored, and so shared by every page: whether Wordcaptor is working,
    // in which mode, where it is not wanted, and what the reader knows.
    let enabled = false;
    let mode: Mode = 'translate';
    let muted = false;
    let known = new Set<string>();

    let sprite: Sprite | null = null;
    let brief: string | null = null;
    let fontRequested = false;
    const runs = new Map<Mode, Run>();
    /** Modes whose run failed here. They wait for the reader instead of starting over by themselves. */
    const failed = new Set<Mode>();

    async function loadStored() {
      const [storedEnabled, storedMode, mutedSites, storedKnown] = await Promise.all([
        loadEnabled(),
        loadMode(),
        loadMutedSites(),
        loadKnown(),
      ]);
      enabled = storedEnabled;
      mode = storedMode;
      muted = mutedSites.includes(site);
      known = new Set(Object.keys(storedKnown));
    }
    const ready = loadStored();

    // Listening starts at once, so a toolbar click right after the page loads
    // is not lost; it is acted on once the stored state is known.
    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === TOGGLE_MESSAGE) void ready.then(onToolbarToggle);
    });

    await ready;
    apply();
    // A change made in another tab, in the options page, or by talking to the sprite.
    onStored(['enabled', 'mode', 'mutedSites', 'known'], () => void loadStored().then(() => apply()));

    // Pages that load content as you go: feeds, comments, single-page apps.
    let rescan: ReturnType<typeof setTimeout> | undefined;
    new MutationObserver(() => {
      rescan ??= setTimeout(() => {
        rescan = undefined;
        apply();
        runs.forEach((run) => void run.scan());
      }, RESCAN_MS);
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('click', onPageClick, true);
    document.addEventListener('selectionchange', onSelection);
    watchSubtitles({
      isActive: active,
      translate,
      cached: async (task, texts) => {
        const saved = await ask<(string | null)[]>({ type: 'cached', mode: task, texts });
        return saved.ok ? saved.value : [];
      },
      loadFont,
    });
    const fading = watchReading(() => active() && mode === 'learn');

    // Whatever was not picked up as reading content — menus, sidebars, tables
    // of contents, text in unusual markup — is worked on when the reader shows
    // interest in it: the pointer comes to rest there.
    let hoveredRegion: HTMLElement | null = null;
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    document.addEventListener(
      'pointerover',
      (event) => {
        const region = event.target instanceof Element ? findHoverRegion(event.target) : null;
        if (region === hoveredRegion) return;
        hoveredRegion = region;
        clearTimeout(hoverTimer);
        if (region) hoverTimer = setTimeout(() => active() && runs.get(mode)?.include(region), HOVER_MS);
      },
      { passive: true },
    );

    // The extension was reloaded or updated while this page stayed open. This
    // copy of the script can no longer reach the extension, so it bows out;
    // the page gets the new one when it is next loaded.
    ctx.onInvalidated(() => {
      sprite?.remove();
      sprite = null;
    });

    function active(): boolean {
      return enabled && !muted && ctx.isValid;
    }

    /** False in the small frames that hold ads, embeds, and widgets. */
    function hasRoomToRead(): boolean {
      return isTopFrame || (window.innerWidth >= MIN_FRAME_WIDTH && window.innerHeight >= MIN_FRAME_HEIGHT);
    }

    function hasEnoughToRead(): boolean {
      return hasRoomToRead() && findReadableBlocks(document).length >= MIN_BLOCKS_TO_START;
    }

    /**
     * Brings the page in line with the stored state. Safe to call at any time.
     * `byHand` says the reader just asked for this here, as opposed to the
     * page following a switch that was already on.
     */
    function apply(byHand = false) {
      if (ctx.isInvalid) return;
      if (muted) {
        sprite?.remove();
        sprite = null;
      } else if (!sprite && hasEnoughToRead()) {
        ensureSprite();
      }
      sprite?.setMode(MODE_LABEL[mode]);
      setShown(document, active() ? mode : 'none');
      if (active() && !runs.has(mode) && (byHand || !failed.has(mode)) && hasEnoughToRead()) start(mode, byHand);
    }

    function ensureSprite(): Sprite {
      sprite ??= createSprite({
        onClick: toggle,
        onMode: switchMode,
        onSettings: () => void ask({ type: 'open-options' }),
        onClose: () => {
          muted = true;
          void setSiteMuted(site, true);
          apply();
        },
        onSay: say,
        onDrop: (x, y) => {
          const under = document.elementsFromPoint(x, y).find((element) => element.id !== 'wisp-sprite');
          const block = under ? findBlockAround(under) : null;
          if (block) void translateOne(block);
          return block !== null;
        },
      });
      sprite.setMode(MODE_LABEL[mode]);
      return sprite;
    }

    function setEnabled(value: boolean) {
      enabled = value;
      void saveEnabled(value);
      apply(true);
      if (value) sprite?.release();
    }

    /**
     * A click on the sprite. Where there is something to read and nothing is
     * being done about it — Wordcaptor is off, the last try failed, or the page is
     * too short to start on uninvited — it means "do this page". Otherwise it
     * turns Wordcaptor off.
     */
    function toggle() {
      const waiting = !runs.has(mode) && findReadableBlocks(document).length > 0;
      if (active() && !waiting) {
        setEnabled(false);
        return;
      }
      if (!enabled) setEnabled(true);
      if (waiting && !runs.has(mode)) start(mode, true);
    }

    /**
     * The toolbar icon and the keyboard shortcut reach every frame of the tab
     * at once. Only the top frame acts on them; the others follow through the
     * stored state.
     */
    function onToolbarToggle() {
      if (!isTopFrame) return;
      if (muted) {
        // Calling Wordcaptor on a site it was sent away from brings it back.
        muted = false;
        void setSiteMuted(site, false);
        if (enabled) apply(true);
        else setEnabled(true);
      } else {
        toggle();
      }
      if (enabled && findReadableBlocks(document).length === 0 && !showsContentInFrame(document)) {
        ensureSprite().say(NOTHING_TO_READ);
      }
    }

    function switchMode() {
      mode = mode === 'translate' ? 'learn' : 'translate';
      void saveMode(mode);
      ensureSprite().say(MODE_HINT[mode]);
      if (enabled) apply(true);
      else setEnabled(true);
      if (!runs.has(mode)) start(mode, true);
    }

    /** Something the reader typed to the sprite. What it changes arrives through the stored state. */
    async function say(said: string) {
      const reply = await ask<Command>({ type: 'command', said, brief: brief ?? '', site });
      if (!reply.ok) {
        report(reply, true);
        return;
      }
      const { reply: answer, ...changes } = reply.value;
      ensureSprite().say(answer);
      if (Object.keys(changes).length > 0) sprite?.cheer();
    }

    /**
     * Something the reader did that shows how the notes fit them. Enough of it
     * moves their level, and she says so, since the notes will change.
     */
    async function learnFrom(kind: 'known' | 'stuck') {
      const moved = await recordEvidence(kind);
      if (!moved) return;
      const why = moved.rose ? '你认识的词不少' : '看来批注不太够';
      ensureSprite().say(`${why}，以后我按「${LEVEL_NAME[moved.level]}」的水平来批注。不对就跟我说`);
    }

    function report(failure: Failure, byHand: boolean) {
      const wisp = ensureSprite();
      if (!failure.notConfigured) {
        wisp.fail(failure.error);
      } else if (byHand) {
        wisp.say('先告诉我用哪个模型，填好后回来再点我');
        void ask({ type: 'open-options' });
      } else {
        wisp.say('还没告诉我用哪个模型。点一下我去设置');
      }
    }

    function onPageClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;

      // An explanation is clicked away once it has been read.
      const note = event.target.closest(`.${NOTE_CLASS}`);
      if (note) {
        note.remove();
        return;
      }
      if (!active()) return;

      // Clicking a note puts it away for good: the reader knows this one now.
      const gloss = event.target.closest<HTMLElement>(`.${GLOSS_CLASS}`);
      if (gloss && mode === 'learn' && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        const phrase = gloss.dataset.phrase!;
        known.add(phrase);
        void addKnown(phrase, gloss.querySelector('rt')?.textContent ?? '');
        sprite?.seal(gloss);
        sealAnnotations(document, phrase);
        void learnFrom('known');
        return;
      }
      if (!event.altKey) return;

      // Alt-clicking a translation asks the model for a new one.
      const translation = event.target.closest(`.${TRANSLATION_CLASS}`);
      if (translation?.parentElement) {
        event.preventDefault();
        runs.get('translate')?.redo(translation.parentElement);
        return;
      }
      // Alt-clicking a paragraph in learn mode asks for all of it in Chinese.
      const block = mode === 'learn' ? findBlockAround(event.target) : null;
      if (block) {
        event.preventDefault();
        void translateOne(block);
      }
    }

    /** Offers a question mark beside whatever English the reader has just selected. */
    function onSelection() {
      const selection = document.getSelection();
      const text = selection?.toString().trim() ?? '';
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const anchor = range?.commonAncestorContainer;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      const block = element && active() ? findBlockAround(element) : null;
      if (!range || !block || !/[A-Za-z]{2}/.test(text) || text.length > MAX_QUESTION_CHARS) {
        sprite?.offer(null);
        return;
      }
      const rects = range.getClientRects();
      const end = rects[rects.length - 1] ?? range.getBoundingClientRect();
      ensureSprite().offer({ x: end.right, y: end.bottom }, () => void explain(text, block));
    }

    async function explain(selection: string, block: HTMLElement) {
      stuckOn(block);
      const flyer = ensureSprite().dispatch();
      loadFont();
      const reply = await ask<string>({
        type: 'explain',
        selection,
        paragraph: blockText(block).slice(0, 1500),
        title: document.title,
      });
      if (reply.ok) flyer.moveTo(renderNote(block, reply.value));
      flyer.release();
      if (!reply.ok) report(reply, true);
    }

    /** In learn mode, asking for more than the notes says the notes of that block were not enough. */
    function stuckOn(block: HTMLElement) {
      if (!active() || mode !== 'learn') return;
      fading.restore(block);
      void learnFrom('stuck');
    }

    /** Translates one block the reader pointed out, whatever the mode and whether or not Wordcaptor is on. */
    async function translateOne(block: HTMLElement) {
      const run = runs.get('translate');
      if (run && active() && mode === 'translate') {
        run.include(block);
        return;
      }
      stuckOn(block);
      const flyer = ensureSprite().dispatch();
      loadFont();
      const failure = await translate(
        { mode: 'translate', brief: brief ?? `标题：${document.title}`, context: '', segments: [blockText(block)] },
        (_index, text) => flyer.moveTo(renderSentence(block, text, true)),
      );
      flyer.release();
      if (failure) report(failure, true);
    }

    /** The handwriting font is large, so a page gets it only once something is written in it. */
    function loadFont() {
      if (fontRequested) return;
      fontRequested = true;
      void ask({ type: 'load-font' }).then((reply) => (fontRequested = reply.ok));
    }

    function start(kind: Mode, byHand: boolean) {
      const wisp = ensureSprite();
      failed.delete(kind);
      loadFont();

      // What the page said when each block was first seen: its own text, and the text just before it.
      const texts = new WeakMap<HTMLElement, string>();
      const contexts = new WeakMap<HTMLElement, string>();
      /** Parts of the page the reader has asked for by resting the pointer on them. */
      const regions = new Set<HTMLElement>();
      let sample = '';
      let briefRequest: Promise<Reply<string>> | undefined;
      let isFirstBatch = true;
      let problem: Failure | null = null;
      let ended = false;

      // The page is read for the brief only once something needs the model, and
      // while the first batch is already under way, so the reader is not left
      // waiting for it.
      const requestBrief = () =>
        (briefRequest ??= ask<string>({ type: 'brief', title: document.title, text: sample }).then((reply) => {
          if (reply.ok && brief === null) {
            brief = reply.value;
            // The brief's first line doubles as a one-line answer to "is this page worth reading?".
            const topic = /主题[：:]\s*(.+)/.exec(reply.value)?.[1];
            if (topic) wisp.say(`这页在讲：${topic}`);
          }
          return reply;
        }));

      /** Writes the model's output for a block into the page and returns the element to fly to. */
      function write(block: HTMLElement, output: string): Element {
        if (kind === 'translate') return renderTranslation(block, output);
        const annotations = parseAnnotations(output).filter(({ phrase }) => !known.has(normalizePhrase(phrase)));
        renderAnnotations(block, annotations);
        fading.track(block);
        const sentence = parseSentenceTranslation(output);
        return sentence ? renderSentence(block, sentence, false) : block;
      }

      const queue = createBatchQueue<HTMLElement>({
        maxItems: 6,
        maxChars: 1500,
        // The page shares the key's two slots with subtitles, which go first; see pace.ts.
        concurrency: 2,
        size: (block) => texts.get(block)!.length,
        async run(batch) {
          if (ended) return;
          const first = batch[0]!; // the queue never hands out an empty batch
          // She stays where she is until there is something written to fly to.
          const flyer = wisp.dispatch();

          let pageBrief = brief ?? `标题：${document.title}`;
          const waitsForBrief = !isFirstBatch;
          isFirstBatch = false;
          if (brief === null) {
            const request = requestBrief();
            const reply = waitsForBrief ? await request : null;
            if (reply?.ok) {
              pageBrief = reply.value;
            } else if (reply) {
              problem ??= reply;
              flyer.release();
              return;
            }
          }

          let written = 0;
          const failure = await translate(
            {
              mode: kind,
              brief: pageBrief,
              context: contexts.get(first)!,
              segments: batch.map((block) => texts.get(block)!),
            },
            (index, output) => {
              const block = batch[index];
              if (!block) return;
              written++;
              flyer.moveTo(write(block, output));
            },
          );
          flyer.release();

          if (failure) problem ??= failure;
          else if (written < batch.length) problem ??= { ok: false, error: '有几段没处理完，再点我一次重试' };
        },
        onIdle() {
          if (problem) end(problem);
        },
      });

      // A block goes to the model only when the reader is about to reach it.
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            queue.push(entry.target as HTMLElement);
          }
        },
        // In a frame from another origin the browser ignores the margin unless
        // the frame's own document is named as the root. A frame taller than
        // the screen does not scroll by itself, though: the page around it
        // does, and only the default root knows which part of it is in view.
        { root: isTopFrame || window.innerHeight > window.screen.height ? null : document, rootMargin: '0px 0px 100% 0px' },
      );

      async function scan() {
        const fresh: HTMLElement[] = [];
        let previous = '';
        const blocks = [...findReadableBlocks(document), ...[...regions].flatMap(findRegionBlocks)];
        for (const block of blocks) {
          const text = blockText(block);
          if (!texts.has(block) && !isRendered(block, kind)) {
            texts.set(block, text);
            contexts.set(block, previous.slice(-CONTEXT_CHARS));
            fresh.push(block);
          }
          previous = text;
        }
        if (fresh.length === 0) return;

        const freshTexts = fresh.map((block) => texts.get(block)!);
        sample ||= freshTexts.join('\n').slice(0, BRIEF_SAMPLE_CHARS);

        // Output saved on an earlier visit is written straight away, without the model.
        const saved = await ask<(string | null)[]>({ type: 'cached', mode: kind, texts: freshTexts });
        if (ended) return;
        fresh.forEach((block, index) => {
          const output = saved.ok ? (saved.value[index] ?? null) : null;
          if (output === null) observer.observe(block);
          else write(block, output);
        });
      }

      /** Ends the run so the next click starts a new one; blocks already written are skipped then. */
      function end(failure: Failure) {
        ended = true;
        observer.disconnect();
        runs.delete(kind);
        failed.add(kind);
        report(failure, byHand);
      }

      runs.set(kind, {
        scan,
        include(region) {
          if (ended || regions.has(region)) return;
          // Most things the pointer rests on are already taken care of.
          if (findRegionBlocks(region).every((block) => texts.has(block))) return;
          regions.add(region);
          void scan();
        },
        redo(block) {
          if (!texts.has(block)) return;
          removeTranslation(block);
          queue.push(block);
        },
      });
      void scan();
    }
  },
});

/** Whether most of the window is taken up by a frame, whose own copy of this script answers for it. */
function showsContentInFrame(doc: Document): boolean {
  const windowArea = window.innerWidth * window.innerHeight;
  return [...doc.querySelectorAll('iframe')].some((frame) => {
    const { width, height } = frame.getBoundingClientRect();
    return width * height >= windowArea * CONTENT_FRAME_SHARE;
  });
}

async function ask<T>(request: Request): Promise<Reply<T>> {
  try {
    return await browser.runtime.sendMessage(request);
  } catch {
    // The extension was reloaded or updated while this page stayed open.
    return LOST_CONTACT;
  }
}

/**
 * Sends one batch to the model, reporting each segment as it arrives. Resolves
 * with the failure, if any. `cancel` drops it, including while it is waiting
 * for a free slot.
 */
function translate(
  request: TranslateRequest,
  onSegment: (index: number, text: string) => void,
): Promise<Failure | null> & { cancel: () => void } {
  let cancel = () => {};
  const done = new Promise<Failure | null>((resolve) => {
    try {
      const port = browser.runtime.connect({ name: TRANSLATE_PORT });
      let settled = false;
      const finish = (failure: Failure | null) => {
        if (settled) return;
        settled = true;
        resolve(failure);
        port.disconnect();
      };
      cancel = () => finish(null);
      port.onMessage.addListener((event: TranslateEvent) => {
        if (event.type === 'segment') {
          onSegment(event.index, event.text);
          return;
        }
        finish(event.failure ?? null);
      });
      // Only fires when the background side goes away before sending `end`.
      port.onDisconnect.addListener(() => finish(settled ? null : LOST_CONTACT));
      port.postMessage(request);
    } catch {
      resolve(LOST_CONTACT);
    }
  }) as Promise<Failure | null> & { cancel: () => void };
  done.cancel = () => cancel();
  return done;
}
