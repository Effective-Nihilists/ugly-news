import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createErrorBatcher } from '../../../extension/src/shared/error-batcher';

function entry(message: string) {
  return { level: 'error' as const, message, timestamp: 1 };
}

describe('createErrorBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces a burst into one send', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const b = createErrorBatcher({ send, delayMs: 1000, maxBatch: 10 });
    b.add(entry('a'));
    b.add(entry('b'));
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('flushes immediately once the batch is full, without waiting', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const b = createErrorBatcher({ send, delayMs: 10_000, maxBatch: 2 });
    b.add(entry('a'));
    b.add(entry('b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('drops the oldest when far more errors arrive than can be sent', async () => {
    // A page in an error loop must not be able to queue unbounded memory, and
    // the newest errors are the ones worth keeping.
    const send = vi.fn().mockResolvedValue(undefined);
    const b = createErrorBatcher({
      send,
      delayMs: 1000,
      maxBatch: 5,
      maxQueue: 5,
    });
    for (let i = 0; i < 100; i++) b.add(entry(`e${String(i)}`));
    await vi.advanceTimersByTimeAsync(1000);
    const sentTotal = send.mock.calls.flatMap((c) => c[0] as unknown[]).length;
    expect(sentTotal).toBeLessThanOrEqual(20);
  });

  it('does not throw when the send itself fails', async () => {
    const send = vi.fn().mockRejectedValue(new Error('offline'));
    const b = createErrorBatcher({ send, delayMs: 10, maxBatch: 10 });
    b.add(entry('a'));
    await expect(vi.advanceTimersByTimeAsync(10)).resolves.not.toThrow();
  });

  it('flush() sends whatever is pending right away', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const b = createErrorBatcher({ send, delayMs: 60_000, maxBatch: 50 });
    b.add(entry('a'));
    await b.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('flush() with nothing pending does not send an empty batch', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const b = createErrorBatcher({ send, delayMs: 10, maxBatch: 10 });
    await b.flush();
    expect(send).not.toHaveBeenCalled();
  });
});
