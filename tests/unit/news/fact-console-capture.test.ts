import { describe, expect, it, vi } from 'vitest';
import { ConsoleRing } from '../../../extension/src/shared/console-ring';
import { installConsoleCapture } from '../../../extension/src/shared/console-capture';

function fakeConsole(): Console & { calls: string[] } {
  const calls: string[] = [];
  const mk =
    (level: string) =>
    (...args: unknown[]) => {
      calls.push(`${level}:${args.map(String).join(' ')}`);
    };
  return {
    calls,
    log: mk('log'),
    info: mk('info'),
    warn: mk('warn'),
    error: mk('error'),
    debug: mk('debug'),
  } as unknown as Console & { calls: string[] };
}

describe('installConsoleCapture', () => {
  it('still calls through to the original console', () => {
    const c = fakeConsole();
    installConsoleCapture({
      target: c,
      ring: new ConsoleRing(),
      onError: () => undefined,
    });
    c.log('hello');
    // Swallowing the developer's own logging would be an unacceptable price.
    expect(c.calls).toEqual(['log:hello']);
  });

  it('records every level into the ring', () => {
    const c = fakeConsole();
    const ring = new ConsoleRing();
    installConsoleCapture({ target: c, ring, onError: () => undefined });
    c.log('a');
    c.warn('b');
    c.error('c');
    expect(ring.snapshot().map((e) => e.level)).toEqual([
      'log',
      'warn',
      'error',
    ]);
  });

  it('forwards ONLY console.error to the error sink', () => {
    const c = fakeConsole();
    const onError = vi.fn();
    installConsoleCapture({ target: c, ring: new ConsoleRing(), onError });
    c.log('quiet');
    c.warn('also quiet');
    c.error('loud', 42);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      level: 'error',
      message: 'loud 42',
    });
  });

  it('attaches a stack when an Error is logged', () => {
    const c = fakeConsole();
    const onError = vi.fn();
    installConsoleCapture({ target: c, ring: new ConsoleRing(), onError });
    c.error(new Error('boom'));
    expect(onError.mock.calls[0]?.[0].stack).toContain('boom');
  });

  it('does NOT recurse when the error sink itself logs an error', () => {
    const c = fakeConsole();
    let depth = 0;
    let max = 0;
    installConsoleCapture({
      target: c,
      ring: new ConsoleRing(),
      onError: () => {
        depth++;
        max = Math.max(max, depth);
        // A sink that fails and logs about it is the ordinary case — an
        // unguarded patch turns it into an infinite loop that hangs the page.
        c.error('sink failed');
        depth--;
      },
    });
    c.error('original');
    expect(max).toBe(1);
  });

  it('can be uninstalled, restoring the originals', () => {
    const c = fakeConsole();
    const original = c.error;
    const uninstall = installConsoleCapture({
      target: c,
      ring: new ConsoleRing(),
      onError: () => undefined,
    });
    expect(c.error).not.toBe(original);
    uninstall();
    expect(c.error).toBe(original);
  });
});
