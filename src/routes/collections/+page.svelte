<script lang="ts">
  import { onMount } from 'svelte';
  import * as abs from '$lib/api/abs';
  import type { Collection, Playlist } from '$lib/api/types';
  import Cover from '$lib/components/Cover.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { plural } from '$lib/util/format';

  let collections = $state<Collection[] | null>(null);
  let playlists = $state<Playlist[]>([]);
  let error = $state<string | null>(null);

  onMount(() => {
    const lib = session.library!.id;
    abs
      .getCollections(lib)
      .then((c) => (collections = c))
      .catch((err) => (error = err.message));
    abs.getPlaylists(lib).then((p) => (playlists = p)).catch(() => {});
  });
</script>

<div class="page">
  <h1 class="page-title">Collections</h1>

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
