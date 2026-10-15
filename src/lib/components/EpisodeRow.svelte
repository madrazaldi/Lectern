<script lang="ts">
  import { CircleCheck, ListEnd, ListX, Pause, Play } from '@lucide/svelte';
  import type { LibraryItem, PodcastEpisode } from '$lib/api/types';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { date, duration } from '$lib/util/format';
  import { itemMenuFor } from '$lib/util/itemMenu';
  import { playOrToggle, toggleFinished, toggleQueued } from '$lib/util/play';
  import AddToPlaylist from './AddToPlaylist.svelte';
  import DownloadButton from './DownloadButton.svelte';
  import Progress from './Progress.svelte';

  /** One podcast episode: play, the details, and its actions (also on right-click / Shift+F10). */
  interface Props {
    podcast: LibraryItem;
    episode: PodcastEpisode;
    /** The description as plain text (worked out once by the list, not per render). */
    summary: string;
  }
  let { podcast, episode: ep, summary }: Props = $props();

  const p = $derived(session.progressFor(podcast.id, ep.id));
  const on = $derived(player.isCurrent(podcast.id, ep.id));
  const playing = $derived(on && player.isPlaying);
  const queued = $derived(player.inQueue(podcast.id, ep.id));
  const when = $derived([date(ep.publishedAt), ep.season && `season ${ep.season}`, ep.episode && `episode ${ep.episode}`].filter(Boolean).join(', '));
</script>

<li class="ep" class:on {@attach itemMenuFor(() => ({ item: podcast, episode: ep }))}>
  <button class="ep-play" onclick={() => playOrToggle(podcast.id, ep.id)} aria-label={playing ? `Pause ${ep.title}` : `Play ${ep.title}`}>
    {#if playing}<Pause size={16} fill="currentColor" strokeWidth={0} />{:else}<Play size={16} fill="currentColor" strokeWidth={0} />{/if}
  </button>
  <div class="ep-main">
    <span class="ep-date faint">{when}</span>
    <span class="ep-title">{ep.title}</span>
    {#if summary}<span class="ep-desc">{summary}</span>{/if}
    {#if p && !p.isFinished && p.progress > 0}<div class="ep-prog"><Progress value={p.progress} label="{ep.title}: listened" /></div>{/if}
  </div>
  <div class="ep-side">
    <span class="faint num">{ep.duration ? duration(ep.duration, { short: true }) : ''}</span>
    {#if !on}
      <button
        class="icon-btn"
        onclick={() => toggleQueued(podcast, ep)}
        aria-pressed={queued}
        aria-label="Up Next"
        title={queued ? 'Remove from Up Next' : 'Add to Up Next'}
      >
        {#if queued}<ListX size={17} />{:else}<ListEnd size={17} />{/if}
      </button>
    {/if}
    <DownloadButton itemId={podcast.id} episodeId={ep.id} compact />
    <AddToPlaylist libraryId={podcast.libraryId} entry={{ libraryItemId: podcast.id, episodeId: ep.id }} size={17} />
    <button
      class="icon-btn"
      aria-pressed={!!p?.isFinished}
      onclick={() => toggleFinished(podcast.id, ep.id)}
      aria-label="Played"
      title={p?.isFinished ? 'Played' : 'Mark as played'}><CircleCheck size={17} /></button
    >
  </div>
</li>

<style>
  .ep {
    display: grid;
    grid-template-columns: 40px 1fr auto;
    gap: 16px;
    padding: 16px 0;
    border-bottom: 1px solid var(--rule-soft);
  }
  .ep-play {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid var(--rule);
    color: var(--text);
  }
  .ep-play:hover,
  .ep.on .ep-play {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .ep-main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .ep-date {
    font-size: var(--t-xs);
  }
  .ep-title {
    font-weight: 620;
  }
  .ep.on .ep-title {
    color: var(--accent);
  }
  .ep-desc {
    font-size: var(--t-sm);
    color: var(--text-2);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .ep-prog {
    margin-top: 6px;
    max-width: 240px;
  }
  .ep-side {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--t-sm);
  }
</style>
