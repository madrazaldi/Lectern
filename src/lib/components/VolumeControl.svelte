<script lang="ts">
  import { Volume, Volume1, Volume2, VolumeX } from '@lucide/svelte';
  import { player } from '$lib/stores/player.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { toggleMute } from '$lib/util/play';
</script>

<div class="vol">
  <button class="icon-btn" onclick={toggleMute} aria-label={prefs.volume ? 'Mute' : 'Unmute'} title={prefs.volume ? 'Mute (M)' : 'Unmute (M)'}>
    {#if prefs.volume === 0}<VolumeX size={18} />{:else if prefs.volume < 0.34}<Volume size={18} />{:else if prefs.volume < 0.67}<Volume1
        size={18}
      />{:else}<Volume2 size={18} />{/if}
  </button>
  <input
    type="range"
    min="0"
    max="1"
    step="0.01"
    value={prefs.volume}
    style:--v="{prefs.volume * 100}%"
    oninput={(e) => player.setVolume(+e.currentTarget.value)}
    aria-label="Volume"
    aria-valuetext="{Math.round(prefs.volume * 100)}%"
  />
</div>

<style>
  .vol {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  input {
    appearance: none;
    width: 84px;
    height: 16px;
    background: transparent;
    cursor: pointer;
  }
  input::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--text-2) var(--v), var(--rule) var(--v));
  }
  input::-webkit-slider-thumb {
    appearance: none;
    width: 11px;
    height: 11px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--text);
    opacity: 0;
    transition: opacity 120ms;
  }
  .vol:hover input::-webkit-slider-thumb,
  input:focus-visible::-webkit-slider-thumb {
    opacity: 1;
  }
</style>
