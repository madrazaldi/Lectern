<script lang="ts">
  import { session } from '$lib/stores/session.svelte';
  let { count = 8, width = 168 }: { count?: number; width?: number } = $props();
  const ratio = $derived(session.library?.settings.coverAspectRatio === 0 ? 1.6 : 1);
</script>

<div class="row" style:--w="{width}px">
  {#each Array(count) as _, i (i)}
    <div class="sk" style:animation-delay="{i * 60}ms">
      <div class="c" style:aspect-ratio="1 / {ratio}"></div>
      <div class="l"></div>
      <div class="l short"></div>
    </div>
  {/each}
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--w), 1fr));
    gap: 22px;
    max-height: calc(var(--w) * 1.9);
    overflow: hidden;
  }
  .sk {
    animation: pulse 1.4s ease-in-out infinite;
  }
  .c,
  .l {
    background: var(--raised-2);
    border-radius: var(--r-sm);
  }
  .l {
    height: 12px;
    margin-top: 12px;
    width: 85%;
  }
  .short {
    width: 50%;
    margin-top: 8px;
  }
  @keyframes pulse {
    50% {
      opacity: 0.55;
    }
  }
</style>
