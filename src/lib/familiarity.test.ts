import { describe, expect, it } from 'vitest';
import { dropOld, fadeLevel, readingTimeMs, sight, unsee, weigh, type Evidence, type Seen } from './familiarity';

describe('counting readings of a note', () => {
  it('counts once per page per day', () => {
    let seen: Seen = {};
    seen = sight(seen, ['ship it', 'tabled'], '2026-11-10', 'a.com/post');
    seen = sight(seen, ['ship it'], '2026-11-10', 'a.com/post'); // again on the same page
    seen = sight(seen, ['ship it'], '2026-11-10', 'b.com/other');
    seen = sight(seen, ['ship it'], '2026-11-11', 'b.com/other');

    expect(seen['ship it']).toEqual({ count: 3, day: '2026-11-11', page: 'b.com/other' });
    expect(seen['tabled']!.count).toBe(1);
  });

  it('starts over for expressions the reader needed help with, leaving the rest', () => {
    const seen = sight(sight({}, ['a', 'b'], '2026-11-10', 'p'), ['a', 'b'], '2026-11-11', 'p');
    expect(unsee(seen, ['a'])).toEqual({ b: { count: 2, day: '2026-11-11', page: 'p' } });
  });

  it('forgets expressions not met for half a year', () => {
    const seen: Seen = { old: { count: 4, day: '2026-01-01', page: 'p' }, recent: { count: 1, day: '2026-09-01', page: 'p' } };
    expect(Object.keys(dropOld(seen, '2026-11-10'))).toEqual(['recent']);
  });
});

describe('fading', () => {
  it('begins at the third reading and ends with the note hidden at the eighth', () => {
    expect([0, 2, 3, 4, 5, 7, 8, 20].map(fadeLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('takes a block to be read in about the time it takes to read it, within bounds', () => {
    expect(readingTimeMs('Two words')).toBe(2000);
    expect(readingTimeMs(Array(20).fill('word').join(' '))).toBe(4800);
    expect(readingTimeMs(Array(500).fill('word').join('\n'))).toBe(15_000);
  });
});

describe('calibrating the level from what the reader does', () => {
  const after = (start: Evidence, level: Evidence['level'], ...kinds: ('known' | 'stuck')[]) =>
    kinds.reduce((state, kind) => weigh(state.evidence, state.level, kind), { evidence: start, level });
  const fresh: Evidence = { level: 'cet4', known: 0, stuck: 0 };
  const times = <T>(count: number, value: T) => Array<T>(count).fill(value);

  it('raises the level after a dozen notes put away, and starts gathering anew', () => {
    expect(after(fresh, 'cet4', ...times(11, 'known' as const)).level).toBe('cet4');
    expect(after(fresh, 'cet4', ...times(12, 'known' as const))).toEqual({
      level: 'cet6',
      evidence: { level: 'cet6', known: 0, stuck: 0 },
    });
  });

  it('does not raise it while the reader also keeps getting stuck', () => {
    const mixed = [...times(4, 'stuck' as const), ...times(15, 'known' as const)];
    expect(after(fresh, 'cet6', ...mixed).level).toBe('cet6');
    expect(after(fresh, 'cet6', ...mixed, 'known').level).toBe('fluent'); // 16 to 4
  });

  it('lowers it after the notes were not enough six times', () => {
    expect(after(fresh, 'cet6', ...times(5, 'stuck' as const)).level).toBe('cet6');
    expect(after(fresh, 'cet6', ...times(6, 'stuck' as const)).level).toBe('cet4');
  });

  it('stays within the levels there are', () => {
    expect(after(fresh, 'fluent', ...times(30, 'known' as const)).level).toBe('fluent');
    expect(after(fresh, 'cet4', ...times(30, 'stuck' as const)).level).toBe('cet4');
  });

  it('discards evidence gathered under another level', () => {
    const stale: Evidence = { level: 'cet4', known: 11, stuck: 0 };
    expect(after(stale, 'cet6', 'known')).toEqual({ level: 'cet6', evidence: { level: 'cet6', known: 1, stuck: 0 } });
  });
});
