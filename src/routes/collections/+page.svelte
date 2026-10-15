<script lang="ts">
  import { Plus } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import * as abs from '$lib/api/abs';
  import type { Collection, Playlist } from '$lib/api/types';
  import Cover from '$lib/components/Cover.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { plural } from '$lib/util/format';

  let collections = $state<Collection[] | null>(null);
  let playlists = $state<Playlist[]>([]);
  let error = $state<string | null>(null);
  let creating = $state(false);
  let newName = $state('');

  async function create(e: SubmitEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const p = await abs.createPlaylist(session.library!.id, name);
      void goto(`/collections/${p.id}?playlist=1`);
    } catch (err) {
      toast(`Couldn't create the playlist. ${errorMessage(err)}`, { tone: 'error' });
    }
  }

  onMount(() => {
    const lib = session.library!.id;
    abs
      .getCollections(lib)
      .then((c) => (collections = c))
      .catch((err) => (error = err.message));
    abs
      .getPlaylists(lib)
      .then((p) => (playlists = p))
      .catch(() => {});
  });
</script>

<div class="page">
  <header class="head">
    <h1 class="page-title">Collections</h1>
    {#if creating}
      <form onsubmit={create}>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="field" bind:value={newName} placeholder="Playlist name" aria-label="New playlist name" autofocus />
        <button class="btn btn-primary" disabled={!newName.trim()}>Create</button>
        <button type="button" class="btn btn-quiet" onclick={() => (creating = false)}>Cancel</button>
      </form>
    {:else}
      <button class="btn btn-quiet" onclick={() => (creating = true)}><Plus size={16} /> New playlist</button>
    {/if}
  </header>

  {#if error}
    <EmptyState title="Couldn't load collections"><p>{error}</p></EmptyState>
  {:else if collections && !collections.length && !playlists.length}
    <EmptyState title="No collections yet">
      <p>Collections are hand-picked groups of books, made in the Audiobookshelf web app. Your playlists show up here too.</p>
    </EmptyState>
  {:else}
    <div class="grid">
      {#each collections ?? [] as c (c.id)}
        <a class="coll" href="/collections/{c.id}">
          <div class="mosaic">
            {#each c.books.slice(0, 4) as b (b.id)}
              <Cover itemId={b.id} title={b.media.metadata.title} updatedAt={b.updatedAt} width={200} aspect={1} radius="0" hasCover={!!b.media.coverPath} />
            {/each}
          </div>
          <span class="name serif">{c.name}</span>
          <span class="faint">{plural(c.books.length, 'book')}</span>
        </a>
      {/each}
      {#each playlists as p (p.id)}
        <a class="coll" href="/collections/{p.id}?playlist=1">
          <div class="mosaic">
            {#each p.items.slice(0, 4) as it (it.libraryItemId + (it.episodeId ?? ''))}
              <Cover itemId={it.libraryItemId} title={it.libraryItem.media.metadata.title} width={200} aspect={1} radius="0" />
            {/each}
          </div>
          <span class="name serif">{p.name}</span>
          <span class="faint">Playlist, {plural(p.items.length, 'item')}</span>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .head form {
    display: flex;
    gap: 8px;
  }
  .head input {
    width: 240px;
    height: 36px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 32px 24px;
    margin-top: 28px;
  }
  .coll {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--t-sm);
  }
  .mosaic {
    display: grid;
    grid-template-columns: 1fr 1fr;
    aspect-ratio: 1;
    border-radius: var(--r-md);
    overflow: hidden;
    background: var(--raised-2);
    margin-bottom: 10px;
    box-shadow: var(--shadow-cover);
  }
  .mosaic :global(.cover) {
    box-shadow: none;
  }
  .name {
    font-size: var(--t-md);
    font-weight: 600;
  }
</style>
