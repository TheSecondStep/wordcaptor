/** One subtitle as it is shown: a stretch of the video, in seconds, and what is said in it. */
export interface Cue {
  start: number;
  end: number;
  text: string;
  translation?: string;
}

/**
 * A stretch of a caption track that the model works on as one piece, and that
 * is saved under its text. For automatic captions, `cues` are the words shown until
 * the model has made sentences. A written line keeps those cues on screen while a
 * playing video is still waiting for the translation.
 */
export interface Passage {
  start: number;
  end: number;
  text: string;
  cues: Cue[];
  /** Automatic captions only: the words with the times they are spoken at, which the model's sentences are timed by. */
  words?: Word[];
}

interface Word {
  /** Milliseconds into the video. */
  at: number;
  text: string;
}

/** YouTube's `json3` caption format, as far as it is used here. */
export interface CaptionEvent {
  tStartMs?: number;
  dDurationMs?: number;
  /** Set on the events of automatic captions that only break the line. */
  aAppend?: number;
  segs?: { utf8?: string; tOffsetMs?: number }[];
}

/** Stands between the English and the Chinese of a line in the model's answer for automatic captions. */
export const CAPTION_SEPARATOR = '||';

/**
 * Automatic captions go to the model in passages of about this many words:
 * long enough to hold whole sentences, short enough to come back in seconds.
 * A passage ends at the longest pause in this range, which is the likeliest
 * place for a sentence to end.
 */
const MIN_PASSAGE_WORDS = 60;
const MAX_PASSAGE_WORDS = 110;
/** Until the model has made sentences of them, words are shown in lines that close once they are this long… */
const MAX_LINE_CHARS = 84;
/** …or when the speaker pauses for this long. */
const PAUSE_MS = 1200;
/** How long the last words before a pause stay on screen. */
const LINGER_MS = 2500;
/** This many words left over by the model are shown as they are, rather than under its last sentence. */
const MIN_LEFTOVER_WORDS = 6;

/**
 * Turns a caption track into passages. Captions written by a person already
 * come as sentences, each of which is a passage of its own. Automatic captions
 * are a stream of words with no sentences in it; making sentences of them is
 * left to the model, a passage at a time.
 */
export function toPassages(events: CaptionEvent[], automatic: boolean): Passage[] {
  return automatic ? spokenPassages(events) : writtenPassages(events);
}

function writtenPassages(events: CaptionEvent[]): Passage[] {
  const passages: Passage[] = [];
  for (const event of events) {
    const text = (event.segs ?? [])
      .map((seg) => seg.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || event.tStartMs === undefined) continue;
    const start = event.tStartMs / 1000;
    const end = (event.tStartMs + (event.dDurationMs ?? 0)) / 1000;
    passages.push({ start, end, text, cues: [{ start, end, text }] });
  }
  return passages;
}

function spokenPassages(events: CaptionEvent[]): Passage[] {
  const words: Word[] = [];
  for (const event of events) {
    if (event.aAppend || event.tStartMs === undefined) continue;
    for (const seg of event.segs ?? []) {
      // Words carry their own leading space, except the first of each event, so the spacing is redone.
      const text = (seg.utf8 ?? '').trim();
      if (text) words.push({ at: event.tStartMs + (seg.tOffsetMs ?? 0), text });
    }
  }

  const passages: Passage[] = [];
  for (let from = 0; from < words.length; ) {
    let to = words.length;
    if (to - from > MAX_PASSAGE_WORDS) {
      to = from + MIN_PASSAGE_WORDS;
      for (let cut = to + 1; cut <= from + MAX_PASSAGE_WORDS; cut++) {
        if (pauseBefore(words, cut) > pauseBefore(words, to)) to = cut;
      }
    }
    const spoken = words.slice(from, to);
    const endMs = Math.min(words[to]?.at ?? Infinity, spoken[spoken.length - 1]!.at + LINGER_MS);
    passages.push({
      start: spoken[0]!.at / 1000,
      end: endMs / 1000,
      text: spoken.map((word) => word.text).join(' '),
      cues: lines(spoken, endMs),
      words: spoken,
    });
    from = to;
  }
  return passages;
}

function pauseBefore(words: Word[], index: number): number {
  return words[index]!.at - words[index - 1]!.at;
}

/** Words as lines of a readable length, for as long as there are no sentences to show instead. */
function lines(words: Word[], endMs: number): Cue[] {
  const cues: Cue[] = [];
  let line: Word[] = [];
  const close = (nextAt: number) => {
    if (line.length === 0) return;
    cues.push({
      start: line[0]!.at / 1000,
      end: Math.min(nextAt, line[line.length - 1]!.at + LINGER_MS) / 1000,
      text: line.map((word) => word.text).join(' '),
    });
    line = [];
  };

  for (const word of words) {
    const previous = line[line.length - 1];
    if (previous) {
      const length = line.reduce((sum, each) => sum + each.text.length + 1, 0);
      if (word.at - previous.at > PAUSE_MS || length + word.text.length > MAX_LINE_CHARS) close(word.at);
    }
    line.push(word);
  }
  close(endMs);
  return cues;
}

/**
 * The cues of a passage once the model has answered for it. For a written
 * caption the answer is its translation. For automatic captions it is the
 * passage as sentences, one `English || Chinese` line each, which are timed
 * by finding their words among the spoken ones. The model is asked to keep
 * the words as they are, but corrects, adds, and drops some all the same.
 */
export function withTranslation(passage: Passage, answer: string): Cue[] {
  if (!passage.words) return passage.cues.map((cue) => ({ ...cue, translation: answer }));

  const sentences: { text: string; translation: string; keys: string[] }[] = [];
  for (const line of answer.split('\n')) {
    const cut = line.indexOf(CAPTION_SEPARATOR);
    const text = cut === -1 ? '' : line.slice(0, cut).trim();
    const translation = cut === -1 ? '' : line.slice(cut + CAPTION_SEPARATOR.length).trim();
    if (text && translation) sentences.push({ text, translation, keys: text.split(/\s+/).map(wordKey).filter(Boolean) });
  }
  if (sentences.length === 0) return passage.cues;

  const words = passage.words;
  const endMs = passage.end * 1000;
  const places = matchWords(
    words.map((word) => wordKey(word.text)),
    sentences.flatMap((sentence) => sentence.keys),
  );

  const timed: { from: number; text: string; translation: string }[] = [];
  /** How many of the spoken words the sentences so far account for. */
  let at = 0;
  let key = 0;
  for (const { text, translation, keys } of sentences) {
    const found = places.slice(key, (key += keys.length));
    const first = found.findIndex((place) => place !== -1);
    const previous = timed[timed.length - 1];
    if (previous && (at >= words.length || first === -1)) {
      // Nothing to time this sentence by: it is said along with the one before.
      previous.text += ` ${text}`;
      previous.translation += translation;
      continue;
    }
    // Words the model changed at the start of a sentence were spoken just before the first one that is found.
    timed.push({ from: first === -1 ? at : Math.max(at, found[first]! - first), text, translation });
    at = Math.max(at, ...found.map((place) => place + 1));
  }

  const leftover = words.length - at >= MIN_LEFTOVER_WORDS ? words.slice(at) : [];
  const cues = timed.map(({ from, text, translation }, index): Cue => {
    const next = timed[index + 1];
    const lastWord = words[(next ? next.from : leftover.length ? at : words.length) - 1] ?? words[from]!;
    const until = next ? words[next.from]!.at : (leftover[0]?.at ?? endMs);
    return {
      start: words[from]!.at / 1000,
      end: Math.max(words[from]!.at, Math.min(until, lastWord.at + LINGER_MS)) / 1000,
      text,
      translation,
    };
  });
  return [...cues, ...lines(leftover, endMs)];
}

/**
 * For each of the model's words, the index of the spoken word it is, or -1
 * for one the model added or changed. The model may also have dropped words.
 * What is found is the longest run of words the two have in common, in order.
 */
function matchWords(spoken: string[], written: string[]): number[] {
  // common[i][j]: how many words spoken[i..] and written[j..] have in common.
  const common = Array.from({ length: spoken.length + 1 }, () => new Uint16Array(written.length + 1));
  for (let i = spoken.length - 1; i >= 0; i--) {
    for (let j = written.length - 1; j >= 0; j--) {
      common[i]![j] = spoken[i] === written[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const places = new Array<number>(written.length).fill(-1);
  for (let i = 0, j = 0; i < spoken.length && j < written.length; ) {
    if (spoken[i] === written[j]) places[j++] = i++;
    else if (common[i + 1]![j]! >= common[i]![j + 1]!) i++;
    else j++;
  }
  return places;
}

/** A word as it is compared: the model adds capitals and punctuation, which must not matter. */
function wordKey(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** The index of the cue or passage on screen at a time, or -1 between two. They are in order of start. */
export function cueAt(cues: { start: number; end: number }[], time: number): number {
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const cue = cues[middle]!;
    if (time < cue.start) high = middle - 1;
    else if (time >= cue.end) low = middle + 1;
    else return middle;
  }
  return -1;
}
