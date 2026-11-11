/** How a failed model call should be tried again. `stop` means another try would fail the same way. */
export type Retry = 'rate' | 'once' | 'stop';

/** How many model calls may be in flight for one key, across the page and the subtitles. */
export const MODEL_SLOTS = 2;

/** Subtitles go ahead of the page. Something the reader just asked goes ahead of both. */
export const PRIORITY = { page: 0, subtitle: 1, interactive: 2 };

const BACKOFF_START_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

/**
 * How long to wait after the service asked us to slow down. The attempt count
 * starts at 1. A time given by the service is used as it is, up to a minute;
 * otherwise the wait doubles each time and is shaken a little, so callers do
 * not all come back together.
 */
export function rateWaitMs(attempt: number, retryAfterMs?: number, random = Math.random): number {
  const within = (ms: number) => Math.min(BACKOFF_MAX_MS, Math.max(0, Math.round(ms)));
  if (retryAfterMs !== undefined) return within(retryAfterMs);
  const base = BACKOFF_START_MS * 2 ** Math.max(0, attempt - 1);
  return within(base * (0.8 + random() * 0.4));
}

/** `Retry-After` is either a number of seconds or an HTTP date. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return;
}

/** What to do about an HTTP status. The body is checked too, because a concurrency limit is not always a 429. */
export function retryFor(status: number, body: string): Retry {
  if (status === 401 || status === 403) return 'stop';
  if (status === 429 || status === 503 || /rate.?limit|too many requests|concurrency|concurrent|限流|限速|频繁|并发/i.test(body)) {
    return 'rate';
  }
  if (status >= 400 && status < 500) return 'stop';
  return 'once';
}

/** Where subtitle requests stand after a failure. */
export interface SubtitlePace {
  /** Nothing is sent before this time. */
  retryAt: number;
  /** A failure that will not change by trying again, such as a rejected key. */
  halted: boolean;
  /** The batch already given its one immediate retry, or -1. */
  onceFrom: number;
  /** Passages before this one are left alone until the viewer seeks back. */
  skipBefore: number;
}

export const IDLE_PACE: SubtitlePace = { retryAt: 0, halted: false, onceFrom: -1, skipBefore: 0 };

/**
 * A failed batch goes back into line where the video is now, which the caller
 * does by forgetting it and asking again from the playhead. A batch that fails
 * twice without the video moving is stepped over, so a later line can be
 * translated instead of the one the viewer has already sat through.
 */
export function afterSubtitleFailure(
  state: SubtitlePace,
  failure: { retry?: Retry; retryAfterMs?: number; notConfigured?: boolean },
  from: number,
  count: number,
  now: number,
): SubtitlePace {
  if (failure.notConfigured || failure.retry === 'stop') return { ...state, halted: true };
  if (failure.retry === 'rate') return { ...state, halted: false, onceFrom: -1, retryAt: now + (failure.retryAfterMs ?? BACKOFF_START_MS) };
  if (state.onceFrom === from) return { ...state, onceFrom: -1, skipBefore: from + count, retryAt: now };
  return { ...state, onceFrom: from, retryAt: now };
}

/**
 * The next contiguous run of passages to send. `index` is the passage at the
 * playhead. Passages already answered, already given up, or further ahead than
 * the window are left out.
 */
export function nextCueBatch(
  starts: number[],
  done: (index: number) => boolean,
  index: number,
  time: number,
  aheadSeconds: number,
  size: number,
  skipBefore: number,
): { from: number; to: number } | null {
  let from = Math.max(index, skipBefore);
  while (from < starts.length && done(from)) from++;
  const start = starts[from];
  if (start === undefined || start > time + aheadSeconds) return null;
  let to = from + 1;
  while (to < starts.length && to < from + size && !done(to) && starts[to]! <= time + aheadSeconds) to++;
  return { from, to };
}
