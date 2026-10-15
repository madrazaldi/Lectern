/** The "More in <Series>" and "More by <Author>" shelves on a book's page. */
import type { BookMetadata, LibraryItem, SeriesRef } from '$lib/api/types';
import { isBook } from '$lib/api/types';

export function seriesRefs(meta: Pick<BookMetadata, 'series'>): SeriesRef[] {
  const s = meta.series;
  return !s ? [] : Array.isArray(s) ? s : [s];
}

/** A title's position in a series ("2", "2.5"), from wherever the listing put it. */
export function sequenceIn(item: LibraryItem, seriesId: string) {
  if (item.sequence) return item.sequence;
  if (!isBook(item)) return undefined;
  return seriesRefs(item.media.metadata).find((r) => r.id === seriesId)?.sequence ?? undefined;
}

const collator = new Intl.Collator(undefined, { numeric: true });

/** Series order: by sequence ("2" before "10"), unnumbered titles last, by title. */
export function bySequence(items: readonly LibraryItem[], seriesId: string): LibraryItem[] {
  return items
    .map((it) => ({ ...it, sequence: sequenceIn(it, seriesId) }))
    .sort((a, b) => {
      if (a.sequence && b.sequence) return collator.compare(a.sequence, b.sequence);
      if (a.sequence || b.sequence) return a.sequence ? -1 : 1;
      return collator.compare(a.media.metadata.title, b.media.metadata.title);
    });
}

export interface Discovery {
  /** The whole series in order, this title included (it's marked on the page); empty when there's nothing else in it. */
  series: LibraryItem[];
  /** The author's other titles, minus this one and anything already on the series shelf. */
  author: LibraryItem[];
}

export function discoveryShelves(currentId: string, seriesBooks: readonly LibraryItem[], authorBooks: readonly LibraryItem[]): Discovery {
  const series = seriesBooks.some((b) => b.id !== currentId) ? [...seriesBooks] : [];
  const shown = new Set([currentId, ...series.map((b) => b.id)]);
  const author: LibraryItem[] = [];
  for (const b of authorBooks) {
    if (shown.has(b.id)) continue;
    shown.add(b.id);
    author.push(b);
  }
  return { series, author };
}
