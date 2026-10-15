<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte';

  /** A page-level spinner that screen readers hear as "Loading…". */
  let { label = 'Loading', size = 26, inline = false }: { label?: string; size?: number; inline?: boolean } = $props();
</script>

<div class="loading" class:inline role="status">
  <LoaderCircle {size} class="spin" aria-hidden="true" />
  <span class="sr-only">{label}…</span>
</div>

<style>
  .loading {
    display: grid;
    place-items: center;
    height: 60vh;
    color: var(--text-3);
  }
  .inline {
    display: inline-grid;
    height: auto;
  }
</style>
