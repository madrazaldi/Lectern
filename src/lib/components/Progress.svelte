<script lang="ts">
  /** Thin progress rule shown under covers. */
  let { value, finished = false }: { value: number; finished?: boolean } = $props();
</script>

<div class="track" class:finished role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
  <div class="fill" style:width="{Math.min(1, Math.max(0, finished ? 1 : value)) * 100}%"></div>
</div>

<style>
  .track {
    height: 3px;
    border-radius: 2px;
    background: var(--rule);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
  }
  .finished .fill {
    background: var(--text-3);
  }
</style>
