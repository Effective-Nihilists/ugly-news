import type { PageSignals } from '../../../shared/news/fact-gate';

function metaContent(doc: Document, selector: string): string | null {
  const el = doc.querySelector(selector);
  if (el === null) return null;
  const v = el.getAttribute('content');
  return v === null || v.trim() === '' ? null : v.trim();
}

function collectTypes(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectTypes(child, out);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const rec = node as Record<string, unknown>;
  const t = rec['@type'];
  if (typeof t === 'string') out.push(t);
  else if (Array.isArray(t)) {
    for (const item of t) if (typeof item === 'string') out.push(item);
  }
  // @graph and nested entities both carry types worth seeing.
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage']) {
    if (key in rec) collectTypes(rec[key], out);
  }
}

/** Every `@type` in every JSON-LD block, flattened. Malformed blocks are skipped. */
function schemaTypes(doc: Document): string[] {
  const out: string[] = [];
  const blocks = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const block of Array.from(blocks)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.textContent ?? '');
    } catch {
      continue; // a broken block must not take the whole probe down
    }
    collectTypes(parsed, out);
  }
  return out;
}

function hasByline(doc: Document): boolean {
  if (
    doc.querySelector(
      '[rel="author"], [itemprop="author"], .byline, .author',
    ) !== null
  ) {
    return true;
  }
  return metaContent(doc, 'meta[name="author"]') !== null;
}

function publishedTime(doc: Document): string | null {
  return (
    metaContent(doc, 'meta[property="article:published_time"]') ??
    metaContent(doc, 'meta[itemprop="datePublished"]') ??
    metaContent(doc, 'meta[name="date"]') ??
    doc.querySelector('time[datetime]')?.getAttribute('datetime') ??
    null
  );
}

/** Words in the body, minus chrome we know is not prose. */
function wordCount(doc: Document): number {
  const root = doc.querySelector('article') ?? doc.body;
  if (root === null) return 0;
  const clone = root.cloneNode(true) as HTMLElement;
  for (const el of Array.from(
    clone.querySelectorAll(
      'script, style, nav, header, footer, aside, noscript',
    ),
  )) {
    el.remove();
  }
  const text = clone.textContent ?? '';
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export function readPageSignals(doc: Document): PageSignals {
  return {
    ogType: metaContent(doc, 'meta[property="og:type"]'),
    schemaTypes: schemaTypes(doc),
    hasByline: hasByline(doc),
    publishedTime: publishedTime(doc),
    wordCount: wordCount(doc),
  };
}
