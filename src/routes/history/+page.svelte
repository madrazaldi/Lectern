<script module lang="ts">
  import type { HistorySession } from '$lib/api/types';
  import { pagedCache } from '$lib/util/paged.svelte';

  const lists = pagedCache<HistorySession>();
</script>

<script lang="ts">
  import { ArrowLeft, Trash2 } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import type { LibraryItem } from '$lib/api/types';
  import Cover from '$lib/components/Cover.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { canDeleteSessions } from '$lib/util/actions/library';
  import { nearEnd } from '$lib/util/dom';
  import { clock, plural } from '$lib/util/format';
  import { dayLabel, deviceLabel, groupByDay, listened } from '$lib/util/history';
  import { PagedList } from '$lib/util/paged.svelte';
  import { invalidate, peek } from '$lib/util/resource.svelte';
  import { pageTitle } from '$lib/util/title';

  const PER_PAGE = 50;

  const itemId = $derived(page.url.searchParams.get('item'));
  const episodeId = $derived(page.url.searchParams.get('episode'));

  // Per user: the cache outlives a sign-out and back in as someone else.
  const list = new PagedList<{ user: string; itemId: string | null; episodeId: string | null }, HistorySession>({
    cache: lists,
    key: (s) => s.id,
    fetch: (q, n, signal) =>
      abs
        .getListeningSessions({ itemId: q.itemId, episodeId: q.episodeId, page: n, itemsPerPage: PER_PAGE }, signal)
        .then((r) => ({ results: r.sessions, total: r.total })),
    // History changes with every listen; an old snapshot would hide the latest sessions.
    maxAge: 60_000
  });
  const query = () => ({ user: session.user?.id ?? '', itemId, episodeId });
  list.set(untrack(query));
  $effect.pre(() => {
    const q = query();
    untrack(() => list.set(q));
  });
  $effect(() => () => list.dispose());

  const days = $derived(groupByDay(list.items));
  const canDelete = $derived(canDeleteSessions());
  // The title being filtered on: from a session if any arrived, else the item page's cached copy.
  const filterTitle = $derived.by(() => {
    if (!itemId) return null;
    const s = list.items[0];
    if (s) return episodeId ? s.displayTitle : (s.mediaMetadata?.title ?? s.displayTitle);
    return peek<LibraryItem>(`item:${itemId}`)?.media.metadata.title ?? null;
  });

  let confirming = $state<string | null>(null);
  let deleting = $state<string | null>(null);

  function times(s: HistorySession) {
    const fmt = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const start = fmt(s.startedAt);
    const end = fmt(s.updatedAt);
    return start === end ? start : `${start} – ${end}`;
  }

  /** Where in the title listening started and stopped, as fractions of its length (for the range bar). */
  function span(s: HistorySession) {
    if (!s.duration) return null;
    const a = Math.max(0, Math.min(1, s.startTime / s.duration));
    const b = Math.max(0, Math.min(1, s.currentTime / s.duration));
    return { left: Math.min(a, b), width: Math.max(Math.abs(b - a), 0.006) };
  }

  async function remove(s: HistorySession) {
    deleting = s.id;
    try {
      await abs.deleteListeningSession(s.id);
      list.update((items) => items.filter((x) => x.id !== s.id), -1);
      // Stats are computed from these sessions.
      invalidate('stats:');
      toast('Deleted the session from your history.');
    } catch (err) {
      toast(`Couldn't delete the session. ${errorMessage(err)}`, { tone: 'error' });
    } finally {
      deleting = null;
      confirming = null;
    }
  }
</script>

<svelte:head><title>{pageTitle(filterTitle ? `History: ${filterTitle}` : 'Listening history')}</title></svelte:head>

<div class="page">
  <a class="back faint" href="/stats"><ArrowLeft size={15} /> Listening</a>
  <header class="head">
    <h1 class="page-title">Listening history</h1>
    {#if list.total !== null}<span class="faint num">{plural(list.total, 'session')}</span>{/if}
  </header>
  {#if itemId}
    <p class="filter">
      {#if filterTitle}Only <a href="/item/{itemId}">{filterTitle}</a>.{:else}Only one title.{/if}
      <a class="link" href="/history">Show everything</a>
    </p>
  {/if}

  {#if list.error && !list.items.length}
    <ErrorState title="Couldn't load your listening history" message={list.error} cause={list.cause} onretry={() => list.reload()} />
  {:else if list.total === 0}
    <EmptyState title="Nothing here yet">
      <p>{itemId ? 'You haven’t listened to this title yet.' : 'Every time you listen, on any device, it shows up here.'}</p>
    </EmptyState>
  {:else if !list.items.length}
    <Loading label="Loading your listening history" />
  {:else}
    {#each days as day (day.key)}
      <section class="day" aria-labelledby="day-{day.key}">
        <h2 class="serif" id="day-{day.key}">
          {dayLabel(day.date)}
          <span class="day-total faint num">{listened(day.total)}</span>
        </h2>
        <ul class="sessions">
          {#each day.sessions as s (s.id)}
            {@const r = span(s)}
            {@const podcastTitle = s.episodeId ? s.mediaMetadata?.title : null}
            <li class="session">
              <a class="thumb" href="/item/{s.libraryItemId}" tabindex="-1" aria-hidden="true">
                <Cover itemId={s.libraryItemId} title={podcastTitle ?? s.displayTitle} width={96} aspect={1} />
              </a>
              <div class="main">
                <a class="title" href="/item/{s.libraryItemId}">{s.displayTitle}</a>
                <span class="sub faint">{podcastTitle ?? s.displayAuthor}</span>
              </div>
              <div class="where">
                <span class="num">
                  {clock(s.startTime)} → {clock(s.currentTime)}<span class="sr-only">, of {clock(s.duration)}</span>
                </span>
                {#if r}
                  <span class="range" aria-hidden="true"><span style:left="{r.left * 100}%" style:width="{r.width * 100}%"></span></span>
                {/if}
              </div>
              <div class="when">
                <span class="num">{listened(s.timeListening)}<span class="sr-only"> listened</span></span>
                <span class="faint num">{times(s)}</span>
              </div>
              <span class="device faint" title={deviceLabel(s.deviceInfo, s.mediaPlayer)}>{deviceLabel(s.deviceInfo, s.mediaPlayer)}</span>
              {#if canDelete}
                <div class="del">
                  {#if confirming === s.id}
                    <span class="faint">Delete? It stops counting in your stats.</span>
                    <button class="btn btn-quiet" onclick={() => (confirming = null)}>Keep</button>
                    <button class="btn btn-danger" onclick={() => remove(s)} disabled={deleting === s.id}>Delete</button>
                  {:else}
                    <button
                      class="icon-btn"
                      aria-label="Delete this session of {s.displayTitle}"
                      title="Delete from history"
                      onclick={() => (confirming = s.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
    {#if !list.done}
      <div class="sentinel" {@attach nearEnd(() => list.loadMore())}></div>
    {/if}
    {#if list.loading}<Loading inline label="Loading more sessions" />{/if}
    {#if list.error}
      <p class="more-error" role="alert">Couldn't load more sessions. <button class="link" onclick={() => list.loadMore()}>Try again</button></p>
    {/if}
  {/if}
</div>

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-sm);
    margin-bottom: 10px;
  }
  .back:hover {
    color: var(--accent);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .filter {
    margin-top: 8px;
    font-size: var(--t-sm);
    color: var(--text-2);
  }
  .filter a:not(.link) {
    font-weight: 600;
    color: var(--text);
  }
  .filter .link {
    margin-left: 8px;
  }
  .day {
    margin-top: 36px;
    max-width: 1100px;
  }
  h2 {
    display: flex;
    align-items: baseline;
    gap: 12px;
    font-size: var(--t-lg);
    font-weight: 620;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--rule);
  }
  .day-total {
    font-family: var(--font-sans);
    font-size: var(--t-sm);
    font-weight: 400;
  }
  .sessions {
    list-style: none;
    margin: 0;
    padding: 0;
    container-type: inline-size;
  }
  .session {
    display: grid;
    grid-template-columns: 40px minmax(0, 2fr) minmax(130px, 1fr) 120px minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 18px;
    min-height: 64px;
    padding: 8px 4px;
    border-bottom: 1px solid var(--rule-soft);
    font-size: var(--t-sm);
  }
  .thumb {
    display: block;
    width: 40px;
  }
  .main,
  .when,
  .where {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .title {
    font-family: var(--font-serif);
    font-size: var(--t-md);
    font-weight: 560;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title:hover {
    color: var(--accent);
  }
  .sub,
  .device {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .range {
    position: relative;
    display: block;
    height: 4px;
    border-radius: 2px;
    background: var(--raised-2);
    overflow: hidden;
  }
  .range span {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 2px;
    background: var(--accent);
  }
  .when {
    text-align: right;
  }
  .del {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 32px;
  }
  .sentinel {
    height: 1px;
  }
  .more-error {
    margin-top: 16px;
    font-size: var(--t-sm);
  }
  @container (max-width: 760px) {
    .session {
      grid-template-columns: 40px minmax(0, 1fr) 120px auto;
    }
    .where,
    .device {
      display: none;
    }
  }
</style>
