<script lang="ts">
  import * as abs from '$lib/api/abs';
  import type { Playlist } from '$lib/api/types';
  import ListPicker from './ListPicker.svelte';

  interface Props {
    libraryId: string;
    entry: abs.PlaylistEntry;
    close: () => void;
  }
  let { libraryId, entry, close }: Props = $props();

  const contains = (p: Playlist) => p.items.some((i) => i.libraryItemId === entry.libraryItemId && (i.episodeId ?? null) === (entry.episodeId ?? null));

  async function toggle(p: Playlist, had: boolean) {
    const updated = had ? await abs.removeFromPlaylist(p.id, entry) : await abs.addToPlaylist(p.id, entry);
    // Removing the last item deletes the playlist on the server; it answers without one.
    return updated && 'items' in updated ? updated : null;
  }
</script>

<ListPicker
  noun="playlist"
  load={() => abs.getPlaylists(libraryId)}
  count={(p) => p.items.length}
  has={contains}
  {toggle}
  create={(name) => abs.createPlaylist(libraryId, name, [entry])}
  {close}
/>
