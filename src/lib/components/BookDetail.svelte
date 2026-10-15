<script lang="ts">
  import { Check, CircleCheck, EyeOff, ListEnd, ListX, Pause, Play, RotateCcw } from '@lucide/svelte';
  import * as abs from '$lib/api/abs';
  import type { BookMedia, LibraryItem } from '$lib/api/types';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { bytes, date, duration } from '$lib/util/format';
  import { playFrom, playOrToggle, toggleFinished, toggleQueued } from '$lib/util/play';
  import AddToPlaylist from './AddToPlaylist.svelte';
  import BookmarkList from './BookmarkList.svelte';
  import ChapterList from './ChapterList.svelte';
  import ChapterShelf from './ChapterShelf.svelte';
  import DownloadButton from './DownloadButton.svelte';
  import ItemAbout from './ItemAbout.svelte';
  import ItemHero from './ItemHero.svelte';

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
  const hasSide = $derived(chapters.length > 1 || marks.length > 0 || !!item.media.audioFiles?.length);

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
  @media (max-width: 1180px) {
    .body {
      grid-template-columns: 1fr;
    }
  }
</style>
