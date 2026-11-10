import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBatchQueue } from './queue';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A `run` whose batches stay in flight until the test finishes them. */
function manualRunner() {
  const batches: string[][] = [];
  const finishers: (() => void)[] = [];
  const run = (batch: string[]) => {
    batches.push(batch);
    return new Promise<void>((resolve) => finishers.push(resolve));
  };
  const finish = async (index: number) => {
    finishers[index]!();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { batches, run, finish };
}

const base = { maxItems: 10, maxChars: 100, concurrency: 5, size: (item: string) => item.length };

describe('createBatchQueue', () => {
  it('groups items pushed close together into one batch', async () => {
    const { batches, run } = manualRunner();
    const queue = createBatchQueue({ ...base, run });

    queue.push('a');
    queue.push('b');
    expect(batches).toEqual([]);

    await vi.advanceTimersByTimeAsync(50);
    expect(batches).toEqual([['a', 'b']]);
  });

  it('splits batches at the item limit', async () => {
    const { batches, run } = manualRunner();
    const queue = createBatchQueue({ ...base, maxItems: 2, run });

    ['a', 'b', 'c'].forEach(queue.push);
    await vi.advanceTimersByTimeAsync(50);

    expect(batches).toEqual([['a', 'b'], ['c']]);
  });

  it('splits batches at the size limit, and sends an oversized item alone', async () => {
    const { batches, run } = manualRunner();
    const queue = createBatchQueue({ ...base, maxChars: 5, run });

    ['aaa', 'bbb', 'cccccccc', 'd'].forEach(queue.push);
    await vi.advanceTimersByTimeAsync(50);

    expect(batches).toEqual([['aaa'], ['bbb'], ['cccccccc'], ['d']]);
  });

  it('runs no more batches at once than the concurrency limit', async () => {
    const { batches, run, finish } = manualRunner();
    const queue = createBatchQueue({ ...base, maxItems: 1, concurrency: 2, run });

    ['a', 'b', 'c'].forEach(queue.push);
    await vi.advanceTimersByTimeAsync(50);
    expect(batches).toEqual([['a'], ['b']]);

    await finish(0);
    expect(batches).toEqual([['a'], ['b'], ['c']]);
  });

  it('reports idle only once everything has finished', async () => {
    const { run, finish } = manualRunner();
    const onIdle = vi.fn();
    const queue = createBatchQueue({ ...base, maxItems: 1, run, onIdle });

    ['a', 'b'].forEach(queue.push);
    await vi.advanceTimersByTimeAsync(50);

    await finish(0);
    expect(onIdle).not.toHaveBeenCalled();

    await finish(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('accepts new items after going idle', async () => {
    const { batches, run, finish } = manualRunner();
    const queue = createBatchQueue({ ...base, run });

    queue.push('a');
    await vi.advanceTimersByTimeAsync(50);
    await finish(0);

    queue.push('b');
    await vi.advanceTimersByTimeAsync(50);
    expect(batches).toEqual([['a'], ['b']]);
  });
});
