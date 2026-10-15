/** How books look in the reader. One set for the whole app, like the app's own preferences. */

/** `auto` follows the app's light or dark theme. */
export type ReaderTheme = 'auto' | 'light' | 'dark' | 'sepia';
/** `book` keeps the publisher's typefaces. */
export type ReaderFont = 'serif' | 'sans' | 'book';

export interface ReaderPrefs {
  /** Percent of the book's own size. */
  fontSize: number;
  lineHeight: number;
  font: ReaderFont;
  theme: ReaderTheme;
}

export const FONT_SIZE = { min: 70, max: 200, step: 10 };
export const LINE_HEIGHT = { min: 1.2, max: 2.2, step: 0.1 };

export const READER_DEFAULTS: ReaderPrefs = { fontSize: 100, lineHeight: 1.6, font: 'serif', theme: 'auto' };

const THEMES: ReaderTheme[] = ['auto', 'light', 'dark', 'sepia'];
const FONTS: ReaderFont[] = ['serif', 'sans', 'book'];

export const READER_PREFS_KEY = 'lectern.reader';

/** Snap to the control's steps and keep within its range. */
export function stepped(value: number, range: { min: number; max: number; step: number }) {
  const snapped = Math.round((value - range.min) / range.step) * range.step + range.min;
  return Math.round(Math.min(range.max, Math.max(range.min, snapped)) * 100) / 100;
}

/** Saved preferences, with anything missing, unknown or out of range replaced by the default. */
export function parseReaderPrefs(raw: string | null): ReaderPrefs {
  let saved: Partial<Record<keyof ReaderPrefs, unknown>> = {};
  try {
    const parsed = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object') saved = parsed;
  } catch {
    // Unreadable: start over.
  }
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    fontSize: stepped(num(saved.fontSize, READER_DEFAULTS.fontSize), FONT_SIZE),
    lineHeight: stepped(num(saved.lineHeight, READER_DEFAULTS.lineHeight), LINE_HEIGHT),
    font: FONTS.includes(saved.font as ReaderFont) ? (saved.font as ReaderFont) : READER_DEFAULTS.font,
    theme: THEMES.includes(saved.theme as ReaderTheme) ? (saved.theme as ReaderTheme) : READER_DEFAULTS.theme
  };
}

export const readerPrefs = $state<ReaderPrefs>(parseReaderPrefs(localStorage.getItem(READER_PREFS_KEY)));

$effect.root(() => {
  $effect(() => {
    try {
      localStorage.setItem(READER_PREFS_KEY, JSON.stringify(readerPrefs));
    } catch {
      // Quota: the preferences last until the app closes.
    }
  });
});
