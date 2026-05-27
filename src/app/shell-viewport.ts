/**
 * Central helpers for full-screen shell layout on mobile browsers.
 * Uses Visual Viewport when available so --vh tracks keyboard open/close (iOS Safari, Chrome, etc.).
 */

/** 1% of usable layout height in px (for CSS variable --vh). */
let maxObservedViewportHeightPx = 0;

export function computeShellVhUnitPx(
  win: Window,
  translateOverlayHeightPx: number,
): number {
  const vv = win.visualViewport;
  const innerHeightPx = win.innerHeight;
  const vvHeightPx = vv?.height ?? innerHeightPx;

  // Track the "closed keyboard" / largest observed viewport height.
  // iOS can temporarily report conflicting values across innerHeight and visualViewport.height.
  maxObservedViewportHeightPx = Math.max(
    maxObservedViewportHeightPx,
    innerHeightPx,
    vvHeightPx,
  );

  const shrinkThresholdPx = 120; // treat as keyboard / chrome-ui sized change
  const innerShrunk = innerHeightPx < maxObservedViewportHeightPx - shrinkThresholdPx;
  const vvShrunk = vvHeightPx < maxObservedViewportHeightPx - shrinkThresholdPx;

  // If both shrunk, prefer the larger one to avoid "double shrinking" bugs.
  // If only one shrunk, use the shrunk one (it likely reflects the keyboard).
  const chosenHeightPx =
    innerShrunk && vvShrunk
      ? Math.max(innerHeightPx, vvHeightPx)
      : vvShrunk
        ? vvHeightPx
        : innerHeightPx;

  const effective = Math.max(0, chosenHeightPx - translateOverlayHeightPx);
  return effective * 0.01;
}

export function applyShellVhCssVariable(
  doc: Document,
  win: Window,
  translateOverlayHeightPx: number,
): void {
  doc.documentElement.style.setProperty(
    '--vh',
    `${computeShellVhUnitPx(win, translateOverlayHeightPx)}px`,
  );
}

