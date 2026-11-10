import { describe, expect, it } from 'vitest';
import type { Reader } from './settings';
import {
  annotatePrompt,
  briefPrompt,
  commandPrompt,
  createSegmentReader,
  explainPrompt,
  parseAnnotations,
  parseCommand,
  parseSentenceTranslation,
  translatePrompt,
} from './translator';

const READER: Reader = { level: 'cet4', preferences: [] };
const PICKY_READER: Reader = { level: 'cet6', preferences: ['译文口语一点', 'agent 保留不译'] };

describe('translatePrompt', () => {
  it('numbers the segments from 1 and puts the context first', () => {
    const prompt = translatePrompt('主题：编译器', 'Earlier text.', ['First.', 'Second.'], READER);

    expect(prompt.user).toBe('<context>Earlier text.</context>\n<s id="1">First.</s>\n<s id="2">Second.</s>');
    expect(prompt.system).toContain('主题：编译器');
  });

  it('omits the context tag when there is no context', () => {
    expect(translatePrompt('', '', ['Only.'], READER).user).toBe('<s id="1">Only.</s>');
  });
});

describe('annotatePrompt', () => {
  it('sends the segments the same way as translation, with the brief', () => {
    const prompt = annotatePrompt('主题：编译器', 'Earlier text.', ['First.', 'Second.'], READER);

    expect(prompt.user).toBe(translatePrompt('', 'Earlier text.', ['First.', 'Second.'], READER).user);
    expect(prompt.system).toContain('主题：编译器');
  });
});

describe('what the prompts say about the reader', () => {
  it('states the level in the notes prompt, and in the explanation prompt', () => {
    expect(annotatePrompt('', '', ['One.'], READER).system).toContain('刚过大学英语四级');
    expect(annotatePrompt('', '', ['One.'], PICKY_READER).system).toContain('过了大学英语六级');
    expect(explainPrompt('ship it', 'Just ship it.', 'A title', PICKY_READER).system).toContain('过了大学英语六级');
  });

  it('lists the wishes the reader has voiced, and says nothing of wishes when there are none', () => {
    for (const prompt of [translatePrompt, annotatePrompt]) {
      expect(prompt('', '', ['One.'], PICKY_READER).system).toContain('- 译文口语一点\n- agent 保留不译');
      expect(prompt('', '', ['One.'], READER).system).not.toContain('读者提过的要求');
    }
  });

  it('puts the selection, its paragraph, and the title in the explanation prompt', () => {
    const prompt = explainPrompt('ship it', 'Just ship it.', 'A title', READER);
    expect(prompt.user).toContain('他选中的是：ship it');
    expect(prompt.user).toContain('所在段落：Just ship it.');
    expect(prompt.user).toContain('A title');
  });

  it('tells the command prompt what is already kept, so it can be dropped by quoting it', () => {
    const prompt = commandPrompt('别那么口语了', PICKY_READER, '主题：编译器');
    expect(prompt.system).toContain('["译文口语一点","agent 保留不译"]');
    expect(prompt.system).toContain('主题：编译器');
    expect(prompt.user).toBe('别那么口语了');
  });
});

describe('parseCommand', () => {
  it('reads the changes, ignoring text around the JSON', () => {
    const reply = '好的：\n```json\n{"reply":"记住啦","level":"cet6","mode":"learn","remember":["口语一点"],"known":["ship it"],"muteSite":true}\n```';
    expect(parseCommand(reply)).toEqual({
      reply: '记住啦',
      level: 'cet6',
      mode: 'learn',
      remember: ['口语一点'],
      known: ['ship it'],
      muteSite: true,
    });
  });

  it('drops values it does not know', () => {
    expect(parseCommand('{"reply":"嗯","level":"expert","mode":"off","remember":[1,""],"muteSite":"yes"}')).toEqual({
      reply: '嗯',
    });
  });

  it('treats anything that is not JSON as a plain reply', () => {
    expect(parseCommand('这页在讲编译器。')).toEqual({ reply: '这页在讲编译器。' });
    expect(parseCommand('').reply).not.toBe('');
  });
});

describe('parseSentenceTranslation', () => {
  it('finds the whole-segment translation among the notes, which are read without it', () => {
    const output = 'ship it = 发布\n>> 直接发布吧，别等了。';
    expect(parseSentenceTranslation(output)).toBe('直接发布吧，别等了。');
    expect(parseAnnotations(output)).toEqual([{ phrase: 'ship it', gloss: '发布' }]);
  });

  it('is null when the segment has none', () => {
    expect(parseSentenceTranslation('ship it = 发布')).toBeNull();
    expect(parseSentenceTranslation('>>  ')).toBeNull();
  });
});

describe('parseAnnotations', () => {
  it('reads one annotation per line', () => {
    expect(parseAnnotations('table the motion = 搁置动议\nship it=发布')).toEqual([
      { phrase: 'table the motion', gloss: '搁置动议' },
      { phrase: 'ship it', gloss: '发布' },
    ]);
  });

  it('splits at the first equals sign only', () => {
    expect(parseAnnotations('a == b = 相等')).toEqual([{ phrase: 'a', gloss: '= b = 相等' }]);
  });

  it('drops lines that are not annotations', () => {
    expect(parseAnnotations('没有需要标的\n\n = 缺表达\nmissing gloss = \nok = 好')).toEqual([
      { phrase: 'ok', gloss: '好' },
    ]);
    expect(parseAnnotations('')).toEqual([]);
  });
});

describe('briefPrompt', () => {
  it('carries the title and the sample text', () => {
    const prompt = briefPrompt('A title', 'Body text');
    expect(prompt.user).toContain('A title');
    expect(prompt.user).toContain('Body text');
  });
});

describe('createSegmentReader', () => {
  /** Feeds the output in pieces of the given size and collects what gets reported. */
  function read(output: string, count: number, pieceSize = output.length) {
    const reported: [number, string][] = [];
    const feed = createSegmentReader(count, (index, text) => reported.push([index, text]));
    for (let i = 0; i < output.length; i += pieceSize) feed(output.slice(i, i + pieceSize));
    return reported;
  }

  it('reports each segment with its zero-based index, in the order the model wrote them', () => {
    expect(read('<s id="2">第二</s>\n<s id="1">第一</s>', 2)).toEqual([
      [1, '第二'],
      [0, '第一'],
    ]);
  });

  it('reports a segment as soon as its closing tag arrives', () => {
    const reported: string[] = [];
    const feed = createSegmentReader(2, (_index, text) => reported.push(text));

    feed('<s id="1">第');
    feed('一</');
    expect(reported).toEqual([]);

    feed('s><s id="2">第二');
    expect(reported).toEqual(['第一']);

    feed('</s>');
    expect(reported).toEqual(['第一', '第二']);
  });

  it('gives the same result however the output is split', () => {
    const output = '好的：\n<s id="1">第一行\n第二行</s>\n<s id="2">第二</s>\n完毕';
    const whole = read(output, 2);

    expect(whole).toEqual([
      [0, '第一行\n第二行'],
      [1, '第二'],
    ]);
    for (const size of [1, 2, 3, 5, 7]) expect(read(output, 2, size)).toEqual(whole);
  });

  it('skips ids out of range and repeated ids, and reports empty segments as empty', () => {
    const output = '<s id="0">零</s><s id="1">一</s><s id="2">  </s><s id="1">又一</s><s id="9">九</s>';
    expect(read(output, 3)).toEqual([
      [0, '一'],
      [1, ''],
    ]);
  });

  it('reports nothing when the output has no tags', () => {
    expect(read('抱歉，我无法翻译。', 2)).toEqual([]);
  });
});
