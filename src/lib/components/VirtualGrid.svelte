<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { untrack } from 'svelte';
  import { columnCount, nearEnd, rowCount, spacers, totalHeight, visibleRange } from '$lib/util/virtual';

  interface Props {
    items: T[];
    key: (item: T) => string;
    /** Columns are as many equal tracks of at least this width as fit. A huge value gives a single column (list view). */
    minColumnWidth: number;
    columnGap?: number;
    rowGap?: number;
    /** Row height to assume until a rendered row has been measured. */
    estimateRowHeight?: number;
    /** Fires whenever the end of the loaded items is within about two viewports of the viewport's bottom edge. */
    onnearend?: () => void;
    item: Snippet<[T, number]>;
  }
  let { items, key, minColumnWidth, columnGap = 0, rowGap = 0, estimateRowHeight = 280, onnearend, item: cell }: Props = $props();

  let root = $state<HTMLDivElement>();
  let grid = $state<HTMLDivElement>();
  let width = $state(0);
  let viewport = $state(0);
  let scrollTop = $state(0);
  let offset = $state(0);
  let measured = $state(0);

  const rowHeight = $derived(measured || estimateRowHeight);
  const cols = $derived(columnCount(width, minColumnWidth, columnGap));
  const rows = $derived(rowCount(items.length, cols));
  const overscan = $derived(Math.max(320, viewport * 0.6));
  const range = $derived(visibleRange({ scrollTop, viewport, offset, rowHeight, rowGap, rows, overscan }));
  const start = $derived(range.start);
  const end = $derived(range.end);
  const pad = $derived(spacers(start, end, rows, rowHeight, rowGap));
  const first = $derived(start * cols);
  const visible = $derived(items.slice(first, end * cols));
  const near = $derived(viewport > 0 && nearEnd(scrollTop, viewport, offset, totalHeight(rows, rowHeight, rowGap), viewport * 2));

  // Rows are only uniform if every row is as tall as the tallest card seen at this width.
  let seen = 0;
  let seenKey = '';

  function scrollParent(el: HTMLElement): HTMLElement {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return p;
    }
    return document.documentElement;
  }

  let scroller: HTMLElement | null = null;
  let raf = 0;

  // Re-read the list's position and size relative to its scroll container.
  function sync() {
    raf = 0;
    if (!root || !scroller) return;
    const isDoc = scroller === document.documentElement;
    const st = isDoc ? window.scrollY : scroller.scrollTop;
    scrollTop = st;
    offset = root.getBoundingClientRect().top - (isDoc ? 0 : scroller.getBoundingClientRect().top) + st;
    viewport = isDoc ? window.innerHeight : scroller.clientHeight;
    width = root.clientWidth;
  }
  const queue = () => (raf ||= requestAnimationFrame(sync));

  $effect(() => {
    if (!root) return;
    const sc = (scroller = scrollParent(root));
    const isDoc = sc === document.documentElement;
    const target: HTMLElement | Window = isDoc ? window : sc;
    sync();
    target.addEventListener('scroll', queue, { passive: true });
    const ro = new ResizeObserver(queue);
    ro.observe(root);
    if (isDoc) window.addEventListener('resize', queue);
    else ro.observe(sc);
    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      target.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
      ro.disconnect();
    };
  });

  function measure() {
    if (!grid || !grid.children.length) return;
    const k = `${cols}:${Math.round(width)}`;
    if (k !== seenKey) {
      seenKey = k;
      seen = 0;
    }
    for (const c of grid.children) seen = Math.max(seen, Math.ceil(c.getBoundingClientRect().height));
    if (seen > 0 && seen !== measured) measured = seen;
  }

  // Track the natural height of every rendered cell (fonts loading, resizes) and re-measure after each render.
  let cellRO: ResizeObserver | undefined;
  $effect(() => {
    cellRO = new ResizeObserver(measure);
    return () => cellRO?.disconnect();
  });
  $effect(() => {
    void [visible, cols, width];
    untrack(() => {
      measure();
      if (!grid || !cellRO) return;
      cellRO.disconnect();
      for (const c of grid.children) cellRO.observe(c);
    });
  });

  // The list can move without any scrolling (content above it changed), so re-read its position when items change.
  $effect(() => {
    void items.length;
    untrack(sync);
  });

  $effect(() => {
    void items.length;
    if (near) untrack(() => onnearend?.());
  });
</script>

<div class="vg" bind:this={root} style:padding-top="{pad.before}px" style:padding-bottom="{pad.after}px">
  <div class="grid" bind:this={grid} style:--cols={cols} style:--row-h="{rowHeight}px" style:column-gap="{columnGap}px" style:row-gap="{rowGap}px">
    {#each visible as it, i (key(it))}
      {@render cell(it, first + i)}
    {/each}
  </div>
</div>

<style>
  .vg {
    /* The spacers change as rows come and go; don't let the browser "correct" for that. */
    overflow-anchor: none;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-auto-rows: var(--row-h);
    /* Natural heights, so the tallest can be measured; the track forces uniform rows. */
    align-items: start;
  }
</style>
