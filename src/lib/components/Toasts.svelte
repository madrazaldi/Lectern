<script lang="ts">
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { X } from '@lucide/svelte';
  import { dismiss, toasts } from '$lib/stores/toast.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast" class:error={t.tone === 'error'} animate:flip={{ duration: 200 }} transition:fly={{ y: 12, duration: 200 }}>
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
</div>

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
    color: #1b1922;
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
  .x:hover {
    opacity: 1;
  }
</style>
