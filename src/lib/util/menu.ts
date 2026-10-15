/** Keyboard behaviour of a menu (role="menu"), kept free of the DOM so it can be tested. */

export interface MenuNavItem {
  label: string;
  disabled?: boolean;
}

export type MenuKeyResult = { type: 'move'; index: number } | { type: 'activate'; index: number } | { type: 'close' } | null;

function step(items: MenuNavItem[], from: number, dir: 1 | -1) {
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (!items[i].disabled) return i;
  }
  return -1;
}

/** First enabled item, or -1. */
export function firstEnabled(items: MenuNavItem[]) {
  return items.length ? step(items, -1, 1) : -1;
}

/** What a key does in a menu whose focused item is `index`. */
export function menuKey(key: string, index: number, items: MenuNavItem[]): MenuKeyResult {
  if (key === 'Escape' || key === 'Tab') return { type: 'close' };
  if (!items.length) return null;
  switch (key) {
    case 'ArrowDown':
      return { type: 'move', index: step(items, index, 1) };
    case 'ArrowUp':
      return { type: 'move', index: step(items, index < 0 ? items.length : index, -1) };
    case 'Home':
      return { type: 'move', index: step(items, -1, 1) };
    case 'End':
      return { type: 'move', index: step(items, items.length, -1) };
    case 'Enter':
    case ' ':
      return index >= 0 && !items[index].disabled ? { type: 'activate', index } : null;
  }
  // Type-ahead: jump to the next item starting with that letter.
  if (key.length === 1 && /\S/.test(key)) {
    const ch = key.toLocaleLowerCase();
    const n = items.length;
    for (let k = 1; k <= n; k++) {
      const i = (index + k) % n;
      if (!items[i].disabled && items[i].label.trim().toLocaleLowerCase().startsWith(ch)) return { type: 'move', index: i };
    }
  }
  return null;
}

/** Shift+F10 or the context-menu key: the keyboard ways to ask for a context menu. */
export function opensContextMenu(e: { key: string; shiftKey: boolean }) {
  return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
}

/** Keep a menu of `size` inside the viewport when opened at (x, y). */
export function placeMenu(x: number, y: number, size: { width: number; height: number }, viewport: { width: number; height: number }, margin = 8) {
  let left = x;
  let top = y;
  if (left + size.width > viewport.width - margin) left = Math.max(margin, x - size.width);
  if (top + size.height > viewport.height - margin) top = Math.max(margin, viewport.height - margin - size.height);
  return { left, top };
}
