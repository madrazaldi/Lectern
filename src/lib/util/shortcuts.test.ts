import { describe, expect, it } from 'vitest';
import {
  available,
  claimKeys,
  describeShortcuts,
  formatCombo,
  isMacPlatform,
  matchShortcut,
  navAllowed,
  shortcutKeys,
  SHORTCUTS,
  type KeyLike
} from './shortcuts';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
const books = { books: true, desktop: true };
const id = (k: KeyLike, ctx: Parameters<typeof matchShortcut>[1] = books) => matchShortcut(k, ctx)?.id ?? null;

describe('shortcut registry', () => {
  it('has unique ids', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  });

  it('tells skipping from chapter jumps by Shift', () => {
    expect(id(key('ArrowLeft'))).toBe('skip-back');
    expect(id(key('ArrowLeft', { shiftKey: true }))).toBe('prev-chapter');
    expect(id(key('ArrowRight', { shiftKey: true }))).toBe('next-chapter');
  });

  it('matches letters in either case and ignores Shift on typed characters', () => {
    expect(id(key('b'))).toBe('add-bookmark');
    expect(id(key('B', { shiftKey: true }))).toBe('add-bookmark');
    expect(id(key('M'))).toBe('mute');
    expect(id(key('?', { shiftKey: true }))).toBe('help');
    expect(id(key('>', { shiftKey: true }))).toBe('speed-up');
    expect(id(key('+', { shiftKey: true }))).toBe('volume-up');
  });

  it('changes speed with ↑/↓ only while Now Playing is open', () => {
    expect(id(key('ArrowUp'))).toBeNull();
    expect(id(key('ArrowUp'), { ...books, expanded: true })).toBe('speed-up');
    expect(id(key('ArrowDown'), { ...books, expanded: true })).toBe('speed-down');
  });

  it('needs the modifier exactly when the combo does', () => {
    expect(id(key('k'))).toBeNull();
    expect(id(key('k', { metaKey: true }))).toBe('search');
    expect(id(key('k', { ctrlKey: true }))).toBe('search');
    expect(id(key('b', { metaKey: true }))).toBeNull();
    expect(id(key('b', { altKey: true }))).toBeNull();
  });

  it('leaves combos the macOS menu provides to the menu', () => {
    expect(id(key('1', { metaKey: true }))).toBe('nav-home');
    expect(id(key('1', { metaKey: true }), { ...books, nativeMenu: true })).toBeNull();
    // ⌘K isn't in the menu, so the page still handles it.
    expect(id(key('k', { metaKey: true }), { ...books, nativeMenu: true })).toBe('search');
  });

  it('switches to the mini player with ⌘⇧M, leaving M alone for mute', () => {
    expect(id(key('M', { metaKey: true, shiftKey: true }))).toBe('mini-player');
    expect(id(key('M', { ctrlKey: true, shiftKey: true }))).toBe('mini-player');
    expect(id(key('m'))).toBe('mute');
    // The View menu has it on a Mac.
    expect(id(key('M', { metaKey: true, shiftKey: true }), { ...books, nativeMenu: true })).toBeNull();
  });

  it('has no Series, Authors or Collections in a podcast library', () => {
    const pods = { books: false, desktop: true };
    expect(id(key('3', { metaKey: true }), pods)).toBeNull();
    expect(id(key('5', { metaKey: true }), pods)).toBeNull();
    expect(id(key('2', { metaKey: true }), pods)).toBe('nav-library');
    expect(navAllowed('/series', pods)).toBe(false);
    expect(navAllowed('/library', pods)).toBe(true);
    expect(navAllowed('/item/abc', pods)).toBe(true);
    expect(available(pods).some((s) => s.id === 'nav-authors')).toBe(false);
  });

  it('has no Downloads outside the desktop app', () => {
    expect(id(key('6', { metaKey: true }), { books: true, desktop: false })).toBeNull();
  });
});

describe('shortcut labels', () => {
  it('uses ⌘ on a Mac and Ctrl elsewhere', () => {
    const c = { key: 'f', mod: true, shift: true };
    expect(formatCombo(c, true)).toBe('⌘⇧F');
    expect(formatCombo(c, false)).toBe('Ctrl+Shift+F');
    expect(formatCombo({ key: 'ArrowLeft', shift: true }, false)).toBe('Shift+←');
    expect(formatCombo({ key: ' ' }, true)).toBe('Space');
  });

  it("labels one shortcut's keys for a tooltip", () => {
    expect(shortcutKeys('mini-player', true)).toBe('⌘⇧M');
    expect(shortcutKeys('mini-player', false)).toBe('Ctrl+Shift+M');
    expect(shortcutKeys('nope', true)).toBe('');
  });

  it('detects the platform', () => {
    expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isMacPlatform({ userAgentData: { platform: 'Windows' }, platform: '' })).toBe(false);
    expect(isMacPlatform({ platform: 'Linux x86_64' })).toBe(false);
  });

  it('groups the list and marks Now Playing-only keys', () => {
    const groups = describeShortcuts({ books: true, desktop: false, mac: false });
    expect(groups.map((g) => g.group)).toEqual(['Playback', 'Navigation', 'General']);
    const faster = groups[0].rows.find((r) => r.id === 'speed-up')!;
    expect(faster.keys).toEqual(['>', '↑ in Now Playing']);
    expect(groups[1].rows.find((r) => r.id === 'search')!.keys).toContain('Ctrl+K');
    expect(groups[1].rows.some((r) => r.id === 'nav-downloads')).toBe(false);
  });
});

describe('claimed keys', () => {
  it('stand down while a page claims them, and come back on release', () => {
    const release = claimKeys([' ', 'ArrowLeft', 'ArrowRight']);
    expect(id(key(' '))).toBeNull();
    expect(id(key('ArrowLeft'))).toBeNull();
    expect(id(key('ArrowRight', { shiftKey: true }))).toBeNull();
    // Other keys and ⌘ combos are unaffected.
    expect(id(key('m'))).toBe('mute');
    expect(id(key('k', { metaKey: true }))).toBe('search');
    release();
    expect(id(key(' '))).toBe('play-pause');
    expect(id(key('ArrowLeft'))).toBe('skip-back');
  });

  it('are the player’s again while Now Playing covers the claiming page', () => {
    const release = claimKeys([' ', 'ArrowLeft', 'ArrowRight']);
    const expanded = { ...books, expanded: true };
    expect(id(key(' '), expanded)).toBe('play-pause');
    expect(id(key('ArrowLeft'), expanded)).toBe('skip-back');
    expect(id(key(' '))).toBeNull();
    release();
  });

  it('keeps a key claimed until every claim on it is released', () => {
    const a = claimKeys(['ArrowLeft']);
    const b = claimKeys(['ArrowLeft']);
    a();
    expect(id(key('ArrowLeft'))).toBeNull();
    b();
    b();
    expect(id(key('ArrowLeft'))).toBe('skip-back');
  });
});
