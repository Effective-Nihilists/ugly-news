import React from 'react';

/**
 * Tiny inline-SVG icon set (lucide path data, no lucide-react dependency).
 *
 * Use these instead of unicode/emoji glyphs (▶, ❙❙, …) so the play affordance
 * renders identically on every platform and matches across pages. Size is a
 * number (px) but any `style` width/height (e.g. a `clamp(...)`) overrides it.
 */

interface IconProps {
  size?: number;
  style?: React.CSSProperties;
  className?: string;
}

/** Solid play triangle (lucide "play", filled). */
export function PlayIcon({
  size = 24,
  style,
  className,
}: IconProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

/** Two bars (lucide "pause", filled). */
export function PauseIcon({
  size = 24,
  style,
  className,
}: IconProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}
