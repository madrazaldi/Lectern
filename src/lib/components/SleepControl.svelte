<script lang="ts">
  import { Moon } from '@lucide/svelte';
  import { player } from '$lib/stores/player.svelte';
  import { clock } from '$lib/util/format';
  import Popover from './Popover.svelte';

  let { placement = 'up', showLabel = false }: { placement?: 'up' | 'down'; showLabel?: boolean } = $props();
  const options = [5, 10, 15, 30, 45, 60, 90];
  const active = $derived(player.sleep.kind !== 'off');
</script>

<Popover label="Sleep timer" {placement} pressed={active} triggerClass="icon-btn sleep-trigger">
  {#snippet trigger()}
    <Moon size={18} />
    {#if active && showLabel}<span class="left num">{clock(player.sleepRemaining)}</span>{/if}
  {/snippet}
  {#snippet children({ close })}
    <div class="menu">
      {#if active}
        <p class="status">
          {player.sleep.kind === 'chapter' ? 'Pausing at the end of this chapter' : 'Pausing in'}
          <span class="num">{clock(player.sleepRemaining)}</span>
        </p>
      {/if}
      <div class="grid">
        {#each options as m (m)}
          <button
            class="opt num"
            class:on={player.sleep.kind === 'timer' && player.sleep.minutes === m}
            onclick={() => {
              player.sleepInMinutes(m);
              close();
            }}>{m} min</button
          >
        {/each}
        <button
          class="opt wide"
          class:on={player.sleep.kind === 'chapter'}
          disabled={!player.session}
          onclick={() => {
            player.sleepAtChapterEnd();
            close();
          }}>End of chapter</button
        >
      </div>
      {#if active}
        <button
          class="opt off"
          onclick={() => {
            player.setSleep({ kind: 'off' });
            close();
          }}>Turn off timer</button
        >
      {/if}
    </div>
  {/snippet}
</Popover>

<style>
  :global(.sleep-trigger) {
    width: auto !important;
    min-width: 34px;
    padding: 0 8px;
    gap: 6px;
    grid-auto-flow: column;
  }
  .left {
    font-size: var(--t-xs);
    font-weight: 600;
  }
  .menu {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 236px;
  }
  .status {
    padding: 4px 6px 2px;
    font-size: var(--t-sm);
    color: var(--text-2);
  }
  .status .num {
    color: var(--accent);
    font-weight: 600;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .opt {
    height: 32px;
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
    color: var(--text-2);
  }
  .opt.wide {
    grid-column: span 4;
  }
  .opt:hover:not(:disabled) {
    background: var(--rule-soft);
    color: var(--text);
  }
  .opt.on {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 650;
  }
  .off {
    border-top: 1px solid var(--rule);
    border-radius: 0 0 var(--r-sm) var(--r-sm);
    padding-top: 4px;
  }
</style>
