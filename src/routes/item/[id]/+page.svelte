<script lang="ts">
  import { Bookmark, Check, CircleCheck, EyeOff, ListEnd, ListX, LoaderCircle, Pause, Play, RotateCcw } from '@lucide/svelte';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import { coverUrl } from '$lib/api/client';
  import type { LibraryItem, PodcastEpisode, PodcastMetadata, SeriesRef } from '$lib/api/types';
  import { isBook, isPodcast } from '$lib/api/types';
  import AddToPlaylist from '$lib/components/AddToPlaylist.svelte';
  import ChapterShelf from '$lib/components/ChapterShelf.svelte';
  import DownloadButton from '$lib/components/DownloadButton.svelte';
  import Cover from '$lib/components/Cover.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import { downloads } from '$lib/stores/downloads.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { tintFor, type Tint } from '$lib/util/color';
  import { bytes, clock, date, duration, plain, safeHtml } from '$lib/util/format';

  let item = $state<LibraryItem | null>(null);
  let error = $state<string | null>(null);
  let tint = $state<Tint | null>(null);
  let expanded = $state(false);
  let episodeFilter = $state<'all' | 'unplayed' | 'in-progress'>('all');
  let busy = $state(false);

  const id = $derived(page.params.id!);

  $effect(() => {
    const current = id;
    item = null;
    error = null;
    expanded = false;
    abs
      .getItem(current)
      .then(async (it) => {
        if (current !== id) return;
        item = it;
        tint = await tintFor(coverUrl(it.id, 96, it.updatedAt));
      })
      .catch((err) => {
        if (current !== id) return;
        // Offline: a downloaded copy still has everything the page needs.
        const saved = downloads.list.find((d) => d.itemId === current);
        if (saved) item = saved.item;
        else error = err.message;
      });
  });

  const book = $derived(item && isBook(item) ? item : null);
  const podcast = $derived(item && isPodcast(item) ? item : null);
  const meta = $derived(item?.media.metadata);
  const progress = $derived(item ? session.progressFor(item.id) : undefined);
  const isCurrent = $derived(!!item && player.isCurrent(item.id));
  const time = $derived(isCurrent ? player.currentTime : (progress?.currentTime ?? 0));
  const total = $derived(book?.media.duration ?? 0);
  const chapters = $derived(book?.media.chapters ?? []);
  const shelfChapters = $derived(chapters.length ? chapters : [{ id: 0, start: 0, end: total, title: meta?.title ?? '' }]);
  const seriesList = $derived.by<SeriesRef[]>(() => {
    const s = book?.media.metadata.series;
    return !s ? [] : Array.isArray(s) ? s : [s];
  });
  const marks = $derived(item ? session.bookmarksFor(item.id) : []);
  const description = $derived(safeHtml(meta?.description));
  const longDescription = $derived(plain(meta?.description).length > 700);

  const episodes = $derived.by(() => {
    const eps = [...(podcast?.media.episodes ?? [])].sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    if (episodeFilter === 'all') return eps;
    return eps.filter((e) => {
      const p = session.progressFor(podcast!.id, e.id);
      return episodeFilter === 'unplayed' ? !p || (!p.isFinished && !p.currentTime) : p && !p.isFinished && p.currentTime > 0;
    });
  });

  function playBook(at?: number) {
    if (!item) return;
    if (isCurrent && at === undefined) player.toggle();
    else void player.play(item.id, null, at);
  }

  function playEpisode(ep: PodcastEpisode) {
    if (!item) return;
    if (player.isCurrent(item.id, ep.id)) player.toggle();
    else void player.play(item.id, ep.id);
  }

  async function toggleFinished(episodeId: string | null = null) {
    if (!item) return;
    const p = session.progressFor(item.id, episodeId);
    const next = !p?.isFinished;
    busy = true;
    try {
      await session.setFinished(item.id, episodeId, next);
      toast(next ? 'Marked as finished.' : 'Marked as not finished.');
    } catch (err) {
      toast(`Couldn't update progress. ${errorMessage(err)}`, { tone: 'error' });
    } finally {
      busy = false;
    }
  }

  function toggleQueue(episode: PodcastEpisode | null = null) {
    if (!item) return;
    const episodeId = episode?.id ?? null;
    const at = player.queue.findIndex((q) => q.itemId === item!.id && q.episodeId === episodeId);
    if (at >= 0) {
      player.removeFromQueue(at);
      toast('Removed from Up Next.');
      return;
    }
    player.enqueue({
      itemId: item.id,
      episodeId,
      title: episode?.title ?? item.media.metadata.title,
      subtitle: episode ? item.media.metadata.title : (book?.media.metadata.authorName ?? ''),
      updatedAt: item.updatedAt
    });
    toast(player.item ? 'Added to Up Next. It plays when the current title finishes.' : 'Added to Up Next.');
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

{#if error}
  <div class="page"><EmptyState title="Couldn't open this title"><p>{error}</p></EmptyState></div>
{:else if !item || !meta}
  <div class="loading"><LoaderCircle size={26} class="spin" /></div>
{:else}
  <article class="tint-scope" style:--h={tint?.h} style:--s={tint ? `${tint.s}%` : undefined}>
    <header class="top">
      <div class="wash" style:background-image="url({coverUrl(item.id, 120, item.updatedAt)})"></div>
      <div class="cover">
        <Cover itemId={item.id} title={meta.title} updatedAt={item.updatedAt} width={640} hasCover={!!item.media.coverPath} radius="var(--r-md)" eager />
      </div>
      <div class="head">
        {#if seriesList.length}
          <p class="series">
            {#each seriesList as s, i (s.id)}{i ? ', ' : ''}<a href="/series/{s.id}">{s.name}{s.sequence ? `, book ${s.sequence}` : ''}</a>{/each}
          </p>
        {/if}
        <h1 class="serif selectable">{meta.title}</h1>
        {#if book?.media.metadata.subtitle}<p class="subtitle serif">{book.media.metadata.subtitle}</p>{/if}

        <p class="people">
          {#if book}
            {#each book.media.metadata.authors ?? [] as a, i (a.id)}{i ? ', ' : ''}<a href="/authors/{a.id}">{a.name}</a>{/each}
            {#if book.media.metadata.narrators?.length}
              <span class="faint">read by</span>
              {#each book.media.metadata.narrators as n, i (n)}{i ? ', ' : ''}<a
                  href="/library?filter={encodeURIComponent(abs.encodeFilter('narrators', n))}&label={encodeURIComponent(`Read by ${n}`)}">{n}</a
                >{/each}
            {/if}
          {:else}
            {(meta as PodcastMetadata).author}
          {/if}
        </p>

        <dl class="facts">
          {#if book}
            <div>
              <dt>Length</dt>
              <dd class="num">{duration(total)}</dd>
            </div>
            {#if chapters.length > 1}<div>
                <dt>Chapters</dt>
                <dd class="num">{chapters.length}</dd>
              </div>{/if}
          {:else if podcast}
            <div>
              <dt>Episodes</dt>
              <dd class="num">{podcast.media.episodes?.length ?? 0}</dd>
            </div>
          {/if}
          {#if book?.media.metadata.publishedYear}<div>
              <dt>Published</dt>
              <dd>{book.media.metadata.publishedYear}</dd>
            </div>{/if}
          {#if book?.media.metadata.publisher}<div>
              <dt>Publisher</dt>
              <dd>{book.media.metadata.publisher}</dd>
            </div>{/if}
          {#if meta.language}<div>
              <dt>Language</dt>
              <dd>{meta.language}</dd>
            </div>{/if}
        </dl>

        {#if book}
          <div class="shelf">
            <ChapterShelf size="full" chapters={shelfChapters} {time} duration={total} bookmarks={marks} onseek={(t) => playBook(t)} />
          </div>
          <div class="actions">
            <button class="btn btn-primary btn-lg" onclick={() => playBook()} disabled={item.isMissing}>
              {#if isCurrent && player.isPlaying}
                <Pause size={18} fill="currentColor" strokeWidth={0} /> Pause
              {:else if progress?.isFinished}
                <RotateCcw size={18} /> Listen again
              {:else}
                <Play size={18} fill="currentColor" strokeWidth={0} /> {time > 0 ? 'Resume' : 'Play'}
              {/if}
            </button>
            <button class="btn btn-quiet btn-lg" onclick={() => toggleFinished()} disabled={busy}>
              {#if progress?.isFinished}<CircleCheck size={18} /> Finished{:else}<Check size={18} /> Mark as finished{/if}
            </button>
            <DownloadButton itemId={item.id} />
            {#if !isCurrent}
              {@const queued = player.inQueue(item.id)}
              <button
                class="icon-btn"
                onclick={() => toggleQueue()}
                aria-pressed={queued}
                title={queued ? 'Remove from Up Next' : 'Play after the current title'}
                aria-label={queued ? 'Remove from Up Next' : 'Add to Up Next'}
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
        {/if}
      </div>
    </header>

    <div class="body">
      <section class="about">
        {#if description}
          <div class="desc serif selectable" class:clamped={longDescription && !expanded}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags — sanitised by safeHtml -->
            {@html description}
          </div>
          {#if longDescription}
            <button class="more" onclick={() => (expanded = !expanded)}>{expanded ? 'Show less' : 'Read more'}</button>
          {/if}
        {/if}

        {#if meta.genres.length || item.media.tags.length}
          <div class="tags">
            {#each meta.genres as g (g)}
              <a class="tag" href="/library?filter={encodeURIComponent(abs.encodeFilter('genres', g))}&label={encodeURIComponent(g)}">{g}</a>
            {/each}
            {#each item.media.tags as t (t)}
              <a class="tag quiet" href="/library?filter={encodeURIComponent(abs.encodeFilter('tags', t))}&label={encodeURIComponent(t)}">{t}</a>
            {/each}
          </div>
        {/if}

        {#if podcast}
          <div class="ep-head">
            <h2 class="serif">Episodes</h2>
            <select class="select" bind:value={episodeFilter} aria-label="Show episodes">
              <option value="all">All episodes</option>
              <option value="unplayed">Unplayed</option>
              <option value="in-progress">In progress</option>
            </select>
          </div>
          <ol class="episodes">
            {#each episodes as ep (ep.id)}
              {@const p = session.progressFor(podcast.id, ep.id)}
              {@const on = player.isCurrent(podcast.id, ep.id)}
              <li class="ep" class:on>
                <button class="ep-play" onclick={() => playEpisode(ep)} aria-label={on && player.isPlaying ? `Pause ${ep.title}` : `Play ${ep.title}`}>
                  {#if on && player.isPlaying}<Pause size={16} fill="currentColor" strokeWidth={0} />{:else}<Play
                      size={16}
                      fill="currentColor"
                      strokeWidth={0}
                    />{/if}
                </button>
                <div class="ep-main">
                  <span class="ep-date faint"
                    >{date(ep.publishedAt)}{ep.season ? `, season ${ep.season}` : ''}{ep.episode ? `, episode ${ep.episode}` : ''}</span
                  >
                  <span class="ep-title">{ep.title}</span>
                  {#if ep.description}<span class="ep-desc">{plain(ep.description)}</span>{/if}
                  {#if p && !p.isFinished && p.progress > 0}<div class="ep-prog"><Progress value={p.progress} /></div>{/if}
                </div>
                <div class="ep-side">
                  <span class="faint num">{ep.duration ? duration(ep.duration, { short: true }) : ''}</span>
                  {#if !on}
                    {@const queued = player.inQueue(podcast.id, ep.id)}
                    <button
                      class="icon-btn"
                      onclick={() => toggleQueue(ep)}
                      aria-pressed={queued}
                      aria-label={queued ? 'Remove from Up Next' : 'Add to Up Next'}
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
                    onclick={() => toggleFinished(ep.id)}
                    aria-label={p?.isFinished ? 'Mark as not played' : 'Mark as played'}
                    title={p?.isFinished ? 'Played' : 'Mark as played'}><CircleCheck size={17} /></button
                  >
                </div>
              </li>
            {:else}
              <li class="faint none">No episodes here.</li>
            {/each}
          </ol>
        {/if}
      </section>

      {#if book}
        <aside class="side">
          {#if chapters.length > 1}
            <section>
              <h2 class="serif">Chapters</h2>
              <ol class="chapters">
                {#each chapters as c, i (c.id ?? i)}
                  {@const done = time >= c.end}
                  {@const now = time >= c.start && time < c.end && time > 0}
                  <li>
                    <button class="ch" class:done class:now onclick={() => playBook(c.start)}>
                      <span class="ch-i num">{i + 1}</span>
                      <span class="ch-t">{c.title}</span>
                      <span class="ch-s num">{clock(c.start)}</span>
                    </button>
                  </li>
                {/each}
              </ol>
            </section>
          {/if}

          {#if marks.length}
            <section>
              <h2 class="serif">Bookmarks</h2>
              <ol class="chapters">
                {#each marks as b (b.time)}
                  <li>
                    <button class="ch" onclick={() => playBook(b.time)}>
                      <span class="ch-i"><Bookmark size={13} /></span>
                      <span class="ch-t">{b.title}</span>
                      <span class="ch-s num">{clock(b.time)}</span>
                    </button>
                  </li>
                {/each}
              </ol>
            </section>
          {/if}

          {#if book.media.audioFiles?.length}
            <section>
              <h2 class="serif">Files</h2>
              <ul class="files">
                {#each book.media.audioFiles as f (f.ino)}
                  <li>
                    <span class="f-name">{f.metadata.filename}</span>
                    <span class="faint num">{f.codec?.toUpperCase()}, {Math.round(f.bitRate / 1000)} kbps, {bytes(f.metadata.size)}</span>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
        </aside>
      {/if}
    </div>
  </article>
{/if}

<style>
  .loading {
    display: grid;
    place-items: center;
    height: 60vh;
    color: var(--text-3);
  }
  .top {
    position: relative;
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 44px;
    padding: 24px 40px 44px;
    isolation: isolate;
    margin-top: -60px;
    padding-top: 84px;
  }
  .wash {
    position: absolute;
    inset: 0 0 -80px;
    z-index: -1;
    background-size: cover;
    background-position: center 30%;
    filter: blur(80px) saturate(1.4);
    opacity: 0.4;
    mask-image: linear-gradient(180deg, #000 30%, transparent);
  }
  .cover {
    align-self: start;
  }
  .cover :global(.cover) {
    box-shadow:
      0 2px 4px rgb(0 0 0 / 0.3),
      0 30px 60px -20px rgb(0 0 0 / 0.65);
  }
  .head {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding-top: 8px;
  }
  .series {
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 10px;
  }
  .series a:hover,
  .people a:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  h1 {
    font-size: var(--t-3xl);
    line-height: 1.04;
    font-weight: 640;
    letter-spacing: -0.03em;
    font-variation-settings: 'opsz' 72;
    text-wrap: balance;
    max-width: 22ch;
  }
  .subtitle {
    margin-top: 8px;
    font-size: var(--t-lg);
    font-style: italic;
    color: var(--text-2);
  }
  .people {
    margin-top: 14px;
    font-size: var(--t-lg);
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 32px;
    margin: 24px 0 0;
  }
  .facts div {
    display: flex;
    flex-direction: column;
  }
  dt {
    font-size: var(--t-xs);
    color: var(--text-3);
  }
  dd {
    margin: 2px 0 0;
    font-size: var(--t-md);
    font-weight: 550;
  }
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
  .icon-btn[aria-pressed='true'] {
    color: var(--accent);
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
  .body:has(.about:only-child) {
    grid-template-columns: minmax(0, 1fr);
  }
  .desc {
    font-size: 1.0625rem;
    line-height: 1.68;
    max-width: 68ch;
    color: color-mix(in srgb, var(--text) 88%, transparent);
  }
  .desc :global(p + p) {
    margin-top: 0.9em;
  }
  .desc :global(a) {
    color: var(--accent);
    text-decoration: underline;
  }
  .desc.clamped {
    max-height: 16.5em;
    overflow: hidden;
    mask-image: linear-gradient(180deg, #000 60%, transparent);
  }
  .more {
    margin-top: 10px;
    font-weight: 650;
    font-size: var(--t-sm);
    color: var(--accent);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 28px;
  }
  .tag {
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--raised-2);
    font-size: var(--t-sm);
    font-weight: 550;
  }
  .tag.quiet {
    background: none;
    border: 1px solid var(--rule);
    color: var(--text-2);
  }
  .tag:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  h2 {
    font-size: var(--t-lg);
    font-weight: 620;
    margin-bottom: 10px;
  }
  .chapters {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 520px;
    overflow-y: auto;
    border-top: 1px solid var(--rule-soft);
  }
  .ch {
    display: grid;
    grid-template-columns: 30px 1fr auto;
    gap: 8px;
    align-items: center;
    width: 100%;
    padding: 8px 6px;
    border-bottom: 1px solid var(--rule-soft);
    font-size: var(--t-sm);
    text-align: left;
  }
  .ch:hover {
    background: color-mix(in srgb, var(--text) 4%, transparent);
  }
  .ch.done {
    color: var(--text-3);
  }
  .ch.now {
    color: var(--accent);
    font-weight: 650;
  }
  .ch-i,
  .ch-s {
    color: var(--text-3);
    font-size: var(--t-xs);
    display: inline-flex;
  }
  .ch-t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .ep-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 40px;
  }
  .episodes {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
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
  .none {
    padding: 20px 0;
  }

  @media (max-width: 1180px) {
    .body {
      grid-template-columns: 1fr;
    }
    .top {
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 32px;
    }
  }
</style>
