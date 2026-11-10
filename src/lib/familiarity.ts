import { LEVELS, loadEvidence, loadReader, saveEvidence, saveReader, type Level } from './settings';

/**
 * How Wordcaptor learns what the reader knows without asking: by how often a note
 * has been read past, and by what the reader does with notes.
 */

/** When a note was last counted as read, and how many times it has been. */
export interface Sighting {
  count: number;
  /** The local date and the page of the last count, which is not repeated for the same pair. */
  day: string;
  page: string;
}

/** Sightings by expression, written as in the collection of known expressions. */
export type Seen = Record<string, Sighting>;

/** A note read this many times is drawn one step fainter; at the last step it shows only under the pointer. */
const FADE_AT = [3, 5, 8];
const MS_PER_WORD = 240;
const MIN_READING_MS = 2000;
const MAX_READING_MS = 15_000;
/** Sightings older than this are dropped: an expression not met for so long is not one being learned. */
const KEEP_DAYS = 180;

/** How faint a note is drawn: 0 is as written, 3 is hidden until pointed at. */
export function fadeLevel(count: number): number {
  return FADE_AT.filter((threshold) => count >= threshold).length;
}

/** How long a block must stay in view before its notes count as read: about the time it takes to read it. */
export function readingTimeMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(Math.max(words * MS_PER_WORD, MIN_READING_MS), MAX_READING_MS);
}

/** Counts one reading of each expression, unless it was already counted on this page today. */
export function sight(seen: Seen, phrases: string[], day: string, page: string): Seen {
  const next = { ...seen };
  for (const phrase of phrases) {
    const last = next[phrase];
    if (last?.day === day && last.page === page) continue;
    next[phrase] = { count: (last?.count ?? 0) + 1, day, page };
  }
  return next;
}

/** Starts the count over for expressions the reader has shown they do not know yet. */
export function unsee(seen: Seen, phrases: string[]): Seen {
  const next = { ...seen };
  for (const phrase of phrases) delete next[phrase];
  return next;
}

export function dropOld(seen: Seen, today: string): Seen {
  const oldest = new Date(new Date(today).getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  return Object.fromEntries(Object.entries(seen).filter(([, sighting]) => sighting.day >= oldest));
}

/** What the reader has done with notes since their level was last set. */
export interface Evidence {
  level: Level;
  /** Notes put away as known. */
  known: number;
  /** Times the notes were not enough: a question asked, a whole translation asked for. */
  stuck: number;
}

const LEVEL_ORDER = Object.keys(LEVELS) as Level[];
/** The level goes up after this many notes put away, if they outnumber the times stuck four to one… */
const KNOWN_TO_RISE = 12;
/** …and down after this many times stuck, if they outnumber the notes put away two to one. */
const STUCK_TO_FALL = 6;

/**
 * Adds one piece of evidence and says what level it points to. Evidence
 * gathered under another level is discarded first: the reader, or Wordcaptor, has
 * changed the level since, and the notes are no longer the same.
 */
export function weigh(evidence: Evidence, level: Level, kind: 'known' | 'stuck'): { evidence: Evidence; level: Level } {
  const next = evidence.level === level ? { ...evidence } : { level, known: 0, stuck: 0 };
  next[kind]++;

  const at = LEVEL_ORDER.indexOf(level);
  let moved = at;
  if (next.known >= KNOWN_TO_RISE && next.known >= 4 * next.stuck) moved = Math.min(at + 1, LEVEL_ORDER.length - 1);
  else if (next.stuck >= STUCK_TO_FALL && next.stuck >= 2 * next.known) moved = Math.max(at - 1, 0);
  if (moved === at) return { evidence: next, level };
  return { evidence: { level: LEVEL_ORDER[moved]!, known: 0, stuck: 0 }, level: LEVEL_ORDER[moved]! };
}

/** Stores one piece of evidence. Resolves with the new level, and which way it went, if the reader's level moved. */
export async function recordEvidence(kind: 'known' | 'stuck'): Promise<{ level: Level; rose: boolean } | null> {
  const [reader, evidence] = await Promise.all([loadReader(), loadEvidence()]);
  const weighed = weigh(evidence, reader.level, kind);
  await saveEvidence(weighed.evidence);
  if (weighed.level === reader.level) return null;
  await saveReader({ ...reader, level: weighed.level });
  return { level: weighed.level, rose: kind === 'known' };
}
