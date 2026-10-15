<script lang="ts">
  import { containKeys } from '$lib/util/confirm';
  import CollectionPicker from './CollectionPicker.svelte';
  import Modal from './Modal.svelte';

  /** "Add to collection" for a title opened from its menu. Mounted on demand by `openCollectionPicker`. */
  interface Props {
    libraryId: string;
    itemIds: string[];
    title: string;
    onclose: () => void;
  }
  let { libraryId, itemIds, title, onclose }: Props = $props();
</script>

<Modal label="Add {title} to a collection" width={320} {onclose}>
  {#snippet children({ close })}
    <div {@attach containKeys}>
      <p class="for">{title}</p>
      <CollectionPicker {libraryId} {itemIds} {close} />
    </div>
  {/snippet}
</Modal>

<style>
  .for {
    margin: 0 8px 10px;
    font-family: var(--font-serif);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
