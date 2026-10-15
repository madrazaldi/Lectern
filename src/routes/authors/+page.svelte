<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import type { Author } from '$lib/api/types';
  import AuthorCard from '$lib/components/AuthorCard.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { resource } from '$lib/util/resource.svelte';
  import { pageTitle } from '$lib/util/title';

  let sort = $state<'name' | 'lastFirst' | 'numBooks'>('name');

  const res = resource(() => session.library!.id, {
    id: (k) => `authors:${k}`,
    load: (k) => abs.getAuthors(k)
  });
  const authors = $derived(res.data);

  // The filter text is in the URL (search links here with ?q=) and follows it on Back.
  const term = $derived(page.url.searchParams.get('q') ?? '');
  let query = $state(untrack(() => page.url.searchParams.get('q') ?? ''));
  let debounce: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const t = term;
    untrack(() => {
      if (t.trim() !== query.trim()) query = t;
    });
  });
  $effect(() => () => clearTimeout(debounce));

  function onInput() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const url = new URL(page.url);
      const q = query.trim();
      if (q) url.searchParams.set('q', q);
      else url.searchParams.delete('q');
      void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
    }, 250);
  }

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = (authors ?? []).filter((a) => !q || a.name.toLowerCase().includes(q));
    if (sort === 'numBooks') return list.toSorted((a, b) => (b.numBooks ?? 0) - (a.numBooks ?? 0));
    const key = (a: Author) => (sort === 'lastFirst' ? ((a as Author & { lastFirst?: string }).lastFirst ?? a.name) : a.name);
    return list.toSorted((a, b) => key(a).localeCompare(key(b)));
  });
</script>

<svelte:head><title>{pageTitle('Authors')}</title></svelte:head>

<div class="page">
  <header class="head">
    <h1 class="page-title">Authors</h1>
    {#if authors}<span class="faint num">{authors.length}</span>{/if}
    <div class="spacer"></div>
    <input class="field filter" type="search" bind:value={query} oninput={onInput} placeholder="Filter authors" aria-label="Filter authors" />
    <select class="select" bind:value={sort} aria-label="Sort authors by">
      <option value="name">First name</option>
      <option value="lastFirst">Last name</option>
      <option value="numBooks">Most books</option>
    </select>
  </header>

  {#if res.error}
    <ErrorState title="Couldn't load authors" message={res.error} cause={res.cause} onretry={() => res.refresh()} />
  {:else if !authors}
    <Loading label="Loading authors" />
  {:else if !shown.length}
    <EmptyState title={query.trim() ? 'No authors match' : 'No authors yet'} />
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
