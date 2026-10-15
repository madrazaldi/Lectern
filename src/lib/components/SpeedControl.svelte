<script lang="ts">
  import { Minus, Plus } from '@lucide/svelte';
  import { player } from '$lib/stores/player.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import Popover from './Popover.svelte';

  let { placement = 'up' }: { placement?: 'up' | 'down' } = $props();
  const presets = [0.8, 1, 1.2, 1.5, 1.75, 2];
  const label = $derived(`${prefs.playbackRate.toFixed(2).replace(/\.?0+$/, '')}×`);
</script>

<Popover label="Playback speed" {placement} triggerClass="icon-btn speed-trigger">
  {#snippet trigger()}
    <span class="speed num">{label}</span>
  {/snippet}
  {#snippet children()}
    <div class="wrap">
      <div class="stepper">
        <button class="icon-btn" onclick={() => player.setRate(prefs.playbackRate - 0.05)} aria-label="Slower"><Minus size={16} /></button>
        <span class="big num">{label}</span>
        <button class="icon-btn" onclick={() => player.setRate(prefs.playbackRate + 0.05)} aria-label="Faster"><Plus size={16} /></button>
      </div>
      <div class="presets">
        {#each presets as p (p)}
          <button class="preset num" class:on={Math.abs(prefs.playbackRate - p) < 0.001} onclick={() => player.setRate(p)}>{p}×</button>
        {/each}
      </div>
    </div>
  {/snippet}
</Popover>

<style>
  :global(.speed-trigger) {
    width: auto !important;
    padding: 0 8px;
  }
  .speed {
    font-size: var(--t-sm);
    font-weight: 650;
    min-width: 3ch;
  }
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .stepper {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .big {
    font-size: var(--t-xl);
    font-weight: 600;
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }
  .preset {
    height: 30px;
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
    color: var(--text-2);
  }
  .preset:hover {
    background: var(--rule-soft);
    color: var(--text);
  }
  .preset.on {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 650;
  }
</style>
