<script lang="ts">
  import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, Layers, List, Search, X } from '@lucide/svelte';
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import { request } from '$lib/api/client';
  import type { FilterData, LibraryItem, SearchResults } from '$lib/api/types';
  import CardSkeleton from '$lib/components/CardSkeleton.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import FilterMenu from '$lib/components/FilterMenu.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import ItemRow from '$lib/components/ItemRow.svelte';
  import VirtualGrid from '$lib/components/VirtualGrid.svelte';
  import { live } from '$lib/stores/live.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { plural } from '$lib/util/format';

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

  let items = $state<LibraryItem[]>([]);
  let total = $state<number | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let nextPage = 0;
  let generation = 0;
  let filterData = $state<FilterData | null>(null);

  // Title search: `query` is the box, `term` is what's been settled on and sent to the server.
  let query = $state('');
  let term = $state('');
  let found = $state<LibraryItem[]>([]);
  let finding = $state(false);
  let findError = $state<string | null>(null);
  let findNonce = $state(0);
  let debounce: ReturnType<typeof setTimeout> | undefined;

  // Filters live in the URL so other pages can link straight into a filtered view.
  const filter = $derived(page.url.searchParams.get('filter') ?? '');
  const filterLabel = $derived(page.url.searchParams.get('label') ?? '');
  const progressValue = $derived(filter.startsWith('progress.') ? atob(filter.slice(9)) : '');
  const sort = $derived(sorts.some((s) => s.value === prefs.librarySort) ? prefs.librarySort : 'media.metadata.title');
  const searching = $derived(term !== '');
  const list = $derived(prefs.libraryView === 'list');
  const shown = $derived(searching ? found : items);
  const count = $derived(searching ? (finding || findError ? null : found.length) : total);
  const collapsing = $derived(isBooks && prefs.collapseSeries && !filter && !searching);

  const keyOf = (it: LibraryItem) => it.collapsedSeries?.id ?? it.id;

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
  let reloads = $state(0);

  $effect(() =>
    live.onItemChange((change, it) => {
      if (it.libraryId !== library.id) return;
      if (change === 'added') added++;
      else if (change === 'removed') {
        const before = items.length;
        items = items.filter((x) => x.id !== it.id);
        if (total !== null && items.length < before) total--;
      } else items = items.map((x) => (x.id === it.id && !x.collapsedSeries ? it : x));
    })
  );

  $effect(() => {
    // Reset whenever the query changes.
    void [filter, sort, prefs.librarySortDesc, prefs.collapseSeries, reloads];
    added = 0;
    generation++;
    items = [];
    total = null;
    nextPage = 0;
    error = null;
    loading = false;
    untrack(() => void loadMore());
  });

  async function loadMore() {
    if (loading || (total !== null && items.length >= total)) return;
    const gen = generation;
    loading = true;
    try {
      const res = await abs.getLibraryItems(library.id, {
        sort,
        desc: prefs.librarySortDesc,
        filter: filter || undefined,
        page: nextPage,
        limit: PAGE,
        collapseseries: isBooks && prefs.collapseSeries && !filter
      });
      if (gen !== generation) return;
      items = [...items, ...res.results];
      total = res.total;
      nextPage++;
    } catch (err) {
      if (gen === generation) error = (err as Error).message;
    } finally {
      if (gen === generation) loading = false;
    }
  }

  $effect(() => {
    void findNonce;
    const q = term;
    if (!q) {
      found = [];
      finding = false;
      findError = null;
      return;
    }
    const ctl = new AbortController();
    finding = true;
    findError = null;
    // abs.search is capped at 12 results; a library view wants more.
    request<SearchResults>(`/api/libraries/${library.id}/search`, { query: { q, limit: 100 }, signal: ctl.signal })
      .then((res) => {
        found = (isBooks ? res.book : res.podcast)?.map((r) => r.libraryItem) ?? [];
        finding = false;
      })
      .catch((err) => {
        if (ctl.signal.aborted) return;
        findError = (err as Error).message;
        finding = false;
      });
    return () => ctl.abort();
  });

  function onQuery() {
    clearTimeout(debounce);
    const q = query.trim();
    if (!q) term = '';
    else
      debounce = setTimeout(() => {
        term = q;
        finding = true;
      }, 250);
  }

  function clearQuery() {
    clearTimeout(debounce);
    query = '';
    term = '';
  }

  function setFilter(value: string, label = '') {
    const url = new URL(page.url);
    if (value) url.searchParams.set('filter', value);
    else url.searchParams.delete('filter');
    if (label) url.searchParams.set('label', label);
    else url.searchParams.delete('label');
    void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }
</script>

<div class="page">
  <header class="head">
    <h1 class="page-title">{filterLabel || library.name}</h1>
    {#if count !== null}
      <span class="count faint num">{searching ? plural(count, 'result') : `${count.toLocaleString()} ${count === 1 ? 'title' : 'titles'}`}</span>
    {/if}
    {#if added && !searching}
      <button class="fresh" onclick={() => reloads++}>{plural(added, 'new title')} added · Refresh</button>
    {/if}
  </header>

  <div class="toolbar">
    <label class="find">
      <Search size={14} />
      <input
        type="text"
        placeholder="Filter titles"
        aria-label="Filter titles"
        autocomplete="off"
        spellcheck="false"
        bind:value={query}
        oninput={onQuery}
        onkeydown={(e) => {
          if (e.key === 'Escape' && query) {
            e.stopPropagation();
            clearQuery();
          }
        }}
      />
      {#if query}
        <button class="x" onclick={clearQuery} aria-label="Clear search"><X size={14} /></button>
      {/if}
    </label>

    {#if isBooks}
      <div class="filters" class:off={searching} inert={searching}>
        <div class="chips" role="radiogroup" aria-label="Listening status">
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
          <button class="chip on" onclick={() => setFilter('')}>{filterLabel || 'Filtered'} <X size={13} /></button>
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
      <button class="icon-btn" aria-pressed={!list} onclick={() => (prefs.libraryView = 'grid')} title="Grid" aria-label="Grid view"
        ><LayoutGrid size={18} /></button
      >
      <button class="icon-btn" aria-pressed={list} onclick={() => (prefs.libraryView = 'list')} title="List" aria-label="List view"><List size={18} /></button>
    </div>
    <div class="sort">
      <select class="select" aria-label="Sort by" value={sort} disabled={searching} onchange={(e) => (prefs.librarySort = e.currentTarget.value)}>
        {#each sorts as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
      </select>
      <button
        class="icon-btn"
        onclick={() => (prefs.librarySortDesc = !prefs.librarySortDesc)}
        disabled={searching}
        aria-label={prefs.librarySortDesc ? 'Sort descending' : 'Sort ascending'}
        title={prefs.librarySortDesc ? 'Descending' : 'Ascending'}
      >
        {#if prefs.librarySortDesc}<ArrowDownWideNarrow size={18} />{:else}<ArrowUpNarrowWide size={18} />{/if}
      </button>
    </div>
  </div>

  {#if searching ? findError : error}
    <EmptyState title={searching ? "Couldn't search this library" : "Couldn't load this library"}>
      <p>{searching ? findError : error}</p>
      <button class="btn btn-primary" onclick={() => (searching ? findNonce++ : loadMore())}>Try again</button>
    </EmptyState>
  {:else if searching && !finding && found.length === 0}
    <EmptyState title="No matches">
      <p>Nothing in {library.name} matches “{term}”.</p>
      <button class="btn btn-quiet" onclick={clearQuery}>Clear search</button>
    </EmptyState>
  {:else if !searching && total === 0}
    <EmptyState title="Nothing matches">
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
      {#key list}
        <VirtualGrid
          items={shown}
          key={keyOf}
          minColumnWidth={list ? 1e6 : 160}
          columnGap={list ? 0 : 24}
          rowGap={list ? 0 : 30}
          estimateRowHeight={list ? 68 : 320}
          onnearend={searching ? undefined : loadMore}
        >
          {#snippet item(it)}
            {#if list}<ItemRow item={it} />{:else}<ItemCard item={it} />{/if}
          {/snippet}
        </VirtualGrid>
      {/key}
    </div>
    {#if shown.length > 0 && !searching && loading}<div class="more">{@render skeleton(true)}</div>{/if}
  {/if}
</div>

{#snippet skeleton(more = false)}
  {#if list}
    <div class="sk-rows" aria-hidden="true">
      {#each Array(more ? 3 : 10) as _, i (i)}<div class="sk-row" style:animation-delay="{i * 60}ms"></div>{/each}
    </div>
  {:else}
    <CardSkeleton count={more ? 6 : 12} />
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
