import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '$lib/api/types';
import { bySequence, discoveryShelves } from './discover';

const book = (id: string, title = id, series?: { id: string; sequence: string | null }) =>
  ({ id, mediaType: 'book', media: { metadata: { title, series: series ? { ...series, name: 'S' } : undefined } } }) as unknown as LibraryItem;
const ids = (items: LibraryItem[]) => items.map((i) => i.id);

describe('discoveryShelves', () => {
  it('shows the whole series, and the author’s other titles minus the series and the current one', () => {
    const series = [book('s1'), book('s2'), book('s3')];
    const author = [book('s2'), book('x'), book('s1'), book('y'), book('s3')];
    const d = discoveryShelves('s2', series, author);
    expect(ids(d.series)).toEqual(['s1', 's2', 's3']);
    expect(ids(d.author)).toEqual(['x', 'y']);
  });

  it('hides a series shelf that would only hold the current title', () => {
    const d = discoveryShelves('s1', [book('s1')], [book('s1'), book('x')]);
    expect(d.series).toEqual([]);
    expect(ids(d.author)).toEqual(['x']);
  });

  it('drops duplicates the author listing repeats, and is empty when nothing else is left', () => {
    expect(ids(discoveryShelves('a', [], [book('b'), book('b'), book('a')]).author)).toEqual(['b']);
    expect(discoveryShelves('a', [book('a'), book('b')], [book('a'), book('b')]).author).toEqual([]);
    expect(discoveryShelves('a', [], [])).toEqual({ series: [], author: [] });
  });
});

describe('bySequence', () => {
  it('orders numerically, decimals included, with unnumbered titles last by title', () => {
    const s = (id: string, sequence: string | null, title = id) => book(id, title, { id: 'S1', sequence });
    const sorted = bySequence([s('ten', '10'), s('z', null, 'Zed'), s('two', '2'), s('half', '2.5'), s('a', null, 'Alpha'), s('one', '1')], 'S1');
    expect(ids(sorted)).toEqual(['one', 'two', 'half', 'ten', 'a', 'z']);
    expect(sorted[0].sequence).toBe('1');
  });

  it('prefers a sequence the listing already set', () => {
    const a = { ...book('a'), sequence: '3' } as LibraryItem;
    const b = book('b', 'b', { id: 'S1', sequence: '1' });
    expect(ids(bySequence([a, b], 'S1'))).toEqual(['b', 'a']);
  });
});
