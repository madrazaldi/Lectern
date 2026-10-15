<script lang="ts">
  import { ArrowDownWideNarrow, ArrowUpNarrowWide, Layers, X } from '@lucide/svelte';
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import type { FilterData, LibraryItem } from '$lib/api/types';
  import CardSkeleton from '$lib/components/CardSkeleton.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { session } from '$lib/stores/session.svelte';

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
  let sentinel = $state<HTMLDivElement>();

  // Filters live in the URL so other pages can link straight into a filtered view.
  const filter = $derived(page.url.searchParams.get('filter') ?? '');
  const filterLabel = $derived(page.url.searchParams.get('label') ?? '');
  const progressValue = $derived(filter.startsWith('progress.') ? atob(filter.slice(9)) : '');
  const sort = $derived(sorts.some((s) => s.value === prefs.librarySort) ? prefs.librarySort : 'media.metadata.title');

  onMount(() => {
    if (isBooks) abs.getFilterData(library.id).then((d) => (filterData = d)).catch(() => {});
  });

  $effect(() => {
    // Reset whenever the query changes.
    void [filter, sort, prefs.librarySortDesc, prefs.collapseSeries];
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
    if (!sentinel) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && void loadMore(), { rootMargin: '800px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });

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
    {#if total !== null}<span class="count faint num">{total.toLocaleString()} {total === 1 ? 'title' : 'titles'}</span>{/if}
  </header>

  <div class="toolbar">
    {#if isBooks}
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
      {#if filterData?.genres.length}
        <select
          class="select"
          aria-label="Genre"
          value={filter.startsWith('genres.') ? filter : ''}
          onchange={(e) => {
            const v = e.currentTarget.value;
            setFilter(v, v ? e.currentTarget.selectedOptions[0].text : '');
          }}
        >
          <option value="">All genres</option>
          {#each filterData.genres as g (g)}<option value={abs.encodeFilter('genres', g)}>{g}</option>{/each}
        </select>
      {/if}
      {#if filter && !filter.startsWith('progress.') && !filter.startsWith('genres.')}
        <button class="chip on" onclick={() => setFilter('')}>{filterLabel || 'Filtered'} <X size={13} /></button>
      {/if}
    {/if}

    <div class="spacer"></div>

    {#if isBooks}
      <button
        class="icon-btn"
        aria-pressed={prefs.collapseSeries}
        onclick={() => (prefs.collapseSeries = !prefs.collapseSeries)}
        title={prefs.collapseSeries ? 'Show every book' : 'Group books by series'}
        aria-label="Group books by series"
        disabled={!!filter}><Layers size={18} /></button
      >
    {/if}
    <select class="select" aria-label="Sort by" value={sort} onchange={(e) => (prefs.librarySort = e.currentTarget.value)}>
      {#each sorts as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
    </select>
    <button
      class="icon-btn"
      onclick={() => (prefs.librarySortDesc = !prefs.librarySortDesc)}
      aria-label={prefs.librarySortDesc ? 'Sort descending' : 'Sort ascending'}
      title={prefs.librarySortDesc ? 'Descending' : 'Ascending'}
    >
      {#if prefs.librarySortDesc}<ArrowDownWideNarrow size={18} />{:else}<ArrowUpNarrowWide size={18} />{/if}
    </button>
  </div>

  {#if error}
    <EmptyState title="Couldn't load this library">
      <p>{error}</p>
      <button class="btn btn-primary" onclick={() => loadMore()}>Try again</button>
    </EmptyState>
  {:else if total === 0}
    <EmptyState title="Nothing matches">
      <p>No titles fit this filter.</p>
      <button class="btn btn-quiet" onclick={() => setFilter('')}>Clear filter</button>
    </EmptyState>
  {:else}
    <div class="grid">
      {#each items as item (item.collapsedSeries?.id ?? item.id)}
        <ItemCard {item} />
      {/each}
    </div>
    {#if loading}<div class="more"><CardSkeleton count={6} /></div>{/if}
    <div bind:this={sentinel} class="sentinel"></div>
  {/if}
</div>

<style>
  .head {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .count {
    font-size: var(--t-sm);
  }
  .toolbar {
    position: sticky;
    top: 60px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 14px -40px 24px;
    padding: 10px 40px;
    background: color-mix(in srgb, var(--ground) 82%, transparent);
    backdrop-filter: blur(16px);
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 30px 24px;
  }
  .more {
    margin-top: 30px;
  }
  .sentinel {
    height: 1px;
  }
</style>
