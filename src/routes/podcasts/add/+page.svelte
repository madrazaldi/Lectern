<script lang="ts">
  import { ArrowLeft, Mic, Rss, Search } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import * as abs from '$lib/api/abs';
  import type { PodcastSearchResult } from '$lib/api/types';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { date, plain, plural } from '$lib/util/format';
  import { podcastPath, podcastPermissions } from '$lib/util/podcastFeed';
  import { resource } from '$lib/util/resource.svelte';
  import { pageTitle } from '$lib/util/title';

  /**
   * Add a podcast to a podcast library: find it by name (iTunes, through the server) or by its RSS feed, look
   * over what the feed holds, pick where it's stored, and create it. The same request the web app sends.
   */
  const perms = $derived(podcastPermissions(session.user));
  const libraries = $derived(session.libraries.filter((l) => l.mediaType === 'podcast'));
  let libraryId = $state(
    session.library?.mediaType === 'podcast' ? session.library.id : (session.libraries.find((l) => l.mediaType === 'podcast')?.id ?? null)
  );

  let text = $state('');
  /** What was last submitted: a search term, or a feed URL to preview. */
  let term = $state('');
  let feedUrl = $state('');
  /** The search result the feed came from, if any; its metadata is richer than most feeds'. */
  let picked = $state<PodcastSearchResult | null>(null);

  const looksLikeUrl = $derived(/^(https?:\/\/|[\w-]+(\.[\w-]+)+\/)/i.test(text.trim()));

  const found = resource(() => term || null, {
    id: (k) => `podcast-search:${k}`,
    load: (k, signal) => abs.searchPodcasts(k, signal)
  });
  const feed = resource(() => feedUrl || null, {
    id: (k) => `podcast-feed:${k}`,
    load: (k, signal) => abs.getPodcastFeed(k, signal),
    freshFor: 5 * 60_000
  });
  const library = resource(() => libraryId, {
    id: (k) => `library-folders:${k}`,
    load: (k, signal) => abs.getLibrary(k, signal)
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    if (looksLikeUrl) {
      picked = null;
      feedUrl = /^https?:\/\//i.test(q) ? q : `https://${q}`;
    } else {
      feedUrl = '';
      term = q;
    }
  }

  function pick(r: PodcastSearchResult) {
    if (!r.feedUrl) {
      toast(`${r.title} has no public RSS feed, so the server can't follow it.`, { tone: 'error' });
      return;
    }
    picked = r;
    feedUrl = r.feedUrl;
  }

  function back() {
    feedUrl = '';
    picked = null;
  }

  // The form, filled from the feed (and the search result) each time a different one is previewed.
  let title = $state('');
  let author = $state('');
  let folderId = $state<string | null>(null);
  let autoDownload = $state(false);
  let creating = $state(false);

  // Once per feed: a background refresh of the same feed mustn't undo edits.
  let filledFor = '';
  $effect(() => {
    const f = feed.data;
    if (!f || filledFor === feedUrl) return;
    filledFor = feedUrl;
    title = picked?.title || f.metadata.title || '';
    author = picked?.artistName || f.metadata.author || '';
    autoDownload = false;
  });

  const folders = $derived(library.data?.folders ?? []);
  $effect(() => {
    if (!folders.some((f) => f.id === folderId)) folderId = folders[0]?.id ?? null;
  });
  const folder = $derived(folders.find((f) => f.id === folderId) ?? null);
  const path = $derived(folder ? podcastPath(folder.fullPath, title) : '');

  const preview = $derived.by(() => {
    const f = feed.data;
    if (!f || !feedUrl) return null;
    const newest = f.episodes.reduce((max, ep) => Math.max(max, ep.publishedAt ?? 0), 0);
    return {
      cover: picked?.cover || f.metadata.image || null,
      description: plain(picked?.description || f.metadata.description || f.metadata.descriptionPlain || ''),
      facts: [
        plural(f.episodes.filter((ep) => ep.enclosure?.url).length, 'episode'),
        newest && `latest ${date(newest)}`,
        f.metadata.language,
        (picked?.genres?.length ? picked.genres : f.metadata.categories).slice(0, 3).join(', ')
      ]
        .filter(Boolean)
        .join(' · ')
    };
  });

  async function create(e: SubmitEvent) {
    e.preventDefault();
    const f = feed.data;
    if (!f || !folder || !path || !libraryId || creating) return;
    creating = true;
    try {
      const item = await abs.createPodcast({
        path,
        folderId: folder.id,
        libraryId,
        media: {
          metadata: {
            title: title.trim(),
            author: author.trim(),
            description: picked?.description || f.metadata.descriptionPlain || '',
            releaseDate: picked?.releaseDate || '',
            genres: [...(picked?.genres?.length ? picked.genres : f.metadata.categories)],
            feedUrl: picked?.feedUrl || f.metadata.feedUrl || feedUrl,
            imageUrl: picked?.cover || f.metadata.image || '',
            itunesPageUrl: picked?.pageUrl || '',
            itunesId: picked ? String(picked.id) : '',
            itunesArtistId: picked?.artistId ? String(picked.artistId) : '',
            language: f.metadata.language || '',
            explicit: picked?.explicit || f.metadata.explicit === 'yes' || f.metadata.explicit === 'true',
            type: f.metadata.type || 'episodic'
          },
          autoDownloadEpisodes: autoDownload
        }
      });
      toast(`Added ${item.media.metadata.title}.`);
      // A new podcast has no episodes yet: go straight to choosing some.
      void goto(`/item/${item.id}${perms.download && f.episodes.length ? '?find=1' : ''}`);
    } catch (err) {
      toast(`Couldn't add the podcast. ${errorMessage(err)}`, { tone: 'error' });
    } finally {
      creating = false;
    }
  }
</script>

<svelte:head><title>{pageTitle(feed.data?.metadata.title, 'Add a podcast')}</title></svelte:head>

<div class="page add">
  <header class="head">
    <h1 class="page-title">Add a podcast</h1>
    {#if libraries.length > 1}
      <select class="select" bind:value={libraryId} aria-label="Library">
        {#each libraries as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
    {/if}
  </header>

  {#if !perms.manage}
    <EmptyState title="Only admins can add podcasts">
      <p>Ask the server's admin to add the show, or to give your account admin rights.</p>
    </EmptyState>
  {:else if !libraryId}
    <EmptyState title="No podcast library">
      <p>This server has no podcast library to add shows to. One can be created in the Audiobookshelf web app.</p>
    </EmptyState>
  {:else}
    <form class="find" onsubmit={submit}>
      <label class="box">
        {#if looksLikeUrl}<Rss size={16} aria-hidden="true" />{:else}<Search size={16} aria-hidden="true" />{/if}
        <input
          type="text"
          bind:value={text}
          placeholder="Search by name, or paste an RSS feed URL"
          aria-label="Search by name, or paste an RSS feed URL"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <button class="btn btn-primary" disabled={!text.trim()}>{looksLikeUrl ? 'Preview feed' : 'Search'}</button>
    </form>

    {#if feedUrl}
      <button class="back link" onclick={back}><ArrowLeft size={15} /> {term ? 'Back to results' : 'Start over'}</button>
      {#if feed.error}
        <ErrorState title="Couldn't read that feed" message={feed.error} cause={feed.cause} onretry={() => feed.refresh()}>
          <p class="faint">The server fetches the feed itself, so the address has to be reachable from the server.</p>
        </ErrorState>
      {:else if !feed.data || !preview}
        <Loading label="Reading the feed" />
      {:else}
        <section class="preview" aria-labelledby="preview-h">
          <div class="art">
            {#if preview.cover}<img src={preview.cover} alt="" />{:else}<div class="blank"><Mic size={40} /></div>{/if}
          </div>
          <div class="about">
            <h2 class="serif" id="preview-h">{feed.data.metadata.title || title}</h2>
            {#if author}<p class="by">{author}</p>{/if}
            <p class="facts faint num">{preview.facts}</p>
            {#if preview.description}<p class="desc">{preview.description}</p>{/if}
            <p class="url faint selectable">{feedUrl}</p>
          </div>
        </section>

        <form class="create" onsubmit={create}>
          <label class="row">
            <span>Title</span>
            <input class="field" bind:value={title} required />
          </label>
          <label class="row">
            <span>Author</span>
            <input class="field" bind:value={author} />
          </label>
          <div class="row">
            <span id="folder-l">Folder</span>
            {#if library.error}
              <span class="faint" role="alert"
                >Couldn't read the library's folders. <button type="button" class="link" onclick={() => library.refresh()}>Try again</button></span
              >
            {:else if folders.length > 1}
              <select class="select" bind:value={folderId} aria-labelledby="folder-l">
                {#each folders as f (f.id)}<option value={f.id}>{f.fullPath}</option>{/each}
              </select>
            {:else}
              <span class="num">{folder?.fullPath ?? '…'}</span>
            {/if}
          </div>
          {#if path}<p class="path faint">Saved in <span class="selectable">{path}</span></p>{/if}
          <label class="check">
            <input type="checkbox" bind:checked={autoDownload} />
            <span>Download new episodes automatically <span class="faint">(the server checks on its schedule)</span></span>
          </label>
          <div class="go">
            <button class="btn btn-primary btn-lg" disabled={creating || !path || !title.trim()}>{creating ? 'Adding…' : 'Add podcast'}</button>
          </div>
        </form>
      {/if}
    {:else if term}
      {#if found.error}
        <ErrorState title="Couldn't search for podcasts" message={found.error} cause={found.cause} onretry={() => found.refresh()} />
      {:else if !found.data}
        <Loading label="Searching" />
      {:else if !found.data.length}
        <EmptyState title="No podcasts found">
          <p>Nothing matches “{term}”. Try another name, or paste the show's RSS feed address.</p>
        </EmptyState>
      {:else}
        <ul class="results" aria-label="Search results">
          {#each found.data as r, i (`${r.id}:${i}`)}
            <li>
              <button class="result" onclick={() => pick(r)} disabled={!r.feedUrl}>
                {#if r.cover}<img src={r.cover} alt="" loading="lazy" />{:else}<span class="blank"><Mic size={20} /></span>{/if}
                <span class="r-text">
                  <span class="r-title">{r.title}</span>
                  <span class="faint">{r.artistName}</span>
                  <span class="faint num">{r.trackCount ? plural(r.trackCount, 'episode') : ''}{r.genres[0] ? ` · ${r.genres[0]}` : ''}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .add {
    max-width: 960px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .find {
    display: flex;
    gap: 10px;
    margin: 22px 0 26px;
  }
  .box {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 44px;
    padding: 0 16px;
    border-radius: 999px;
    border: 1px solid var(--rule);
    background: var(--raised);
    color: var(--text-3);
  }
  .box:focus-within {
    border-color: var(--accent);
  }
  .box input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    font-size: var(--t-md);
    color: var(--text);
    user-select: text;
  }
  .find .btn {
    height: 44px;
  }
  .link {
    color: var(--accent);
    font-weight: 650;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 18px;
    font-size: var(--t-sm);
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .result {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 10px;
    border-radius: var(--r-md);
    text-align: left;
  }
  .result:hover:not(:disabled) {
    background: var(--raised);
  }
  .result:disabled {
    opacity: 0.5;
  }
  .result img,
  .result .blank {
    flex: none;
    width: 56px;
    height: 56px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--raised-2);
  }
  .blank {
    display: grid;
    place-items: center;
    color: var(--text-3);
  }
  .r-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: var(--t-sm);
  }
  .r-title {
    font-size: var(--t-md);
    font-weight: 620;
  }
  .preview {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 28px;
  }
  .art img,
  .art .blank {
    width: 180px;
    height: 180px;
    border-radius: var(--r-md);
    object-fit: cover;
    background: var(--raised-2);
    box-shadow: var(--shadow-cover);
  }
  .about h2 {
    font-size: var(--t-xl);
    font-weight: 620;
    line-height: 1.15;
  }
  .by {
    margin-top: 6px;
    font-size: var(--t-md);
  }
  .facts {
    margin-top: 8px;
    font-size: var(--t-sm);
  }
  .desc {
    margin-top: 12px;
    color: var(--text-2);
    font-size: var(--t-sm);
    display: -webkit-box;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .url {
    margin-top: 10px;
    font-size: var(--t-xs);
    overflow-wrap: anywhere;
  }
  .create {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 30px;
    padding-top: 24px;
    border-top: 1px solid var(--rule-soft);
    max-width: 640px;
  }
  .row {
    display: grid;
    grid-template-columns: 80px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    font-size: var(--t-sm);
  }
  .row > span:first-child {
    color: var(--text-2);
  }
  .row .select {
    justify-self: start;
    max-width: 100%;
  }
  .path {
    margin-left: 92px;
    font-size: var(--t-xs);
    overflow-wrap: anywhere;
  }
  .check {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-top: 4px;
    font-size: var(--t-sm);
  }
  .go {
    margin-top: 8px;
  }
</style>
