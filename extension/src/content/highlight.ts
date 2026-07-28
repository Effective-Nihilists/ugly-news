/**
 * Painting with the CSS Custom Highlight API — no nodes are inserted into the
 * page, so there is no layout shift and nothing for the site's own framework to
 * trip over on its next render.
 *
 * Two constraints this imposes, designed around rather than fought:
 *
 *  - `::highlight()` only honours color, background-color, text-decoration*,
 *    text-shadow and -webkit-text-stroke. No border, box-shadow or padding —
 *    hence tint + underline as the entire visual vocabulary.
 *  - Highlights are NOT hit-testable, so clicks resolve through
 *    caretPositionFromPoint against the stored ranges.
 */
export type Band = 'pending' | 'green' | 'yellow' | 'red' | 'grey';

const BANDS: Band[] = ['pending', 'green', 'yellow', 'red', 'grey'];
const STYLE_ID = 'ugly-fact-highlight-style';

// `pending` and `grey` MUST look different. They were near-identical greys, so
// "still checking" and "checked, nobody covered it" were indistinguishable —
// and when the verdict call failed outright, a whole page of pending claims
// read as a confident "unverified". Pending is now a faint DOTTED underline
// with no fill; grey is a solid one.
const STYLE_TEXT = `
::highlight(ugly-fact-pending){text-decoration:underline dotted 2px rgb(150,150,160);text-underline-offset:3px}
::highlight(ugly-fact-green){background-color:rgba(47,158,68,.16);text-decoration:underline 2px rgb(47,158,68);text-underline-offset:3px}
::highlight(ugly-fact-yellow){background-color:rgba(214,150,20,.22);text-decoration:underline 2px rgb(214,150,20);text-underline-offset:3px}
::highlight(ugly-fact-red){background-color:rgba(224,49,49,.15);text-decoration:underline 2px rgb(224,49,49);text-underline-offset:3px}
::highlight(ugly-fact-grey){background-color:rgba(140,146,158,.15);text-decoration:underline 2px rgb(154,160,172);text-underline-offset:3px}
`;

const painted = new Map<string, { range: Range; band: Band }>();

export function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = STYLE_TEXT;
  document.head.append(el);
}

function repaint(): void {
  for (const band of BANDS) {
    const name = `ugly-fact-${band}`;
    const ranges = [...painted.values()]
      .filter((v) => v.band === band)
      .map((v) => v.range);
    if (ranges.length === 0) {
      CSS.highlights.delete(name);
      continue;
    }
    CSS.highlights.set(name, new Highlight(...ranges));
  }
}

export function paintClaims(
  entries: { id: string; range: Range; band: Band }[],
): void {
  ensureStyle();
  painted.clear();
  for (const e of entries) painted.set(e.id, { range: e.range, band: e.band });
  repaint();
}

export function setBand(id: string, band: Band): void {
  const entry = painted.get(id);
  if (entry === undefined) return;
  entry.band = band;
  repaint();
}

export function clearClaims(): void {
  painted.clear();
  for (const band of BANDS) CSS.highlights.delete(`ugly-fact-${band}`);
}

/** Highlights are not hit-testable; resolve a click through the caret position. */
export function claimAtPoint(x: number, y: number): string | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      cx: number,
      cy: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (cx: number, cy: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos === null) return null;
    node = pos.offsetNode;
    offset = pos.offset;
    // caretRangeFromPoint is deprecated in favour of caretPositionFromPoint,
    // but it is the ONLY option on WebKit and on Chrome before 128 — this
    // branch only runs where the modern API is absent, so the deprecation is
    // the point rather than an oversight.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const r = doc.caretRangeFromPoint(x, y);
    if (r === null) return null;
    node = r.startContainer;
    offset = r.startOffset;
  }
  if (node === null) return null;

  for (const [id, { range }] of painted) {
    try {
      if (range.comparePoint(node, offset) === 0) return id;
    } catch {
      // comparePoint throws when the node is in a different tree — not a match.
      continue;
    }
  }
  return null;
}
