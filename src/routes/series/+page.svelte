<script lang="ts">
  import { untrack } from 'svelte';
  import * as abs from '$lib/api/abs';
  import type { Series } from '$lib/api/types';
  import CardSkeleton from '$lib/components/CardSkeleton.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import SeriesCard from '$lib/components/SeriesCard.svelte';
  import { session } from '$lib/stores/session.svelte';

  const library = session.library!;
  let list = $state<Series[]>([]);
  let total = $state<number | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let sort = $state('name');
  let nextPage = 0;
  let generation = 0;
  let sentinel = $state<HTMLDivElement>();

  const sorts = [
    { value: 'name', label: 'Name' },
    { value: 'numBooks', label: 'Number of books' },
    { value: 'addedAt', label: 'Date added' },
    { value: 'lastBookAdded', label: 'Recently added book' },
    { value: 'totalDuration', label: 'Total length' }
  ];

  async function loadMore() {
    if (loading || (total !== null && list.length >= total)) return;
    const gen = generation;
    loading = true;
    try {
      const res = await abs.getSeriesList(library.id, nextPage, sort, sort !== 'name');
      if (gen !== generation) return;
      list = [...list, ...res.results];
      total = res.total;
      nextPage++;
    } catch (err) {
      if (gen === generation) error = (err as Error).message;
    } finally {
      if (gen === generation) loading = false;
    }
  }

  $effect(() => {
    void sort;
    generation++;
    list = [];
    total = null;
    nextPage = 0;
    loading = false;
    untrack(() => void loadMore());
  });

  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && void loadMore(), { rootMargin: '800px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });
</script>

<div class="page">
  <header class="head">
    <h1 class="page-title">Series</h1>
    {#if total !== null}<span class="faint num">{total.toLocaleString()}</span>{/if}
    <div class="spacer"></div>
    <select class="select" bind:value={sort} aria-label="Sort series by">
      {#each sorts as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
    </select>
  </header>

  {#if error}
    <EmptyState title="Couldn't load series"><p>{error}</p></EmptyState>
  {:else if total === 0}
    <EmptyState title="No series yet"><p>Books that share series metadata are grouped here.</p></EmptyState>
  {:else}
    <div class="grid">
      {#each list as s (s.id)}<SeriesCard series={s} />{/each}
    </div>
    {#if loading}<div class="more"><CardSkeleton count={6} width={176} /></div>{/if}
    <div bind:this={sentinel} style:height="1px"></div>
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
    gap: 34px 26px;
  }
  .more {
    margin-top: 30px;
  }
</style>
