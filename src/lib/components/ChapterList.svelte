<script lang="ts">
  import type { Chapter } from '$lib/api/types';
  import { clock } from '$lib/util/format';
  import { scrollBehavior } from '$lib/util/motion';
  import { findChapter } from '$lib/util/playback';

  /**
   * A book's chapters as a list to jump around in. `panel` (Now Playing) shows each chapter's length and
   * a progress line under the current one, and keeps it in view; `plain` (the title page) shows start times.
   */
  interface Props {
    chapters: Chapter[];
    time: number;
    onseek: (time: number) => void;
    variant?: 'panel' | 'plain';
    /** Keep the current chapter scrolled into view as playback moves on. */
    follow?: boolean;
    label?: string;
  }
  let { chapters, time, onseek, variant = 'plain', follow = false, label = 'Chapters' }: Props = $props();

  let list = $state<HTMLOListElement>();
  // On the title page nothing is "current" until listening has started.
  const current = $derived(variant === 'panel' || time > 0 ? findChapter(chapters, time) : -1);

  $effect(() => {
    if (!follow || !list || current < 0) return;
    const li = list.children[current] as HTMLElement | undefined;
    if (!li) return;
    // Scroll only the list, never the page around it.
    const top = li.offsetTop;
    if (top < list.scrollTop || top + li.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: top - list.clientHeight / 3, behavior: scrollBehavior() });
    }
  });
</script>

<ol class="list {variant}" bind:this={list} aria-label={label}>
  {#each chapters as c, i (c.id ?? i)}
    {@const on = i === current}
    <li>
      <button class="row" class:on class:done={i < current} aria-current={on ? 'true' : undefined} onclick={() => onseek(c.start)}>
        <span class="idx num">{i + 1}</span>
        <span class="name">{c.title}</span>
        <span class="meta num">{variant === 'panel' ? clock(c.end - c.start) : clock(c.start)}</span>
        {#if on && variant === 'panel'}
          <span class="bar" style:width="{((time - c.start) / Math.max(1, c.end - c.start)) * 100}%"></span>
        {/if}
      </button>
    </li>
  {/each}
</ol>

<style>
  .list {
    position: relative;
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
  }
  .panel {
    padding: 8px;
    flex: 1;
    min-height: 0;
  }
  .plain {
    max-height: 520px;
    border-top: 1px solid var(--rule-soft);
  }
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 30px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    font-size: var(--t-sm);
    text-align: left;
    overflow: hidden;
  }
  .panel .row {
    grid-template-columns: 34px 1fr auto;
    padding: 9px 10px;
    border-radius: var(--r-sm);
  }
  .plain .row {
    padding: 8px 6px;
    border-bottom: 1px solid var(--rule-soft);
  }
  .row:hover {
    background: color-mix(in srgb, var(--text) 5%, transparent);
  }
  .row.done {
    color: var(--text-3);
  }
  .panel .row.on {
    background: var(--accent-soft);
    color: var(--text);
  }
  .plain .row.on {
    color: var(--accent);
  }
  .row.on .name {
    font-weight: 650;
  }
  .row.on .idx {
    color: var(--accent);
  }
  .idx,
  .meta {
    color: var(--text-3);
    font-size: var(--t-xs);
    display: inline-flex;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: var(--accent);
  }
</style>
