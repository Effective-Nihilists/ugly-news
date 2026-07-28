/**
 * Tolerant JSON extraction for model output.
 *
 * The AI proxy accepts a schema but does NOT enforce it for the models we use,
 * so a reply routinely arrives as a fenced block, or as a valid object followed
 * by a sentence of commentary. A strict `JSON.parse` throws on both — observed
 * in prod as "Unexpected non-whitespace character after JSON at position 1044",
 * which killed a whole page's claims over a trailing pleasantry.
 */

function stripFences(s: string): string {
  const t = s.trim();
  if (!t.startsWith('```')) return t;
  return t
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/**
 * The first balanced `{...}` in the text, ignoring braces inside strings.
 *
 * Counting braces naively breaks on any object whose values contain them —
 * and claim text quoted from an article frequently does.
 */
function firstBalancedObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse model output into an object, or null if there is none to be had. */
export function extractJson(raw: string): unknown {
  const cleaned = stripFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through: almost always leading or trailing prose.
  }
  const candidate = firstBalancedObject(cleaned);
  if (candidate === null) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
