// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GLOSS_CLASS,
  isRendered,
  removeTranslation,
  renderAnnotations,
  renderTranslation,
  sealAnnotations,
  setShown,
  TRANSLATION_CLASS,
  renderNote,
  renderSentence,
} from './render';

function block(html: string): HTMLElement {
  document.body.innerHTML = `<p>${html}</p>`;
  return document.querySelector('p')!;
}

/** Each note on the page as [expression as written, note]. */
function notes(): [string, string][] {
  return [...document.querySelectorAll(`.${GLOSS_CLASS}`)].map((gloss) => [
    gloss.firstChild!.textContent!,
    gloss.querySelector('rt')!.textContent!,
  ]);
}

describe('renderTranslation', () => {
  it('appends the translation after the original text, as text', () => {
    const p = block('Hello <b>world</b>');

    const added = renderTranslation(p, '你好 <b>世界</b>');

    expect(p.lastElementChild).toBe(added);
    expect(added.className).toBe(TRANSLATION_CLASS);
    expect(added.textContent).toBe('你好 <b>世界</b>');
    expect(added.children).toHaveLength(0); // model output is never parsed as HTML
    expect(p.firstChild!.textContent).toBe('Hello ');
  });

  it('can be taken off again', () => {
    const p = block('Hello');
    renderTranslation(p, '你好');

    removeTranslation(p);

    expect(p.innerHTML).toBe('Hello');
  });
});

describe('renderAnnotations', () => {
  it('writes a note above each expression and leaves the rest of the text alone', () => {
    const p = block('We should table the motion and ship it.');

    renderAnnotations(p, [
      { phrase: 'table the motion', gloss: '搁置动议' },
      { phrase: 'ship it', gloss: '发布' },
    ]);

    expect(notes()).toEqual([
      ['table the motion', '搁置动议'],
      ['ship it', '发布'],
    ]);
    expect(p.querySelectorAll('rt')).toHaveLength(2);
    p.querySelectorAll('rt').forEach((rt) => rt.remove());
    expect(p.textContent).toBe('We should table the motion and ship it.');
  });

  it('matches whole words only, ignoring case and line breaks in the page', () => {
    const p = block('A relationship can\n   Ship quickly.');

    renderAnnotations(p, [
      { phrase: 'ship', gloss: '发布' },
      { phrase: 'can ship', gloss: '不会重复标' },
    ]);

    expect(notes()).toEqual([['Ship', '发布']]);
  });

  it('notes only the first occurrence', () => {
    const p = block('Ship it, then ship it again.');

    renderAnnotations(p, [{ phrase: 'ship it', gloss: '发布' }]);

    expect(notes()).toEqual([['Ship it', '发布']]);
  });

  it('finds expressions inside inline elements, and skips ones split across them', () => {
    const p = block('Read <a href="/x">the fine print</a> before you <em>sign</em> off.');

    renderAnnotations(p, [
      { phrase: 'the fine print', gloss: '细则' },
      { phrase: 'sign off', gloss: '签字同意' },
    ]);

    expect(notes()).toEqual([['the fine print', '细则']]);
    expect(p.querySelector('a')!.querySelector(`.${GLOSS_CLASS}`)).not.toBeNull();
  });

  it('writes the note as text and treats the expression as text, not as a pattern', () => {
    const p = block('What does a.b (really) mean?');

    renderAnnotations(p, [
      { phrase: 'a.b (really)', gloss: '<b>粗</b>' },
      { phrase: 'a.c', gloss: '不该出现' },
    ]);

    expect(notes()).toEqual([['a.b (really)', '<b>粗</b>']]);
    expect(p.querySelector('rt b')).toBeNull();
  });

  it('does not put notes inside a translation', () => {
    const p = block('Ship it.');
    renderTranslation(p, '发布吧 ship');

    renderAnnotations(p, [{ phrase: 'ship', gloss: '发布' }]);

    expect(notes()).toEqual([['Ship', '发布']]);
    expect(p.querySelector(`.${TRANSLATION_CLASS} .${GLOSS_CLASS}`)).toBeNull();
  });
});

describe('the other lines written under a block', () => {
  it('keeps one whole-block translation, marked when the reader asked for it', () => {
    document.body.innerHTML = '<p>Just ship it.</p>';
    const block = document.querySelector('p')!;

    renderSentence(block, '第一版', false);
    const asked = renderSentence(block, '直接发布吧。', true);

    expect(block.querySelectorAll('.wisp-sentence')).toHaveLength(1);
    expect(asked.textContent).toBe('直接发布吧。');
    expect(asked.classList.contains('wisp-asked')).toBe(true);
  });

  it('writes explanations as text, and notes are not placed inside them', () => {
    document.body.innerHTML = '<p>Just ship it.</p>';
    const block = document.querySelector('p')!;

    const note = renderNote(block, '<b>ship it</b> 是「发布」');
    renderAnnotations(block, [{ phrase: 'b', gloss: '错' }]);

    expect(note.querySelector('b')).toBeNull();
    expect(block.querySelector('.wisp-gloss')).toBeNull();
  });
});

describe('sealAnnotations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes every note for the expression, whatever its case, and restores the text', () => {
    document.body.innerHTML = `<p id="a">Ship it now.</p><p id="b">Never ship it late, at any rate.</p>`;
    const a = document.querySelector<HTMLElement>('#a')!;
    const b = document.querySelector<HTMLElement>('#b')!;
    renderAnnotations(a, [{ phrase: 'Ship it', gloss: '发布' }]);
    renderAnnotations(b, [
      { phrase: 'ship it', gloss: '发布' },
      { phrase: 'at any rate', gloss: '无论如何' },
    ]);

    sealAnnotations(document, 'SHIP  it');
    expect(notes()).toHaveLength(3); // still there while the animation plays

    vi.runAllTimers();
    expect(notes()).toEqual([['at any rate', '无论如何']]);
    expect(a.innerHTML).toBe('Ship it now.');
    expect(a.childNodes).toHaveLength(1);
  });
});

describe('isRendered', () => {
  it('tracks each mode separately', () => {
    const p = block('Hello there.');
    expect(isRendered(p, 'translate')).toBe(false);
    expect(isRendered(p, 'learn')).toBe(false);

    renderAnnotations(p, []); // nothing to note is still an answer
    expect(isRendered(p, 'learn')).toBe(true);
    expect(isRendered(p, 'translate')).toBe(false);

    renderTranslation(p, '你好。');
    expect(isRendered(p, 'translate')).toBe(true);
  });
});

describe('setShown', () => {
  it('records what is shown on the root element', () => {
    setShown(document, 'learn');
    expect(document.documentElement.getAttribute('data-wisp-show')).toBe('learn');

    setShown(document, 'none');
    expect(document.documentElement.getAttribute('data-wisp-show')).toBe('none');
  });
});
