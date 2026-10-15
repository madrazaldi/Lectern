<script lang="ts">
  import { ArrowDownToLine, CircleCheck, RotateCw, Trash2, X } from '@lucide/svelte';
  import { inTauri } from '$lib/native';
  import { downloadKey, downloads } from '$lib/stores/downloads.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { toast } from '$lib/stores/toast.svelte';

  interface Props {
    itemId: string;
    episodeId?: string | null;
    /** Icon only, for dense rows. */
    compact?: boolean;
  }
  let { itemId, episodeId = null, compact = false }: Props = $props();

  const record = $derived(downloads.get(itemId, episodeId));
  const job = $derived(downloads.jobFor(itemId, episodeId));
  const pct = $derived(record?.bytesTotal ? Math.floor((record.bytesDone / record.bytesTotal) * 100) : 0);
  const status = $derived(job ? 'downloading' : record?.status);

  // Deleting can throw away gigabytes, so it takes a second, deliberate click.
  let confirming = $state(false);
  $effect(() => {
    if (!confirming) return;
    const t = setTimeout(() => (confirming = false), 5000);
    return () => clearTimeout(t);
  });

  async function remove() {
    confirming = false;
    if (!record) return;
    const title = record.title;
    await downloads.remove(record);
    toast(`Removed the download of ${title}.`);
  }
</script>

{#if inTauri && session.canDownload}
  {#if status === 'downloading'}
    <button
      class={compact ? 'icon-btn' : 'btn btn-quiet btn-lg'}
      onclick={() => downloads.cancel(record ?? downloadKey(itemId, episodeId))}
      aria-label="Cancel download ({pct}%)"
      title="Downloading, {pct}%. Click to cancel."
    >
      <span class="ring" style:--p="{pct}%"><X size={compact ? 12 : 13} /></span>
      {#if !compact}<span class="num">{pct}%</span>{/if}
    </button>
  {:else if status === 'ready' && confirming}
    <span class="confirm" role="group" aria-label="Delete the downloaded copy?">
      {#if !compact}<span class="faint">Delete the copy on this computer?</span>{/if}
      <button class={compact ? 'icon-btn danger' : 'btn btn-danger btn-lg'} onclick={remove} aria-label="Delete download" title="Delete download">
        <Trash2 size={compact ? 16 : 17} />
        {#if !compact}Delete{/if}
      </button>
      <button class={compact ? 'icon-btn' : 'btn btn-quiet btn-lg'} onclick={() => (confirming = false)} aria-label="Keep download" title="Keep">
        {#if compact}<X size={16} />{:else}Keep{/if}
      </button>
    </span>
  {:else if status === 'ready'}
    <button
      class={compact ? 'icon-btn on' : 'btn btn-quiet btn-lg'}
      onclick={() => (confirming = true)}
      aria-label="Downloaded. Remove download"
      title="Downloaded. Click to remove the copy on this computer."
    >
      <CircleCheck size={compact ? 17 : 18} />
      {#if !compact}Downloaded{/if}
    </button>
  {:else if status === 'paused' || status === 'failed'}
    <button
      class={compact ? 'icon-btn' : 'btn btn-quiet btn-lg'}
      class:err={status === 'failed'}
      onclick={() => downloads.start(itemId, episodeId)}
      disabled={!session.online}
      aria-label={status === 'paused' ? `Resume download (${pct}% done)` : 'Retry download'}
      title={status === 'paused' ? `Paused at ${pct}%. Click to resume.` : record?.error ? `Download stopped: ${record.error}` : 'Download stopped'}
    >
      <RotateCw size={compact ? 16 : 17} />
      {#if !compact}{status === 'paused' ? `Resume download · ${pct}%` : 'Retry download'}{/if}
    </button>
  {:else}
    <button
      class={compact ? 'icon-btn' : 'btn btn-quiet btn-lg'}
      onclick={() => downloads.start(itemId, episodeId)}
      disabled={!session.online}
      aria-label="Download"
      title="Download to listen offline"
    >
      <ArrowDownToLine size={compact ? 17 : 18} />
      {#if !compact}Download{/if}
    </button>
  {/if}
{/if}

<style>
  .ring {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
  }
  /* Progress drawn as a donut behind the cancel icon. */
  .ring::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(var(--accent) var(--p), var(--rule) 0);
    -webkit-mask: radial-gradient(circle, transparent 7px, #000 7.5px);
    mask: radial-gradient(circle, transparent 7px, #000 7.5px);
  }
  .on {
    color: var(--accent);
  }
  .err,
  .danger {
    color: var(--danger);
  }
  .confirm {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--t-sm);
  }
</style>
