<script module lang="ts">
  import type { LibraryItem, RecentEpisode } from '$lib/api/types';
  import { pagedCache } from '$lib/util/paged.svelte';

  // Loaded pages outlive the page, so Back from an episode's podcast lands on the same list.
  const lists = pagedCache<RecentEpisode>();
</script>

<script lang="ts">
  import { ListEnd, ListX, Pause, Play } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import * as abs from '$lib/api/abs';
  import Cover from '$lib/components/Cover.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import { live } from '$lib/stores/live.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { nearEnd } from '$lib/util/dom';
  import { date, duration, plain, plural } from '$lib/util/format';
  import { itemMenuFor } from '$lib/util/itemMenu';
  import { PagedList } from '$lib/util/paged.svelte';
  import { playOrToggle, toggleQueued } from '$lib/util/play';
  import { pageTitle } from '$lib/util/title';

  /** The newest episodes across a podcast library that haven't been finished, newest first. */
  const PAGE = 30;
  const library = $derived(session.library?.mediaType === 'podcast' ? session.library : (session.libraries.find((l) => l.mediaType === 'podcast') ?? null));

  const list = new PagedList<string, RecentEpisode>({
    cache: lists,
    key: (ep) => ep.id,
    id: (lib) => `recent-episodes:${lib}`,
    fetch: async (lib, page, signal) => {
      const results = await abs.getRecentEpisodes(lib, page, PAGE, signal);
      // The server doesn't count them: a full page means there may be another.
      return { results, total: page * PAGE + results.length + (results.length === PAGE ? 1 : 0) };
    }
  });
  if (untrack(() => library)) list.set(untrack(() => library!.id));
  $effect.pre(() => {
    const id = library?.id;
    if (id) untrack(() => list.set(id));
  });
  $effect(() => () => list.dispose());

  // Finished here (or on another device) since loading: the server would leave them out now, so do the same.
  const shown = $derived(list.items.filter((ep) => !session.progressFor(ep.libraryItemId, ep.id)?.isFinished));

  /** A stand-in library item for the player, Up Next and context menu, which act on items. */
  function itemFor(ep: RecentEpisode): LibraryItem {
    return {
      id: ep.libraryItemId,
      libraryId: ep.libraryId,
      mediaType: 'podcast',
      addedAt: 0,
      updatedAt: 0,
      isMissing: false,
      isInvalid: false,
      media: { ...ep.podcast, episodes: undefined }
    };
  }

  let added = $state(0);
  $effect(() =>
    live.onEpisodeEvent((e) => {
      if (e.type === 'added' && e.episode.libraryItem?.libraryId === library?.id) added++;
    })
  );

  function refresh() {
    added = 0;
    list.reload();
  }
</script>

<svelte:head><title>{pageTitle('Latest episodes', library?.name)}</title></svelte:head>

<div class="page latest">
  <header class="head">
    <h1 class="page-title">Latest episodes</h1>
    {#if library}<a class="faint lib" href="/library">{library.name}</a>{/if}
    {#if added}<button class="fresh" onclick={refresh}>{plural(added, 'new episode')} · Refresh</button>{/if}
  </header>

  {#if !library}
    <EmptyState title="No podcast library"><p>This server has no podcast library.</p></EmptyState>
  {:else if list.error && !list.items.length}
    <ErrorState title="Couldn't load the latest episodes" message={list.error} cause={list.cause} onretry={() => list.reload()} />
  {:else if list.total === 0 || (list.done && !shown.length)}
    <EmptyState title="All caught up">
      <p>Every episode in {library.name} has been played.</p>
    </EmptyState>
  {:else if !list.items.length}
    <Loading label="Loading episodes" />
  {:else}
    <ol class="list">
      {#each shown as ep (ep.id)}
        {@const item = itemFor(ep)}
        {@const p = session.progressFor(ep.libraryItemId, ep.id)}
        {@const on = player.isCurrent(ep.libraryItemId, ep.id)}
        {@const playing = on && player.isPlaying}
        {@const queued = player.inQueue(ep.libraryItemId, ep.id)}
        <li class="row" class:on {@attach itemMenuFor(() => ({ item, episode: ep }))}>
          <a class="art" href="/item/{ep.libraryItemId}" tabindex="-1" aria-hidden="true">
            <Cover itemId={ep.libraryItemId} title={ep.podcast.metadata.title} width={120} aspect={1} hasCover={!!ep.podcast.coverPath} />
          </a>
          <div class="main">
            <span class="meta faint"><a href="/item/{ep.libraryItemId}">{ep.podcast.metadata.title}</a> · {date(ep.publishedAt)}</span>
            <span class="title">{ep.title}</span>
            {#if ep.description}<span class="desc">{plain(ep.description)}</span>{/if}
            {#if p && !p.isFinished && p.progress > 0}<div class="prog"><Progress value={p.progress} label="{ep.title}: listened" /></div>{/if}
          </div>
          <div class="side">
            <span class="faint num">{ep.duration ? duration(ep.duration, { short: true }) : ''}</span>
            {#if !on}
              <button
                class="icon-btn"
                onclick={() => toggleQueued(item, ep)}
                aria-pressed={queued}
                aria-label="Up Next"
                title={queued ? 'Remove from Up Next' : 'Add to Up Next'}
              >
                {#if queued}<ListX size={17} />{:else}<ListEnd size={17} />{/if}
              </button>
            {/if}
            <button class="play" onclick={() => playOrToggle(ep.libraryItemId, ep.id)} aria-label={playing ? `Pause ${ep.title}` : `Play ${ep.title}`}>
              {#if playing}<Pause size={16} fill="currentColor" strokeWidth={0} />{:else}<Play size={16} fill="currentColor" strokeWidth={0} />{/if}
            </button>
          </div>
        </li>
      {/each}
    </ol>
    {#if !list.done}
      {#key list.items.length}
        <div class="more" {@attach nearEnd(() => list.loadMore())}>
          {#if list.error}
            <p role="alert">Couldn't load more episodes. <button class="link" onclick={() => list.loadMore()}>Try again</button></p>
          {:else if list.loading}
            <Loading label="Loading more episodes" inline size={20} />
          {:else}
            <button class="btn btn-quiet" onclick={() => list.loadMore()}>Show more</button>
          {/if}
        </div>
      {/key}
    {/if}
  {/if}
</div>

<style>
  .latest {
    max-width: 1100px;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-bottom: 18px;
  }
  .lib {
    font-size: var(--t-sm);
  }
  .lib:hover {
    color: var(--text);
  }
  .fresh,
  .link {
    font-size: var(--t-sm);
    font-weight: 650;
    color: var(--accent);
  }
  .fresh:hover {
    text-decoration: underline;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;
    padding: 14px 0;
    border-bottom: 1px solid var(--rule-soft);
  }
  .art {
    width: 64px;
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .meta {
    font-size: var(--t-xs);
  }
  .meta a:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .title {
    font-weight: 620;
  }
  .row.on .title {
    color: var(--accent);
  }
  .desc {
    font-size: var(--t-sm);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .prog {
    margin-top: 4px;
    max-width: 240px;
  }
  .side {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--t-sm);
  }
  .play {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid var(--rule);
    color: var(--text);
  }
  .play:hover,
  .row.on .play {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .more {
    display: flex;
    justify-content: center;
    padding: 24px 0;
    font-size: var(--t-sm);
    color: var(--text-2);
  }
</style>
