import { describe, expect, it } from 'vitest';
import { columnCount, nearEnd, rowCount, spacers, totalHeight, visibleRange } from './virtual';

describe('grid geometry', () => {
  it('fits as many minimum-width columns as the width allows', () => {
    expect(columnCount(1000, 160, 24)).toBe(5);
    expect(columnCount(100, 160, 24)).toBe(1);
    expect(columnCount(0, 160)).toBe(1);
  });

  it('counts partial rows', () => {
    expect(rowCount(0, 5)).toBe(0);
    expect(rowCount(5, 5)).toBe(1);
    expect(rowCount(6, 5)).toBe(2);
  });

  it('has no trailing gap in the total height', () => {
    expect(totalHeight(3, 100, 10)).toBe(320);
    expect(totalHeight(0, 100, 10)).toBe(0);
  });
});

describe('visibleRange', () => {
  const base = { viewport: 500, offset: 200, rowHeight: 100, rowGap: 10, rows: 100 };

  it('renders the rows in view at the top', () => {
    expect(visibleRange({ ...base, scrollTop: 0 })).toEqual({ start: 0, end: 3 });
  });

  it('renders the rows in view mid-list, plus overscan', () => {
    const r = visibleRange({ ...base, scrollTop: 2200 });
    expect(r).toEqual({ start: 18, end: 23 });
    const o = visibleRange({ ...base, scrollTop: 2200, overscan: 220 });
    expect(o.start).toBeLessThan(r.start);
    expect(o.end).toBeGreaterThan(r.end);
  });

  it('keeps one row alive when scrolled past a list that shrank', () => {
    expect(visibleRange({ ...base, rows: 3, scrollTop: 50_000 })).toEqual({ start: 2, end: 3 });
  });

  it('is empty with no rows', () => {
    expect(visibleRange({ ...base, rows: 0, scrollTop: 0 })).toEqual({ start: 0, end: 0 });
  });

  it('spacers plus rendered rows always add up to the full height', () => {
    for (const scrollTop of [0, 777, 5000, 10_800]) {
      const { start, end } = visibleRange({ ...base, scrollTop, overscan: 300 });
      const { before, after } = spacers(start, end, base.rows, base.rowHeight, base.rowGap);
      const rendered = totalHeight(end - start, base.rowHeight, base.rowGap);
      expect(before + rendered + after).toBe(totalHeight(base.rows, base.rowHeight, base.rowGap));
    }
  });
});

describe('nearEnd', () => {
  it('fires when the list end is within the threshold', () => {
    expect(nearEnd(0, 500, 0, 2000, 1000)).toBe(false);
    expect(nearEnd(600, 500, 0, 2000, 1000)).toBe(true);
  });
});
