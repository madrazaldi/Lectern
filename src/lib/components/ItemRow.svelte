<script lang="ts">
  import { Check, Pause, Play } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import type { LibraryItem, PodcastMetadata } from '$lib/api/types';
  import { isBook, isPodcast } from '$lib/api/types';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { duration } from '$lib/util/format';
  import Cover from './Cover.svelte';
  import Progress from './Progress.svelte';

  interface Props {
    item: LibraryItem;
    /** Show the series position ("Book 3") under the title. */
    showSequence?: boolean;
    /** Extra controls at the end of the row. Rendered outside the link, so clicks in here never navigate. */
    actions?: Snippet;
  }
  let { item, showSequence = false, actions }: Props = $props();

  const meta = $derived(item.media.metadata);
  const series = $derived(item.collapsedSeries);
  const episode = $derived(item.recentEpisode ?? null);
  const href = $derived(series ? `/series/${series.id}` : `/item/${item.id}`);
  const title = $derived(series ? series.name : (episode?.title ?? meta.title));
  const sub = $derived.by(() => {
    if (series) return `${series.numBooks} books`;
    if (episode) return meta.title;
    if (isBook(item)) {
      if (showSequence && item.sequence) return `Book ${item.sequence}`;
      return item.media.metadata.seriesName || item.media.metadata.subtitle || '';
    }
    return '';
  });
  const author = $derived.by(() => {
    if (series) return '';
    if (isBook(item)) return item.media.metadata.authorName ?? '';
    return (item.media.metadata as PodcastMetadata).author ?? '';
  });
  const narrator = $derived(!series && isBook(item) ? (item.media.metadata.narratorName ?? '') : '');
  const length = $derived.by(() => {
    if (series) return '';
    if (episode) return episode.duration ? duration(episode.duration, { short: true }) : '';
    if (isBook(item)) return item.media.duration ? duration(item.media.duration, { short: true }) : '';
    const n = isPodcast(item) ? item.media.numEpisodes : 0;
    return n ? `${n.toLocaleString()} ep` : '';
  });
  const progress = $derived(series ? undefined : session.progressFor(item.id, episode?.id));
  const current = $derived(!series && player.isCurrent(item.id, episode?.id));
  const playing = $derived(current && player.isPlaying);
  const canPlay = $derived(!series && (!isPodcast(item) || !!episode) && !item.isMissing);
  const ratio = $derived(session.library?.settings.coverAspectRatio === 0 ? 1.6 : 1);

  function onPlay(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (current) player.toggle();
    else void player.play(item.id, episode?.id ?? null);
  }
</script>

<div class="row" class:current style:--ratio={ratio}>
  <a class="link" {href} class:with-actions={!!actions} draggable="false">
    <span class="art">
      <Cover itemId={item.id} {title} {author} updatedAt={item.updatedAt} hasCover={!!item.media.coverPath} width={120} />
    </span>
    <span class="main">
      <span class="title">{title}</span>
      {#if sub}<span class="sub">{sub}</span>{/if}
    </span>
    <span class="cell author">{author}</span>
    <span class="cell narrator">{narrator}</span>
    <span class="cell len num">{length}</span>
    <span class="status">
      {#if progress?.isFinished}
        <span class="done" title="Finished"><Check size={14} strokeWidth={2.5} /></span>
      {:else if progress && progress.progress > 0}
        <span class="pct num">{Math.round(progress.progress * 100)}%</span>
        <span class="bar"><Progress value={progress.progress} /></span>
      {/if}
    </span>
    <span class="go">
      {#if canPlay}
        <button class="play" class:on={playing} onclick={onPlay} aria-label={playing ? `Pause ${title}` : `Play ${title}`}>
          {#if playing}<Pause size={15} fill="currentColor" strokeWidth={0} />{:else}<Play size={15} fill="currentColor" strokeWidth={0} />{/if}
        </button>
      {/if}
    </span>
  </a>
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
  .link {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: grid;
    grid-template-columns: 44px minmax(0, 2.2fr) minmax(0, 1.2fr) minmax(0, 1.2fr) 64px 84px 34px;
    align-items: center;
    column-gap: 16px;
    padding: 0 12px;
    border-radius: var(--r-sm);
    -webkit-user-drag: none;
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
  .link:focus-visible .play,
  .play:focus-visible,
  .play.on {
    opacity: 1;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 10px 0 4px;
    flex: none;
  }

  @container (max-width: 860px) {
    .link {
      grid-template-columns: 44px minmax(0, 2fr) minmax(0, 1.2fr) 64px 84px 34px;
    }
    .narrator {
      display: none;
    }
  }
  @container (max-width: 600px) {
    .link {
      grid-template-columns: 44px minmax(0, 1fr) 64px 34px;
      column-gap: 12px;
    }
    .author,
    .status {
      display: none;
    }
  }
</style>
