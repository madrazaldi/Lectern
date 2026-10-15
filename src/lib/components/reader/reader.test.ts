// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { LibraryItem } from '$lib/api/types';
import { canRead, ebookFormat, hasAudio, otherEbooks, readHref } from './ebook';
import { loadLocations, saveLocations } from './locations';
import { READER_DEFAULTS } from './prefs.svelte';
import { contentCss, PALETTES, resolvePaper } from './theme';

const file = (ino: string, ext: string, isSupplementary: boolean) => ({
  ino,
  fileType: 'ebook',
  isSupplementary,
  ebookFormat: ext,
  metadata: { filename: `b.${ext}`, ext: `.${ext}`, path: '', relPath: '', size: 1 }
});

function book(media: Record<string, unknown>, extra: Partial<LibraryItem> = {}) {
  return { id: 'i1', mediaType: 'book', media: { metadata: { title: 'T' }, duration: 0, ...media }, ...extra } as unknown as LibraryItem;
}

describe('ebook helpers', () => {
  it('tells ebook-only books from audiobooks, minified or expanded', () => {
    expect(hasAudio(book({ numTracks: 0, numAudioFiles: 0, ebookFormat: 'epub' }))).toBe(false);
    expect(hasAudio(book({ tracks: [], audioFiles: [] }))).toBe(false);
    expect(hasAudio(book({ numTracks: 2, duration: 480 }))).toBe(true);
    expect(hasAudio({ mediaType: 'podcast', media: {} } as unknown as LibraryItem)).toBe(true);
  });

  it('reads EPUB and PDF, from the file or the minified format', () => {
    expect(canRead(book({ ebookFormat: 'epub' }))).toBe(true);
    expect(canRead(book({ ebookFile: file('1', 'pdf', false) }))).toBe(true);
    expect(canRead(book({ ebookFormat: 'mobi' }))).toBe(false);
    expect(canRead(book({}))).toBe(false);
    expect(ebookFormat(book({ ebookFormat: 'EPUB' }))).toBe('epub');
  });

  it('lists the other readable ebooks in the folder', () => {
    const item = book({ ebookFile: file('1', 'epub', false) }, {
      libraryFiles: [file('1', 'epub', false), file('2', 'pdf', true), file('3', 'mobi', true), { ...file('4', 'mp3', false), fileType: 'audio' }]
    } as Partial<LibraryItem>);
    expect(otherEbooks(item).map((f) => f.ino)).toEqual(['2']);
    expect(readHref('i1')).toBe('/read/i1');
    expect(readHref('i1', '2')).toBe('/read/i1?file=2');
  });
});

describe('reader theme', () => {
  it('follows the app theme on auto', () => {
    expect(resolvePaper('auto', true)).toBe('light');
    expect(resolvePaper('auto', false)).toBe('dark');
    expect(resolvePaper('sepia', false)).toBe('sepia');
  });

  it('lays the chosen type and colours over the book', () => {
    const css = contentCss({ ...READER_DEFAULTS, fontSize: 130, lineHeight: 1.8, font: 'sans' }, PALETTES.sepia);
    expect(css).toContain('font-size: 130% !important');
    expect(css).toContain('line-height: 1.8 !important');
    expect(css).toContain('Schibsted Grotesk');
    expect(css).toContain(`color: ${PALETTES.sepia.ink} !important`);
    expect(contentCss({ ...READER_DEFAULTS, font: 'book' }, PALETTES.dark)).not.toContain('font-family');
  });
});

describe('locations cache', () => {
  it('keeps only the most recently used books', () => {
    localStorage.clear();
    vi.useFakeTimers();
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      saveLocations(`b${i}`, `locs${i}`);
    }
    vi.useRealTimers();
    expect(loadLocations('b9')).toBe('locs9');
    expect(loadLocations('b0')).toBeNull();
    const kept = Object.keys(localStorage).filter((k) => k.startsWith('lectern.reader.locations.'));
    expect(kept.length).toBe(8);
  });
});
