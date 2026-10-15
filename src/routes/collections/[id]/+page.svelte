<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import { request } from '$lib/api/client';
  import type { LibraryItem, Playlist } from '$lib/api/types';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import { plural, safeHtml } from '$lib/util/format';

  let name = $state('');
  let description = $state<string | null>(null);
  let items = $state<LibraryItem[] | null>(null);
  let error = $state<string | null>(null);

  const id = $derived(page.params.id!);
  const isPlaylist = $derived(page.url.searchParams.has('playlist'));

  $effect(() => {
    const current = id;
    items = null;
    const load = isPlaylist
      ? request<Playlist>(`/api/playlists/${current}`).then((p) => ({
          name: p.name,
          description: p.description,
          items: p.items.map((i) => (i.episode ? { ...i.libraryItem, recentEpisode: i.episode } : i.libraryItem))
        }))
      : abs.getCollection(current).then((c) => ({ name: c.name, description: c.description, items: c.books }));
    load
      .then((r) => {
        if (current !== id) return;
        name = r.name;
        description = r.description;
        items = r.items;
      })
      .catch((err) => (error = err.message));
  });
</script>

{#if error}
  <div class="page"><EmptyState title="Couldn't open this collection"><p>{error}</p></EmptyState></div>
{:else if !items}
  <div class="loading"><LoaderCircle size={26} class="spin" /></div>
{:else}
  <div class="page">
    <h1 class="page-title">{name}</h1>
    <p class="faint meta">{plural(items.length, isPlaylist ? 'item' : 'book')}</p>
    {#if description}<div class="desc serif">{@html safeHtml(description)}</div>{/if}
    <div class="grid">
      {#each items as item, i (item.id + i)}<ItemCard {item} />{/each}
    </div>
  </div>
{/if}

<style>
  .loading {
    display: grid;
    place-items: center;
    height: 60vh;
    color: var(--text-3);
  }
  .meta {
    margin-top: 6px;
    font-size: var(--t-sm);
  }
  .desc {
    margin-top: 12px;
    max-width: 66ch;
    color: var(--text-2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 30px 24px;
    margin-top: 32px;
  }
</style>
