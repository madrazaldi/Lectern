/** What the reader's chrome needs from a format's view (EPUB, PDF). */

export interface TocEntry {
  label: string;
  /** Opaque to the chrome: handed back to `go`. */
  target: string;
  depth: number;
}

export interface Relocation {
  /** Saved and restored as is: an EPUB CFI, or a PDF page number. */
  location: string;
  /** 0–1. */
  progress: number;
  /** Index into the table of contents of the chapter being read, or -1. */
  chapter: number;
  atStart: boolean;
  atEnd: boolean;
}

export interface ViewProps {
  data: ArrayBuffer;
  /** Where to open (a saved `location`), or the start. */
  start: string | null;
  /** Used to cache per-book data (EPUB locations). */
  cacheId: string;
  ontoc: (toc: TocEntry[]) => void;
  onrelocate: (r: Relocation) => void;
  onerror: (err: unknown) => void;
}

export interface BookView {
  next(): void;
  prev(): void;
  go(target: string): void;
  /** A link in the book at this point of the window, if any. */
  linkAt(x: number, y: number): string | null;
  /** Follow a link from `linkAt`. */
  follow(href: string): void;
}
