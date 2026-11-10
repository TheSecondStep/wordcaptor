import { ADDED_TEXT_SELECTOR, GLOSS_CLASS, NOTE_CLASS, SENTENCE_CLASS, TRANSLATION_CLASS } from './render';

/** The last entry is the text of a post on X (Twitter), which is not marked up as a paragraph. */
const BLOCK_SELECTOR =
  'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, figcaption, td, th, [data-testid="tweetText"]';
/** A table cell that contains any of these is laying out a part of the page, not holding a piece of text. */
const CELL_LAYOUT_SELECTOR = 'div, table, ul, ol, section';

/** Regions that are never reading content, wherever they appear. */
const CHROME_SELECTOR = [
  'nav',
  'aside',
  'footer',
  'form',
  'pre',
  'button',
  'select',
  'textarea',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[aria-hidden="true"]',
  '[contenteditable="true"]',
].join(', ');

/**
 * Regions that surround the reading content: menus, sidebars, tables of
 * contents. They are left alone until the reader shows interest in one.
 */
const SECONDARY_REGION_SELECTOR = [
  'nav',
  'aside',
  'header',
  'footer',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
].join(', ');

/** Text in these is never worth writing under, in any region. */
const NO_TEXT_SELECTOR = [
  'pre',
  'code',
  'script',
  'style',
  'noscript',
  'button',
  'select',
  'textarea',
  '[aria-hidden="true"]',
  '[contenteditable="true"]',
  // A video player's controls and captions; Wisp's own subtitles are among them.
  '.html5-video-player',
  '.wisp-subtitle',
  `.${TRANSLATION_CLASS}`,
  `.${SENTENCE_CLASS}`,
  `.${NOTE_CLASS}`,
  `.${GLOSS_CLASS}`,
].join(', ');

/** Above this share of text sitting inside links, a block is a menu entry, not prose. */
const MAX_LINK_SHARE = 0.8;

/**
 * Returns the blocks of English reading content on the page, in document
 * order, skipping navigation, footers, and code. Content is what sits in the
 * main container, plus the page's title wherever it is.
 */
export function findReadableBlocks(doc: Document): HTMLElement[] {
  const container = findMainContainer(doc);
  const blocks: HTMLElement[] = [];

  // Some pages put the article's title in a hero section above the main container.
  const candidates = [...doc.querySelectorAll<HTMLElement>('h1')].filter((title) => !container.contains(title));
  candidates.push(...container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  candidates.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  for (const el of candidates) {
    if (el.querySelector(BLOCK_SELECTOR)) continue; // only the innermost block
    if (el.matches('td, th') && el.querySelector(CELL_LAYOUT_SELECTOR)) continue;
    if (el.closest(CHROME_SELECTOR)) continue;
    if (isSiteHeader(el, container)) continue;
    if (!isEnglish(blockText(el))) continue;
    if (linkShare(el) > MAX_LINK_SHARE) continue;
    blocks.push(el);
  }
  return blocks;
}

/**
 * What the reader is pointing at when the pointer rests on an element: the
 * innermost menu, sidebar, header, footer, table, or list around it, or
 * failing that the element itself if it holds text. Null when it is pointing
 * at nothing in particular, such as the empty part of a large container.
 */
export function findHoverRegion(el: Element): HTMLElement | null {
  const region = el.closest<HTMLElement>(`${SECONDARY_REGION_SELECTOR}, table, ul, ol, dl`);
  if (region) return region;
  return el instanceof HTMLElement && hasDirectText(el) && !el.closest(NO_TEXT_SELECTOR) ? el : null;
}

/**
 * Returns the pieces of English text in a secondary region, in document
 * order. Such regions are rarely marked up as paragraphs, so a piece is the
 * outermost element that holds text directly: a whole sentence with its
 * inline links, or a single menu entry.
 */
export function findRegionBlocks(region: HTMLElement): HTMLElement[] {
  const blocks = new Set<HTMLElement>();
  const walker = region.ownerDocument.createTreeWalker(region, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!/\S/.test(node.nodeValue ?? '')) continue;
    let el = node.parentElement;
    if (!el || el.closest(NO_TEXT_SELECTOR)) continue;
    while (el !== region && el.parentElement && hasDirectText(el.parentElement)) el = el.parentElement;
    blocks.add(el);
  }
  return [...blocks].filter((block) => isEnglish(blockText(block)));
}

/**
 * The piece of English text an element belongs to: the block around it, or
 * failing that the outermost element around it that holds text directly, which
 * is a whole sentence with its inline links. Null when there is none, or when
 * it is something never written under.
 */
export function findBlockAround(el: Element): HTMLElement | null {
  if (el.closest(NO_TEXT_SELECTOR)) return null;
  let block = el.closest<HTMLElement>(BLOCK_SELECTOR);
  for (let up: Element | null = el; !block && up; up = up.parentElement) {
    if (up instanceof HTMLElement && hasDirectText(up)) block = up;
  }
  while (block && !block.matches(BLOCK_SELECTOR) && block.parentElement && hasDirectText(block.parentElement)) {
    block = block.parentElement;
  }
  return block && isEnglish(blockText(block)) ? block : null;
}

function hasDirectText(el: Element): boolean {
  return [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && /\S/.test(node.nodeValue ?? ''));
}

/** The page's own text in an element, without anything Wisp added, with whitespace collapsed. */
export function blockText(el: Element): string {
  let source = el;
  if (el.querySelector(ADDED_TEXT_SELECTOR)) {
    source = el.cloneNode(true) as Element;
    source.querySelectorAll(ADDED_TEXT_SELECTOR).forEach((added) => added.remove());
  }
  return (source.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function findMainContainer(doc: Document): HTMLElement {
  let best: HTMLElement = doc.body;
  let bestLength = 0;
  for (const el of doc.querySelectorAll<HTMLElement>('main, [role="main"], article')) {
    const length = el.textContent?.length ?? 0;
    if (length > bestLength) {
      best = el;
      bestLength = length;
    }
  }
  return best;
}

/**
 * A <header> inside the main container usually holds the article's own title,
 * which is content. Any other <header> is site chrome.
 */
function isSiteHeader(el: Element, container: HTMLElement): boolean {
  const header = el.closest('header');
  if (!header) return false;
  const insideMain = container !== el.ownerDocument.body && container.contains(header) && header !== container;
  return !insideMain;
}

function isEnglish(text: string): boolean {
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g)?.length ?? 0;
  return latin >= 3 && latin > cjk;
}

function linkShare(el: Element): number {
  const total = blockText(el).length;
  if (total === 0) return 0;
  let linked = 0;
  for (const link of el.querySelectorAll('a')) linked += blockText(link).length;
  return linked / total;
}
