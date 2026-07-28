import { ConsoleRing, formatArgs, type LogLevel } from './console-ring';

/**
 * Patch a console so everything it sees is remembered, and errors are shipped.
 *
 * Scope note: a content script runs in an ISOLATED world, so this captures the
 * extension's own logging, not the host page's. That is the intent — the page's
 * console is the site's noise, and reading it would mean injecting into the
 * main world, which is a real privilege increase for no diagnostic gain.
 */

export interface CapturedError {
  level: 'error';
  message: string;
  stack?: string;
  timestamp: number;
}

export interface CaptureOptions {
  target: Console;
  ring: ConsoleRing;
  onError: (e: CapturedError) => void;
  now?: () => number;
}

const LEVELS: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

export function installConsoleCapture(opts: CaptureOptions): () => void {
  const { target, ring, onError } = opts;
  const now = opts.now ?? (() => Date.now());
  const originals = new Map<LogLevel, (...args: unknown[]) => void>();

  // The sink almost always logs when it fails — without this, that log
  // re-enters the patch and spins forever, hanging whatever page we are on.
  let inSink = false;

  for (const level of LEVELS) {
    const original = target[level] as (...args: unknown[]) => void;
    originals.set(level, original);
    const patched = (...args: unknown[]): void => {
      original.apply(target, args);
      if (inSink) return;
      const at = now();
      ring.push(level, args, at);
      if (level !== 'error') return;
      const err = args.find((a): a is Error => a instanceof Error);
      inSink = true;
      try {
        onError({
          level: 'error',
          message: formatArgs(args),
          ...(err?.stack === undefined ? {} : { stack: err.stack }),
          timestamp: at,
        });
      } finally {
        inSink = false;
      }
    };
    (target as unknown as Record<string, unknown>)[level] = patched;
  }

  return () => {
    for (const [level, original] of originals) {
      (target as unknown as Record<string, unknown>)[level] = original;
    }
  };
}
