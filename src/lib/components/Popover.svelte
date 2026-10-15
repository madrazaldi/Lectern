<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';

  interface Props {
    label: string;
    placement?: 'up' | 'down';
    align?: 'start' | 'end' | 'center';
    trigger: Snippet<[{ open: boolean }]>;
    children: Snippet<[{ close: () => void }]>;
    triggerClass?: string;
    /** Highlights the trigger (e.g. a sleep timer is running). Visual only: the trigger's state is aria-expanded. */
    active?: boolean;
  }
  let { label, placement = 'up', align = 'end', trigger, children, triggerClass = 'icon-btn', active = false }: Props = $props();

  let open = $state(false);
  let root: HTMLDivElement;
  let button: HTMLButtonElement;
  let panel = $state<HTMLDivElement>();
  const id = $props.id();

  function close(refocus = true) {
    open = false;
    if (refocus) button?.focus();
  }

  $effect(() => {
    if (!open) return;
    // Move into the panel unless something in it already took focus (a search box focuses itself).
    void tick().then(() => {
      if (panel && !panel.contains(document.activeElement))
        panel.querySelector<HTMLElement>('input, button:not(:disabled), [tabindex]:not([tabindex="-1"])')?.focus();
    });
    const onDown = (e: PointerEvent) => {
      if (!root.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  });

  // Tabbing out of the panel closes it. A null relatedTarget (a click on something unfocusable, the window
  // losing focus) is left to the pointerdown handler, so clicks inside the panel still land.
  function onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (open && next && !root.contains(next)) close(false);
  }
</script>

<div class="pop" bind:this={root} onfocusout={onFocusOut}>
  <button
    bind:this={button}
    class={triggerClass}
    class:active
    aria-label={label}
    title={label}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={open ? id : undefined}
    onclick={() => (open ? close(false) : (open = true))}
  >
    {@render trigger({ open })}
  </button>
  {#if open}
    <div class="panel {placement} {align}" role="dialog" aria-label={label} {id} bind:this={panel}>
      {@render children({ close })}
    </div>
  {/if}
</div>

<style>
  .pop {
    position: relative;
    display: inline-flex;
  }
  .panel {
    position: absolute;
    z-index: 40;
    min-width: 220px;
    padding: 8px;
    border-radius: var(--r-md);
    background: var(--raised-2);
    border: 1px solid var(--rule);
    box-shadow: 0 18px 40px -12px rgb(0 0 0 / 0.55);
    animation: pop 140ms var(--ease);
  }
  .up {
    bottom: calc(100% + 10px);
    transform-origin: bottom;
  }
  .down {
    top: calc(100% + 8px);
    transform-origin: top;
  }
  .end {
    right: 0;
  }
  .start {
    left: 0;
  }
  .center {
    left: 50%;
    translate: -50% 0;
  }
  @keyframes pop {
    from {
      opacity: 0;
      scale: 0.96;
    }
  }
</style>
