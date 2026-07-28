import { describe, expect, it } from 'vitest';
import { extractJson } from '../../../shared/news/fact-json';

describe('extractJson', () => {
  it('parses clean json', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips a markdown fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('survives prose AFTER the json', () => {
    // The exact prod failure: "Unexpected non-whitespace character after JSON
    // at position 1044" — a complete object followed by a closing remark.
    const raw = '{"claims":[]}\n\nI hope this helps with your analysis!';
    expect(extractJson(raw)).toEqual({ claims: [] });
  });

  it('survives prose BEFORE the json', () => {
    expect(extractJson('Here are the stances:\n{"stances":[]}')).toEqual({
      stances: [],
    });
  });

  it('survives prose on both sides', () => {
    const raw = 'Sure! {"a":[1,2]} Let me know if you need more.';
    expect(extractJson(raw)).toEqual({ a: [1, 2] });
  });

  it('does not mis-balance on braces inside strings', () => {
    // Claim text quoted from an article can contain braces; counting naively
    // would truncate the object mid-way and lose every claim after it.
    const raw = '{"text":"the set {a, b} was cited","ok":true} trailing';
    expect(extractJson(raw)).toEqual({
      text: 'the set {a, b} was cited',
      ok: true,
    });
  });

  it('handles an escaped quote inside a string', () => {
    const raw = '{"text":"he said \\"yes\\" clearly"} and done';
    expect(extractJson(raw)).toEqual({ text: 'he said "yes" clearly' });
  });

  it('returns null when there is no json at all', () => {
    expect(extractJson('I cannot help with that.')).toBeNull();
    expect(extractJson('')).toBeNull();
  });

  it('returns null for an unterminated object rather than throwing', () => {
    expect(extractJson('{"a":1')).toBeNull();
  });
});
