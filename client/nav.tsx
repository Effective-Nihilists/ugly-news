import type React from 'react';

/**
 * Intercept a left-click for client-side (SPA) navigation.
 *
 * Keep the real `href` on the `<a>` for accessibility, SEO and
 * open-in-new-tab — this only hijacks a plain left-click and routes it
 * through the router's `push`, avoiding the full-document reload (white
 * flash + repaint) that a bare anchor triggers. Modifier-clicks
 * (cmd/ctrl/shift/alt) fall through to the browser's default behavior.
 */
export function navClick(go: () => void): (e: React.MouseEvent) => void {
  return (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go();
  };
}
