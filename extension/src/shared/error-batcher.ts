export interface ErrorEntry {
  level: 'error';
  message: string;
  stack?: string;
  url?: string;
  timestamp: number;
  source?: string;
}

export interface BatcherOptions {
  send: (entries: ErrorEntry[]) => Promise<void>;
  delayMs: number;
  maxBatch: number;
  /** Hard ceiling on what a page in an error loop can hold in memory. */
  maxQueue?: number;
}

export interface ErrorBatcher {
  add: (e: ErrorEntry) => void;
  flush: () => Promise<void>;
}

/**
 * Coalesces console.error into batched posts.
 *
 * The endpoint is rate-limited (60/60s) and a page stuck in an error loop can
 * emit thousands, so this both debounces and caps. Failures are swallowed —
 * telemetry that throws would be worse than telemetry that misses.
 */
export function createErrorBatcher(opts: BatcherOptions): ErrorBatcher {
  const maxQueue = opts.maxQueue ?? 200;
  let queue: ErrorEntry[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Guards the immediate-fire path. Without it, a synchronous burst of errors
  // drains the queue once per add — a page in an error loop would emit a POST
  // every few milliseconds and blow the endpoint's 60/60s rate limit.
  let sending = false;

  const schedule = (): void => {
    timer ??= setTimeout(() => {
      timer = null;
      void fire();
    }, opts.delayMs);
  };

  const fire = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (queue.length === 0) return;
    const batch = queue.slice(0, opts.maxBatch);
    queue = queue.slice(opts.maxBatch);
    sending = true;
    try {
      await opts.send(batch);
    } catch {
      // Deliberately silent: console.error here would re-enter the capture.
    } finally {
      sending = false;
      if (queue.length > 0) schedule();
    }
  };

  return {
    add(e) {
      queue.push(e);
      // Newest errors are the useful ones, so overflow drops from the front.
      if (queue.length > maxQueue) queue = queue.slice(queue.length - maxQueue);
      if (queue.length >= opts.maxBatch && !sending) {
        void fire();
        return;
      }
      schedule();
    },
    flush: fire,
  };
}
