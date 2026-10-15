<script lang="ts">
  import { Minus, Plus } from '@lucide/svelte';
  import { player } from '$lib/stores/player.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import Popover from './Popover.svelte';

  let { placement = 'up' }: { placement?: 'up' | 'down' } = $props();
  const presets = [0.8, 1, 1.2, 1.5, 1.75, 2];
  const fmt = (r: number) => `${r.toFixed(2).replace(/\.?0+$/, '')}×`;
  const label = $derived(fmt(player.rate));
</script>

<Popover label="Playback speed" {placement} triggerClass="icon-btn speed-trigger">
  {#snippet trigger()}
    <span class="speed num">{label}</span>
  {/snippet}
  <div class="wrap">
    <div class="stepper">
      <button class="icon-btn" onclick={() => player.setRate(player.rate - 0.05)} aria-label="Slower"><Minus size={16} /></button>
      <span class="big num">{label}</span>
      <button class="icon-btn" onclick={() => player.setRate(player.rate + 0.05)} aria-label="Faster"><Plus size={16} /></button>
    </div>
    <div class="presets">
      {#each presets as p (p)}
        <button class="preset num" class:on={Math.abs(player.rate - p) < 0.001} onclick={() => player.setRate(p)}>{p}×</button>
      {/each}
    </div>
    {#if prefs.perItemSpeed && player.item}
      <p class="scope">
        {#if player.hasOwnRate}
          Just for this title. <button class="link" onclick={() => player.resetRate()}>Use default ({fmt(prefs.playbackRate)})</button>
        {:else}
          Default speed. Changing it here applies to this title only.
        {/if}
      </p>
    {/if}
  </div>
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
  .scope {
    margin: 2px 2px 0;
    max-width: 220px;
    font-size: var(--t-xs);
    color: var(--text-3);
  }
  .link {
    color: var(--accent);
    font-weight: 600;
  }
  .link:hover {
    text-decoration: underline;
  }
  .preset.on {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 650;
  }
</style>
