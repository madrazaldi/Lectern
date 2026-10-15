<script lang="ts">
  import { onMount } from 'svelte';
  import * as abs from '$lib/api/abs';
  import type { Author } from '$lib/api/types';
  import AuthorCard from '$lib/components/AuthorCard.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { session } from '$lib/stores/session.svelte';

  let authors = $state<Author[] | null>(null);
  let error = $state<string | null>(null);
  let sort = $state<'name' | 'lastFirst' | 'numBooks'>('name');
  let query = $state('');

  onMount(() => {
    abs
      .getAuthors(session.library!.id)
      .then((a) => (authors = a))
      .catch((err) => (error = err.message));
  });

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = (authors ?? []).filter((a) => !q || a.name.toLowerCase().includes(q));
    if (sort === 'numBooks') return list.toSorted((a, b) => (b.numBooks ?? 0) - (a.numBooks ?? 0));
    const key = (a: Author) => (sort === 'lastFirst' ? ((a as Author & { lastFirst?: string }).lastFirst ?? a.name) : a.name);
    return list.toSorted((a, b) => key(a).localeCompare(key(b)));
  });
</script>

<div class="page">
  <header class="head">
    <h1 class="page-title">Authors</h1>
    {#if authors}<span class="faint num">{authors.length}</span>{/if}
    <div class="spacer"></div>
    <input class="field filter" bind:value={query} placeholder="Filter authors" aria-label="Filter authors" />
    <select class="select" bind:value={sort} aria-label="Sort authors by">
      <option value="name">First name</option>
      <option value="lastFirst">Last name</option>
      <option value="numBooks">Most books</option>
    </select>
  </header>

  {#if error}
    <EmptyState title="Couldn't load authors"><p>{error}</p></EmptyState>
  {:else if authors && !shown.length}
    <EmptyState title={query ? 'No authors match' : 'No authors yet'} />
  {:else}
    <div class="grid">
      {#each shown as a (a.id)}<AuthorCard author={a} />{/each}
    </div>
  {/if}
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 32px;
  }
  .spacer {
    flex: 1;
  }
  .filter {
    height: 32px;
    border-radius: 999px;
    width: 200px;
    font-size: var(--t-sm);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(136px, 1fr));
    gap: 34px 28px;
  }
</style>
