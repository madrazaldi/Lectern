<script lang="ts">
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
    <!-- Keys typed in here are the dialog's: the app's single-key shortcuts must not see them. -->
    <div role="presentation" onkeydown={(e) => e.stopPropagation()}>
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
