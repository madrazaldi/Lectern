<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import type { SearchResults } from '$lib/api/types';
  import AuthorCard from '$lib/components/AuthorCard.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import SeriesCard from '$lib/components/SeriesCard.svelte';
  import { session } from '$lib/stores/session.svelte';

  const q = $derived(page.url.searchParams.get('q') ?? '');
  let results = $state<SearchResults | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    const term = q.trim();
    if (!term) {
      results = null;
      return;
    }
    const ctrl = new AbortController();
    loading = true;
    error = null;
    abs
      .search(session.library!.id, term, ctrl.signal)
      .then((r) => (results = r))
      .catch((err) => {
        if (err?.name !== 'AbortError') error = err.message;
      })
      .finally(() => (loading = false));
    return () => ctrl.abort();
  });

  const items = $derived([...(results?.book ?? []), ...(results?.podcast ?? [])].map((r) => r.libraryItem));
  const count = $derived(
    items.length +
      (results?.series?.length ?? 0) +
      (results?.authors?.length ?? 0) +
      (results?.narrators?.length ?? 0) +
      (results?.genres?.length ?? 0) +
      (results?.tags?.length ?? 0)
  );
</script>

<div class="page">
  <h1 class="page-title">
    {#if q}Results for “{q}”{:else}Search{/if}
    {#if loading}<LoaderCircle size={20} class="spin" />{/if}
  </h1>

  {#if !q}
    <EmptyState title="Find something to listen to">
      <p>Search by title, author, narrator, series, genre or tag. Press ⌘K from anywhere.</p>
    </EmptyState>
  {:else if error}
    <EmptyState title="Search failed"><p>{error}</p></EmptyState>
  {:else if results && !count}
    <EmptyState title="No matches">
      <p>Nothing in {session.library?.name} matches “{q}”. Check the spelling, or try an author or series name.</p>
    </EmptyState>
  {:else if results}
    {#if items.length}
      <section>
        <h2 class="serif">Titles</h2>
        <div class="grid">
          {#each items as item (item.id)}<ItemCard {item} />{/each}
        </div>
      </section>
    {/if}
    {#if results.series?.length}
      <section>
        <h2 class="serif">Series</h2>
        <div class="grid">
          {#each results.series as s (s.series.id)}<SeriesCard series={{ ...s.series, books: s.books }} />{/each}
        </div>
      </section>
    {/if}
    {#if results.authors?.length}
      <section>
        <h2 class="serif">Authors</h2>
        <div class="grid authors">
          {#each results.authors as a (a.id)}<AuthorCard author={a} />{/each}
        </div>
      </section>
    {/if}
    {#if results.narrators?.length || results.genres?.length || results.tags?.length}
      <section>
        <h2 class="serif">Narrators, genres and tags</h2>
        <div class="chips">
          {#each results.narrators ?? [] as n (n.name)}
            <a class="chip" href="/library?filter={encodeURIComponent(abs.encodeFilter('narrators', n.name))}&label={encodeURIComponent(`Read by ${n.name}`)}">
              {n.name} <span class="faint">narrator, {n.numBooks}</span>
            </a>
          {/each}
          {#each results.genres ?? [] as g (g.name)}
            <a class="chip" href="/library?filter={encodeURIComponent(abs.encodeFilter('genres', g.name))}&label={encodeURIComponent(g.name)}">
              {g.name} <span class="faint">genre, {g.numItems}</span>
            </a>
          {/each}
          {#each results.tags ?? [] as t (t.name)}
            <a class="chip" href="/library?filter={encodeURIComponent(abs.encodeFilter('tags', t.name))}&label={encodeURIComponent(t.name)}">
              {t.name} <span class="faint">tag, {t.numItems}</span>
            </a>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  h1 {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  section {
    margin-top: 36px;
  }
  h2 {
    font-size: var(--t-xl);
    font-weight: 600;
    margin-bottom: 16px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 30px 24px;
  }
  .grid.authors {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    display: inline-flex;
    gap: 8px;
    padding: 7px 14px;
    border-radius: 999px;
    border: 1px solid var(--rule);
    font-size: var(--t-sm);
    font-weight: 550;
  }
  .chip:hover {
    border-color: var(--accent);
  }
</style>
