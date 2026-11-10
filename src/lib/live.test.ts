import { describe, expect, it } from 'vitest';
import { chat, listModels } from './llm';
import { PROVIDERS } from './providers';
import type { Reader, Settings } from './settings';
import {
  annotatePrompt,
  briefPrompt,
  captionsPrompt,
  commandPrompt,
  createSegmentReader,
  explainPrompt,
  parseAnnotations,
  parseCommand,
  translatePrompt,
} from './translator';
import { toPassages, withTranslation } from './subtitles';

/**
 * These call a real model, so they cost money and only run when a key is
 * given: set WISP_TEST_API_KEY, and optionally WISP_TEST_PROVIDER (an id from
 * providers.ts, default deepseek) and WISP_TEST_MODEL. Each test makes one
 * small call. They check that the prompts get answers in the shape the code
 * reads; whether the answers are good is for a person to judge from the
 * output, which is printed.
 */
const apiKey = process.env.WISP_TEST_API_KEY ?? '';
const provider = PROVIDERS.find((each) => each.id === (process.env.WISP_TEST_PROVIDER ?? 'deepseek'))!;
const settings: Settings = {
  protocol: provider.protocol,
  baseUrl: provider.baseUrl,
  apiKey,
  model: process.env.WISP_TEST_MODEL ?? provider.model ?? '',
};
const READER: Reader = { level: 'cet4', preferences: [] };
const CHINESE = /[\u4e00-\u9fff]/;

const TITLE = 'Why we shipped late';
const SEGMENTS = [
  'We bit off more than we could chew, and by March the whole plan had gone south.',
  'So we called it a day, tabled the redesign, and shipped what we had.',
  'In hindsight, it was the right call.',
];

/** Runs a prompt over segments and collects what the model wrote for each. */
async function segments(prompt: ReturnType<typeof translatePrompt>): Promise<string[]> {
  const outputs: string[] = [];
  await chat(settings, prompt, { onDelta: createSegmentReader(SEGMENTS.length, (index, text) => (outputs[index] = text)) });
  console.log(outputs.join('\n---\n'));
  return outputs;
}

describe.skipIf(!apiKey)(`a real model (${provider.name})`, { timeout: 60_000 }, () => {
  it('lists its models, the configured one among them', async () => {
    expect(await listModels(settings)).toContain(settings.model);
  });

  it('writes a brief in the asked-for layout', async () => {
    const brief = await chat(settings, briefPrompt(TITLE, SEGMENTS.join('\n')));
    console.log(brief);
    expect(brief).toMatch(/主题[：:]/);
    expect(brief.length).toBeLessThan(900);
  });

  it('translates every segment, in Chinese, by meaning', async () => {
    const outputs = await segments(translatePrompt(`标题：${TITLE}`, '', SEGMENTS, READER));
    expect(outputs).toHaveLength(SEGMENTS.length);
    for (const output of outputs) expect(output).toMatch(CHINESE);
    // "went south" and "called it a day" read literally would bring in 南 and 一天.
    expect(outputs[0]).not.toContain('南');
    expect(outputs[1]).not.toContain('一天');
  });

  it('notes expressions copied exactly from the text, each with a short meaning', async () => {
    const outputs = await segments(annotatePrompt(`标题：${TITLE}`, '', SEGMENTS, READER));
    expect(outputs).toHaveLength(SEGMENTS.length);
    const notes = outputs.flatMap((output, index) => parseAnnotations(output).map((note) => ({ ...note, index })));
    expect(notes.length).toBeGreaterThanOrEqual(3);
    for (const { phrase, gloss, index } of notes) {
      expect(SEGMENTS[index]!.toLowerCase()).toContain(phrase.toLowerCase());
      expect(gloss).toMatch(CHINESE);
      expect(gloss.length).toBeLessThanOrEqual(16);
    }
    // The idioms are what this mode is for.
    expect(notes.map((note) => note.phrase.toLowerCase()).join('|')).toMatch(/gone south|called it a day|tabled/);
  });

  it('follows a wish the reader has voiced', async () => {
    const wishful: Reader = { level: 'cet4', preferences: ['每段译文都以「喵」结尾'] };
    const outputs = await segments(translatePrompt(`标题：${TITLE}`, '', SEGMENTS, wishful));
    for (const output of outputs) expect(output).toMatch(/喵[。！～~.!]*$/);
  });

  it('makes timed bilingual subtitles of automatic captions', async () => {
    // As speech recognition gives it: lowercase words, a third of a second apart, no sentences.
    const SPOKEN =
      'so today i want to talk about why we shipped late um we bit off more than we could chew and by march the whole plan had gone south so we called it a day we tabled the redesign and we shipped what we had and in hindsight it was the right call';
    const events = [{ tStartMs: 0, segs: SPOKEN.split(' ').map((word, index) => ({ utf8: ` ${word}`, tOffsetMs: index * 300 })) }];
    const [passage] = toPassages(events, true);
    let answer = '';
    await chat(settings, captionsPrompt(`标题：${TITLE}`, '', [passage!.text], READER), {
      onDelta: createSegmentReader(1, (_index, text) => (answer = text)),
    });
    const cues = withTranslation(passage!, answer);
    console.log(cues.map((cue) => `${cue.start.toFixed(1)}–${cue.end.toFixed(1)}  ${cue.text}  ${cue.translation}`).join('\n'));

    expect(cues.length).toBeGreaterThan(3);
    for (const cue of cues) {
      expect(cue.translation).toMatch(CHINESE);
      expect(cue.text.split(' ').length).toBeLessThanOrEqual(18);
      expect(cue.end).toBeGreaterThan(cue.start);
    }
    // Every word is in some line, in order, so that the lines could be timed by them.
    const said = cues.map((cue) => cue.text.toLowerCase().replace(/[^a-z ]/g, '')).join(' ');
    expect(said.split(/\s+/).length).toBeGreaterThan(SPOKEN.split(' ').length * 0.9);
    expect(cues.map((cue) => cue.start)).toEqual([...cues.map((cue) => cue.start)].sort((a, b) => a - b));
  });

  it('explains a selection briefly', async () => {
    const explanation = await chat(settings, explainPrompt('tabled the redesign', SEGMENTS[1]!, TITLE, READER));
    console.log(explanation);
    expect(explanation).toMatch(CHINESE);
    expect(explanation.length).toBeLessThanOrEqual(120);
  });

  it('turns what the reader says into changes', async () => {
    const said = async (text: string) => {
      const command = parseCommand(await chat(settings, commandPrompt(text, READER, '主题：一个团队为什么延期发布')));
      console.log(text, '→', JSON.stringify(command));
      return command;
    };
    expect((await said('我其实过了六级，批注少一点')).level).toBe('cet6');
    expect((await said('以后译文口语化一点，像朋友聊天')).remember?.join('')).toMatch(/口语/);
    const answer = await said('这页讲了什么？');
    expect(answer.reply).toMatch(CHINESE);
    expect(answer.remember).toBeUndefined();
  });
});
