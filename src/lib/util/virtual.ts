// Pure maths for the windowed grid. Everything is in CSS pixels; rows are uniform height.

/** How many equal columns of at least `minColumnWidth` fit in `width`, always at least one. */
export function columnCount(width: number, minColumnWidth: number, columnGap = 0) {
  if (!(width > 0) || !(minColumnWidth > 0)) return 1;
  return Math.max(1, Math.floor((width + columnGap) / (minColumnWidth + columnGap)));
}

export function rowCount(itemCount: number, columns: number) {
  return itemCount <= 0 ? 0 : Math.ceil(itemCount / Math.max(1, columns));
}

/** Distance from one row's top edge to the next. */
export function rowPitch(rowHeight: number, rowGap = 0) {
  return rowHeight + rowGap;
}

/** Height of `rows` rows including the gaps between them (none trailing). */
export function totalHeight(rows: number, rowHeight: number, rowGap = 0) {
  return rows <= 0 ? 0 : rows * rowHeight + (rows - 1) * rowGap;
}

export interface RangeInput {
  /** Scroll position of the scroll container. */
  scrollTop: number;
  /** Visible height of the scroll container. */
  viewport: number;
  /** Distance from the top of the scroll container's content to the top of the list. */
  offset: number;
  rowHeight: number;
  rowGap?: number;
  rows: number;
  /** Extra pixels to render above and below the viewport. */
  overscan?: number;
}

/** Half-open range [start, end) of rows to render. Empty when there are no rows. */
export function visibleRange({ scrollTop, viewport, offset, rowHeight, rowGap = 0, rows, overscan = 0 }: RangeInput) {
  if (rows <= 0 || !(rowHeight > 0)) return { start: 0, end: 0 };
  const pitch = rowPitch(rowHeight, rowGap);
  const top = scrollTop - offset - overscan;
  const bottom = scrollTop - offset + viewport + overscan;
  // A row i spans [i * pitch, i * pitch + rowHeight].
  let start = Math.floor((top - rowHeight) / pitch) + 1;
  let end = Math.ceil(bottom / pitch);
  // Scrolled past a list that has since shrunk: keep the last row alive so there's something to land on.
  start = Math.min(Math.max(0, start), rows - 1);
  end = Math.min(rows, Math.max(end, start + 1));
  return { start, end };
}

/** Pixels the rows above / below the window occupy, to stand in for them as padding. */
export function spacers(start: number, end: number, rows: number, rowHeight: number, rowGap = 0) {
  if (rows <= 0) return { before: 0, after: 0 };
  const pitch = rowPitch(rowHeight, rowGap);
  return { before: start * pitch, after: (rows - end) * pitch };
}

/** Is the end of the list within `threshold` pixels below the bottom of the viewport? */
export function nearEnd(scrollTop: number, viewport: number, offset: number, listHeight: number, threshold: number) {
  return offset + listHeight - (scrollTop + viewport) < threshold;
}
