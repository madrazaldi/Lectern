<script lang="ts">
  import { Check, Pause, Play } from '@lucide/svelte';
  import type { LibraryItem, PodcastMetadata } from '$lib/api/types';
  import { isBook, isPodcast } from '$lib/api/types';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import Cover from './Cover.svelte';
  import Progress from './Progress.svelte';

  interface Props {
    item: LibraryItem;
    /** Show the series position ("Book 3") instead of the author. */
    showSequence?: boolean;
  }
  let { item, showSequence = false }: Props = $props();

  const meta = $derived(item.media.metadata);
  const series = $derived(item.collapsedSeries);
  const episode = $derived(item.recentEpisode ?? null);
  const href = $derived(series ? `/series/${series.id}` : `/item/${item.id}`);
  const title = $derived(series ? series.name : (episode?.title ?? meta.title));
  const byline = $derived.by(() => {
    if (series) return `${series.numBooks} books`;
    if (episode) return meta.title;
    if (showSequence && item.sequence) return `Book ${item.sequence}`;
    if (isBook(item)) return item.media.metadata.authorName ?? '';
    return (item.media.metadata as PodcastMetadata).author ?? '';
  });
  const progress = $derived(series ? undefined : session.progressFor(item.id, episode?.id));
  const current = $derived(!series && player.isCurrent(item.id, episode?.id));
  const playing = $derived(current && player.isPlaying);
  const canPlay = $derived(!series && (!isPodcast(item) || !!episode) && !item.isMissing);

  function onPlay(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (current) player.toggle();
    else void player.play(item.id, episode?.id ?? null);
  }
</script>

<a class="card" {href} class:series={!!series} class:current draggable="false">
  <div class="art">
    {#if series}
      <span class="sheet s2" aria-hidden="true"></span>
      <span class="sheet s1" aria-hidden="true"></span>
    {/if}
    <Cover itemId={item.id} {title} author={byline} updatedAt={item.updatedAt} hasCover={!!item.media.coverPath} width={360} />
    {#if progress?.isFinished}
      <span class="badge" title="Finished"><Check size={13} strokeWidth={3} /></span>
    {/if}
    {#if canPlay}
      <button class="play" class:on={playing} onclick={onPlay} aria-label={playing ? `Pause ${title}` : `Play ${title}`}>
        {#if playing}<Pause size={18} fill="currentColor" strokeWidth={0} />{:else}<Play size={18} fill="currentColor" strokeWidth={0} />{/if}
      </button>
    {/if}
  </div>
  <!-- Always reserve the rule's space so titles line up across a shelf. -->
  <div class="prog">
    {#if progress && !progress.isFinished && progress.progress > 0}<Progress value={progress.progress} />{/if}
  </div>
  <div class="text">
    <span class="title">{title}</span>
    {#if byline}<span class="by">{byline}</span>{/if}
  </div>
</a>

<style>
  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-radius: var(--r-md);
    -webkit-user-drag: none;
  }
  .art {
    position: relative;
  }
  .series .art {
    margin-top: 8px;
  }
  .sheet {
    position: absolute;
    inset: 0;
    border-radius: var(--r-sm);
    background: var(--raised-2);
    border: 1px solid var(--rule);
  }
  .s1 {
    transform: translate(5px, -5px);
  }
  .s2 {
    transform: translate(10px, -10px) scale(0.98);
    opacity: 0.6;
  }
  .badge {
    position: absolute;
    top: 8px;
    right: 8px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgb(20 18 26 / 0.78);
    color: #eee7da;
    backdrop-filter: blur(6px);
  }
  .play {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 6px 18px -4px rgb(0 0 0 / 0.6);
    opacity: 0;
    transform: translateY(4px);
    transition:
      opacity 140ms var(--ease),
      transform 140ms var(--ease);
  }
  .play :global(svg) {
    margin-left: 2px;
  }
  .play.on :global(svg) {
    margin-left: 0;
  }
  .card:hover .play,
  .card:focus-visible .play,
  .play:focus-visible,
  .play.on {
    opacity: 1;
    transform: none;
  }
  .prog {
    height: 3px;
    margin-top: 8px;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 10px;
    min-width: 0;
  }
  .title {
    font-family: var(--font-serif);
    font-size: var(--t-md);
    font-weight: 560;
    line-height: 1.25;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .current .title {
    color: var(--accent);
  }
  .by {
    font-size: var(--t-sm);
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
