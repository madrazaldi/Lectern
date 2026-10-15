<script module lang="ts">
  import type { LibraryItem } from '$lib/api/types';
  import { pagedCache } from '$lib/util/paged.svelte';

  // Loaded pages per query outlive the page, so Back lands on the same list (and the layout can restore the scroll).
  const lists = pagedCache<LibraryItem>();
  // One shuffle order per library for the session, until "Shuffle again".
  const seeds = new Map<string, number>();
</script>

<script lang="ts">
  import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, Layers, List, Search, Shuffle, X } from '@lucide/svelte';
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import { request } from '$lib/api/client';
  import type { FilterData, SearchResults } from '$lib/api/types';
  import CardSkeleton from '$lib/components/CardSkeleton.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import FilterMenu from '$lib/components/FilterMenu.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import ItemRow from '$lib/components/ItemRow.svelte';
  import VirtualGrid from '$lib/components/VirtualGrid.svelte';
  import { live } from '$lib/stores/live.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { plural } from '$lib/util/format';
  import { PagedList } from '$lib/util/paged.svelte';
  import { resource } from '$lib/util/resource.svelte';
  import { roving } from '$lib/util/roving';
  import { newSeed, shuffled } from '$lib/util/shuffle';
  import { pageTitle } from '$lib/util/title';

  const PAGE = 60;
  const library = session.library!;
  const isBooks = library.mediaType === 'book';

  const sorts = isBooks
    ? [
        { value: 'media.metadata.title', label: 'Title' },
        { value: 'media.metadata.authorNameLF', label: 'Author' },
        { value: 'addedAt', label: 'Date added' },
        { value: 'media.metadata.publishedYear', label: 'Published' },
        { value: 'media.duration', label: 'Length' },
        { value: 'progress', label: 'Last listened' },
        { value: 'random', label: 'Shuffle' }
      ]
    : [
        { value: 'media.metadata.title', label: 'Title' },
        { value: 'media.metadata.author', label: 'Author' },
        { value: 'addedAt', label: 'Date added' },
        { value: 'media.numTracks', label: 'Episodes' }
      ];

  const progressFilters = [
    { value: '', label: 'Everything' },
    { value: 'not-started', label: 'Not started' },
    { value: 'in-progress', label: 'In progress' },
    { value: 'finished', label: 'Finished' }
  ];

  interface Query {
    library: string;
    filter: string;
    sort: string;
    desc: boolean;
    collapse: boolean;
    seed: number | null;
  }

  const keyOf = (it: LibraryItem) => it.collapsedSeries?.id ?? it.id;

  const list = new PagedList<Query, LibraryItem>({
    cache: lists,
    key: keyOf,
    fetch: async (q, n, signal) => {
      const base = { filter: q.filter || undefined, collapseseries: q.collapse };
      if (q.seed !== null) {
        // The server reshuffles on every request, so paging through sort=random repeats some titles and skips
        // others. Take the whole filtered set once and shuffle it here; the seed keeps the order for Back.
        const all = await abs.getLibraryItems(q.library, { ...base, sort: 'media.metadata.title', limit: 0 }, signal);
        return { results: shuffled(all.results, q.seed), total: all.results.length };
      }
      return abs.getLibraryItems(q.library, { ...base, sort: q.sort, desc: q.desc, page: n, limit: PAGE }, signal);
    }
  });

  let filterData = $state<FilterData | null>(null);
  const initialSeed = seeds.get(library.id) ?? newSeed();
  seeds.set(library.id, initialSeed);
  let seed = $state(initialSeed);

  // Filters and the title search live in the URL: other pages link straight into a filtered view, and Back restores both.
  const filter = $derived(page.url.searchParams.get('filter') ?? '');
  const filterLabel = $derived(page.url.searchParams.get('label') ?? '');
  const term = $derived((page.url.searchParams.get('q') ?? '').trim());
  const progressValue = $derived(filter.startsWith('progress.') ? atob(filter.slice(9)) : '');
  const sort = $derived(sorts.some((s) => s.value === prefs.librarySort) ? prefs.librarySort : 'media.metadata.title');
  const shuffling = $derived(sort === 'random');
  const searching = $derived(term !== '');
  const listView = $derived(prefs.libraryView === 'list');
  const collapsing = $derived(isBooks && prefs.collapseSeries && !filter && !searching);

  const query = $derived<Query>({
    library: library.id,
    filter,
    sort,
    desc: prefs.librarySortDesc,
    collapse: isBooks && prefs.collapseSeries && !filter,
    seed: shuffling ? seed : null
  });
  // Synchronously first, so a remembered list is there for the very first render.
  list.set(untrack(() => query));
  $effect.pre(() => {
    const q = query;
    untrack(() => list.set(q));
  });
  $effect(() => () => list.dispose());

  // Title search. abs.search is capped at 12 results; a library view wants more.
  const found = resource(() => (term ? { library: library.id, q: term } : null), {
    id: (k) => `library-search:${k.library}:${k.q}`,
    load: (k, signal) =>
      request<SearchResults>(`/api/libraries/${k.library}/search`, { query: { q: k.q, limit: 100 }, signal }).then(
        (res) => (isBooks ? res.book : res.podcast)?.map((r) => r.libraryItem) ?? []
      )
  });

  const shown = $derived(searching ? (found.data ?? []) : list.items);
  const count = $derived(searching ? (found.data ? found.data.length : null) : list.total);

  // The box follows the URL (Back to a filtered list shows its text) without fighting the person typing.
  let text = $state(untrack(() => page.url.searchParams.get('q') ?? ''));
  let debounce: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const t = term;
    untrack(() => {
      if (t !== text.trim()) text = t;
    });
  });

  function setParams(patch: Record<string, string>) {
    const url = new URL(page.url);
    for (const [k, v] of Object.entries(patch)) {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function onText() {
    clearTimeout(debounce);
    const q = text.trim();
    debounce = setTimeout(() => setParams({ q }), q ? 250 : 0);
  }

  function clearText() {
    clearTimeout(debounce);
    text = '';
    setParams({ q: '' });
  }

  function setFilter(value: string, label = '') {
    setParams({ filter: value, label });
  }

  function reshuffle() {
    seed = newSeed();
    seeds.set(library.id, seed);
  }

  onMount(() => {
    if (isBooks)
      abs
        .getFilterData(library.id)
        .then((d) => (filterData = d))
        .catch(() => {});
    return () => clearTimeout(debounce);
  });

  // Titles added on the server since this list loaded; offered as a refresh rather than shifting the grid under the reader.
  let added = $state(0);
  $effect(() => {
    void query;
    added = 0;
  });

  $effect(() =>
    live.onItemChange((change, it) => {
      if (it.libraryId !== library.id) return;
      if (change === 'added') added++;
      else if (change === 'removed') list.update((items) => items.filter((x) => x.id !== it.id), -1);
      else list.update((items) => items.map((x) => (x.id === it.id && !x.collapsedSeries ? it : x)));
    })
  );

  function refresh() {
    added = 0;
    if (shuffling) reshuffle();
    else list.reload();
  }
</script>

<svelte:head><title>{pageTitle(filterLabel || (searching ? `“${term}”` : ''), library.name)}</title></svelte:head>

<div class="page">
  <header class="head">
    <h1 class="page-title">{filterLabel || library.name}</h1>
    {#if count !== null}
      <span class="count faint num">{searching ? plural(count, 'result') : `${count.toLocaleString()} ${count === 1 ? 'title' : 'titles'}`}</span>
    {/if}
    {#if added && !searching}
      <button class="fresh" onclick={refresh}>{plural(added, 'new title')} added · Refresh</button>
    {/if}
  </header>

  <div class="toolbar">
    <label class="find">
      <Search size={14} aria-hidden="true" />
      <input
        type="text"
        placeholder="Filter titles"
        aria-label="Filter titles"
        autocomplete="off"
        spellcheck="false"
        bind:value={text}
        oninput={onText}
        onkeydown={(e) => {
          if (e.key === 'Escape' && text) {
            e.stopPropagation();
            clearText();
          }
        }}
      />
      {#if text}
        <button class="x" onclick={clearText} aria-label="Clear filter text"><X size={14} /></button>
      {/if}
    </label>

    {#if isBooks}
      <div class="filters" class:off={searching} inert={searching}>
        <div class="chips" role="radiogroup" aria-label="Listening status" {@attach roving()}>
          {#each progressFilters as f (f.value)}
            <button
              class="chip"
              role="radio"
              aria-checked={progressValue === f.value && (f.value !== '' || !filter)}
              onclick={() => setFilter(f.value ? abs.encodeFilter('progress', f.value) : '')}>{f.label}</button
            >
          {/each}
        </div>
        <FilterMenu {filterData} active={filter} onselect={setFilter} />
        {#if filter && !filter.startsWith('progress.')}
          <button class="chip on" onclick={() => setFilter('')} aria-label="Remove filter: {filterLabel || 'Filtered'}"
            >{filterLabel || 'Filtered'} <X size={13} /></button
          >
        {/if}
      </div>
    {/if}

    <div class="spacer"></div>

    {#if isBooks}
      <button
        class="icon-btn"
        aria-pressed={prefs.collapseSeries}
        onclick={() => (prefs.collapseSeries = !prefs.collapseSeries)}
        title={prefs.collapseSeries ? 'Show every book' : 'Group books by series'}
        aria-label="Group books by series"
        disabled={!!filter || searching}><Layers size={18} /></button
      >
    {/if}
    <div class="seg" role="group" aria-label="View">
      <button class="icon-btn" aria-pressed={!listView} onclick={() => (prefs.libraryView = 'grid')} title="Grid" aria-label="Grid view"
        ><LayoutGrid size={18} /></button
      >
      <button class="icon-btn" aria-pressed={listView} onclick={() => (prefs.libraryView = 'list')} title="List" aria-label="List view"
        ><List size={18} /></button
      >
    </div>
    <div class="sort">
      <select class="select" aria-label="Sort by" value={sort} disabled={searching} onchange={(e) => (prefs.librarySort = e.currentTarget.value)}>
        {#each sorts as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
      </select>
      {#if shuffling}
        <button class="icon-btn" onclick={reshuffle} disabled={searching} aria-label="Shuffle again" title="Shuffle again"><Shuffle size={18} /></button>
      {:else}
        <button
          class="icon-btn"
          onclick={() => (prefs.librarySortDesc = !prefs.librarySortDesc)}
          disabled={searching}
          aria-label={prefs.librarySortDesc ? 'Sort descending' : 'Sort ascending'}
          title={prefs.librarySortDesc ? 'Descending' : 'Ascending'}
        >
          {#if prefs.librarySortDesc}<ArrowDownWideNarrow size={18} />{:else}<ArrowUpNarrowWide size={18} />{/if}
        </button>
      {/if}
    </div>
  </div>

  {#if searching && found.error}
    <ErrorState title="Couldn't search this library" message={found.error} cause={found.cause} onretry={() => found.refresh()} />
  {:else if !searching && list.error && !list.items.length}
    <ErrorState title="Couldn't load this library" message={list.error} cause={list.cause} onretry={() => list.loadMore()} />
  {:else if searching && found.data && found.data.length === 0}
    <EmptyState title="No matches">
      <p>Nothing in {library.name} matches “{term}”.</p>
      <button class="btn btn-quiet" onclick={clearText}>Clear filter text</button>
    </EmptyState>
  {:else if !searching && list.total === 0}
    <EmptyState title={filter ? 'Nothing matches' : 'No titles yet'}>
      {#if filter}
        <p>No titles fit this filter.</p>
        <button class="btn btn-quiet" onclick={() => setFilter('')}>Clear filter</button>
      {:else}
        <p>This library has no titles yet.</p>
      {/if}
    </EmptyState>
  {:else}
    {#if shown.length === 0}
      {@render skeleton()}
    {/if}
    <!-- Cards differ in height by title length and the series stack; even them out so rows are a fixed pitch. -->
    <div class="results" class:collapsing>
      {#key listView}
        <VirtualGrid
          items={shown}
          key={keyOf}
          minColumnWidth={listView ? 1e6 : 160}
          columnGap={listView ? 0 : 24}
          rowGap={listView ? 0 : 30}
          estimateRowHeight={listView ? 68 : 320}
          onnearend={searching ? undefined : () => list.loadMore()}
        >
          {#snippet item(it)}
            {#if listView}<ItemRow item={it} />{:else}<ItemCard item={it} />{/if}
          {/snippet}
        </VirtualGrid>
      {/key}
    </div>
    {#if shown.length > 0 && !searching}
      {#if list.loading}<div class="more">{@render skeleton(true)}</div>{/if}
      {#if list.error}
        <p class="more-error" role="alert">
          Couldn't load more titles. <button class="link" onclick={() => list.loadMore()}>Try again</button>
        </p>
      {/if}
    {/if}
  {/if}
</div>

{#snippet skeleton(more = false)}
  {#if listView}
    <div class="sk-rows" role="status">
      <span class="sr-only">Loading titles…</span>
      {#each Array(more ? 3 : 10) as _, i (i)}<div class="sk-row" style:animation-delay="{i * 60}ms" aria-hidden="true"></div>{/each}
    </div>
  {:else}
    <CardSkeleton count={more ? 6 : 12} label="Loading titles" />
  {/if}
{/snippet}

<style>
  .head {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .fresh {
    font-size: var(--t-sm);
    font-weight: 650;
    color: var(--accent);
  }
  .fresh:hover {
    text-decoration: underline;
  }
  .count {
    font-size: var(--t-sm);
  }
  .toolbar {
    position: sticky;
    top: 60px;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
    margin: 14px -40px 24px;
    padding: 10px 40px;
    background: color-mix(in srgb, var(--ground) 82%, transparent);
    backdrop-filter: blur(16px);
  }
  .find {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 170px;
    height: 32px;
    padding: 0 10px 0 12px;
    border-radius: 999px;
    border: 1px solid var(--rule);
    background: var(--raised);
    color: var(--text-3);
    transition: border-color 120ms;
  }
  .find:focus-within {
    border-color: var(--accent);
  }
  .find input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    font-size: var(--t-sm);
    color: var(--text);
    user-select: text;
  }
  .find input::placeholder {
    color: var(--text-3);
  }
  .x {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    color: var(--text-2);
  }
  .x:hover {
    color: var(--text);
  }
  .filters {
    display: flex;
    align-items: center;
    gap: 10px;
    transition: opacity 120ms;
  }
  .filters.off {
    opacity: 0.45;
  }
  .chips {
    display: flex;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid var(--rule);
    font-size: var(--t-sm);
    font-weight: 550;
    color: var(--text-2);
  }
  .chip:hover {
    color: var(--text);
    border-color: var(--text-3);
  }
  .chip[aria-checked='true'],
  .chip.on {
    background: var(--text);
    border-color: var(--text);
    color: var(--ground);
  }
  .toolbar .select {
    max-width: 220px;
  }
  .spacer {
    flex: 1;
  }
  .sort {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .seg {
    display: flex;
  }
  .results :global(.card .text) {
    /* Two title lines, a byline and the gap between them. */
    min-height: calc(var(--t-md) * 2.5 + var(--t-sm) * 1.45 + 1px);
  }
  /* A stacked series card sits 8px lower than a plain one; drop plain ones to match when both can appear. */
  .collapsing :global(.card:not(.series) .art) {
    margin-top: 8px;
  }
  .more {
    margin-top: 30px;
  }
  .more-error {
    margin-top: 24px;
    text-align: center;
    font-size: var(--t-sm);
    color: var(--text-2);
  }
  .link {
    color: var(--accent);
    font-weight: 650;
  }
  .sk-rows {
    display: flex;
    flex-direction: column;
  }
  .sk-row {
    height: 68px;
    border-bottom: 1px solid var(--rule-soft);
    background: linear-gradient(var(--raised-2), var(--raised-2)) 12px 12px / 44px 44px no-repeat;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.55;
    }
  }
</style>
