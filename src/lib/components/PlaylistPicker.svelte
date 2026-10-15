<script lang="ts">
  import { Check, LoaderCircle, Plus } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import * as abs from '$lib/api/abs';
  import type { Playlist } from '$lib/api/types';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';

  interface Props {
    libraryId: string;
    entry: abs.PlaylistEntry;
    close: () => void;
  }
  let { libraryId, entry, close }: Props = $props();

  let playlists = $state<Playlist[] | null>(null);
  let creating = $state(false);
  let name = $state('');
  let busy = $state<string | null>(null);

  onMount(() => {
    abs
      .getPlaylists(libraryId)
      .then((p) => (playlists = p))
      .catch((err) => {
        toast(`Couldn't load playlists. ${errorMessage(err)}`, { tone: 'error' });
        close();
      });
  });

  const contains = (p: Playlist) => p.items.some((i) => i.libraryItemId === entry.libraryItemId && (i.episodeId ?? null) === (entry.episodeId ?? null));

  async function toggle(p: Playlist) {
    busy = p.id;
    try {
      const had = contains(p);
      const updated = had ? await abs.removeFromPlaylist(p.id, entry) : await abs.addToPlaylist(p.id, entry);
      // Removing the last item deletes the playlist on the server; it answers without one.
      playlists = updated && 'items' in updated ? playlists!.map((x) => (x.id === p.id ? updated : x)) : playlists!.filter((x) => x.id !== p.id);
      toast(had ? `Removed from ${p.name}.` : `Added to ${p.name}.`);
    } catch (err) {
      toast(`Couldn't update ${p.name}. ${errorMessage(err)}`, { tone: 'error' });
    } finally {
      busy = null;
    }
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    busy = 'new';
    try {
      await abs.createPlaylist(libraryId, n, [entry]);
      toast(`Added to the new playlist ${n}.`);
      close();
    } catch (err) {
      toast(`Couldn't create the playlist. ${errorMessage(err)}`, { tone: 'error' });
    } finally {
      busy = null;
    }
  }
</script>

<div class="picker">
  <p class="head">Add to playlist</p>
  {#if !playlists}
    <div class="loading"><LoaderCircle size={18} class="spin" /></div>
  {:else}
    <ul>
      {#each playlists as p (p.id)}
        <li>
          <button class="opt" onclick={() => toggle(p)} disabled={busy !== null} aria-pressed={contains(p)}>
            <span class="tick"
              >{#if busy === p.id}<LoaderCircle size={14} class="spin" />{:else if contains(p)}<Check size={14} />{/if}</span
            >
            <span class="name">{p.name}</span>
            <span class="faint num">{p.items.length}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if creating}
    <form onsubmit={create}>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="field" bind:value={name} placeholder="Playlist name" aria-label="New playlist name" autofocus />
      <button class="btn btn-primary" disabled={!name.trim() || busy !== null}>Create</button>
    </form>
  {:else}
    <button class="opt new" onclick={() => (creating = true)}><span class="tick"><Plus size={14} /></span> New playlist…</button>
  {/if}
</div>

<style>
  .picker {
    width: 260px;
  }
  .head {
    margin: 2px 8px 6px;
    font-size: var(--t-xs);
    font-weight: 650;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 260px;
    overflow-y: auto;
  }
  .opt {
    display: grid;
    grid-template-columns: 18px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 34px;
    padding: 0 8px;
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
    text-align: left;
  }
  .opt:hover:not(:disabled) {
    background: var(--rule-soft);
  }
  .tick {
    display: inline-flex;
    color: var(--accent);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .new {
    margin-top: 4px;
    border-top: 1px solid var(--rule-soft);
    border-radius: 0;
    color: var(--text-2);
  }
  form {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  form input {
    flex: 1;
    min-width: 0;
    height: 34px;
  }
  form .btn {
    height: 34px;
  }
  .loading {
    display: grid;
    place-items: center;
    height: 60px;
    color: var(--text-3);
  }
</style>
