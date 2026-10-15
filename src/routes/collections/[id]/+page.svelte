<script lang="ts">
  import { ArrowDown, ArrowUp, ListEnd, LoaderCircle, Pencil, Play, Trash2, X } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import type { LibraryItem, Playlist } from '$lib/api/types';
  import { isBook } from '$lib/api/types';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import ItemRow from '$lib/components/ItemRow.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import type { QueueEntry } from '$lib/util/playback';
  import { plural, safeHtml } from '$lib/util/format';

  let name = $state('');
  let description = $state<string | null>(null);
  let items = $state<LibraryItem[] | null>(null);
  let playlist = $state<Playlist | null>(null);
  let error = $state<string | null>(null);
  let renaming = $state(false);
  let draftName = $state('');
  let confirmDelete = $state(false);

  const id = $derived(page.params.id!);
  const isPlaylist = $derived(page.url.searchParams.has('playlist'));
  const editable = $derived(isPlaylist && !!playlist && playlist.userId === session.user?.id);

  function fromPlaylist(p: Playlist) {
    return p.items.map((i) => (i.episode ? { ...i.libraryItem, recentEpisode: i.episode } : i.libraryItem));
  }

  $effect(() => {
    const current = id;
    items = null;
    playlist = null;
    renaming = false;
    confirmDelete = false;
    const load = isPlaylist
      ? abs.getPlaylist(current).then((p) => {
          playlist = p;
          return { name: p.name, description: p.description, items: fromPlaylist(p) };
        })
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

  function entries(): QueueEntry[] {
    return (items ?? [])
      .filter((i) => !i.isMissing)
      .map((i) => ({
        itemId: i.id,
        episodeId: i.recentEpisode?.id ?? null,
        title: i.recentEpisode?.title ?? i.media.metadata.title,
        subtitle: i.recentEpisode ? i.media.metadata.title : isBook(i) ? (i.media.metadata.authorName ?? '') : '',
        updatedAt: i.updatedAt
      }));
  }

  function playAll() {
    void player.playAll(entries());
  }

  function queueAll() {
    const all = entries();
    for (const e of all) player.enqueue(e);
    toast(`Added ${plural(all.length, 'title')} to Up Next.`);
  }

  async function save(patch: Parameters<typeof abs.updatePlaylist>[1]) {
    if (!playlist) return;
    try {
      playlist = await abs.updatePlaylist(playlist.id, patch);
      name = playlist.name;
      items = fromPlaylist(playlist);
    } catch (err) {
      toast(`Couldn't update the playlist. ${errorMessage(err)}`, { tone: 'error' });
    }
  }

  function rename(e: SubmitEvent) {
    e.preventDefault();
    renaming = false;
    const n = draftName.trim();
    if (n && n !== name) void save({ name: n });
  }

  function move(index: number, by: number) {
    if (!playlist) return;
    const list = playlist.items.map((i) => ({ libraryItemId: i.libraryItemId, episodeId: i.episodeId }));
    const to = index + by;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    void save({ items: list });
  }

  async function remove(index: number) {
    if (!playlist) return;
    const entry = playlist.items[index];
    if (playlist.items.length === 1) {
      confirmDelete = true;
      return;
    }
    try {
      playlist = await abs.removeFromPlaylist(playlist.id, entry);
      items = fromPlaylist(playlist);
    } catch (err) {
      toast(`Couldn't remove it. ${errorMessage(err)}`, { tone: 'error' });
    }
  }

  async function deletePlaylist() {
    if (!playlist) return;
    try {
      await abs.deletePlaylist(playlist.id);
      toast(`Deleted ${name}.`);
      void goto('/collections');
    } catch (err) {
      toast(`Couldn't delete the playlist. ${errorMessage(err)}`, { tone: 'error' });
    }
  }
</script>

{#if error}
  <div class="page"><EmptyState title="Couldn't open this collection"><p>{error}</p></EmptyState></div>
{:else if !items}
  <div class="loading"><LoaderCircle size={26} class="spin" /></div>
{:else}
  <div class="page">
    <header>
      {#if renaming}
        <form onsubmit={rename}>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="field title-field serif" bind:value={draftName} aria-label="Playlist name" autofocus onblur={() => (renaming = false)} />
        </form>
      {:else}
        <h1 class="page-title">
          {name}
          {#if editable}
            <button
              class="icon-btn"
              aria-label="Rename playlist"
              title="Rename"
              onclick={() => {
                draftName = name;
                renaming = true;
              }}><Pencil size={16} /></button
            >
          {/if}
        </h1>
      {/if}
      <p class="faint meta">{isPlaylist ? 'Playlist, ' : ''}{plural(items.length, isPlaylist ? 'item' : 'book')}</p>
      {#if description}<div class="desc serif">{@html safeHtml(description)}</div>{/if}
      {#if items.length}
        <div class="actions">
          <button class="btn btn-primary" onclick={playAll}><Play size={16} fill="currentColor" strokeWidth={0} /> Play all</button>
          <button class="btn btn-quiet" onclick={queueAll}><ListEnd size={16} /> Add all to Up Next</button>
          {#if editable}
            <div class="spacer"></div>
            {#if confirmDelete}
              <span class="faint">Delete this playlist? The titles stay in your library.</span>
              <button class="btn btn-quiet" onclick={() => (confirmDelete = false)}>Keep</button>
              <button class="btn btn-danger" onclick={deletePlaylist}>Delete</button>
            {:else}
              <button class="btn btn-quiet" onclick={() => (confirmDelete = true)}><Trash2 size={16} /> Delete playlist</button>
            {/if}
          {/if}
        </div>
      {/if}
    </header>

    {#if isPlaylist}
      <div class="rows">
        {#each items as item, i (item.id + (item.recentEpisode?.id ?? '') + i)}
          <ItemRow {item}>
            {#snippet actions()}
              {#if editable}
                <button class="icon-btn" aria-label="Move up" onclick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={15} /></button>
                <button class="icon-btn" aria-label="Move down" onclick={() => move(i, 1)} disabled={i === items!.length - 1}><ArrowDown size={15} /></button>
                <button class="icon-btn" aria-label="Remove from playlist" onclick={() => remove(i)}><X size={15} /></button>
              {/if}
            {/snippet}
          </ItemRow>
        {:else}
          <EmptyState title="This playlist is empty"><p>Add titles with the playlist button on their page.</p></EmptyState>
        {/each}
      </div>
    {:else}
      <div class="grid">
        {#each items as item, i (item.id + i)}<ItemCard {item} />{/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .loading {
    display: grid;
    place-items: center;
    height: 60vh;
    color: var(--text-3);
  }
  h1 {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h1 .icon-btn {
    opacity: 0.6;
  }
  h1 .icon-btn:hover {
    opacity: 1;
  }
  .title-field {
    font-size: var(--t-2xl);
    height: auto;
    padding: 4px 10px;
    width: min(100%, 640px);
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
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 22px;
    font-size: var(--t-sm);
  }
  .spacer {
    flex: 1;
  }
  .rows {
    margin-top: 24px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 30px 24px;
    margin-top: 32px;
  }
</style>
