import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModelGate } from './gate';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const never = new AbortController().signal;

describe('createModelGate', () => {
  it('runs two calls at once, and a third when a slot frees', async () => {
    const gate = createModelGate(2, () => 0);
    const started: number[] = [];
    const run = (n: number) => void gate.acquire(0, never).then(() => started.push(n));

    run(1);
    run(2);
    run(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([1, 2]);

    gate.release('ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([1, 2, 3]);
  });

  it('starts a subtitle ahead of page calls that are still waiting', async () => {
    const gate = createModelGate(1, () => 0);
    const started: string[] = [];
    const acquire = (name: string, priority: number) => void gate.acquire(priority, never).then(() => started.push(name));

    acquire('page-1', 0);
    await vi.advanceTimersByTimeAsync(0);
    acquire('page-2', 0);
    acquire('subtitle', 1);
    gate.release('ok');
    await vi.advanceTimersByTimeAsync(0);

    expect(started).toEqual(['page-1', 'subtitle']);
  });

  it('holds everything after a rate limit, for the wait it was given', async () => {
    const gate = createModelGate(1, (_attempt, retryAfterMs) => retryAfterMs ?? 2_000);
    const started: number[] = [];
    void gate.acquire(0, never).then(() => started.push(1));
    await vi.advanceTimersByTimeAsync(0);

    expect(gate.release('rate', 4_000)).toBe(4_000);
    void gate.acquire(0, never).then(() => started.push(2));
    await vi.advanceTimersByTimeAsync(3_999);
    expect(started).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual([1, 2]);
  });

  it('drops a call that is cancelled while it waits', async () => {
    const gate = createModelGate(1, () => 0);
    const started: number[] = [];
    const abort = new AbortController();
    void gate.acquire(0, never).then(() => started.push(1));
    const waiting = gate.acquire(0, abort.signal).then(
      () => started.push(2),
      () => started.push(-2),
    );
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    await waiting;

    gate.release('ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([1, -2]);
  });
});
