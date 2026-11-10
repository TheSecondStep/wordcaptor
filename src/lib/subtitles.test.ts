import { describe, expect, it } from 'vitest';
import { cueAt, toPassages, withTranslation, type CaptionEvent } from './subtitles';

/** Words as automatic captions give them: one event, each word with the time it is spoken at. */
function spoken(text: string, gapMs = 300, pauses: Record<string, number> = {}): CaptionEvent[] {
  let at = 0;
  const segs = text.split(' ').map((word, index) => {
    at += index === 0 ? 0 : (pauses[word] ?? gapMs);
    return { utf8: index === 0 ? word : ` ${word}`, tOffsetMs: at };
  });
  return [{ tStartMs: 0, segs }];
}

describe('captions written by a person', () => {
  const events: CaptionEvent[] = [
    { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello\nthere.' }] },
    { tStartMs: 3000, dDurationMs: 500, segs: [{ utf8: '\n' }] },
    { tStartMs: 4000, dDurationMs: 1500, segs: [{ utf8: 'Second ' }, { utf8: 'line.' }] },
  ];

  it('become one passage each, with line breaks as spaces and empty ones dropped', () => {
    expect(toPassages(events, false)).toEqual([
      { start: 1, end: 3, text: 'Hello there.', cues: [{ start: 1, end: 3, text: 'Hello there.' }] },
      { start: 4, end: 5.5, text: 'Second line.', cues: [{ start: 4, end: 5.5, text: 'Second line.' }] },
    ]);
  });

  it('are shown with the answer as their translation', () => {
    const [first] = toPassages(events, false);
    expect(withTranslation(first!, '你好。')).toEqual([{ start: 1, end: 3, text: 'Hello there.', translation: '你好。' }]);
  });
});

describe('automatic captions, before the model has seen them', () => {
  it('are one passage while short, shown as the words come, a line ending where the speaker pauses', () => {
    const events: CaptionEvent[] = [
      // The first word of an event comes without the space the others lead with.
      { tStartMs: 0, segs: [{ utf8: 'so' }, { utf8: ' today', tOffsetMs: 300 }, { utf8: ' we', tOffsetMs: 600 }] },
      { tStartMs: 900, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 900, segs: [{ utf8: 'build' }] },
      { tStartMs: 5000, segs: [{ utf8: 'next' }, { utf8: ' up', tOffsetMs: 300 }] },
    ];
    const passages = toPassages(events, true);

    expect(passages).toHaveLength(1);
    expect(passages[0]).toMatchObject({ start: 0, end: 7.8, text: 'so today we build next up' });
    expect(passages[0]!.cues).toEqual([
      { start: 0, end: 3.4, text: 'so today we build' }, // lingers 2.5 s after its last word
      { start: 5, end: 7.8, text: 'next up' },
    ]);
  });

  it('ends a line that has grown long', () => {
    const text = Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ');
    const [passage] = toPassages(spoken(text), true);
    expect(passage!.cues.length).toBeGreaterThan(1);
    expect(Math.max(...passage!.cues.map((cue) => cue.text.length))).toBeLessThanOrEqual(84);
    expect(passage!.cues.map((cue) => cue.text).join(' ')).toBe(text);
  });

  it('are divided into passages at the longest pause within reach, one following on the other', () => {
    const text = Array.from({ length: 250 }, (_, index) => `w${index}`).join(' ');
    // The speaker stops for breath before the 81st word, and for less before the 100th.
    const passages = toPassages(spoken(text, 300, { w80: 900, w99: 700 }), true);

    expect(passages.map((passage) => passage.text.split(' ').length)).toEqual([80, 60, 110]);
    expect(passages[1]!.text.startsWith('w80 w81')).toBe(true);
    expect(passages.map((passage) => passage.text).join(' ')).toBe(text);
    expect(passages[0]!.end).toBe(passages[1]!.start);
    expect(passages[1]!.end).toBe(passages[2]!.start);
  });
});

describe('automatic captions, made into sentences by the model', () => {
  const TEXT = 'so today we are going to build a compiler um and it is easier than you think';
  const [passage] = toPassages(spoken(TEXT), true);
  const at = (word: string) => (TEXT.split(' ').indexOf(word) * 300) / 1000;

  it('times each sentence by where its words are spoken', () => {
    const cues = withTranslation(
      passage!,
      ['So today, we are going to build a compiler. || 今天我们来写一个编译器。', 'And it is easier than you think. || 它比你想的简单。'].join('\n'),
    );
    expect(cues).toEqual([
      { start: 0, end: at('and'), text: 'So today, we are going to build a compiler.', translation: '今天我们来写一个编译器。' },
      // The "um" between the two belongs to neither, and the second starts at its own first word.
      { start: at('and'), end: passage!.end, text: 'And it is easier than you think.', translation: '它比你想的简单。' },
    ]);
  });

  it('keeps time when the model corrects a word, adds one, or leaves one out', () => {
    const cues = withTranslation(
      passage!,
      [
        'So today we\'re gonna build a compiler, || 今天我们来写一个编译器，', // "are going to" became two other words
        'and, well, it is easier than you thought. || 它比你想的简单。', // one word added, the last one changed
      ].join('\n'),
    );
    expect(cues.map((cue) => cue.start)).toEqual([0, at('and')]);
    expect(cues[1]!.end).toBe(passage!.end);
  });

  it('shows the words the model left out as they are, after its sentences', () => {
    const cues = withTranslation(passage!, 'So today we are going to build a compiler. || 今天我们来写一个编译器。');
    expect(cues).toEqual([
      { start: 0, end: at('um'), text: 'So today we are going to build a compiler.', translation: '今天我们来写一个编译器。' },
      { start: at('um'), end: passage!.end, text: 'um and it is easier than you think' },
    ]);
  });

  it('says sentences there are no words left for along with the last one', () => {
    const cues = withTranslation(passage!, [`${TEXT} || 全部。`, 'Thanks for watching. || 谢谢观看。'].join('\n'));
    expect(cues).toEqual([
      { start: 0, end: passage!.end, text: `${TEXT} Thanks for watching.`, translation: '全部。谢谢观看。' },
    ]);
  });

  it('falls back to the words as they come when the answer is not in the expected shape', () => {
    expect(withTranslation(passage!, '今天我们来写一个编译器。')).toBe(passage!.cues);
    expect(withTranslation(passage!, '')).toBe(passage!.cues);
  });
});

describe('cueAt', () => {
  const cues = [
    { start: 1, end: 3, text: 'a' },
    { start: 4, end: 5, text: 'b' },
    { start: 5, end: 8, text: 'c' },
  ];

  it('finds the cue on screen, and nothing between cues', () => {
    expect([0, 1, 2.9, 3, 4.5, 5, 7.9, 8].map((time) => cueAt(cues, time))).toEqual([-1, 0, 0, -1, 1, 2, 2, -1]);
    expect(cueAt([], 1)).toBe(-1);
  });
});
