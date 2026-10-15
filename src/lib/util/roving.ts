/**
 * Roving tabindex for composite widgets (radio groups, tab lists): the group is one Tab stop, and the
 * arrow keys move between its items.
 */

export type Orientation = 'horizontal' | 'vertical' | 'both';

/** Where a key moves focus among `count` items from `index` (wrapping), or null if it isn't a navigation key. */
export function rovingIndex(
  key: string,
  index: number,
  count: number,
  orientation: Orientation = 'horizontal',
  enabled?: (i: number) => boolean
): number | null {
  if (count <= 0) return null;
  const ok = enabled ?? (() => true);
  const step = (from: number, dir: 1 | -1) => {
    for (let n = 1; n <= count; n++) {
      const i = (((from + dir * n) % count) + count) % count;
      if (ok(i)) return i;
    }
    return null;
  };
  const prev = orientation !== 'vertical' ? ['ArrowLeft'] : [];
  const next = orientation !== 'vertical' ? ['ArrowRight'] : [];
  if (orientation !== 'horizontal') {
    prev.push('ArrowUp');
    next.push('ArrowDown');
  }
  if (next.includes(key)) return step(index, 1);
  if (prev.includes(key)) return step(index, -1);
  if (key === 'Home') return step(-1, 1);
  if (key === 'End') return step(count, -1);
  return null;
}

const DEFAULT_ITEMS = '[role="radio"], [role="tab"]';

function isSelected(el: Element) {
  return el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true';
}

function isDisabled(el: Element) {
  return (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true';
}

export interface RovingOptions {
  /** Which descendants take part. Defaults to radios and tabs. */
  items?: string;
  orientation?: Orientation;
  /** Selection follows focus (the ARIA pattern for radios and automatic tabs): the newly focused item is clicked. */
  select?: boolean;
}

/**
 * Attachment for the group element (`{@attach roving()}`). Keeps exactly one item in the Tab order (the selected
 * one, else the first enabled) and handles arrows, Home and End. Items need no tabindex of their own.
 */
export function roving(opts: RovingOptions = {}) {
  const selector = opts.items ?? DEFAULT_ITEMS;
  const select = opts.select ?? true;
  return (group: HTMLElement) => {
    const items = () => Array.from(group.querySelectorAll<HTMLElement>(selector));

    const sync = () => {
      const all = items();
      const active = all.find((el) => isSelected(el) && !isDisabled(el)) ?? all.find((el) => !isDisabled(el));
      for (const el of all) {
        const want = el === active ? '0' : '-1';
        if (el.getAttribute('tabindex') !== want) el.setAttribute('tabindex', want);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const all = items();
      const index = all.indexOf(e.target as HTMLElement);
      if (index < 0) return;
      const to = rovingIndex(e.key, index, all.length, opts.orientation, (i) => !isDisabled(all[i]));
      if (to === null) return;
      e.preventDefault();
      // The app's global ←/→ seek shortcut must not also fire.
      e.stopPropagation();
      const el = all[to];
      el.focus();
      if (select && !isSelected(el)) el.click();
    };

    sync();
    const mo = new MutationObserver(sync);
    mo.observe(group, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-checked', 'aria-selected', 'disabled'] });
    group.addEventListener('keydown', onKey);
    return () => {
      mo.disconnect();
      group.removeEventListener('keydown', onKey);
    };
  };
}
