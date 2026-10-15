<script lang="ts">
  import { ArrowDown, ArrowUp, ListEnd, Pencil, Play, Trash2, X } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import type { PlaylistEntry } from '$lib/api/abs';
  import type { LibraryItem, Playlist } from '$lib/api/types';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import ItemRow from '$lib/components/ItemRow.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { plural, safeHtml } from '$lib/util/format';
  import { queueEntry } from '$lib/util/play';
  import { invalidate, resource } from '$lib/util/resource.svelte';
  import { pageTitle } from '$lib/util/title';

  interface View {
    name: string;
    description: string | null;
    items: LibraryItem[];
    playlist: Playlist | null;
  }

  let renaming = $state(false);
  let draftName = $state('');
  let confirmDelete = $state(false);

  const id = $derived(page.params.id!);
  const isPlaylist = $derived(page.url.searchParams.has('playlist'));

  function fromPlaylist(p: Playlist): View {
    const items = p.items.map((i) => (i.episode ? { ...i.libraryItem, recentEpisode: i.episode } : i.libraryItem));
    return { name: p.name, description: p.description ?? null, items, playlist: p };
  }

  const res = resource(() => ({ id, playlist: isPlaylist }), {
    id: (k) => `${k.playlist ? 'playlist' : 'collection'}:${k.id}`,
    load: async (k): Promise<View> => {
      if (k.playlist) return fromPlaylist(await abs.getPlaylist(k.id));
      const c = await abs.getCollection(k.id);
      return { name: c.name, description: c.description ?? null, items: c.books, playlist: null };
    }
  });
  const view = $derived(res.data);
  const items = $derived(view?.items);
  const playlist = $derived(view?.playlist ?? null);
  const name = $derived(view?.name ?? '');
  const editable = $derived(!!playlist && playlist.userId === session.user?.id);

  // Another collection: start without a half-finished rename or delete prompt.
  $effect(() => {
    void id;
    renaming = false;
    confirmDelete = false;
  });

  function entries() {
    return (items ?? []).filter((i) => !i.isMissing).map((i) => queueEntry(i, i.recentEpisode ?? null));
  }

  function playAll() {
    void player.playAll(entries());
  }

  function queueAll() {
    const all = entries();
    for (const e of all) player.enqueue(e);
    toast(`Added ${plural(all.length, 'title')} to Up Next.`);
  }

  // The answer applies only if it's still the playlist on screen.
  function show(p: Playlist) {
    invalidate('collections:');
    if (res.key?.id === p.id) res.mutate(fromPlaylist(p));
  }

  async function save(patch: Parameters<typeof abs.updatePlaylist>[1]) {
    if (!playlist) return;
    try {
      show(await abs.updatePlaylist(playlist.id, patch));
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

  const entryOf = (i: Playlist['items'][number]): PlaylistEntry => ({ libraryItemId: i.libraryItemId, episodeId: i.episodeId });

  function move(index: number, by: number) {
    if (!playlist) return;
    const list = playlist.items.map(entryOf);
    const to = index + by;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    void save({ items: list });
  }

  async function remove(index: number) {
    if (!playlist) return;
    // Removing the last entry deletes the playlist on the server, so that one asks first instead.
    if (playlist.items.length === 1) {
      confirmDelete = true;
      return;
    }
    const pid = playlist.id;
    const order = playlist.items.map(entryOf);
    const entry = order[index];
    const title = items?.[index]?.recentEpisode?.title ?? items?.[index]?.media.metadata.title ?? 'Title';
    try {
      show(await abs.removeFromPlaylist(pid, entry));
      toast(`Removed ${title} from ${name}.`, {
        action: {
          label: 'Undo',
          run: async () => {
            try {
              // Adding appends; the PATCH then puts it back where it was.
              await abs.addToPlaylist(pid, entry);
              show(await abs.updatePlaylist(pid, { items: order }));
            } catch (err) {
              toast(`Couldn't put it back. ${errorMessage(err)}`, { tone: 'error' });
            }
          }
        }
      });
    } catch (err) {
      toast(`Couldn't remove it. ${errorMessage(err)}`, { tone: 'error' });
    }
  }

  async function deletePlaylist() {
    if (!playlist) return;
    try {
      await abs.deletePlaylist(playlist.id);
      invalidate('collections:');
      invalidate(`playlist:${playlist.id}`);
      toast(`Deleted ${name}.`);
      void goto('/collections');
    } catch (err) {
      toast(`Couldn't delete the playlist. ${errorMessage(err)}`, { tone: 'error' });
    }
  }
</script>

<svelte:head><title>{pageTitle(name || (isPlaylist ? 'Playlist' : 'Collection'))}</title></svelte:head>

{#if res.error}
  <div class="page">
    <ErrorState title="Couldn't open this {isPlaylist ? 'playlist' : 'collection'}" message={res.error} cause={res.cause} onretry={() => res.refresh()} />
  </div>
{:else if !view || !items}
  <Loading label="Loading {isPlaylist ? 'playlist' : 'collection'}" />
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
      {#if view.description}<div class="desc serif">{@html safeHtml(view.description)}</div>{/if}
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
