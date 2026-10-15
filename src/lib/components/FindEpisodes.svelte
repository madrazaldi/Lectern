<script lang="ts">
  import { Search, X } from '@lucide/svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import * as abs from '$lib/api/abs';
  import type { LibraryItem, PodcastMedia, ServerEpisode } from '$lib/api/types';
  import { episodeDownloads } from '$lib/stores/episodeDownloads.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { containKeys } from '$lib/util/confirm';
  import { date, duration, plural } from '$lib/util/format';
  import { feedEntries } from '$lib/util/podcastFeed';
  import { resource } from '$lib/util/resource.svelte';
  import ErrorState from './ErrorState.svelte';
  import Loading from './Loading.svelte';
  import Modal from './Modal.svelte';

  /**
   * The podcast's feed, with what the server doesn't have yet ready to pick and download to it. Episodes
   * already there or on their way are shown but can't be picked; both update live as downloads finish.
   */
  let { podcast, onclose }: { podcast: LibraryItem & { media: PodcastMedia }; onclose: () => void } = $props();

  const PAGE = 100;
  const feedUrl = $derived(podcast.media.metadata.feedUrl);

  const feed = resource(() => feedUrl, {
    id: (k) => `podcast-feed:${k}`,
    load: (k, signal) => abs.getPodcastFeed(k, signal)
  });

  const pending = $derived.by(() => {
    const q = episodeDownloads.forItem(podcast.id);
    return q.current ? [q.current, ...q.queued] : q.queued;
  });
  const entries = $derived(feed.data ? feedEntries(feed.data.episodes, (podcast.media.episodes ?? []) as ServerEpisode[], pending) : []);
  const fresh = $derived(entries.filter((e) => e.state === 'new'));

  let query = $state('');
  let limit = $state(PAGE);
  const shown = $derived.by(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? entries.filter((e) => `${e.episode.title} ${e.episode.subtitle ?? ''}`.toLocaleLowerCase().includes(q)) : entries;
  });

  const selected = new SvelteSet<string>();
  // Something picked can turn up on the server meanwhile (another admin, auto-download): drop it.
  $effect(() => {
    const open = new Set(fresh.map((e) => e.key));
    for (const k of selected) if (!open.has(k)) selected.delete(k);
  });

  const shownFresh = $derived(shown.filter((e) => e.state === 'new'));
  const allShownPicked = $derived(shownFresh.length > 0 && shownFresh.every((e) => selected.has(e.key)));

  function toggleAll() {
    if (allShownPicked) for (const e of shownFresh) selected.delete(e.key);
    else for (const e of shownFresh) selected.add(e.key);
  }

  let sending = $state(false);
  async function download(close: () => void) {
    const picked = fresh.filter((e) => selected.has(e.key)).map((e) => e.episode);
    if (!picked.length) return;
    sending = true;
    try {
      // Oldest first, so the server adds them in the order they came out.
      await abs.downloadEpisodes(
        podcast.id,
        picked.toSorted((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0))
      );
      toast(`Downloading ${plural(picked.length, 'episode')} to the server.`);
      close();
    } catch (err) {
      toast(`Couldn't start the download. ${errorMessage(err)}`, { tone: 'error' });
    } finally {
      sending = false;
    }
  }
</script>

<Modal label="Find episodes of {podcast.media.metadata.title}" width={680} {onclose}>
  {#snippet children({ close })}
    <div class="find" {@attach containKeys}>
      <header>
        <div>
          <h2 class="serif">Find episodes</h2>
          <p class="faint">{podcast.media.metadata.title}</p>
        </div>
        <button class="icon-btn" onclick={close} aria-label="Close"><X size={18} /></button>
      </header>

      {#if !feedUrl}
        <p class="muted">This podcast has no RSS feed to look in.</p>
      {:else if feed.error}
        <ErrorState title="Couldn't read the feed" message={feed.error} cause={feed.cause} onretry={() => feed.refresh()} />
      {:else if !feed.data}
        <div class="wait"><Loading label="Reading the feed" inline /></div>
      {:else}
        <div class="tools">
          <label class="search">
            <Search size={14} aria-hidden="true" />
            <input
              type="text"
              placeholder="Search the feed"
              aria-label="Search the feed"
              autocomplete="off"
              spellcheck="false"
              bind:value={query}
              oninput={() => (limit = PAGE)}
            />
          </label>
          <label class="all">
            <input type="checkbox" checked={allShownPicked} disabled={!shownFresh.length} onchange={toggleAll} />
            {query.trim() ? `Select ${plural(shownFresh.length, 'match', 'matches')}` : `Select all ${plural(fresh.length, 'new episode')}`}
          </label>
        </div>
        <p class="sum faint num" aria-live="polite">
          {plural(entries.length, 'episode')} in the feed · {fresh.length.toLocaleString()} not on the server{#if pending.length}
            · {pending.length.toLocaleString()} downloading{/if}
        </p>

        <ul class="list" aria-label="Feed episodes">
          {#each shown.slice(0, limit) as e (e.key)}
            {@const ep = e.episode}
            <li class:off={e.state !== 'new'}>
              <label>
                <input
                  type="checkbox"
                  disabled={e.state !== 'new'}
                  checked={e.state !== 'new' || selected.has(e.key)}
                  onchange={() => (selected.has(e.key) ? selected.delete(e.key) : selected.add(e.key))}
                />
                <span class="text">
                  <span class="title">{ep.title}</span>
                  <span class="meta faint num">
                    {[
                      date(ep.publishedAt),
                      ep.season && `season ${ep.season}`,
                      ep.episode && `episode ${ep.episode}`,
                      ep.durationSeconds && duration(ep.durationSeconds, { short: true })
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {#if e.state === 'downloaded'}<span class="badge">On server</span>{:else if e.state === 'queued'}<span class="badge">Downloading</span>{/if}
              </label>
            </li>
          {:else}
            <li class="none faint">{query ? `Nothing in the feed matches “${query.trim()}”.` : 'The feed lists no episodes.'}</li>
          {/each}
        </ul>
        {#if shown.length > limit}
          <div class="more">
            <button class="btn btn-quiet" onclick={() => (limit += PAGE)}>Show more ({(shown.length - limit).toLocaleString()} left)</button>
          </div>
        {/if}

        <footer>
          <button class="btn btn-quiet" onclick={close}>Cancel</button>
          <button class="btn btn-primary" disabled={!selected.size || sending} onclick={() => download(close)}>
            {selected.size ? `Download ${plural(selected.size, 'episode')} to server` : 'Pick episodes to download'}
          </button>
        </footer>
      {/if}
    </div>
  {/snippet}
</Modal>

<style>
  .find {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }
  h2 {
    font-size: var(--t-xl);
    font-weight: 600;
  }
  header p {
    font-size: var(--t-sm);
  }
  .wait {
    display: grid;
    place-items: center;
    padding: 48px 0;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 240px;
    height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--rule);
    background: var(--raised);
    color: var(--text-3);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    font-size: var(--t-sm);
    color: var(--text);
  }
  .all {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--t-sm);
  }
  .sum {
    font-size: var(--t-xs);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--rule-soft);
  }
  .list li {
    border-bottom: 1px solid var(--rule-soft);
  }
  .list label {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 10px 4px;
    cursor: pointer;
  }
  .off label {
    cursor: default;
  }
  .off .title {
    color: var(--text-2);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    font-size: var(--t-sm);
  }
  .meta {
    font-size: var(--t-xs);
  }
  .badge {
    font-size: var(--t-xs);
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--raised);
    color: var(--text-2);
  }
  .none {
    padding: 20px 4px;
    font-size: var(--t-sm);
  }
  .more {
    display: flex;
    justify-content: center;
  }
  footer {
    position: sticky;
    bottom: -18px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin: 0 -18px -18px;
    padding: 12px 18px;
    background: var(--raised-2);
    border-top: 1px solid var(--rule);
  }
</style>
