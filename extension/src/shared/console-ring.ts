/**
 * A bounded console history, carried on every feedback report and error.
 *
 * "It didn't flag the claims" is unanswerable without knowing what the
 * extension did — which tier stopped, what the endpoint said, how many claims
 * failed to anchor. This is that record.
 *
 * Pure and DOM-free so it unit-tests in node; the patching lives in
 * console-capture.
 */

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
}

/** Enough to cover a page's whole lifecycle without bloating a report. */
export const RING_CAPACITY = 200;

/** One argument cannot be allowed to crowd out the rest of the history. */
const MAX_ARG_CHARS = 2000;

function truncate(s: string): string {
  if (s.length <= MAX_ARG_CHARS) return s;
  return `${s.slice(0, MAX_ARG_CHARS)}… (truncated, ${String(s.length)} chars)`;
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return truncate(arg);
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (arg instanceof Error) {
    return truncate(`${arg.name}: ${arg.message}\n${arg.stack ?? ''}`);
  }
  if (typeof arg === 'object') {
    // A circular structure must not throw — that would take out the console
    // patch itself, which is a far worse failure than a lossy line.
    const seen = new WeakSet();
    try {
      return truncate(
        JSON.stringify(arg, (_k, v: unknown) => {
          if (typeof v === 'object' && v !== null) {
            if (seen.has(v)) return '[circular]';
            seen.add(v);
          }
          return v;
        }) ?? '[unserialisable]',
      );
    } catch {
      return '[unserialisable]';
    }
  }
  if (typeof arg === 'symbol') return arg.toString();
  if (typeof arg === 'function') return `[function ${arg.name}]`;
  if (
    typeof arg === 'number' ||
    typeof arg === 'boolean' ||
    typeof arg === 'bigint'
  ) {
    return truncate(String(arg));
  }
  return '[unknown]';
}

export function formatArgs(args: readonly unknown[]): string {
  return args.map(formatArg).join(' ');
}

export class ConsoleRing {
  private entries: LogEntry[] = [];

  push(level: LogLevel, args: readonly unknown[], timestamp: number): void {
    this.entries.push({ timestamp, level, message: formatArgs(args) });
    if (this.entries.length > RING_CAPACITY) {
      this.entries.splice(0, this.entries.length - RING_CAPACITY);
    }
  }

  /** A copy, optionally just the tail — callers must not mutate the buffer. */
  snapshot(limit?: number): LogEntry[] {
    if (limit === undefined || limit >= this.entries.length) {
      return [...this.entries];
    }
    return this.entries.slice(this.entries.length - limit);
  }
}
