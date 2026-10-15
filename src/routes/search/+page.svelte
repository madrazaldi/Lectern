<script lang="ts">
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import AuthorCard from '$lib/components/AuthorCard.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import SeriesCard from '$lib/components/SeriesCard.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { isMacPlatform, modLabel } from '$lib/util/shortcuts';
  import { resource } from '$lib/util/resource.svelte';
  import { pageTitle } from '$lib/util/title';

  // The server answers at most this many of each kind; hitting it means there may be more.
  const CAP = 12;

  const q = $derived((page.url.searchParams.get('q') ?? '').trim());
  const library = session.library!;

  const res = resource(() => (q ? { library: library.id, q } : null), {
    id: (k) => `search:${k.library}:${k.q}`,
    load: (k, signal) => abs.search(k.library, k.q, signal)
  });
  const results = $derived(res.data);

  const books = $derived(results?.book ?? []);
  const podcasts = $derived(results?.podcast ?? []);
  const items = $derived([...books, ...podcasts].map((r) => r.libraryItem));
  const moreTitles = $derived(books.length >= CAP || podcasts.length >= CAP);
  const moreAuthors = $derived((results?.authors?.length ?? 0) >= CAP);
  const count = $derived(
    items.length +
      (results?.series?.length ?? 0) +
      (results?.authors?.length ?? 0) +
      (results?.narrators?.length ?? 0) +
      (results?.genres?.length ?? 0) +
      (results?.tags?.length ?? 0)
  );
</script>

<svelte:head><title>{pageTitle(q ? `“${q}”` : 'Search')}</title></svelte:head>

<div class="page">
  <h1 class="page-title">
    {#if q}Results for “{q}”{:else}Search{/if}
    {#if res.loading && results}<Loading inline size={20} label="Searching" />{/if}
  </h1>

  {#if !q}
    <EmptyState title="Find something to listen to">
      <p>Search by title, author, narrator, series, genre or tag. Press {modLabel(isMacPlatform())}K from anywhere.</p>
    </EmptyState>
  {:else if res.error}
    <ErrorState title="Search failed" message={res.error} cause={res.cause} onretry={() => res.refresh()} />
  {:else if !results}
    <Loading label="Searching" />
  {:else if !count}
    <EmptyState title="No matches">
      <p>Nothing in {session.library?.name} matches “{q}”. Check the spelling, or try an author or series name.</p>
    </EmptyState>
  {:else}
    {#if items.length}
      <section>
        <div class="sec-head">
          <h2 class="serif">Titles</h2>
          {#if moreTitles}<a class="all" href="/library?q={encodeURIComponent(q)}">See all in library</a>{/if}
        </div>
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
        <div class="sec-head">
          <h2 class="serif">Authors</h2>
          {#if moreAuthors}<a class="all" href="/authors?q={encodeURIComponent(q)}">See all authors</a>{/if}
        </div>
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
  .sec-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }
  .all {
    font-size: var(--t-sm);
    font-weight: 650;
    color: var(--accent);
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
