<script lang="ts">
  import { Check, Pause, Play } from '@lucide/svelte';
  import type { LibraryItem } from '$lib/api/types';
  import { itemMenuFor } from '$lib/util/itemMenu';
  import { ItemView } from '$lib/util/itemView.svelte';
  import Cover from './Cover.svelte';
  import Progress from './Progress.svelte';

  interface Props {
    item: LibraryItem;
    /** Show the series position ("Book 3") instead of the author. */
    showSequence?: boolean;
  }
  let { item, showSequence = false }: Props = $props();

  const v = new ItemView(() => item);
  const byline = $derived.by(() => {
    if (v.series) return `${v.series.numBooks} books`;
    if (v.episode) return item.media.metadata.title;
    if (showSequence && item.sequence) return `Book ${item.sequence}`;
    return v.author;
  });
</script>

<!-- The title link stretches over the whole card; Play sits beside it (never inside a link). -->
<div class="card stretch-host" class:series={!!v.series} class:current={v.current} {@attach itemMenuFor(() => ({ item }))}>
  <div class="art">
    {#if v.series}
      <span class="sheet s2" aria-hidden="true"></span>
      <span class="sheet s1" aria-hidden="true"></span>
    {/if}
    <Cover itemId={item.id} title={v.title} author={byline} updatedAt={item.updatedAt} hasCover={!!item.media.coverPath} width={360} />
    {#if v.progress?.isFinished}
      <span class="badge" title="Finished"><Check size={13} strokeWidth={3} /><span class="sr-only">Finished</span></span>
    {/if}
    {#if v.canPlay}
      <button class="play" class:on={v.playing} onclick={v.play} aria-label={v.playLabel}>
        {#if v.playing}<Pause size={18} fill="currentColor" strokeWidth={0} />{:else}<Play size={18} fill="currentColor" strokeWidth={0} />{/if}
      </button>
    {/if}
  </div>
  <!-- Always reserve the rule's space so titles line up across a shelf. -->
  <div class="prog">
    {#if v.progress && !v.progress.isFinished && v.progress.progress > 0}<Progress value={v.progress.progress} label="{v.title}: listened" />{/if}
  </div>
  <div class="text">
    <a class="title stretched" href={v.href} draggable="false">{v.title}</a>
    {#if byline}<span class="by">{byline}</span>{/if}
  </div>
</div>

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
    z-index: 2;
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
  .card:focus-within .play,
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
