<script lang="ts">
  import { ArrowDownToLine, CircleCheck, RotateCw, X } from '@lucide/svelte';
  import { inTauri } from '$lib/native';
  import { downloads } from '$lib/stores/downloads.svelte';
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
  const pct = $derived(record?.bytesTotal ? Math.floor((record.bytesDone / record.bytesTotal) * 100) : 0);

  async function remove() {
    if (!record) return;
    const title = record.title;
    await downloads.remove(record.key);
    toast(`Removed the download of ${title}.`);
  }
</script>

{#if inTauri && session.canDownload}
  {#if record?.status === 'downloading'}
    <button
      class={compact ? 'icon-btn' : 'btn btn-quiet btn-lg'}
      onclick={() => downloads.cancel(record.key)}
      aria-label="Cancel download"
      title="Downloading, {pct}%. Click to cancel."
    >
      <span class="ring" style:--p="{pct}%"><X size={compact ? 12 : 13} /></span>
      {#if !compact}<span class="num">{pct}%</span>{/if}
    </button>
  {:else if record?.status === 'ready'}
    <button
      class={compact ? 'icon-btn on' : 'btn btn-quiet btn-lg'}
      onclick={remove}
      aria-label="Remove download"
      title="Downloaded. Click to remove the copy on this computer."
    >
      <CircleCheck size={compact ? 17 : 18} />
      {#if !compact}Downloaded{/if}
    </button>
  {:else if record?.status === 'failed'}
    <button
      class={compact ? 'icon-btn' : 'btn btn-quiet btn-lg'}
      onclick={() => downloads.start(itemId, episodeId)}
      disabled={!session.online}
      aria-label="Retry download"
      title={record.error ? `Download stopped: ${record.error}` : 'Download stopped'}
    >
      <RotateCw size={compact ? 16 : 17} />
      {#if !compact}Retry download{/if}
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
</style>
