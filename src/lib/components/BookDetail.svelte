<script lang="ts">
  import { Check, CircleCheck, EyeOff, History, ListEnd, ListX, Pause, Play, RotateCcw } from '@lucide/svelte';
  import * as abs from '$lib/api/abs';
  import type { BookMedia, LibraryItem } from '$lib/api/types';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { canEditCollections } from '$lib/util/actions/library';
  import { bySequence, discoveryShelves, seriesRefs } from '$lib/util/discover';
  import { bytes, date, duration } from '$lib/util/format';
  import { playFrom, playOrToggle, toggleFinished, toggleQueued } from '$lib/util/play';
  import { resource } from '$lib/util/resource.svelte';
  import AddToCollection from './AddToCollection.svelte';
  import AddToPlaylist from './AddToPlaylist.svelte';
  import BookmarkList from './BookmarkList.svelte';
  import ChapterList from './ChapterList.svelte';
  import ChapterShelf from './ChapterShelf.svelte';
  import DownloadButton from './DownloadButton.svelte';
  import ItemAbout from './ItemAbout.svelte';
  import ItemCard from './ItemCard.svelte';
  import ItemHero from './ItemHero.svelte';
  import Shelf from './Shelf.svelte';

  /** A book's page: header with the chapter shelf and actions, then the description beside chapters, bookmarks and files. */
  let { item }: { item: LibraryItem & { media: BookMedia } } = $props();

  let busy = $state(false);

  const meta = $derived(item.media.metadata);
  const progress = $derived(session.progressFor(item.id));
  const isCurrent = $derived(player.isCurrent(item.id));
  const time = $derived(isCurrent ? player.currentTime : (progress?.currentTime ?? 0));
  const total = $derived(item.media.duration);
  const chapters = $derived(item.media.chapters ?? []);
  const shelfChapters = $derived(chapters.length ? chapters : [{ id: 0, start: 0, end: total, title: meta.title }]);
  const marks = $derived(session.bookmarksFor(item.id));
  const queued = $derived(player.inQueue(item.id));
  const hasSide = $derived(chapters.length > 1 || marks.length > 0 || !!item.media.audioFiles?.length || !!progress);

  // Discovery shelves. Keyed by series and author (not by this title), so the other books in the same series
  // open with their shelves already there.
  const seriesRef = $derived(seriesRefs(meta)[0] ?? null);
  const authorRef = $derived(meta.authors?.[0] ?? null);
  const seriesRes = resource(() => (seriesRef ? { library: item.libraryId, id: seriesRef.id } : null), {
    id: (k) => `shelf-series:${k.id}`,
    load: (k, signal) =>
      abs
        .getLibraryItems(k.library, { filter: abs.encodeFilter('series', k.id), sort: 'media.metadata.series.sequence', limit: 100 }, signal)
        .then((r) => bySequence(r.results, k.id))
  });
  const authorRes = resource(() => (authorRef ? { library: item.libraryId, id: authorRef.id } : null), {
    id: (k) => `shelf-author:${k.library}:${k.id}`,
    load: (k, signal) =>
      abs.getLibraryItems(k.library, { filter: abs.encodeFilter('authors', k.id), sort: 'media.metadata.title', limit: 100 }, signal).then((r) => r.results)
  });
  // Each shelf waits for its own answer only: a slow author listing doesn't hold back the series.
  const shelves = $derived(discoveryShelves(item.id, seriesRef ? (seriesRes.data ?? []) : [], authorRef ? (authorRes.data ?? []) : []));

  async function finished() {
    busy = true;
    await toggleFinished(item.id);
    busy = false;
  }

  async function hideFromContinue() {
    if (!progress) return;
    try {
      await abs.removeFromContinueListening(progress.id);
      session.patchProgress(progress.libraryItemId, null, { hideFromContinueListening: true });
      toast('Removed from Continue Listening.');
    } catch (err) {
      toast(`Couldn't update. ${errorMessage(err)}`, { tone: 'error' });
    }
  }
</script>

<ItemHero {item}>
  <div class="shelf">
    <ChapterShelf size="full" chapters={shelfChapters} {time} duration={total} bookmarks={marks} onseek={(t) => playFrom(item.id, t)} />
  </div>
  <div class="actions">
    <button class="btn btn-primary btn-lg" onclick={() => playOrToggle(item.id)} disabled={item.isMissing}>
      {#if isCurrent && player.isPlaying}
        <Pause size={18} fill="currentColor" strokeWidth={0} /> Pause
      {:else if progress?.isFinished}
        <RotateCcw size={18} /> Listen again
      {:else}
        <Play size={18} fill="currentColor" strokeWidth={0} /> {time > 0 ? 'Resume' : 'Play'}
      {/if}
    </button>
    <button class="btn btn-quiet btn-lg" onclick={finished} disabled={busy}>
      {#if progress?.isFinished}<CircleCheck size={18} /> Finished{:else}<Check size={18} /> Mark as finished{/if}
    </button>
    <DownloadButton itemId={item.id} />
    {#if !isCurrent}
      <button
        class="icon-btn"
        onclick={() => toggleQueued(item)}
        aria-pressed={queued}
        title={queued ? 'Remove from Up Next' : 'Play after the current title'}
        aria-label="Up Next"
      >
        {#if queued}<ListX size={18} />{:else}<ListEnd size={18} />{/if}
      </button>
    {/if}
    <AddToPlaylist libraryId={item.libraryId} entry={{ libraryItemId: item.id }} />
    {#if canEditCollections()}<AddToCollection libraryId={item.libraryId} itemIds={[item.id]} />{/if}
    {#if progress && !progress.isFinished && !progress.hideFromContinueListening && progress.currentTime > 0}
      <button class="icon-btn" onclick={hideFromContinue} title="Remove from Continue Listening" aria-label="Remove from Continue Listening">
        <EyeOff size={18} />
      </button>
    {/if}
    <span class="where faint num">
      {#if progress?.isFinished}
        Finished {date(progress.finishedAt)}
      {:else if time > 0}
        {duration(Math.max(0, total - time) / (player.rateFor(item.id) || 1))} left
      {/if}
    </span>
  </div>
</ItemHero>

<div class="body" class:single={!hasSide}>
  <section class="about" aria-label="About">
    <ItemAbout {item} />
  </section>

  {#if hasSide}<aside class="side">
      {#if chapters.length > 1}
        <section>
          <h2 class="serif">Chapters</h2>
          <ChapterList {chapters} {time} onseek={(t) => playFrom(item.id, t)} />
        </section>
      {/if}

      {#if marks.length}
        <section>
          <h2 class="serif">Bookmarks</h2>
          <BookmarkList itemId={item.id} {marks} onseek={(t) => playFrom(item.id, t)} />
        </section>
      {/if}

      {#if progress}
        <section>
          <a class="history" href="/history?item={item.id}"><History size={16} /> Your listening history for this title</a>
        </section>
      {/if}

      {#if item.media.audioFiles?.length}
        <section>
          <h2 class="serif">Files</h2>
          <ul class="files">
            {#each item.media.audioFiles as f (f.ino)}
              <li>
                <span class="f-name">{f.metadata.filename}</span>
                <span class="faint num">{f.codec?.toUpperCase()}, {Math.round(f.bitRate / 1000)} kbps, {bytes(f.metadata.size)}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </aside>{/if}
</div>

{#if shelves.series.length || shelves.author.length}
  <div class="discover">
    {#if shelves.series.length && seriesRef}
      <Shelf title="More in {seriesRef.name}" href="/series/{seriesRef.id}">
        {#each shelves.series as b (b.id)}
          {#if b.id === item.id}
            <div class="here" aria-current="page">
              <ItemCard item={b} showSequence />
              <span class="here-tag">This book</span>
            </div>
          {:else}
            <ItemCard item={b} showSequence />
          {/if}
        {/each}
      </Shelf>
    {/if}
    {#if shelves.author.length && authorRef}
      <Shelf title="More by {authorRef.name}" href="/authors/{authorRef.id}">
        {#each shelves.author as b (b.id)}<ItemCard item={b} />{/each}
      </Shelf>
    {/if}
  </div>
{/if}

<style>
  .shelf {
    margin-top: 34px;
    max-width: 760px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 24px;
  }
  .where {
    margin-left: 10px;
    font-size: var(--t-sm);
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 56px;
    padding: 12px 40px 64px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .single {
    grid-template-columns: minmax(0, 1fr);
  }
  h2 {
    font-size: var(--t-lg);
    font-weight: 620;
    margin-bottom: 10px;
  }
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: var(--t-sm);
  }
  .files li {
    display: flex;
    flex-direction: column;
  }
  .f-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .history {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--t-sm);
    color: var(--text-2);
  }
  .history:hover {
    color: var(--accent);
  }
  .discover {
    padding: 0 40px 64px;
    margin-top: -28px;
  }
  .here {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .here :global(.art) {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    border-radius: var(--r-sm);
  }
  .here-tag {
    margin-top: 4px;
    font-size: var(--t-xs);
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent);
  }
  @media (max-width: 1180px) {
    .body {
      grid-template-columns: 1fr;
    }
  }
</style>
