import type { EbookFile, LibraryFile, LibraryItem } from '$lib/api/types';
import { isBook } from '$lib/api/types';

/** Formats the reader can open. Audiobookshelf also files MOBI, AZW3 and comic archives as ebooks. */
export const READABLE = new Set(['epub', 'pdf']);

export function formatOf(file: Pick<LibraryFile, 'ebookFormat' | 'metadata'>) {
  return (file.ebookFormat || file.metadata.ext.replace(/^\./, '')).toLowerCase();
}

/** The book's primary ebook format (minified listings carry only this, not the file). */
export function ebookFormat(item: LibraryItem): string | null {
  if (!isBook(item)) return null;
  const file = item.media.ebookFile as EbookFile | null | undefined;
  const format = file ? formatOf(file) : item.media.ebookFormat;
  return format ? format.toLowerCase() : null;
}

export function primaryEbook(item: LibraryItem): EbookFile | null {
  return isBook(item) ? ((item.media.ebookFile as EbookFile | null | undefined) ?? null) : null;
}

/** The other ebooks in the title's folder that the reader can open (expanded items only). */
export function otherEbooks(item: LibraryItem): LibraryFile[] {
  return (item.libraryFiles ?? []).filter((f) => f.fileType === 'ebook' && f.isSupplementary && READABLE.has(formatOf(f)));
}

export function canRead(item: LibraryItem) {
  const format = ebookFormat(item);
  return !!format && READABLE.has(format);
}

/** Whether there's anything to listen to. Ebook-only books have no tracks and no duration. */
export function hasAudio(item: LibraryItem) {
  if (!isBook(item)) return true;
  const m = item.media;
  return (m.numTracks ?? m.tracks?.length ?? 0) > 0 || (m.numAudioFiles ?? m.audioFiles?.length ?? 0) > 0 || m.duration > 0;
}

/** The reader's address for a title's primary ebook, or another file by inode. */
export function readHref(itemId: string, fileIno?: string | null) {
  return `/read/${itemId}${fileIno ? `?file=${encodeURIComponent(fileIno)}` : ''}`;
}
