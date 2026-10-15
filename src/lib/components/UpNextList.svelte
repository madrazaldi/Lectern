<script lang="ts">
  import { ArrowDown, ArrowUp, X } from '@lucide/svelte';
  import { player } from '$lib/stores/player.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { plural } from '$lib/util/format';
  import Cover from './Cover.svelte';

  /** The Up Next queue: play, reorder, remove, and what happens when it runs out. */

  function playFromQueue(i: number) {
    const q = player.queue[i];
    player.removeFromQueue(i);
    void player.play(q.itemId, q.episodeId);
  }

  function clear() {
    const before = [...player.queue];
    player.clearQueue();
    toast(`Cleared ${plural(before.length, 'title')} from Up Next.`, {
      action: { label: 'Undo', run: () => before.forEach((q) => player.enqueue(q)) }
    });
  }
</script>

<ol class="list" aria-label="Up next">
  {#each player.queue as q, i (q.itemId + (q.episodeId ?? ''))}
    <li class="mark-row">
      <button class="row" onclick={() => playFromQueue(i)} title="Play now">
        <span class="thumb"><Cover itemId={q.itemId} title={q.title} updatedAt={q.updatedAt} width={80} aspect={1} radius="4px" /></span>
        <span class="qtext">
          <span class="name">{q.title}</span>
          <span class="qsub">{q.subtitle}</span>
        </span>
      </button>
      <div class="mark-actions">
        <button class="icon-btn" aria-label="Move {q.title} up" onclick={() => player.moveInQueue(i, -1)} disabled={i === 0}><ArrowUp size={14} /></button>
        <button class="icon-btn" aria-label="Move {q.title} down" onclick={() => player.moveInQueue(i, 1)} disabled={i === player.queue.length - 1}
          ><ArrowDown size={14} /></button
        >
        <button class="icon-btn" aria-label="Remove {q.title} from Up Next" onclick={() => player.removeFromQueue(i)}><X size={14} /></button>
      </div>
    </li>
  {:else}
    <li class="empty">
      <p>Add titles from their page, or right-click one, to play them one after another.</p>
    </li>
  {/each}
  <li class="auto">
    <label>
      <input type="checkbox" bind:checked={prefs.autoContinue} />
      When Up Next is empty, continue with the {player.episode ? 'next episode' : 'next book in the series'}
    </label>
    {#if player.queue.length}<button class="link" onclick={clear}>Clear</button>{/if}
  </li>
</ol>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 8px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .mark-row {
    position: relative;
    display: flex;
    align-items: center;
  }
  .row {
    display: grid;
    grid-template-columns: 40px 1fr;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 9px 10px;
    border-radius: var(--r-sm);
    text-align: left;
    font-size: var(--t-sm);
  }
  .row:hover {
    background: var(--rule-soft);
  }
  .thumb {
    width: 40px;
  }
  .qtext {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .qsub {
    font-size: var(--t-xs);
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mark-actions {
    position: absolute;
    right: 4px;
    display: none;
    padding-left: 12px;
    background: linear-gradient(90deg, transparent, var(--raised) 12px);
  }
  .mark-row:hover .mark-actions,
  .mark-row:focus-within .mark-actions {
    display: flex;
  }
  .auto {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 8px;
    padding: 12px 10px 4px;
    border-top: 1px solid var(--rule-soft);
    font-size: var(--t-xs);
    color: var(--text-2);
  }
  .auto label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .auto input {
    accent-color: var(--accent);
  }
  .link {
    color: var(--accent);
    font-weight: 600;
  }
  .empty {
    padding: 16px 12px;
    color: var(--text-2);
    font-size: var(--t-sm);
  }
</style>
