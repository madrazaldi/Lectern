/** The nearest ancestor that scrolls vertically (the app's <main>), or the document. */
export function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return p;
  }
  return document.documentElement;
}

/**
 * Scroll `el` to `top` once its content is tall enough: pages render their content a frame or two after
 * navigation, and setting scrollTop too early clamps it to the top. Retries for a number of frames and
 * gives up as soon as the user scrolls. Returns a cancel function.
 */
export function restoreScroll(el: HTMLElement, top: number, frames = 90) {
  let raf = 0;
  let n = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    for (const t of ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const) el.removeEventListener(t, stop);
  };
  const step = () => {
    el.scrollTop = top;
    if (Math.abs(el.scrollTop - top) <= 1 || ++n >= frames) return stop();
    raf = requestAnimationFrame(step);
  };
  for (const t of ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const) el.addEventListener(t, stop, { passive: true });
  step();
  return stop;
}

/**
 * Attachment: call `onnear` whenever the element (a sentinel at the end of a list) comes within `margin`
 * pixels of the visible part of its scroll container. The container must be the observer's root: <main>
 * scrolls, not the window, so a viewport-rooted rootMargin would never reach past the fold.
 */
export function nearEnd(onnear: () => void, margin = 800) {
  return (el: HTMLElement) => {
    const root = scrollParent(el);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onnear(), {
      root: root === document.documentElement ? null : root,
      rootMargin: `${margin}px 0px`
    });
    io.observe(el);
    return () => io.disconnect();
  };
}

/** The element focused right now, if it's one we can return focus to later. */
export function activeElement(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

/** Focus `el` if it's still in the page; otherwise `fallback`. */
export function returnFocus(el: HTMLElement | null, fallback?: HTMLElement | null) {
  const target = el?.isConnected ? el : fallback?.isConnected ? fallback : null;
  target?.focus({ preventScroll: true });
}
