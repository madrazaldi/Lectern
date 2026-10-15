<script lang="ts">
  import { FolderPlus } from '@lucide/svelte';
  import CollectionPicker from './CollectionPicker.svelte';
  import Popover from './Popover.svelte';

  interface Props {
    libraryId: string;
    itemIds: string[];
    placement?: 'up' | 'down';
    size?: number;
  }
  let { libraryId, itemIds, placement = 'down', size = 18 }: Props = $props();
</script>

<Popover label="Add to collection" {placement} align="start">
  {#snippet trigger()}<FolderPlus {size} />{/snippet}
  {#snippet children({ close })}<CollectionPicker {libraryId} {itemIds} {close} />{/snippet}
</Popover>
