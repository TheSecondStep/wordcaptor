import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { cacheKey, getCached, pruneCache, putCached } from './cache';

describe('cacheKey', () => {
  it('is the same for the same parts and different otherwise', async () => {
    const key = await cacheKey('model-a', 'Hello.');

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await cacheKey('model-a', 'Hello.')).toBe(key);
    expect(await cacheKey('model-b', 'Hello.')).not.toBe(key);
    expect(await cacheKey('model-a', 'Hello!')).not.toBe(key);
  });

  it('does not confuse where one part ends and the next begins', async () => {
    expect(await cacheKey('ab', 'c')).not.toBe(await cacheKey('a', 'bc'));
  });
});

describe('the cache', () => {
  it('returns stored values in the order asked, and null for unknown keys', async () => {
    await putCached('order-1', '一');
    await putCached('order-2', '二');

    expect(await getCached(['order-2', 'order-missing', 'order-1'])).toEqual(['二', null, '一']);
    expect(await getCached([])).toEqual([]);
  });

  it('overwrites an existing entry', async () => {
    await putCached('overwrite', '旧');
    await putCached('overwrite', '新');

    expect(await getCached(['overwrite'])).toEqual(['新']);
  });

  it('prunes entries older than the limit and keeps the rest', async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 100 * day;
    await putCached('prune-old', '旧', now - 31 * day);
    await putCached('prune-edge', '刚好', now - 30 * day);
    await putCached('prune-new', '新', now - day);

    await pruneCache(30 * day, now);

    expect(await getCached(['prune-old', 'prune-edge', 'prune-new'])).toEqual([null, '刚好', '新']);
  });
});
