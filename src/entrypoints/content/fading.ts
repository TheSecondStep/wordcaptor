import { blockText } from '@/lib/extract';
import { dropOld, fadeLevel, readingTimeMs, sight, unsee, type Seen } from '@/lib/familiarity';
import { GLOSS_CLASS } from '@/lib/render';
import { loadSeen, onStored, saveSeen } from '@/lib/settings';

/** How long the pointer must rest on a faded note before it counts as "I still need this one". */
const LOOK_MS = 400;
const FADE_ATTRIBUTE = 'data-wisp-fade';

export interface Fading {
  /** Draws a block's notes as faint as they have become, and starts counting readings of them. */
  track(block: HTMLElement): void;
  /** The reader needed help with this block: its notes start over at full strength. */
  restore(block: HTMLElement): void;
}

/**
 * Lets notes fade as they are read. A note counts as read once when its block
 * has stayed in the middle of the screen for about as long as it takes to
 * read, in learn mode, at most once a day per page. Pointing at a faded note
 * brings it back for good.
 */
export function watchReading(isLearning: () => boolean): Fading {
  let seen: Seen = {};
  const loaded = loadSeen().then((stored) => (seen = stored));
  onStored(['seen'], () => void loadSeen().then((stored) => ((seen = stored), paint(document))));

  const page = location.host + location.pathname;
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const phrasesIn = (root: ParentNode) =>
    [...root.querySelectorAll<HTMLElement>(`.${GLOSS_CLASS}`)].map((gloss) => gloss.dataset.phrase!);

  function paint(root: ParentNode) {
    for (const gloss of root.querySelectorAll<HTMLElement>(`.${GLOSS_CLASS}`)) {
      const level = fadeLevel(seen[gloss.dataset.phrase!]?.count ?? 0);
      if (level) gloss.setAttribute(FADE_ATTRIBUTE, String(level));
      else gloss.removeAttribute(FADE_ATTRIBUTE);
    }
  }

  function store(next: Seen) {
    seen = next;
    // Fails only when the extension has been reloaded under this page, and then the count no longer matters.
    saveSeen(dropOld(next, today())).catch(() => {});
  }

  const reading = new Map<Element, ReturnType<typeof setTimeout>>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting } of entries) {
        clearTimeout(reading.get(target));
        reading.delete(target);
        if (!isIntersecting) continue;
        const timer = setTimeout(() => {
          reading.delete(target);
          // Reading in translate mode is reading the Chinese, and a tab in the background is not being read.
          if (!isLearning() || document.visibilityState !== 'visible') return;
          store(sight(seen, phrasesIn(target), today(), page));
        }, readingTimeMs(blockText(target)));
        reading.set(target, timer);
      }
    },
    // The middle of the screen, where reading happens.
    { rootMargin: '-15% 0px -15% 0px' },
  );

  let looking: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener(
    'pointerover',
    (event) => {
      clearTimeout(looking);
      const gloss = event.target instanceof Element ? event.target.closest<HTMLElement>(`.${GLOSS_CLASS}`) : null;
      if (!gloss?.hasAttribute(FADE_ATTRIBUTE)) return;
      looking = setTimeout(() => {
        store(unsee(seen, [gloss.dataset.phrase!]));
        paint(document);
      }, LOOK_MS);
    },
    { passive: true },
  );

  return {
    track(block) {
      if (phrasesIn(block).length === 0) return;
      void loaded.then(() => paint(block));
      observer.observe(block);
    },
    restore(block) {
      const phrases = phrasesIn(block);
      if (phrases.length === 0) return;
      store(unsee(seen, phrases));
      paint(document);
    },
  };
}
