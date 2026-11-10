import { normalizePhrase, type Mode } from './settings';
import type { Annotation } from './translator';

export const TRANSLATION_CLASS = 'wisp-translation';
export const GLOSS_CLASS = 'wisp-gloss';
/** In learn mode, the translation of a whole block that notes alone would not make readable. */
export const SENTENCE_CLASS = 'wisp-sentence';
/** The answer to a question the reader asked about a block. */
export const NOTE_CLASS = 'wisp-note';
/** Everything Wisp adds to a block that is not part of the page's own text. */
export const ADDED_TEXT_SELECTOR = `.${TRANSLATION_CLASS}, .${SENTENCE_CLASS}, .${NOTE_CLASS}, .${GLOSS_CLASS} > rt`;

const NOTED_ATTRIBUTE = 'data-wisp-noted';
const SHOW_ATTRIBUTE = 'data-wisp-show';
const SEALED_CLASS = 'wisp-sealed';
const SEAL_MS = 450;

/** Writes the translation under the original text of a block and returns the new element. */
export function renderTranslation(block: HTMLElement, text: string): HTMLElement {
  return appendLine(block, TRANSLATION_CLASS, text);
}

/**
 * Writes a translation of the whole block under it, replacing an earlier one.
 * One the reader asked for stays visible whatever the mode; one that came
 * with the notes shows in learn mode only.
 */
export function renderSentence(block: HTMLElement, text: string, asked: boolean): HTMLElement {
  block.querySelector(`:scope > .${SENTENCE_CLASS}`)?.remove();
  const el = appendLine(block, SENTENCE_CLASS, text);
  el.classList.toggle('wisp-asked', asked);
  return el;
}

/** Writes an explanation under a block. The reader clicks it away when done with it. */
export function renderNote(block: HTMLElement, text: string): HTMLElement {
  return appendLine(block, NOTE_CLASS, text);
}

function appendLine(block: HTMLElement, className: string, text: string): HTMLElement {
  const el = block.ownerDocument.createElement('span');
  el.className = className;
  el.lang = 'zh-CN';
  el.textContent = text;
  block.append(el);
  return el;
}

export function removeTranslation(block: HTMLElement): void {
  block.querySelector(`:scope > .${TRANSLATION_CLASS}`)?.remove();
}

/**
 * Writes each note above the expression it explains, at the first place the
 * expression occurs in the block. An expression that cannot be found, or that
 * is split across elements such as a link boundary, gets no note.
 */
export function renderAnnotations(block: HTMLElement, annotations: Annotation[]): void {
  block.setAttribute(NOTED_ATTRIBUTE, '');
  for (const annotation of annotations) {
    const found = findPhrase(block, annotation.phrase);
    if (!found) continue;

    const base = found.node.splitText(found.start);
    base.splitText(found.length);

    const doc = block.ownerDocument;
    const ruby = doc.createElement('ruby');
    ruby.className = GLOSS_CLASS;
    ruby.dataset.phrase = normalizePhrase(annotation.phrase);
    const gloss = doc.createElement('rt');
    gloss.lang = 'zh-CN';
    gloss.textContent = annotation.gloss;
    base.replaceWith(ruby);
    ruby.append(base, gloss);
  }
}

/** Finds the first whole-word occurrence of a phrase inside a single text node of the page's own text. */
function findPhrase(block: HTMLElement, phrase: string): { node: Text; start: number; length: number } | null {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![A-Za-z])${escaped.join('\\s+')}(?![A-Za-z])`, 'i');

  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.parentElement?.closest(`${ADDED_TEXT_SELECTOR}, .${GLOSS_CLASS}`)) continue;
    const match = pattern.exec(node.data);
    if (match) return { node, start: match.index, length: match[0].length };
  }
  return null;
}

/**
 * Takes the notes for one expression off the page, after a short moment in
 * which they are styled as being put away.
 */
export function sealAnnotations(doc: Document, phrase: string): void {
  const key = normalizePhrase(phrase);
  const glosses = [...doc.querySelectorAll<HTMLElement>(`.${GLOSS_CLASS}`)].filter(
    (gloss) => gloss.dataset.phrase === key,
  );
  for (const gloss of glosses) gloss.classList.add(SEALED_CLASS);

  setTimeout(() => {
    for (const gloss of glosses) {
      const parent = gloss.parentNode;
      gloss.querySelector('rt')?.remove();
      gloss.replaceWith(...gloss.childNodes);
      parent?.normalize();
    }
  }, SEAL_MS);
}

/** Whether a block already has what the given mode writes into it. */
export function isRendered(block: HTMLElement, mode: Mode): boolean {
  if (mode === 'learn') return block.hasAttribute(NOTED_ATTRIBUTE);
  return block.querySelector(`:scope > .${TRANSLATION_CLASS}`) !== null;
}

/** Chooses which of Wisp's additions are visible: one mode's, or none. Nothing is discarded. */
export function setShown(doc: Document, shown: Mode | 'none'): void {
  doc.documentElement.setAttribute(SHOW_ATTRIBUTE, shown);
}

