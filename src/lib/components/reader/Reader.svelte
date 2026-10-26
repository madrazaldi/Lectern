<script lang="ts">
  import { ArrowLeft, ChevronLeft, ChevronRight, TableOfContents, X } from '@lucide/svelte';
  import { openUrl } from '$lib/ipc';
  import { onMount, tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { inApp } from '$lib/native';
  import { player } from '$lib/stores/player.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { contextMenu } from '$lib/util/contextMenu.svelte';
  import { dialogs } from '$lib/util/dialogs.svelte';
  import { claimKeys } from '$lib/util/shortcuts';
  import EpubView from './EpubView.svelte';
  import PdfView from './PdfView.svelte';
  import { readerPrefs } from './prefs.svelte';
  import ReaderSettings from './ReaderSettings.svelte';
  import type { Position } from './sync';
  import { appFontFaces, contentCss, PALETTES, resolvePaper } from './theme';
  import type { BookView, Relocation, TocEntry } from './view';

  interface Props {
    title: string;
    format: 'epub' | 'pdf';
    data: ArrayBuffer;
    /** Saved location to open at. */
    start: string | null;
    cacheId: string;
    onposition: (pos: Position) => void;
    onclose: () => void;
  }
  let { title, format, data, start, cacheId, onposition, onclose }: Props = $props();

  // Page turning, and the keys the app would otherwise take for playback while a book is open.
  const PREV = ['ArrowLeft', 'PageUp'];
  const NEXT = ['ArrowRight', 'PageDown'];

  let views = $state<{ view: BookView }>();
  let toc = $state<TocEntry[]>([]);
  let at = $state<Relocation | null>(null);
  let tocOpen = $state(false);
  let error = $state<string | null>(null);
  let surface = $state<HTMLDivElement>();
  let overlay = $state<HTMLDivElement>();
  let tocList = $state<HTMLElement>();
  let pointerOnLink = $state(false);

  const lightScheme = new MediaQuery('(prefers-color-scheme: light)');
  const appLight = $derived(prefs.theme === 'light' || (prefs.theme === 'system' && lightScheme.current));
  const palette = $derived(PALETTES[resolvePaper(readerPrefs.theme, appLight)]);
  const fontFaces = appFontFaces();
  const css = $derived(contentCss(readerPrefs, palette, fontFaces));
  const percent = $derived(at ? Math.round(at.progress * 100) : null);
  const chapter = $derived(at && at.chapter >= 0 ? toc[at.chapter]?.label : null);

  onMount(() => {
    const release = claimKeys([' ', ...PREV, ...NEXT]);
    surface?.focus();
    return release;
  });

  // Opening at a saved place reports the start of the page it falls on, which is a little before it (and, laid
  // out differently from the device that saved it, maybe a page before). Only report once the reader moves, so
  // opening a book never moves its saved place.
  let moved = false;
  function relocated(r: Relocation) {
    at = r;
    if (moved) onposition({ location: r.location, progress: r.progress });
  }

  function move(fn: (view: BookView) => void) {
    if (!views) return;
    moved = true;
    fn(views.view);
  }

  const next = () => move((v) => v.next());
  const prev = () => move((v) => v.prev());

  async function openToc() {
    tocOpen = true;
    await tick();
    (tocList?.querySelector<HTMLElement>('[aria-current="true"]') ?? tocList?.querySelector<HTMLElement>('button'))?.focus();
  }

  function closeToc() {
    tocOpen = false;
    surface?.focus();
  }

  function goTo(entry: TocEntry) {
    move((v) => v.go(entry.target));
    closeToc();
  }

  function follow(href: string) {
    if (!/^(https?|mailto):/i.test(href)) return move((v) => v.follow(href));
    if (inApp) void openUrl(href).catch(() => {});
    else window.open(href, '_blank', 'noopener,noreferrer');
  }

  function onClick(e: MouseEvent) {
    const link = views?.view.linkAt(e.clientX, e.clientY);
    if (link) return follow(link);
    const r = overlay!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (x < 0.3) prev();
    else if (x > 0.7) next();
    surface?.focus();
  }

  function onPointerMove(e: PointerEvent) {
    pointerOnLink = !!views?.view.linkAt(e.clientX, e.clientY);
  }

  // A trackpad swipe sends a stream of wheel events (and momentum after it): turn one page per gesture.
  let wheelQuietAt = 0;
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const now = performance.now();
    const busy = now < wheelQuietAt;
    wheelQuietAt = now + 250;
    if (busy) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 4) wheelQuietAt = 0;
    else if (d > 0) next();
    else prev();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    // Something else is on top, or the focused control uses these keys itself.
    if (dialogs.any || contextMenu.current || player.expanded) return;
    const target = e.target as HTMLElement;
    if (e.key === 'Escape') {
      if (target.closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
      if (tocOpen) closeToc();
      else onclose();
      return;
    }
    if (target.closest('input, textarea, select, [contenteditable], [role="slider"], [role="dialog"], .toc')) return;
    const space = e.key === ' ';
    if (space && target.closest('button, a')) return;
    if (NEXT.includes(e.key) || (space && !e.shiftKey)) next();
    else if (PREV.includes(e.key) || (space && e.shiftKey)) prev();
    else return;
    e.preventDefault();
  }

  function failed(err: unknown) {
    console.error(err);
    error = `This ${format === 'pdf' ? 'PDF' : 'book'} couldn't be opened. ${err instanceof Error ? err.message : ''}`.trim();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="reader"
  style:--paper={palette.paper}
  style:--ground={palette.paper}
  style:--raised={palette.raised}
  style:--raised-2={palette.raised2}
  style:--rule={palette.rule}
  style:--rule-soft={palette.rule}
  style:--text={palette.ink}
  style:--text-2={palette.ink2}
  style:--text-3={palette.ink3}
  style:color-scheme={palette.scheme}
>
  <header class="bar" data-drag-region>
    <button class="icon-btn" onclick={onclose} aria-label="Close the book" title="Close (Esc)"><ArrowLeft size={18} /></button>
    <div class="titles" data-drag-region>
      <h1 class="serif">{title}</h1>
      {#if chapter}<p class="chapter">{chapter}</p>{/if}
    </div>
    {#if toc.length}
      <button
        class="icon-btn"
        onclick={() => (tocOpen ? closeToc() : openToc())}
        aria-expanded={tocOpen}
        aria-controls="reader-toc"
        aria-label="Contents"
        title="Contents"><TableOfContents size={18} /></button
      >
    {/if}
    <ReaderSettings pdf={format === 'pdf'} />
  </header>

  <div class="body">
    {#if tocOpen}
      <nav class="toc" id="reader-toc" aria-label="Contents" bind:this={tocList}>
        <div class="toc-head">
          <h2 class="serif">Contents</h2>
          <button class="icon-btn" onclick={closeToc} aria-label="Close contents"><X size={16} /></button>
        </div>
        <ol>
          {#each toc as entry, i (i)}
            <li style:--depth={entry.depth}>
              <button aria-current={at?.chapter === i} onclick={() => goTo(entry)}>{entry.label}</button>
            </li>
          {/each}
        </ol>
      </nav>
    {/if}

    <button class="turn" onclick={prev} disabled={!at || at.atStart} aria-label="Previous page" tabindex="-1"><ChevronLeft size={22} /></button>
    <div class="surface" bind:this={surface} tabindex="-1" role="region" aria-label="{title}. Turn pages with the arrow keys or Space.">
      {#if error}
        <p class="error">{error}</p>
      {:else}
        <div class="stage" class:pdf={format === 'pdf'}>
          {#if format === 'pdf'}
            <PdfView bind:this={views} {data} {start} {cacheId} ontoc={(t) => (toc = t)} onrelocate={relocated} onerror={failed} />
          {:else}
            <EpubView bind:this={views} {data} {start} {cacheId} {css} ontoc={(t) => (toc = t)} onrelocate={relocated} onerror={failed} />
          {/if}
        </div>
        <!-- Clicks, wheel and link hover land here rather than in the book's frame (see EpubView). -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="overlay" class:link={pointerOnLink} bind:this={overlay} onclick={onClick} onwheel={onWheel} onpointermove={onPointerMove}></div>
      {/if}
    </div>
    <button class="turn" onclick={next} disabled={!at || at.atEnd} aria-label="Next page" tabindex="-1"><ChevronRight size={22} /></button>
  </div>

  <footer class="foot">
    <div class="meter" role="progressbar" aria-label="Progress through the book" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
      <div class="fill" style:width="{(at?.progress ?? 0) * 100}%"></div>
    </div>
    <span class="pct num">{percent === null ? '' : `${percent}%`}</span>
  </footer>
</div>

<style>
  /* Covers the page column (top bar included); the sidebar and the player stay. */
  .reader {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    background: var(--paper);
    color: var(--text);
    transition: background 200ms;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 14px 20px 6px;
    min-height: 60px;
  }
  .titles {
    flex: 1;
    min-width: 0;
    text-align: center;
  }
  h1 {
    font-size: var(--t-md);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chapter {
    font-size: var(--t-xs);
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body {
    position: relative;
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) 56px;
    min-height: 0;
  }
  .surface {
    position: relative;
    display: grid;
    /* A fixed track: the book's frame is as wide as all its pages, and an auto track would grow to fit it. */
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    min-height: 0;
    outline: none;
  }
  .stage {
    width: 100%;
    max-width: 1180px;
    height: 100%;
    padding: 12px 0 8px;
    overflow: hidden;
  }
  .stage.pdf {
    padding: 8px 0 16px;
  }
  .overlay {
    position: absolute;
    inset: 0;
    cursor: default;
  }
  .overlay.link {
    cursor: pointer;
  }
  .turn {
    display: grid;
    place-items: center;
    color: var(--text-3);
    opacity: 0.5;
    transition: opacity 160ms;
  }
  .turn:hover:not(:disabled) {
    opacity: 1;
    color: var(--text);
  }
  .turn:disabled {
    opacity: 0;
  }
  .error {
    align-self: center;
    max-width: 44ch;
    text-align: center;
    color: var(--text-2);
  }
  .toc {
    position: absolute;
    z-index: 2;
    top: 0;
    bottom: 0;
    left: 12px;
    width: min(340px, 80%);
    display: flex;
    flex-direction: column;
    background: var(--raised-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    box-shadow: 0 18px 40px -12px rgb(0 0 0 / 0.45);
    animation: slide 160ms var(--ease);
  }
  .toc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 10px 6px 18px;
  }
  .toc h2 {
    font-size: var(--t-lg);
  }
  .toc ol {
    list-style: none;
    margin: 0;
    padding: 4px 8px 12px;
    overflow-y: auto;
  }
  .toc li button {
    display: block;
    width: 100%;
    padding: 7px 10px 7px calc(10px + var(--depth) * 16px);
    border-radius: var(--r-sm);
    text-align: left;
    font-size: var(--t-sm);
    color: var(--text-2);
  }
  .toc li button:hover {
    background: var(--raised);
    color: var(--text);
  }
  .toc li button[aria-current='true'] {
    color: var(--text);
    font-weight: 650;
    background: var(--raised);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 6px 76px 16px;
  }
  .meter {
    flex: 1;
    height: 3px;
    border-radius: 3px;
    background: var(--rule);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--text-3);
    transition: width 200ms var(--ease);
  }
  .pct {
    min-width: 4ch;
    text-align: right;
    font-size: var(--t-xs);
    color: var(--text-3);
  }
  @keyframes slide {
    from {
      opacity: 0;
      translate: -8px 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toc {
      animation: none;
    }
  }
</style>
