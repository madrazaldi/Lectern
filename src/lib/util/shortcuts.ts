/**
 * Every keyboard shortcut in one place: the global handler matches against this list, and Settings and
 * the "?" overlay render it, so the documentation can't drift from the behaviour.
 */

export interface Combo {
  /** `KeyboardEvent.key`. Letters match either case. */
  key: string;
  /** ⌘ on macOS, Ctrl elsewhere. */
  mod?: boolean;
  /** Must Shift be held? Unset means: not held for named keys (arrows), ignored for typed characters. */
  shift?: boolean;
  /** Only while Now Playing is open. */
  expanded?: boolean;
  /** The macOS app menu already provides it, so the page doesn't handle it there (it would fire twice). */
  native?: boolean;
}

export type ShortcutGroup = 'Playback' | 'Navigation' | 'General';

export interface Shortcut {
  id: string;
  label: string;
  group: ShortcutGroup;
  combos: Combo[];
  /** A page to open. */
  href?: string;
  /** Only meaningful in book libraries (Series, Authors, Collections). */
  booksOnly?: boolean;
  /** Only in the desktop app (Downloads). */
  desktopOnly?: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'play-pause', label: 'Play or pause', group: 'Playback', combos: [{ key: ' ' }] },
  { id: 'skip-back', label: 'Skip back', group: 'Playback', combos: [{ key: 'ArrowLeft' }] },
  { id: 'skip-forward', label: 'Skip forward', group: 'Playback', combos: [{ key: 'ArrowRight' }] },
  { id: 'prev-chapter', label: 'Previous chapter', group: 'Playback', combos: [{ key: 'ArrowLeft', shift: true }] },
  { id: 'next-chapter', label: 'Next chapter', group: 'Playback', combos: [{ key: 'ArrowRight', shift: true }] },
  { id: 'speed-down', label: 'Slower', group: 'Playback', combos: [{ key: '<' }, { key: 'ArrowDown', expanded: true }] },
  { id: 'speed-up', label: 'Faster', group: 'Playback', combos: [{ key: '>' }, { key: 'ArrowUp', expanded: true }] },
  { id: 'volume-down', label: 'Volume down', group: 'Playback', combos: [{ key: '-' }] },
  { id: 'volume-up', label: 'Volume up', group: 'Playback', combos: [{ key: '=' }, { key: '+' }] },
  { id: 'mute', label: 'Mute or unmute', group: 'Playback', combos: [{ key: 'm' }] },
  { id: 'add-bookmark', label: 'Add a bookmark', group: 'Playback', combos: [{ key: 'b' }] },
  { id: 'now-playing', label: 'Open or close Now Playing', group: 'Playback', combos: [{ key: 'f' }, { key: 'f', mod: true, shift: true, native: true }] },

  { id: 'search', label: 'Search', group: 'Navigation', combos: [{ key: 'k', mod: true }, { key: '/' }, { key: 'f', mod: true, native: true }] },
  { id: 'nav-home', label: 'Home', group: 'Navigation', href: '/', combos: [{ key: '1', mod: true, native: true }] },
  { id: 'nav-library', label: 'Library', group: 'Navigation', href: '/library', combos: [{ key: '2', mod: true, native: true }] },
  { id: 'nav-series', label: 'Series', group: 'Navigation', href: '/series', booksOnly: true, combos: [{ key: '3', mod: true, native: true }] },
  { id: 'nav-authors', label: 'Authors', group: 'Navigation', href: '/authors', booksOnly: true, combos: [{ key: '4', mod: true, native: true }] },
  { id: 'nav-collections', label: 'Collections', group: 'Navigation', href: '/collections', booksOnly: true, combos: [{ key: '5', mod: true, native: true }] },
  { id: 'nav-downloads', label: 'Downloads', group: 'Navigation', href: '/downloads', desktopOnly: true, combos: [{ key: '6', mod: true, native: true }] },
  { id: 'nav-stats', label: 'Listening', group: 'Navigation', href: '/stats', combos: [{ key: '7', mod: true, native: true }] },
  { id: 'back', label: 'Back', group: 'Navigation', combos: [{ key: '[', mod: true, native: true }] },
  { id: 'forward', label: 'Forward', group: 'Navigation', combos: [{ key: ']', mod: true, native: true }] },
  { id: 'settings', label: 'Settings', group: 'Navigation', href: '/settings', combos: [{ key: ',', mod: true, native: true }] },

  { id: 'mini-player', label: 'Switch to or from the mini player', group: 'General', combos: [{ key: 'm', mod: true, shift: true, native: true }] },
  { id: 'help', label: 'Show keyboard shortcuts', group: 'General', combos: [{ key: '?' }] },
  { id: 'close', label: 'Close Now Playing, a menu or a dialog', group: 'General', combos: [{ key: 'Escape' }] },
  { id: 'context-menu', label: 'Actions for the focused title', group: 'General', combos: [{ key: 'F10', shift: true }] }
];

export interface ShortcutContext {
  /** Book library (as opposed to podcasts). */
  books: boolean;
  /** Running in the desktop app. */
  desktop: boolean;
  /** Now Playing is open. */
  expanded?: boolean;
  /** The native macOS menu handles `native` combos. */
  nativeMenu?: boolean;
}

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Shortcuts that apply in this context (nothing for Series in a podcast library, no Downloads in a browser). */
export function available(ctx: Pick<ShortcutContext, 'books' | 'desktop'>, list = SHORTCUTS) {
  return list.filter((s) => (!s.booksOnly || ctx.books) && (!s.desktopOnly || ctx.desktop));
}

/** Whether a page can be opened in this library: the native Go menu offers Series etc. everywhere. */
export function navAllowed(href: string, ctx: Pick<ShortcutContext, 'books' | 'desktop'>) {
  const s = SHORTCUTS.find((x) => x.href === href);
  return !s || available(ctx, [s]).length > 0;
}

function comboMatches(c: Combo, e: KeyLike, ctx: ShortcutContext) {
  if (c.native && ctx.nativeMenu) return false;
  if (c.expanded && !ctx.expanded) return false;
  if (!!c.mod !== (e.metaKey || e.ctrlKey) || e.altKey) return false;
  const named = c.key.length > 1;
  if (c.shift !== undefined ? c.shift !== e.shiftKey : named && e.shiftKey) return false;
  return named || c.key === ' ' ? e.key === c.key : e.key.toLowerCase() === c.key.toLowerCase();
}

/** The shortcut a key press triggers, if any. */
export function matchShortcut(e: KeyLike, ctx: ShortcutContext, list = SHORTCUTS): Shortcut | null {
  for (const s of available(ctx, list)) if (s.combos.some((c) => comboMatches(c, e, ctx))) return s;
  return null;
}

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc'
};

export function formatCombo(c: Combo, mac: boolean) {
  const key = KEY_NAMES[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key);
  if (mac) return `${c.mod ? '⌘' : ''}${c.shift ? '⇧' : ''}${key}`;
  return [c.mod && 'Ctrl', c.shift && 'Shift', key].filter(Boolean).join('+');
}

/** A shortcut's first key combination as people read it ("⌘⇧M"), for tooltips. */
export function shortcutKeys(id: string, mac = isMacPlatform()) {
  const c = SHORTCUTS.find((s) => s.id === id)?.combos[0];
  return c ? formatCombo(c, mac) : '';
}

/** The ⌘ / Ctrl label for this platform. */
export function modLabel(mac: boolean) {
  return mac ? '⌘' : 'Ctrl+';
}

export function isMacPlatform(nav: { platform?: string; userAgent?: string; userAgentData?: { platform?: string } } | undefined = globalThis.navigator) {
  const p = (nav as { userAgentData?: { platform?: string } })?.userAgentData?.platform || nav?.platform || nav?.userAgent || '';
  return /mac|iphone|ipad/i.test(p);
}

export interface ShortcutRow {
  id: string;
  label: string;
  keys: string[];
}

/** The list as people read it: grouped, platform-specific key names, Now Playing-only keys marked. */
export function describeShortcuts(ctx: Pick<ShortcutContext, 'books' | 'desktop'> & { mac: boolean }) {
  const groups: { group: ShortcutGroup; rows: ShortcutRow[] }[] = [];
  for (const s of available(ctx)) {
    let g = groups.find((x) => x.group === s.group);
    if (!g) groups.push((g = { group: s.group, rows: [] }));
    const keys = [...new Set(s.combos.map((c) => formatCombo(c, ctx.mac) + (c.expanded ? ' in Now Playing' : '')))];
    g.rows.push({ id: s.id, label: s.label, keys });
  }
  return groups;
}
