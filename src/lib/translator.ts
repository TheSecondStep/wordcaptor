import type { Prompt } from './llm';
import { LEVELS, type Reader } from './settings';
import { CAPTION_SEPARATOR } from './subtitles';

/**
 * Part of every cache key. Change it whenever the prompts below change, so
 * output produced by the old prompts is no longer reused.
 */
export const PROMPT_VERSION = '2';

/** One note for learn mode: an expression as written in the text, and what it means there. */
export interface Annotation {
  phrase: string;
  gloss: string;
}

/** Asks the model to read the page once and write notes that every later call shares. */
export function briefPrompt(title: string, text: string): Prompt {
  return {
    system: [
      '你在为一位译者做准备工作。下面是一个英文网页的标题和正文节选。',
      '写一份翻译简报，纯文本，不超过 250 字，格式如下：',
      '主题：一句话说明这页在讲什么、属于什么领域',
      '语气：原文的语气和文体，一句话',
      '术语：最多 15 条，每行一条，写成「English = 中文」；应保留原文不译的专名、产品名写成「English = 保留」',
      '只输出简报本身。',
    ].join('\n'),
    user: `标题：${title}\n\n正文节选：\n${text}`,
  };
}

/** Builds the prompt that translates one batch of segments. `context` is the text just before the batch. */
export function translatePrompt(brief: string, context: string, segments: string[], reader: Reader): Prompt {
  const system = [
    '你是一位为中文读者翻译英文网页的译者。读者英语基础薄弱，目标是让他顺畅读懂原文的意思。',
    '',
    '要求：',
    '- 译成自然、通顺的简体中文，按意思翻，不逐词硬译。',
    '- 习语、短语动词、俚语、反讽、网络用语，译出它在这里的实际含义，不要按字面翻。',
    '- 代码、命令、URL、人名和产品名保留原文。',
    '- 遵守页面简报里的术语译法，全文保持一致。',
    '- 不添加解释、注释或原文没有的内容。',
    ...wishes(reader),
    '',
    '页面简报：',
    brief,
    '',
    '输入是若干 <s id="N">…</s> 片段。<context> 里是紧邻的上文，只用来帮助理解，不要翻译它。',
    '逐个翻译片段，用相同的 id 和标签输出，除此之外不输出任何内容。',
  ].join('\n');

  return { system, user: segmentsInput(context, segments) };
}

/**
 * Builds the prompt for learn mode: for each segment, list the expressions the
 * reader would not understand or would misread, each with a short gloss.
 */
export function annotatePrompt(brief: string, context: string, segments: string[], reader: Reader): Prompt {
  const system = [
    `你在帮一位中文读者读英文网页，为他写批注。他的英语水平：${LEVELS[reader.level]}。`,
    '找出每个片段里他很可能看不懂、或者按字面理解会理解错的表达。',
    '',
    '要标的：',
    '- 习语、短语动词、俚语、网络用语、缩写。',
    '- 常见词在这里不是它最常见的意思，例如 "table the motion"、"address the issue"、"ship it"。这一类最重要，因为读者会以为自己看懂了。',
    '- 以他的水平很可能不认识的难词。',
    '',
    '不要标的：',
    '- 人名、地名、产品名、代码。',
    '- 他这个水平认识、并且在这里就是常见意思的词。',
    '',
    '写法：',
    '- 以意义单元为单位：短语整体标出，不要拆成单词。',
    '- 原文表达必须从片段里照抄，一字不差，不要改变词形或大小写。',
    '- 中文意思只写它在这句话里的意思，不超过 10 个字，不解释，不举例。',
    '- 同一个表达在一个片段里只标一次。',
    `- 如果一个片段要标的地方超过三处，或者句子结构绕到标了词也读不懂，在这个片段的最后另起一行，写「${SENTENCE_MARK} 整个片段的中文译文」。其余片段不要写这一行。`,
    ...wishes(reader),
    '',
    '页面简报：',
    brief,
    '',
    '输入是若干 <s id="N">…</s> 片段。<context> 里是紧邻的上文，只用来帮助理解，不要标它。',
    '对每个片段，用相同的 id 输出一个 <s id="N">…</s>，里面每行一条，写成「原文表达 = 中文意思」。',
    '没有需要标的片段也要输出，里面留空。除此之外不输出任何内容。',
  ].join('\n');

  return { system, user: segmentsInput(context, segments) };
}

/**
 * Builds the prompt that makes subtitles of a video's automatic captions:
 * words with no punctuation and no sentences. The model divides each segment
 * into lines, and gives each line in English and in Chinese. The English is
 * asked for word by word as spoken, because the lines are timed by finding
 * their words among the spoken ones; see subtitles.ts.
 */
export function captionsPrompt(brief: string, context: string, segments: string[], reader: Reader): Prompt {
  const system = [
    '你在给英文视频做中英双语字幕。输入是自动语音识别出来的字幕：全是小写，没有标点，没有断句，偶尔有听错的词。',
    '观众英语基础薄弱，靠中文字幕看懂视频。',
    '',
    '对每个片段：',
    '- 按意思把它断成一行行字幕。每行是一个完整的短句或一个意群，英文 4 到 14 个词。长句在从句、连接词处断开，不要把一个词组拆在两行。',
    `- 每行写成「英文 ${CAPTION_SEPARATOR} 中文」。`,
    '- 英文：片段里的词照抄，顺序不变，不增不删，只加上标点和大小写。明显听错的词可以改正，但一个词只换成一个词。片段里的每个词都要出现在某一行里。',
    '- 中文：这一行英文的意思，口语、简短，像字幕。一句话断成几行时，各行中文连起来读要通顺。um、you know 这类口头禅不用译。',
    '- 片段的开头和结尾可能停在半句话上，照原样处理，不要补全。',
    '- 人名、产品名、代码保留原文。',
    ...wishes(reader),
    '',
    '视频简报：',
    brief,
    '',
    '输入是若干 <s id="N">…</s> 片段。<context> 里是紧邻的上文，只用来帮助理解，不要处理它。',
    '对每个片段，用相同的 id 输出一个 <s id="N">…</s>，里面每行一条字幕。除此之外不输出任何内容。',
  ].join('\n');

  return { system, user: segmentsInput(context, segments) };
}

/** In learn mode, starts the line that translates a whole segment too hard to read with notes alone. */
const SENTENCE_MARK = '>>';

/** What the reader has asked for, as extra rules. They come after the fixed rules so they can override them. */
function wishes(reader: Reader): string[] {
  if (reader.preferences.length === 0) return [];
  return ['', '读者提过的要求，和上面的规则冲突时以这些为准：', ...reader.preferences.map((wish) => `- ${wish}`)];
}

/** Asks for a short explanation of something the reader selected and did not understand. */
export function explainPrompt(selection: string, paragraph: string, title: string, reader: Reader): Prompt {
  return {
    system: [
      `一位中文读者在读英文网页，他选中了一处看不懂的地方。他的英语水平：${LEVELS[reader.level]}。`,
      '用简体中文告诉他这处在这里是什么意思，以及为什么会这样说（如果是习语、双关、省略、文化背景）。',
      '最多两句话，不超过 60 个字。不要重复原文，不要寒暄，不要用列表或标记。',
      ...wishes(reader),
    ].join('\n'),
    user: `网页标题：${title}\n所在段落：${paragraph}\n\n他选中的是：${selection}`,
  };
}

/** What the reader can change by talking to the sprite. Every part is optional. */
export interface Command {
  /** What the sprite says back. */
  reply: string;
  level?: Reader['level'];
  mode?: 'translate' | 'learn';
  /** Wishes to keep from now on. */
  remember?: string[];
  /** Wishes to drop, quoted as they were kept. */
  forget?: string[];
  /** Expressions the reader says they know. */
  known?: string[];
  /** Stay away from the site the reader is on. */
  muteSite?: boolean;
}

/** Turns something the reader said to the sprite into changes to make, or just an answer. */
export function commandPrompt(said: string, reader: Reader, brief: string): Prompt {
  return {
    system: [
      '你是「小樱」，一个浏览器扩展里帮中文读者读英文网页的小魔法使。读者对你说了一句话。',
      '判断他想要什么，只输出一个 JSON 对象，不要输出别的。可用的字段（都可省略，reply 必填）：',
      '- "reply"：你回他的一句话，简体中文，不超过 40 个字，语气轻快，不要用表情符号。',
      '- "level"："cet4"、"cet6" 或 "fluent"。他说到自己的英语水平、嫌批注太多或太少时设置。',
      '- "mode"："translate"（每段都要译文）或 "learn"（只批注难词）。',
      '- "remember"：字符串数组。他对译文或批注提出的长期要求，每条改写成一句清楚的规则，例如「译文口语化一些」「agent 保留不译」。',
      '- "forget"：字符串数组。他想取消的已有要求，照抄下面「已有的要求」里的原文。',
      '- "known"：字符串数组。他说自己已经会的英文词或短语。',
      '- "muteSite"：true。他不想在当前网站看到你。',
      '如果他只是在问问题（比如这页讲了什么、某个词什么意思），只用 reply 回答，这时 reply 可以放宽到 80 个字。',
      '',
      `他现在的水平：${reader.level}`,
      `已有的要求：${JSON.stringify(reader.preferences)}`,
      `当前页面的简报：${brief || '（还没有）'}`,
    ].join('\n'),
    user: said,
  };
}

/** Reads the model's answer to a command. Anything that is not the expected JSON becomes a plain reply. */
export function parseCommand(text: string): Command {
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
  try {
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const command: Command = { reply: typeof json.reply === 'string' && json.reply ? json.reply : '好的' };
    if (json.level in LEVELS) command.level = json.level;
    if (json.mode === 'translate' || json.mode === 'learn') command.mode = json.mode;
    if (strings(json.remember).length) command.remember = strings(json.remember);
    if (strings(json.forget).length) command.forget = strings(json.forget);
    if (strings(json.known).length) command.known = strings(json.known);
    if (json.muteSite === true) command.muteSite = true;
    return command;
  } catch {
    return { reply: text.trim().slice(0, 120) || '我没听懂，再说一次？' };
  }
}

function segmentsInput(context: string, segments: string[]): string {
  const parts = segments.map((segment, index) => `<s id="${index + 1}">${segment}</s>`);
  if (context) parts.unshift(`<context>${context}</context>`);
  return parts.join('\n');
}

/** Reads the notes of one learn-mode segment. Lines that are not `expression = meaning` are dropped. */
export function parseAnnotations(text: string): Annotation[] {
  const annotations: Annotation[] = [];
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at === -1 || line.trimStart().startsWith(SENTENCE_MARK)) continue;
    const phrase = line.slice(0, at).trim();
    const gloss = line.slice(at + 1).trim();
    if (phrase && gloss) annotations.push({ phrase, gloss });
  }
  return annotations;
}

/** The translation a learn-mode segment carries when notes alone would not be enough, if any. */
export function parseSentenceTranslation(text: string): string | null {
  const line = text.split('\n').find((candidate) => candidate.trimStart().startsWith(SENTENCE_MARK));
  return line?.trimStart().slice(SENTENCE_MARK.length).trim() || null;
}

/**
 * Returns a function to feed the model's reply into as it streams in.
 * `onSegment` is called once for each segment as soon as its closing tag
 * arrives, with the zero-based index of the input segment it belongs to and
 * the text inside the tags, which may be empty. Segments the model skips are
 * never reported.
 */
export function createSegmentReader(
  count: number,
  onSegment: (index: number, text: string) => void,
): (delta: string) => void {
  const reported = new Set<number>();
  let buffer = '';

  return (delta) => {
    buffer += delta;
    for (;;) {
      const end = buffer.indexOf('</s>');
      if (end === -1) return;
      const match = buffer.slice(0, end).match(/<s id="(\d+)">([\s\S]*)$/);
      buffer = buffer.slice(end + '</s>'.length);
      if (!match) continue;

      const index = Number(match[1]) - 1;
      if (index < 0 || index >= count || reported.has(index)) continue;
      reported.add(index);
      onSegment(index, (match[2] ?? '').trim());
    }
  };
}
