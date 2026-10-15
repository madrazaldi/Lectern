// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FONT_SIZE, LINE_HEIGHT, parseReaderPrefs, READER_DEFAULTS, READER_PREFS_KEY, stepped } from './prefs.svelte';

describe('reader preferences', () => {
  it('fills in defaults for anything missing or unreadable', () => {
    expect(parseReaderPrefs(null)).toEqual(READER_DEFAULTS);
    expect(parseReaderPrefs('not json')).toEqual(READER_DEFAULTS);
    expect(parseReaderPrefs('[1,2]')).toEqual(READER_DEFAULTS);
    expect(parseReaderPrefs('{"font":"comic","theme":"neon","fontSize":"big"}')).toEqual(READER_DEFAULTS);
  });

  it('keeps valid choices and snaps sizes onto the controls’ steps and range', () => {
    expect(parseReaderPrefs('{"font":"sans","theme":"sepia","fontSize":130,"lineHeight":1.8}')).toEqual({
      font: 'sans',
      theme: 'sepia',
      fontSize: 130,
      lineHeight: 1.8
    });
    expect(parseReaderPrefs('{"fontSize":999,"lineHeight":0.5}')).toMatchObject({ fontSize: FONT_SIZE.max, lineHeight: LINE_HEIGHT.min });
    expect(stepped(104, FONT_SIZE)).toBe(100);
    expect(stepped(1.6 + 0.1, LINE_HEIGHT)).toBe(1.7);
  });
});

describe('reader preference persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('loads saved preferences and saves changes as they are made', async () => {
    localStorage.setItem(READER_PREFS_KEY, JSON.stringify({ fontSize: 120, theme: 'dark' }));
    const { readerPrefs } = await import('./prefs.svelte');
    expect(readerPrefs).toMatchObject({ fontSize: 120, theme: 'dark', font: 'serif' });
    readerPrefs.font = 'sans';
    readerPrefs.lineHeight = 2;
    // `flushSync` resolves to Svelte's server build under vitest: let the effect run on a tick instead.
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(localStorage.getItem(READER_PREFS_KEY)!)).toEqual({ fontSize: 120, lineHeight: 2, font: 'sans', theme: 'dark' });
  });
});
