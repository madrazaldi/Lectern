<script lang="ts">
  import { Check, Pause, Play } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import type { LibraryItem } from '$lib/api/types';
  import { isBook, isPodcast } from '$lib/api/types';
  import { session } from '$lib/stores/session.svelte';
  import { duration } from '$lib/util/format';
  import { itemMenuFor } from '$lib/util/itemMenu';
  import { ItemView } from '$lib/util/itemView.svelte';
  import Cover from './Cover.svelte';
  import Progress from './Progress.svelte';

  interface Props {
    item: LibraryItem;
    /** Show the series position ("Book 3") under the title. */
    showSequence?: boolean;
    /** Extra controls at the end of the row. They sit above the row's link, so clicks in here never navigate. */
    actions?: Snippet;
  }
  let { item, showSequence = false, actions }: Props = $props();

  const v = new ItemView(() => item);
  const sub = $derived.by(() => {
    if (v.series) return `${v.series.numBooks} books`;
    if (v.episode) return item.media.metadata.title;
    if (isBook(item)) {
      if (showSequence && item.sequence) return `Book ${item.sequence}`;
      return item.media.metadata.seriesName || item.media.metadata.subtitle || '';
    }
    return '';
  });
  const narrator = $derived(!v.series && isBook(item) ? (item.media.metadata.narratorName ?? '') : '');
  const length = $derived.by(() => {
    if (v.series) return '';
    if (v.episode) return v.episode.duration ? duration(v.episode.duration, { short: true }) : '';
    if (isBook(item)) return item.media.duration ? duration(item.media.duration, { short: true }) : '';
    const n = isPodcast(item) ? item.media.numEpisodes : 0;
    return n ? `${n.toLocaleString()} ep` : '';
  });
  const ratio = $derived(session.library?.settings.coverAspectRatio === 0 ? 1.6 : 1);
</script>

<!-- The title link stretches over the row; Play and the extra actions sit above it as siblings. -->
<div class="row stretch-host" class:current={v.current} style:--ratio={ratio} {@attach itemMenuFor(() => ({ item }))}>
  <div class="cells" class:with-actions={!!actions}>
    <span class="art">
      <Cover itemId={item.id} title={v.title} author={v.author} updatedAt={item.updatedAt} hasCover={!!item.media.coverPath} width={120} />
    </span>
    <span class="main">
      <a class="title stretched" href={v.href} draggable="false">{v.title}</a>
      {#if sub}<span class="sub">{sub}</span>{/if}
    </span>
    <span class="cell author">{v.author}</span>
    <span class="cell narrator">{narrator}</span>
    <span class="cell len num">{length}</span>
    <span class="status">
      {#if v.progress?.isFinished}
        <span class="done" title="Finished"><Check size={14} strokeWidth={2.5} /><span class="sr-only">Finished</span></span>
      {:else if v.progress && v.progress.progress > 0}
        <span class="pct num" aria-hidden="true">{Math.round(v.progress.progress * 100)}%</span>
        <span class="bar"><Progress value={v.progress.progress} label="{v.title}: listened" /></span>
      {/if}
    </span>
    <span class="go">
      {#if v.canPlay}
        <button class="play" class:on={v.playing} onclick={v.play} aria-label={v.playLabel}>
          {#if v.playing}<Pause size={15} fill="currentColor" strokeWidth={0} />{:else}<Play size={15} fill="currentColor" strokeWidth={0} />{/if}
        </button>
      {/if}
    </span>
  </div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    height: 68px;
    min-width: 0;
    border-bottom: 1px solid var(--rule-soft);
    border-radius: var(--r-sm);
    container-type: inline-size;
  }
  .row:hover {
    background: color-mix(in srgb, var(--text) 5%, transparent);
  }
  .cells {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: grid;
    grid-template-columns: 44px minmax(0, 2.2fr) minmax(0, 1.2fr) minmax(0, 1.2fr) 64px 84px 34px;
    align-items: center;
    column-gap: 16px;
    padding: 0 12px;
    border-radius: var(--r-sm);
  }
  .with-actions {
    padding-right: 4px;
  }
  .art {
    display: grid;
    place-items: center;
    /* Square covers fill the 44px column; tall ones are capped at 52px high. */
    width: min(44px, calc(52px / var(--ratio)));
    justify-self: center;
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .title {
    -webkit-user-drag: none;
    font-family: var(--font-serif);
    font-size: var(--t-md);
    font-weight: 560;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .current .title {
    color: var(--accent);
  }
  .sub,
  .cell {
    font-size: var(--t-sm);
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .len {
    text-align: right;
    color: var(--text-3);
  }
  .status {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    font-size: var(--t-xs);
    color: var(--text-2);
  }
  .bar {
    width: 56px;
  }
  .done {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .go {
    display: grid;
    place-items: center;
  }
  .play {
    position: relative;
    z-index: 2;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    opacity: 0;
    transition: opacity 120ms var(--ease);
  }
  .play :global(svg) {
    margin-left: 2px;
  }
  .play.on :global(svg) {
    margin-left: 0;
  }
  .row:hover .play,
  .row:focus-within .play,
  .play.on {
    opacity: 1;
  }
  .actions {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 10px 0 4px;
    flex: none;
  }

  @container (max-width: 860px) {
    .cells {
      grid-template-columns: 44px minmax(0, 2fr) minmax(0, 1.2fr) 64px 84px 34px;
    }
    .narrator {
      display: none;
    }
  }
  @container (max-width: 600px) {
    .cells {
      grid-template-columns: 44px minmax(0, 1fr) 64px 34px;
      column-gap: 12px;
    }
    .author,
    .status {
      display: none;
    }
  }
</style>
