import { describe, expect, it } from 'vitest';
import {
  IDLE_PACE,
  afterSubtitleFailure,
  nextCueBatch,
  parseRetryAfter,
  rateWaitMs,
  retryFor,
} from './pace';

describe('rateWaitMs', () => {
  const fixed = () => 0.5;

  it('uses the time the service asked for, and never waits more than a minute', () => {
    expect(rateWaitMs(1, 4_000, fixed)).toBe(4_000);
    expect(rateWaitMs(1, 0, fixed)).toBe(0);
    expect(rateWaitMs(3, 120_000, fixed)).toBe(60_000);
  });

  it('doubles each attempt when the service gave no time, and shakes the result', () => {
    expect(rateWaitMs(1, undefined, () => 0)).toBe(1_600);
    expect(rateWaitMs(1, undefined, () => 1)).toBe(2_400);
    expect(rateWaitMs(2, undefined, fixed)).toBe(4_000);
    expect(rateWaitMs(3, undefined, fixed)).toBe(8_000);
    expect(rateWaitMs(8, undefined, fixed)).toBe(60_000);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-11-11T02:00:00Z');

  it('reads seconds and a date', () => {
    expect(parseRetryAfter('2', now)).toBe(2_000);
    expect(parseRetryAfter('Wed, 11 Nov 2026 02:00:05 GMT', now)).toBe(5_000);
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
  });
});

describe('retryFor', () => {
  it('waits on a rate limit or a concurrency limit, and stops on a rejected key', () => {
    expect(retryFor(429, '')).toBe('rate');
    expect(retryFor(503, 'unavailable')).toBe('rate');
    expect(retryFor(400, 'concurrency limit exceeded')).toBe('rate');
    expect(retryFor(200, '您当前的并发数过高')).toBe('rate');
    expect(retryFor(401, 'invalid api key')).toBe('stop');
    expect(retryFor(403, 'forbidden')).toBe('stop');
    expect(retryFor(400, 'bad request')).toBe('stop');
  });

  it('retries a server failure or a dropped connection once', () => {
    expect(retryFor(500, 'model exploded')).toBe('once');
    expect(retryFor(502, '')).toBe('once');
    expect(retryFor(0, 'Failed to fetch')).toBe('once');
  });
});

describe('afterSubtitleFailure', () => {
  const failed = { ...IDLE_PACE };

  it('waits out a rate limit and then takes whatever the playhead has reached', () => {
    expect(afterSubtitleFailure(failed, { retry: 'rate', retryAfterMs: 4_000 }, 0, 20, 1_000)).toEqual({
      ...IDLE_PACE,
      retryAt: 5_000,
    });
  });

  it('retries a dropped connection at once, and steps over a batch that fails twice', () => {
    const once = afterSubtitleFailure(failed, { retry: 'once' }, 0, 20, 1_000);
    expect(once).toMatchObject({ onceFrom: 0, retryAt: 1_000, skipBefore: 0 });
    expect(afterSubtitleFailure(once, { retry: 'once' }, 0, 20, 1_100)).toMatchObject({ onceFrom: -1, skipBefore: 20 });
  });

  it('stops on a rejected key', () => {
    expect(afterSubtitleFailure(failed, { retry: 'stop' }, 0, 20, 1_000).halted).toBe(true);
    expect(afterSubtitleFailure(failed, { notConfigured: true }, 0, 20, 1_000).halted).toBe(true);
  });
});

describe('nextCueBatch', () => {
  const starts = Array.from({ length: 100 }, (_, index) => index * 3);

  it('starts at the playhead, so a line the video has passed is not sent', () => {
    // The playhead is at 90 seconds: passage 30. The batch that failed was 0 to 19.
    const batch = nextCueBatch(starts, () => false, 30, 90, 180, 20, 0);
    expect(batch).toEqual({ from: 30, to: 50 });
  });

  it('skips passages already answered and stops at the window', () => {
    const batch = nextCueBatch(starts, (index) => index < 4, 0, 0, 180, 20, 0);
    expect(batch).toEqual({ from: 4, to: 24 });
    expect(nextCueBatch(starts, () => false, 0, 0, 9, 20, 0)).toEqual({ from: 0, to: 4 });
  });

  it('leaves a batch that failed twice until the viewer comes back to it', () => {
    expect(nextCueBatch(starts, () => false, 0, 0, 180, 20, 20)).toEqual({ from: 20, to: 40 });
    expect(nextCueBatch(starts, () => false, 95, 290, 180, 20, 0)).toEqual({ from: 95, to: 100 });
  });
});
