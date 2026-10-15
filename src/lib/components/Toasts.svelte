<script lang="ts">
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { X } from '@lucide/svelte';
  import { dismiss, pause, resume, toasts } from '$lib/stores/toast.svelte';
  import { motion } from '$lib/util/motion';
</script>

<!-- Each toast is its own live region: errors interrupt (alert), everything else waits its turn (status). -->
<section class="toasts" aria-label="Notifications">
  {#each toasts as t (t.id)}
    <div
      class="toast"
      class:error={t.tone === 'error'}
      role={t.tone === 'error' ? 'alert' : 'status'}
      aria-live={t.tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      animate:flip={motion({ duration: 200 })}
      transition:fly={motion({ y: 12, duration: 200 })}
      onmouseenter={() => pause(t.id)}
      onmouseleave={() => resume(t.id)}
      onfocusin={() => pause(t.id)}
      onfocusout={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) resume(t.id);
      }}
    >
      <span>{t.message}</span>
      {#if t.action}
        <button
          class="act"
          onclick={() => {
            t.action?.run();
            dismiss(t.id);
          }}>{t.action.label}</button
        >
      {/if}
      <button class="x" onclick={() => dismiss(t.id)} aria-label="Dismiss"><X size={14} /></button>
    </div>
  {/each}
</section>

<style>
  .toasts {
    position: fixed;
    right: 24px;
    bottom: calc(var(--dock-h) + 20px);
    z-index: 50;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 420px;
    padding: 10px 10px 10px 16px;
    border-radius: var(--r-md);
    background: var(--text);
    color: var(--ground);
    font-size: var(--t-sm);
    font-weight: 550;
    box-shadow: 0 14px 34px -10px rgb(0 0 0 / 0.55);
  }
  .toast.error {
    background: var(--danger);
    /* Dark ink on the dark theme's coral, white on the light theme's brick: both clear 4.5:1. */
    color: var(--accent-ink);
  }
  .act {
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .x {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    opacity: 0.6;
  }
  .x:hover,
  .x:focus-visible {
    opacity: 1;
  }
  .toast :focus-visible {
    outline-color: currentColor;
  }
</style>
