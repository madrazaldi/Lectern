<script lang="ts">
  import type { Chapter } from '$lib/api/types';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { findChapter } from '$lib/util/playback';
  import { clock } from '$lib/util/format';

  /**
   * The scrubber. Each chapter is a book spine on a shelf, as wide as the chapter is long;
   * finished chapters are gilt, the current one is pulled slightly forward and fills as you listen.
   */
  interface Props {
    chapters: Chapter[];
    time: number;
    duration: number;
    onseek: (time: number) => void;
    size?: 'dock' | 'full';
    bookmarks?: { time: number; title: string }[];
    disabled?: boolean;
  }
  let { chapters, time, duration, onseek, size = 'dock', bookmarks = [], disabled = false }: Props = $props();

  let shelf: HTMLDivElement;
  let rects = $state<{ left: number; width: number }[]>([]);
  let shelfWidth = $state(0);
  let hoverX = $state<number | null>(null);
  let dragTime = $state<number | null>(null);
  /** Set briefly after a keyboard seek, so the announced position is exact while someone is seeking. */
  let seeking = $state(false);
  let seekTimer: ReturnType<typeof setTimeout> | undefined;

  const shown = $derived(dragTime ?? time);
  const current = $derived(findChapter(chapters, shown));
  const gap = $derived(chapters.length > 120 ? 1 : chapters.length > 50 ? 2 : size === 'full' ? 3 : 2);

  // Deterministic "books of different heights" — a gentle rhythm, never random per render.
  function heightFor(i: number) {
    const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
    return 0.66 + (x - Math.floor(x)) * 0.34;
  }

  function measure() {
    if (!shelf) return;
    const base = shelf.getBoundingClientRect();
    shelfWidth = base.width;
    rects = Array.from(shelf.querySelectorAll<HTMLElement>('.spine')).map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - base.left, width: r.width };
    });
  }

  $effect(() => {
    void chapters;
    void gap;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(shelf);
    return () => ro.disconnect();
  });

  function timeAtX(x: number) {
    if (!rects.length || !chapters.length) return 0;
    if (x <= rects[0].left) return chapters[0].start;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const nextLeft = rects[i + 1]?.left ?? Infinity;
      if (x < nextLeft) {
        const frac = Math.min(1, Math.max(0, (x - r.left) / r.width));
        const c = chapters[i];
        return c.start + frac * (c.end - c.start);
      }
    }
    return duration;
  }

  function xAtTime(t: number) {
    if (!rects.length || !chapters.length) return 0;
    const i = findChapter(chapters, t);
    const c = chapters[i];
    const r = rects[i];
    if (!r) return 0;
    const frac = c.end > c.start ? (t - c.start) / (c.end - c.start) : 0;
    return r.left + Math.min(1, Math.max(0, frac)) * r.width;
  }

  function localX(e: PointerEvent) {
    return e.clientX - shelf.getBoundingClientRect().left;
  }

  function onPointerDown(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    shelf.setPointerCapture(e.pointerId);
    measure();
    dragTime = timeAtX(localX(e));
  }

  function onPointerMove(e: PointerEvent) {
    hoverX = localX(e);
    if (dragTime !== null) dragTime = timeAtX(hoverX);
  }

  function onPointerUp(e: PointerEvent) {
    if (dragTime === null) return;
    shelf.releasePointerCapture(e.pointerId);
    onseek(dragTime);
    dragTime = null;
  }

  function onKey(e: KeyboardEvent) {
    if (disabled) return;
    // The same steps as the skip buttons; Shift for a minute at a time.
    let t: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') t = time + (e.shiftKey ? 60 : prefs.skipForward);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') t = time - (e.shiftKey ? 60 : prefs.skipBack);
    else if (e.key === 'PageDown') t = chapters[current + 1]?.start ?? null;
    else if (e.key === 'PageUp') t = chapters[Math.max(0, current - 1)]?.start ?? null;
    else if (e.key === 'Home') t = 0;
    else if (e.key === 'End') t = duration - 1;
    if (t !== null) {
      e.preventDefault();
      e.stopPropagation();
      seeking = true;
      clearTimeout(seekTimer);
      seekTimer = setTimeout(() => (seeking = false), 2000);
      onseek(Math.max(0, Math.min(duration, t)));
    }
  }

  $effect(() => () => clearTimeout(seekTimer));

  // Playback moves the position every quarter second; screen readers re-announce a focused slider's value on
  // every change. Only expose whole minutes unless the listener is seeking with the keyboard.
  const spoken = $derived(seeking ? time : Math.floor(time / 60) * 60);
  const spokenChapter = $derived(chapters[findChapter(chapters, spoken)]);

  const hoverTime = $derived(hoverX !== null ? timeAtX(hoverX) : null);
  const hoverChapter = $derived(hoverTime !== null ? chapters[findChapter(chapters, hoverTime)] : null);
  const tipX = $derived(dragTime !== null ? xAtTime(dragTime) : (hoverX ?? 0));
</script>

<div
  class="shelf {size}"
  class:disabled
  class:dragging={dragTime !== null}
  bind:this={shelf}
  style:--gap="{gap}px"
  role="slider"
  tabindex={disabled ? -1 : 0}
  aria-label="Position"
  aria-valuemin={0}
  aria-valuemax={Math.round(duration)}
  aria-valuenow={Math.round(spoken)}
  aria-valuetext="{clock(spoken)} of {clock(duration)}{spokenChapter && chapters.length > 1 ? `, ${spokenChapter.title}` : ''}"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={() => (dragTime = null)}
  onpointerleave={() => (hoverX = null)}
  onkeydown={onKey}
>
  {#each chapters as c, i (c.id ?? i)}
    {@const len = Math.max(c.end - c.start, 0.001)}
    {@const fill = i < current ? 1 : i > current ? 0 : Math.min(1, Math.max(0, (shown - c.start) / len))}
    <div
      class="spine"
      class:read={i < current}
      class:now={i === current}
      style:flex-grow={len}
      style:height="{(chapters.length === 1 ? 1 : heightFor(i)) * 100}%"
      style:--fill="{fill * 100}%"
    ></div>
  {/each}

  {#each bookmarks as b (b.time)}
    {#if rects.length}
      <span class="mark" style:left="{xAtTime(b.time)}px" title={b.title}></span>
    {/if}
  {/each}

  {#if (hoverTime !== null || dragTime !== null) && !disabled}
    {@const t = dragTime ?? hoverTime ?? 0}
    {@const ch = dragTime !== null ? chapters[findChapter(chapters, dragTime)] : hoverChapter}
    <div class="tip" style:left="{Math.min(Math.max(tipX, 60), shelfWidth - 60)}px">
      {#if ch && chapters.length > 1}<span class="tip-ch">{ch.title}</span>{/if}
      <span class="num">{clock(t)}</span>
    </div>
  {/if}
</div>

<style>
  .shelf {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: var(--gap);
    width: 100%;
    cursor: pointer;
    touch-action: none;
    border-radius: 2px;
  }
  .shelf::after {
    /* the shelf board */
    content: '';
    position: absolute;
    left: -4px;
    right: -4px;
    bottom: -3px;
    height: 1px;
    background: var(--rule);
  }
  .dock {
    height: 16px;
  }
  .full {
    height: 64px;
  }
  .disabled {
    cursor: default;
  }

  .spine {
    position: relative;
    flex-basis: 0;
    min-width: 1px;
    border-radius: 1.5px 1.5px 0 0;
    background: linear-gradient(90deg, var(--accent) var(--fill), var(--spine-empty) var(--fill));
    transition:
      transform 220ms var(--ease),
      filter 160ms;
  }
  .full .spine {
    border-radius: 3px 3px 1px 1px;
  }
  .spine.read {
    background: var(--accent);
    filter: saturate(0.75) brightness(0.86);
  }
  .spine.now {
    transform: translateY(-3px);
  }
  .full .spine.now {
    transform: translateY(-7px);
  }
  .shelf:not(.disabled):hover .spine {
    filter: none;
  }

  .mark {
    position: absolute;
    top: -9px;
    width: 2px;
    height: 6px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--text);
    pointer-events: none;
  }
  .full .mark {
    top: -14px;
    height: 8px;
  }

  .tip {
    position: absolute;
    bottom: calc(100% + 12px);
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 5px 10px;
    border-radius: var(--r-sm);
    background: var(--raised-2);
    border: 1px solid var(--rule);
    box-shadow: 0 8px 20px -6px rgb(0 0 0 / 0.5);
    font-size: var(--t-xs);
    white-space: nowrap;
    pointer-events: none;
    z-index: 5;
  }
  .tip-ch {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-2);
  }
</style>
