import React from 'react';

/**
 * An <img> that takes itself out of the layout when its source fails to load.
 *
 * Thumbnails are third-party URLs copied out of RSS items, and publishers move
 * or delete them (thehill.com and cbsnewsstatic.com 404s in the production
 * log). A plain <img> then renders the browser's broken-image glyph inside the
 * card. On error this renders `fallback` instead (nothing by default), and the
 * optional `frame` wrapper (the clipping box a hover zoom needs) goes with it,
 * so no empty bordered box is left behind. Re-arms when `src` changes.
 */
interface SafeImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Rendered in place of the image once it fails to load. */
  fallback?: React.ReactNode;
  /** Styles for a wrapper div (the clipping box a hover zoom needs); it is
   *  dropped together with the image on error. */
  frame?: React.CSSProperties;
}

export function SafeImg({
  fallback = null,
  frame,
  onError,
  ...img
}: SafeImgProps): React.ReactElement {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  if (img.src !== undefined && failedSrc === img.src) return <>{fallback}</>;
  const element = (
    <img
      {...img}
      onError={(event) => {
        setFailedSrc(img.src ?? null);
        onError?.(event);
      }}
    />
  );
  return frame ? <div style={frame}>{element}</div> : element;
}
