/**
 * A flat string of the article's visible text, plus the ability to turn an
 * offset pair back into a DOM Range.
 *
 * This is what lets anchoring stay pure: shared/news/fact-anchor.ts works in
 * offsets, and this is the only place that knows about nodes.
 */
export interface TextMap {
  text: string;
  toRange(start: number, end: number): Range | null;
}

const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'NAV',
  'HEADER',
  'FOOTER',
  'ASIDE',
]);

export function buildTextMap(root: HTMLElement): TextMap {
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = '';

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent === null) return NodeFilter.FILTER_REJECT;
      if (SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue === null || node.nodeValue.trim() === ''
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const t = n as Text;
    const value = t.nodeValue ?? '';
    nodes.push({
      node: t,
      start: text.length,
      end: text.length + value.length,
    });
    text += value;
  }

  return {
    text,
    toRange(start, end) {
      const from = nodes.find((n) => start >= n.start && start < n.end);
      const to = nodes.find((n) => end > n.start && end <= n.end);
      if (from === undefined || to === undefined) return null;
      const range = document.createRange();
      range.setStart(from.node, start - from.start);
      range.setEnd(to.node, end - to.start);
      return range;
    },
  };
}
