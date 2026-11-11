/**
 * The queue in front of the model. One key is allowed a fixed number of calls
 * at once, from every tab together; a rate limit holds the whole queue, and a
 * higher priority starts before a lower one that is still waiting.
 */
export function createModelGate(concurrency: number, waitMs: (attempt: number, retryAfterMs?: number) => number) {
  let running = 0;
  let attempt = 0;
  let notBefore = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  const waiting: Waiter[] = [];

  interface Waiter {
    priority: number;
    seq: number;
    signal: AbortSignal;
    grant: () => void;
    reject: (error: unknown) => void;
  }

  function pump() {
    if (Date.now() < notBefore) {
      clearTimeout(timer);
      timer = setTimeout(pump, notBefore - Date.now());
      return;
    }
    waiting.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    while (running < concurrency && waiting.length > 0) {
      const next = waiting.shift()!;
      if (next.signal.aborted) {
        next.reject(abortError(next.signal));
        continue;
      }
      running++;
      next.grant();
    }
  }

  return {
    /** Resolves when a slot is free and the rate limit has cooled. Rejects if `signal` aborts while waiting. */
    acquire(priority: number, signal: AbortSignal): Promise<void> {
      if (signal.aborted) return Promise.reject(abortError(signal));
      return new Promise((resolve, reject) => {
        const waiter: Waiter = { priority, seq: seq++, signal, grant: resolve, reject };
        signal.addEventListener(
          'abort',
          () => {
            const index = waiting.indexOf(waiter);
            if (index === -1) return;
            waiting.splice(index, 1);
            reject(abortError(signal));
          },
          { once: true },
        );
        waiting.push(waiter);
        pump();
      });
    },

    /**
     * Gives back the slot taken by `acquire`. A rate-limited call holds every
     * later call until the wait is over, and the wait is what this returns.
     */
    release(kind: 'ok' | 'rate' | 'other', retryAfterMs?: number): number {
      running = Math.max(0, running - 1);
      if (kind === 'rate') {
        attempt++;
        const wait = waitMs(attempt, retryAfterMs);
        notBefore = Math.max(notBefore, Date.now() + wait);
        pump();
        return wait;
      }
      // A call that was already running when the limit hit must not clear it.
      if (kind === 'ok' && Date.now() >= notBefore) attempt = 0;
      pump();
      return 0;
    },
  };
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError');
}
