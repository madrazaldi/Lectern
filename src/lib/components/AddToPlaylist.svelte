<script lang="ts">
  import { ListPlus } from '@lucide/svelte';
  import type { PlaylistEntry } from '$lib/api/abs';
  import PlaylistPicker from './PlaylistPicker.svelte';
  import Popover from './Popover.svelte';

  interface Props {
    libraryId: string;
    entry: PlaylistEntry;
    placement?: 'up' | 'down';
    size?: number;
  }
  let { libraryId, entry, placement = 'down', size = 18 }: Props = $props();
</script>

<Popover label="Add to playlist" {placement} align="start">
  {#snippet trigger()}<ListPlus {size} />{/snippet}
  {#snippet children({ close })}<PlaylistPicker {libraryId} {entry} {close} />{/snippet}
</Popover>
