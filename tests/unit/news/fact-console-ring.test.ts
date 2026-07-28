import { describe, expect, it } from 'vitest';
import {
  ConsoleRing,
  formatArgs,
  RING_CAPACITY,
} from '../../../extension/src/shared/console-ring';

describe('formatArgs', () => {
  it('joins primitives the way console does', () => {
    expect(formatArgs(['claims', 4, true])).toBe('claims 4 true');
  });

  it('renders null and undefined distinguishably', () => {
    expect(formatArgs([null, undefined])).toBe('null undefined');
  });

  it('keeps an Error message AND its stack', () => {
    const e = new Error('anchor failed');
    const out = formatArgs([e]);
    expect(out).toContain('Error: anchor failed');
    expect(out).toContain('console-ring.test');
  });

  it('serialises plain objects rather than printing [object Object]', () => {
    expect(formatArgs([{ painted: 0, returned: 9 }])).toBe(
      '{"painted":0,"returned":9}',
    );
  });

  it('survives a circular object instead of throwing', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a['self'] = a;
    // A throw here would take out the console patch itself, which would be a
    // far worse failure than a lossy log line.
    expect(() => formatArgs([a])).not.toThrow();
    expect(formatArgs([a])).toContain('a');
  });

  it('truncates a huge argument so one log line cannot dominate the report', () => {
    const out = formatArgs(['x'.repeat(50_000)]);
    expect(out.length).toBeLessThan(3000);
    expect(out).toContain('truncated');
  });
});

describe('ConsoleRing', () => {
  it('records entries with level and message', () => {
    const ring = new ConsoleRing();
    ring.push('log', ['hello', 1], 100);
    expect(ring.snapshot()).toEqual([
      { timestamp: 100, level: 'log', message: 'hello 1' },
    ]);
  });

  it('keeps only the most recent entries once full', () => {
    const ring = new ConsoleRing();
    for (let i = 0; i < RING_CAPACITY + 50; i++) ring.push('log', [i], i);
    const snap = ring.snapshot();
    expect(snap).toHaveLength(RING_CAPACITY);
    // The OLDEST are dropped — a report is most useful about what just happened.
    expect(snap[0]?.message).toBe('50');
    expect(snap.at(-1)?.message).toBe(String(RING_CAPACITY + 49));
  });

  it('returns a copy so callers cannot mutate the buffer', () => {
    const ring = new ConsoleRing();
    ring.push('warn', ['a'], 1);
    ring.snapshot().pop();
    expect(ring.snapshot()).toHaveLength(1);
  });

  it('can be limited to the last n entries for shipping', () => {
    const ring = new ConsoleRing();
    for (let i = 0; i < 20; i++) ring.push('log', [i], i);
    const tail = ring.snapshot(5);
    expect(tail).toHaveLength(5);
    expect(tail[0]?.message).toBe('15');
  });
});
