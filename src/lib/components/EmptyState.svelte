<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, children }: { title: string; children?: Snippet } = $props();
</script>

<div class="empty">
  <div class="spines" aria-hidden="true">
    <span style:height="70%"></span><span style:height="92%"></span><span style:height="60%" class="lean"></span>
  </div>
  <h2 class="serif">{title}</h2>
  {#if children}<div class="body">{@render children()}</div>{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 10px;
    padding: 72px 24px;
    color: var(--text-2);
  }
  .spines {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 48px;
    margin-bottom: 10px;
    padding-bottom: 3px;
    border-bottom: 2px solid var(--rule);
  }
  .spines span {
    width: 12px;
    border-radius: 2px 2px 0 0;
    background: var(--spine-empty);
  }
  .spines .lean {
    transform: rotate(14deg);
    transform-origin: bottom right;
    margin-left: 6px;
  }
  h2 {
    font-size: var(--t-xl);
    color: var(--text);
    font-weight: 600;
  }
  .body {
    max-width: 44ch;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
</style>
