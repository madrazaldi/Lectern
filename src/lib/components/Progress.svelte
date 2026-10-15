<script lang="ts">
  /** Thin progress rule shown under covers. */
  interface Props {
    value: number;
    finished?: boolean;
    /** Accessible name, e.g. "Listening progress" or "Download progress". */
    label?: string;
  }
  let { value, finished = false, label = 'Listening progress' }: Props = $props();
  const pct = $derived(Math.round(Math.min(1, Math.max(0, finished ? 1 : value)) * 100));
</script>

<div
  class="track"
  class:finished
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={pct}
  aria-valuetext={finished ? 'Finished' : `${pct}%`}
>
  <div class="fill" style:width="{pct}%"></div>
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
