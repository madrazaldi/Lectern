<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { activeElement, returnFocus } from '$lib/util/dom';

  /**
   * A native modal <dialog>: the page behind is inert, Escape closes it, and focus returns to where it was.
   * Mount it to open it; `onclose` tells the owner to unmount it.
   */
  interface Props {
    label: string;
    onclose: () => void;
    width?: number;
    children: Snippet<[{ close: () => void }]>;
  }
  let { label, onclose, width = 420, children }: Props = $props();

  let dialog: HTMLDialogElement;
  const close = () => dialog.close();

  onMount(() => {
    const before = activeElement();
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      returnFocus(before);
    };
  });
</script>

<dialog
  bind:this={dialog}
  aria-label={label}
  style:--w="{width}px"
  {onclose}
  onclick={(e) => {
    // A click on the backdrop lands on the dialog element itself.
    if (e.target === dialog) close();
  }}
>
  <div class="inner">{@render children({ close })}</div>
</dialog>

<style>
  dialog {
    width: min(var(--w), calc(100vw - 48px));
    max-height: min(80vh, 720px);
    padding: 0;
    border: 1px solid var(--rule);
    border-radius: var(--r-lg);
    background: var(--raised-2);
    color: var(--text);
    box-shadow: 0 30px 80px -20px rgb(0 0 0 / 0.6);
    overflow: auto;
  }
  dialog::backdrop {
    background: rgb(10 8 14 / 0.55);
    backdrop-filter: blur(3px);
  }
  dialog[open] {
    animation: rise 160ms var(--ease);
  }
  .inner {
    padding: 18px;
  }
  @keyframes rise {
    from {
      opacity: 0;
      translate: 0 8px;
    }
  }
</style>
