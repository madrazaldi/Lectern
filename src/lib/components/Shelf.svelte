<script lang="ts">
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import { scrollBehavior } from '$lib/util/motion';

  interface Props {
    title: string;
    href?: string;
    /** Card width in px; the row scrolls horizontally. */
    itemWidth?: number;
    children: Snippet;
  }
  let { title, href, itemWidth = 168, children }: Props = $props();

  let row: HTMLDivElement;
  let atStart = $state(true);
  let atEnd = $state(false);

  function update() {
    if (!row) return;
    atStart = row.scrollLeft < 4;
    atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 4;
  }

  function page(dir: number) {
    row.scrollBy({ left: dir * row.clientWidth * 0.85, behavior: scrollBehavior() });
  }

  $effect(() => {
    update();
    const ro = new ResizeObserver(update);
    ro.observe(row);
    return () => ro.disconnect();
  });
</script>

<section class="shelf" style:--w="{itemWidth}px">
  <header>
    <h2>
      {#if href}<a {href}>{title}</a>{:else}{title}{/if}
    </h2>
    <div class="nav">
      <button class="icon-btn" onclick={() => page(-1)} disabled={atStart} aria-label="Scroll {title} back"><ChevronLeft size={18} /></button>
      <button class="icon-btn" onclick={() => page(1)} disabled={atEnd} aria-label="Scroll {title} forward"><ChevronRight size={18} /></button>
    </div>
  </header>
  <div class="row" bind:this={row} onscroll={update}>
    {@render children()}
  </div>
</section>

<style>
  .shelf {
    margin-top: 36px;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  h2 {
    font-family: var(--font-serif);
    font-size: var(--t-xl);
    font-weight: 600;
    letter-spacing: -0.01em;
    font-variation-settings: 'opsz' 36;
  }
  h2 a:hover {
    color: var(--accent);
  }
  .nav {
    display: flex;
    gap: 2px;
  }
  .row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: var(--w);
    gap: 22px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 10px 40px 14px;
    margin: -10px -40px 0;
    scroll-snap-type: x proximity;
    scroll-padding: 0 40px;
    scrollbar-width: none;
  }
  .row::-webkit-scrollbar {
    display: none;
  }
  .row > :global(*) {
    scroll-snap-align: start;
  }
</style>
