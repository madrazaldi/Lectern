<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    placement?: 'up' | 'down';
    align?: 'start' | 'end' | 'center';
    trigger: Snippet<[{ open: boolean }]>;
    children: Snippet<[{ close: () => void }]>;
    triggerClass?: string;
    pressed?: boolean;
  }
  let { label, placement = 'up', align = 'end', trigger, children, triggerClass = 'icon-btn', pressed }: Props = $props();

  let open = $state(false);
  let root: HTMLDivElement;

  const close = () => (open = false);

  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.contains(e.target as Node)) close();
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
</script>

<div class="pop" bind:this={root}>
  <button
    class={triggerClass}
    aria-label={label}
    title={label}
    aria-expanded={open}
    aria-pressed={pressed}
    onclick={() => (open = !open)}
  >
    {@render trigger({ open })}
  </button>
  {#if open}
    <div class="panel {placement} {align}" role="dialog" aria-label={label}>
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
