<script module lang="ts">
  import type { Series } from '$lib/api/types';
  import { pagedCache } from '$lib/util/paged.svelte';

  const lists = pagedCache<Series>();
  let lastSort = 'name';
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import * as abs from '$lib/api/abs';
  import CardSkeleton from '$lib/components/CardSkeleton.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import SeriesCard from '$lib/components/SeriesCard.svelte';
  import VirtualGrid from '$lib/components/VirtualGrid.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { PagedList } from '$lib/util/paged.svelte';
  import { pageTitle } from '$lib/util/title';

  const library = session.library!;
  // Remembered for the session so Back returns to the same order (and the same loaded pages).
  let sort = $state(lastSort);

  const sorts = [
    { value: 'name', label: 'Name' },
    { value: 'numBooks', label: 'Number of books' },
    { value: 'addedAt', label: 'Date added' },
    { value: 'lastBookAdded', label: 'Recently added book' },
    { value: 'totalDuration', label: 'Total length' }
  ];

  const list = new PagedList<{ library: string; sort: string }, Series>({
    cache: lists,
    key: (s) => s.id,
    fetch: (q, n) => abs.getSeriesList(q.library, n, q.sort, q.sort !== 'name')
  });
  list.set({ library: library.id, sort: untrack(() => sort) });
  $effect.pre(() => {
    const q = { library: library.id, sort };
    lastSort = sort;
    untrack(() => list.set(q));
  });
  $effect(() => () => list.dispose());
</script>

<svelte:head><title>{pageTitle('Series')}</title></svelte:head>

<div class="page">
  <header class="head">
    <h1 class="page-title">Series</h1>
    {#if list.total !== null}<span class="faint num">{list.total.toLocaleString()}</span>{/if}
    <div class="spacer"></div>
    <select class="select" bind:value={sort} aria-label="Sort series by">
      {#each sorts as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
    </select>
  </header>

  {#if list.error && !list.items.length}
    <ErrorState title="Couldn't load series" message={list.error} cause={list.cause} onretry={() => list.loadMore()} />
  {:else if list.total === 0}
    <EmptyState title="No series yet"><p>Books that share series metadata are grouped here.</p></EmptyState>
  {:else}
    {#if !list.items.length}<CardSkeleton count={12} width={176} label="Loading series" />{/if}
    <VirtualGrid items={list.items} key={(s) => s.id} minColumnWidth={176} columnGap={26} rowGap={34} estimateRowHeight={300} onnearend={() => list.loadMore()}>
      {#snippet item(s)}<SeriesCard series={s} />{/snippet}
    </VirtualGrid>
    {#if list.loading && list.items.length}<div class="more"><CardSkeleton count={6} width={176} label="Loading more series" /></div>{/if}
    {#if list.error && list.items.length}
      <p class="more-error" role="alert">Couldn't load more series. <button class="link" onclick={() => list.loadMore()}>Try again</button></p>
    {/if}
  {/if}
</div>

<style>
  .head {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-bottom: 28px;
  }
  .spacer {
    flex: 1;
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
</style>
