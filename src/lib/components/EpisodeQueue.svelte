<script lang="ts">
  import { CircleAlert, CircleCheck, Clock, LoaderCircle } from '@lucide/svelte';
  import * as abs from '$lib/api/abs';
  import { serverNow } from '$lib/api/client';
  import type { EpisodeDownload } from '$lib/api/types';
  import { episodeDownloads } from '$lib/stores/episodeDownloads.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { plural } from '$lib/util/format';

  /**
   * What the server is downloading for this podcast, live from the socket: the episode in progress, those
   * waiting, and those that finished while the page was open.
   */
  let { itemId, canClear = false }: { itemId: string; canClear?: boolean } = $props();

  // Only downloads that finish from now on (server time): older ones are already in the episode list, or failed long ago.
  let hiddenBefore = $state(serverNow());

  const q = $derived(episodeDownloads.forItem(itemId));
  const done = $derived(q.done.filter((d) => (d.finishedAt ?? 0) >= hiddenBefore));
  const busy = $derived(!!q.current || q.queued.length > 0);
  const failed = $derived(done.filter((d) => d.failed).length);

  const label = (d: EpisodeDownload) => d.episodeDisplayTitle || 'Untitled episode';

  async function clear() {
    try {
      await abs.clearEpisodeQueue(itemId);
    } catch (err) {
      toast(`Couldn't clear the queue. ${errorMessage(err)}`, { tone: 'error' });
    }
  }
</script>

{#if busy || done.length}
  <section class="queue" aria-labelledby="queue-h">
    <div class="q-head">
      <h2 id="queue-h">Downloading to the server</h2>
      <span class="faint num" aria-live="polite">
        {#if busy}{plural((q.current ? 1 : 0) + q.queued.length, 'episode')} to go{:else if failed}{plural(failed, 'download')} failed{:else}Done{/if}
      </span>
      <div class="spacer"></div>
      {#if canClear && q.queued.length}<button class="btn btn-quiet" onclick={clear}>Cancel waiting</button>{/if}
      {#if !busy}<button class="btn btn-quiet" onclick={() => (hiddenBefore = serverNow() + 1)}>Dismiss</button>{/if}
    </div>
    <ul>
      {#if q.current}
        <li class="now"><LoaderCircle size={15} class="spin" aria-hidden="true" /><span>{label(q.current)}</span><span class="faint">Downloading</span></li>
      {/if}
      {#each q.queued as d (d.id)}
        <li><Clock size={15} aria-hidden="true" /><span>{label(d)}</span><span class="faint">Waiting</span></li>
      {/each}
      {#each done as d (d.id)}
        <li class:bad={d.failed}>
          {#if d.failed}<CircleAlert size={15} aria-hidden="true" />{:else}<CircleCheck size={15} aria-hidden="true" />{/if}
          <span>{label(d)}</span><span class="faint">{d.failed ? 'Failed' : 'Added'}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .queue {
    margin-top: 32px;
    padding: 14px 18px;
    border-radius: var(--r-md);
    border: 1px solid var(--rule-soft);
    background: var(--raised);
  }
  .q-head {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: var(--t-sm);
  }
  .q-head .btn {
    height: 30px;
    padding: 0 12px;
  }
  h2 {
    font-size: var(--t-md);
    font-weight: 620;
  }
  .spacer {
    flex: 1;
  }
  ul {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: var(--t-sm);
  }
  li {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    color: var(--text-2);
  }
  li span:nth-child(2) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .now {
    color: var(--text);
  }
  .now :global(svg) {
    color: var(--accent);
  }
  .bad :global(svg) {
    color: var(--danger);
  }
</style>
