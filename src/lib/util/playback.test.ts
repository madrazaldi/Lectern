import { describe, expect, it } from 'vitest';
import type { Chapter, LibraryItem, PodcastEpisode } from '$lib/api/types';
import { findChapter, findTrack, nextEpisode, nextInSeries, sessionDate } from './playback';

const chapters: Chapter[] = [
  { id: 0, start: 0, end: 100, title: 'One' },
  { id: 1, start: 100, end: 250, title: 'Two' },
  { id: 2, start: 250, end: 400, title: 'Three' }
];

describe('findChapter', () => {
  it('finds the chapter containing a time', () => {
    expect(findChapter(chapters, 0)).toBe(0);
    expect(findChapter(chapters, 99.9)).toBe(0);
    expect(findChapter(chapters, 100)).toBe(1);
    expect(findChapter(chapters, 399)).toBe(2);
  });

  it('clamps times outside the book', () => {
    expect(findChapter(chapters, -5)).toBe(0);
    expect(findChapter(chapters, 1000)).toBe(2);
  });

  it('handles gaps between chapters by picking the next one', () => {
    const gappy = [chapters[0], { ...chapters[1], start: 120 }];
    expect(findChapter(gappy, 110)).toBe(1);
  });

  it('returns 0 for no chapters', () => {
    expect(findChapter([], 50)).toBe(0);
  });
});

describe('findTrack', () => {
  const tracks = [
    { startOffset: 0, duration: 60 },
    { startOffset: 60, duration: 60 },
    { startOffset: 120, duration: 30 }
  ];

  it('maps a book position to its file', () => {
    expect(findTrack(tracks, 0)).toBe(0);
    expect(findTrack(tracks, 59.99)).toBe(0);
    expect(findTrack(tracks, 60)).toBe(1);
    expect(findTrack(tracks, 149)).toBe(2);
  });

  it('clamps to the first and last file', () => {
    expect(findTrack(tracks, -1)).toBe(0);
    expect(findTrack(tracks, 150)).toBe(2);
    expect(findTrack(tracks, 10_000)).toBe(2);
  });
});

function book(id: string, sequence?: string, extra: Partial<LibraryItem> = {}) {
  return { id, sequence, isMissing: false, ...extra } as LibraryItem & { sequence?: string };
}

describe('nextInSeries', () => {
  const series = [book('c', '3'), book('a', '1'), book('b', '2'), book('b5', '2.5'), book('x')];

  it('orders by numeric sequence, not server order', () => {
    expect(nextInSeries(series, 'a', () => false)?.id).toBe('b');
    expect(nextInSeries(series, 'b', () => false)?.id).toBe('b5');
  });

  it('skips ebook-only books, which have nothing to play', () => {
    const ebookOnly = { ...book('b', '2'), mediaType: 'book', media: { duration: 0, numTracks: 0, numAudioFiles: 0 } } as unknown as LibraryItem;
    expect(nextInSeries([book('a', '1'), ebookOnly, book('c', '3')], 'a', () => false)?.id).toBe('c');
  });

  it('skips finished and missing books', () => {
    const missing = [...series.filter((b) => b.id !== 'b5'), book('b5', '2.5', { isMissing: true })];
    expect(nextInSeries(missing, 'b', (id) => id === 'c')?.id).toBe('x');
  });

  it('puts unnumbered books last and stops at the end', () => {
    expect(nextInSeries(series, 'c', () => false)?.id).toBe('x');
    expect(nextInSeries(series, 'x', () => false)).toBeNull();
  });

  it('returns null when the current book is not in the list', () => {
    expect(nextInSeries(series, 'zzz', () => false)).toBeNull();
  });
});

describe('nextEpisode', () => {
  const ep = (id: string, publishedAt: number) => ({ id, publishedAt }) as PodcastEpisode;
  const episodes = [ep('new', 300), ep('old', 100), ep('mid', 200)];

  it('moves forward in publication order, skipping finished episodes', () => {
    expect(nextEpisode(episodes, 'old', () => false)?.id).toBe('mid');
    expect(nextEpisode(episodes, 'old', (id) => id === 'mid')?.id).toBe('new');
    expect(nextEpisode(episodes, 'new', () => false)).toBeNull();
  });
});

describe('sessionDate', () => {
  it('formats local dates the way the server files sessions', () => {
    const ms = new Date(2026, 0, 5, 23, 30).valueOf();
    expect(sessionDate(ms)).toEqual({ date: '2026-01-05', dayOfWeek: 'Monday' });
  });
});
