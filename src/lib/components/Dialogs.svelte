<script lang="ts">
  import { X } from '@lucide/svelte';
  import { dialogs } from '$lib/util/dialogs.svelte';
  import Modal from './Modal.svelte';
  import PlaylistPicker from './PlaylistPicker.svelte';
  import ShortcutList from './ShortcutList.svelte';

  /** App-wide dialogs, opened through `dialogs` from anywhere (context menus, the "?" key). */
</script>

{#if dialogs.playlist}
  {@const target = dialogs.playlist}
  <Modal label="Add {target.title} to a playlist" width={320} onclose={() => (dialogs.playlist = null)}>
    {#snippet children({ close })}
      <p class="for">{target.title}</p>
      <PlaylistPicker libraryId={target.libraryId} entry={target.entry} {close} />
    {/snippet}
  </Modal>
{/if}

{#if dialogs.shortcuts}
  <Modal label="Keyboard shortcuts" width={620} onclose={() => (dialogs.shortcuts = false)}>
    {#snippet children({ close })}
      <header>
        <h2 class="serif">Keyboard shortcuts</h2>
        <button class="icon-btn" onclick={close} aria-label="Close"><X size={18} /></button>
      </header>
      <ShortcutList />
    {/snippet}
  </Modal>
{/if}

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  h2 {
    font-size: var(--t-xl);
    font-weight: 600;
  }
  .for {
    margin: 0 8px 10px;
    font-family: var(--font-serif);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
