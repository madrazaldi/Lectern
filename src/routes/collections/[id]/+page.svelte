<script lang="ts">
  import { ArrowUpDown, Check, ListEnd, Pencil, Play, Trash2, X } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import type { PlaylistEntry } from '$lib/api/abs';
  import type { Collection, LibraryItem, Playlist } from '$lib/api/types';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { hasAudio } from '$lib/components/reader/ebook';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import ItemRow from '$lib/components/ItemRow.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import ReorderList from '$lib/components/ReorderList.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { canDeleteCollections, canEditCollections } from '$lib/util/actions/library';
  import { confirmDialog } from '$lib/util/confirm';
  import { plural, safeHtml } from '$lib/util/format';
  import { queueEntry } from '$lib/util/play';
  import { move, OrderSync } from '$lib/util/reorder';
  import { invalidate, resource } from '$lib/util/resource.svelte';
  import { pageTitle } from '$lib/util/title';

  interface View {
    name: string;
    description: string | null;
    items: LibraryItem[];
    playlist: Playlist | null;
    collection: Collection | null;
  }

  let renaming = $state(false);
  let draftName = $state('');
  let describing = $state(false);
  let draftDesc = $state('');
  /** A collection shows as covers; editing its books switches to rows. */
  let arranging = $state(false);

  const id = $derived(page.params.id!);
  const isPlaylist = $derived(page.url.searchParams.has('playlist'));

  function fromPlaylist(p: Playlist): View {
    const items = p.items.map((i) => (i.episode ? { ...i.libraryItem, recentEpisode: i.episode } : i.libraryItem));
    return { name: p.name, description: p.description ?? null, items, playlist: p, collection: null };
  }

  function fromCollection(c: Collection): View {
    return { name: c.name, description: c.description ?? null, items: c.books, playlist: null, collection: c };
  }

  const res = resource(() => ({ id, playlist: isPlaylist }), {
    id: (k) => `${k.playlist ? 'playlist' : 'collection'}:${k.id}`,
    load: async (k): Promise<View> => (k.playlist ? fromPlaylist(await abs.getPlaylist(k.id)) : fromCollection(await abs.getCollection(k.id)))
  });
  const view = $derived(res.data);
  const items = $derived(view?.items);
  /** What Play all and Up Next can take: ebook-only books have nothing to play. */
  const listenable = $derived((items ?? []).filter((i) => !i.isMissing && hasAudio(i)));
  const playlist = $derived(view?.playlist ?? null);
  const collection = $derived(view?.collection ?? null);
  const name = $derived(view?.name ?? '');
  const noun = $derived(isPlaylist ? 'playlist' : 'collection');
  const editable = $derived(playlist ? playlist.userId === session.user?.id : !!collection && canEditCollections());
  const deletable = $derived(playlist ? editable : !!collection && canDeleteCollections());
  const rowsEditable = $derived(editable && (!!playlist || arranging));

  // Another collection: start without a half-finished edit or delete prompt.
  $effect(() => {
    void id;
    renaming = false;
    describing = false;
    arranging = false;
  });

  function entries() {
    return listenable.map((i) => queueEntry(i, i.recentEpisode ?? null));
  }

  function playAll() {
    void player.playAll(entries());
  }

  function queueAll() {
    const all = entries();
    for (const e of all) player.enqueue(e);
    toast(`Added ${plural(all.length, 'title')} to Up Next.`);
  }

  // Answers apply only if it's still the playlist or collection on screen.
  function show(p: Playlist) {
    invalidate('collections:');
    if (res.key?.id === p.id) res.mutate(fromPlaylist(p));
  }

  function showCollection(c: Collection) {
    invalidate('collections:');
    if (res.key?.id === c.id) res.mutate(fromCollection(c));
  }

  async function save(patch: { name?: string; description?: string | null }) {
    try {
      if (playlist) show(await abs.updatePlaylist(playlist.id, patch));
      else if (collection) showCollection(await abs.updateCollection(collection.id, patch));
    } catch (err) {
      toast(`Couldn't update the ${noun}. ${errorMessage(err)}`, { tone: 'error' });
    }
  }

  function rename(e: SubmitEvent) {
    e.preventDefault();
    renaming = false;
    const n = draftName.trim();
    if (n && n !== name) void save({ name: n });
  }

  function describe(e: SubmitEvent) {
    e.preventDefault();
    describing = false;
    const d = draftDesc.trim();
    if (d !== (view?.description ?? '')) void save({ description: d || null });
  }

  const entryOf = (i: Playlist['items'][number]): PlaylistEntry => ({ libraryItemId: i.libraryItemId, episodeId: i.episodeId });
  const rowKey = (i: LibraryItem) => i.id + (i.recentEpisode?.id ? `:${i.recentEpisode.id}` : '');
  const rowLabel = (i: LibraryItem) => i.recentEpisode?.title ?? i.media.metadata.title;

  /** The view with its titles in a new order (the playlist's own entries follow along). */
  function withOrder(v: View, order: LibraryItem[]): View {
    if (v.collection) return { ...v, items: order, collection: { ...v.collection, books: order } };
    if (!v.playlist) return { ...v, items: order };
    const byKey = new Map(v.playlist.items.map((e) => [e.libraryItemId + (e.episodeId ? `:${e.episodeId}` : ''), e]));
    return { ...v, items: order, playlist: { ...v.playlist, items: order.map((i) => byKey.get(rowKey(i))!) } };
  }

  interface Order {
    id: string;
    playlist: boolean;
    items: LibraryItem[];
  }

  const orders = new OrderSync<Order, Playlist | Collection>({
    save: (o) =>
      o.playlist
        ? abs.updatePlaylist(o.id, { items: o.items.map((i) => ({ libraryItemId: i.id, episodeId: i.recentEpisode?.id ?? null })) })
        : abs.updateCollection(o.id, { books: o.items.map((i) => i.id) }),
    apply: (o) => {
      const v = res.data;
      if (v && res.key?.id === o.id) res.mutate(withOrder(v, o.items));
    },
    saved: (r) => ('items' in r ? show(r) : showCollection(r)),
    failed: (err) => toast(`Couldn't save the new order. ${errorMessage(err)}`, { tone: 'error' })
  });

  function reorder(from: number, to: number) {
    const v = view;
    if (!v) return;
    const kind = { id, playlist: !!v.playlist };
    void orders.change({ ...kind, items: v.items }, { ...kind, items: move(v.items, from, to) });
  }

  async function removeFromPlaylist(index: number) {
    if (!playlist) return;
    // Removing the last entry deletes the playlist on the server, so that one asks first instead.
    if (playlist.items.length === 1) return deleteIt();
    const pid = playlist.id;
    const order = playlist.items.map(entryOf);
    const entry = order[index];
    const title = items?.[index] ? rowLabel(items[index]) : 'Title';
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

  async function removeFromCollection(index: number) {
    if (!collection || !items?.[index]) return;
    const cid = collection.id;
    const book = items[index];
    const order = items.map((i) => i.id);
    try {
      showCollection(await abs.removeFromCollection(cid, [book.id]));
      toast(`Removed ${book.media.metadata.title} from ${name}.`, {
        action: {
          label: 'Undo',
          run: async () => {
            try {
              await abs.addToCollection(cid, [book.id]);
              showCollection(await abs.updateCollection(cid, { books: order }));
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

  async function remove(index: number) {
    if (playlist) return removeFromPlaylist(index);
    return removeFromCollection(index);
  }

  async function deleteIt() {
    const target = playlist ?? collection;
    if (!target) return;
    const sure = await confirmDialog({
      title: `Delete ${name}?`,
      message:
        playlist && playlist.items.length === 1
          ? `It's the last title in this playlist, and a playlist can't be empty. The title stays in your library.`
          : `The ${noun} goes for everyone who can see it. The titles stay in your library.`,
      confirmLabel: `Delete ${noun}`,
      danger: true
    });
    if (!sure) return;
    try {
      await (playlist ? abs.deletePlaylist(target.id) : abs.deleteCollection(target.id));
      invalidate('collections:');
      invalidate(`${noun}:${target.id}`);
      toast(`Deleted ${name}.`);
      void goto('/collections');
    } catch (err) {
      toast(`Couldn't delete the ${noun}. ${errorMessage(err)}`, { tone: 'error' });
    }
  }
</script>

<svelte:head><title>{pageTitle(name || (isPlaylist ? 'Playlist' : 'Collection'))}</title></svelte:head>

{#snippet removeButton(i: number)}
  <button class="icon-btn" aria-label="Remove from {noun}" title="Remove from {noun}" onclick={() => remove(i)}><X size={15} /></button>
{/snippet}

{#if res.error}
  <div class="page">
    <ErrorState title="Couldn't open this {noun}" message={res.error} cause={res.cause} onretry={() => res.refresh()} />
  </div>
{:else if !view || !items}
  <Loading label="Loading {noun}" />
{:else}
  <div class="page">
    <header>
      {#if renaming}
        <form onsubmit={rename}>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="field title-field serif"
            bind:value={draftName}
            aria-label="{isPlaylist ? 'Playlist' : 'Collection'} name"
            autofocus
            onblur={() => (renaming = false)}
          />
        </form>
      {:else}
        <h1 class="page-title">
          {name}
          {#if editable}
            <button
              class="icon-btn"
              aria-label="Rename {noun}"
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
      {#if describing}
        <form class="desc-form" onsubmit={describe}>
          <!-- svelte-ignore a11y_autofocus -->
          <textarea class="field" bind:value={draftDesc} rows="4" aria-label="Description" autofocus></textarea>
          <div class="row">
            <button class="btn btn-primary">Save</button>
            <button type="button" class="btn btn-quiet" onclick={() => (describing = false)}>Cancel</button>
          </div>
        </form>
      {:else}
        {#if view.description}<div class="desc serif">{@html safeHtml(view.description)}</div>{/if}
        {#if editable}
          <button
            class="link edit-desc"
            onclick={() => {
              // Edited as plain text: the server stores what it's given, and safeHtml keeps the paragraphs.
              draftDesc = view.description ? (new DOMParser().parseFromString(view.description, 'text/html').body.textContent ?? '') : '';
              describing = true;
            }}>{view.description ? 'Edit description' : 'Add a description'}</button
          >
        {/if}
      {/if}
      <div class="actions">
        {#if listenable.length}
          <button class="btn btn-primary" onclick={playAll}><Play size={16} fill="currentColor" strokeWidth={0} /> Play all</button>
          <button class="btn btn-quiet" onclick={queueAll}><ListEnd size={16} /> Add all to Up Next</button>
        {/if}
        {#if editable && collection && items.length}
          <button class="btn btn-quiet" aria-pressed={arranging} onclick={() => (arranging = !arranging)}>
            {#if arranging}<Check size={16} /> Done{:else}<ArrowUpDown size={16} /> Arrange books{/if}
          </button>
        {/if}
        {#if deletable}
          <div class="spacer"></div>
          <button class="btn btn-quiet" onclick={deleteIt}><Trash2 size={16} /> Delete {noun}</button>
        {/if}
      </div>
    </header>

    {#if !items.length}
      <EmptyState title="This {noun} is empty">
        <p>
          {#if isPlaylist}Add titles with the playlist button on their page.{:else}Add books from their menu: Add to collection…{/if}
        </p>
      </EmptyState>
    {:else if rowsEditable}
      <div class="rows">
        <ReorderList {items} key={rowKey} label={rowLabel} onmove={reorder}>
          {#snippet row(item, i)}
            <ItemRow {item}>
              {#snippet actions()}{@render removeButton(i)}{/snippet}
            </ItemRow>
          {/snippet}
        </ReorderList>
      </div>
    {:else if isPlaylist}
      <div class="rows">
        {#each items as item (rowKey(item))}<ItemRow {item} />{/each}
      </div>
    {:else}
      <div class="grid">
        {#each items as item (item.id)}<ItemCard {item} />{/each}
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
  .edit-desc {
    margin-top: 8px;
    font-size: var(--t-sm);
  }
  .desc-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
    max-width: 66ch;
  }
  .desc-form textarea {
    width: 100%;
    resize: vertical;
  }
  .desc-form .row {
    display: flex;
    gap: 8px;
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
