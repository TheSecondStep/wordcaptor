export interface BatchQueueOptions<T> {
  maxItems: number;
  maxChars: number;
  concurrency: number;
  size: (item: T) => number;
  /** Processes one batch. Must handle its own errors and not reject. */
  run: (batch: T[]) => Promise<void>;
  /** Called each time the queue drains completely. */
  onIdle?: () => void;
}

const COLLECT_MS = 50;

/**
 * Groups items that arrive close together into batches bounded by count and
 * total size, and runs a limited number of batches at once.
 */
export function createBatchQueue<T>(options: BatchQueueOptions<T>) {
  const pending: T[] = [];
  let active = 0;
  let scheduled = false;

  function takeBatch(): T[] {
    const batch: T[] = [];
    let chars = 0;
    while (pending.length > 0 && batch.length < options.maxItems) {
      const size = options.size(pending[0]!);
      // An oversized item still goes out, alone.
      if (batch.length > 0 && chars + size > options.maxChars) break;
      batch.push(pending.shift()!);
      chars += size;
    }
    return batch;
  }

  function pump() {
    while (active < options.concurrency && pending.length > 0) {
      active++;
      void options.run(takeBatch()).finally(() => {
        active--;
        pump();
        if (active === 0 && pending.length === 0) options.onIdle?.();
      });
    }
  }

  return {
    push(item: T) {
      pending.push(item);
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        pump();
      }, COLLECT_MS);
    },
  };
}
