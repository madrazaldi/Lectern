<script lang="ts">
  import { CircleAlert, Pause, Play, RotateCw, Trash2, X } from '@lucide/svelte';
  import Cover from '$lib/components/Cover.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import { inTauri } from '$lib/native';
  import { downloads, type DownloadRecord } from '$lib/stores/downloads.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { bytes, duration } from '$lib/util/format';

  let confirmAll = $state(false);

  function play(r: DownloadRecord) {
    if (player.isCurrent(r.itemId, r.episodeId)) player.toggle();
    else void player.play(r.itemId, r.episodeId);
  }

  function progressOf(r: DownloadRecord) {
    return session.progressFor(r.itemId, r.episodeId);
  }
</script>

<div class="page">
  <header class="head">
    <h1 class="page-title">Downloads</h1>
    {#if downloads.list.length}
      <span class="faint num">{bytes(downloads.usage)} on this computer</span>
      <div class="spacer"></div>
      {#if confirmAll}
        <span class="faint">Delete every download?</span>
        <button class="btn btn-quiet" onclick={() => (confirmAll = false)}>Keep</button>
        <button
          class="btn btn-danger"
          onclick={async () => {
            confirmAll = false;
            await downloads.removeAll();
          }}>Delete all</button
        >
      {:else}
        <button class="btn btn-quiet" onclick={() => (confirmAll = true)}><Trash2 size={16} /> Delete all</button>
      {/if}
    {/if}
  </header>

  {#if !inTauri}
    <EmptyState title="Downloads need the desktop app">
      <p>Offline listening stores files on your computer, which a browser tab can't do.</p>
    </EmptyState>
  {:else if !downloads.list.length}
    <EmptyState title="Nothing downloaded yet">
      <p>
        Use <strong>Download</strong> on a book or episode to keep a copy here. Downloads play without a connection, and your progress syncs when you're back online.
      </p>
    </EmptyState>
  {:else}
    <ul class="list">
      {#each downloads.list as r (r.key)}
        {@const p = progressOf(r)}
        {@const current = player.isCurrent(r.itemId, r.episodeId)}
        <li class="row" class:current>
          <a class="art" href="/item/{r.itemId}">
            <Cover itemId={r.itemId} title={r.title} updatedAt={r.item.updatedAt} width={120} aspect={1} hasCover={!!r.item.media.coverPath} />
          </a>
          <div class="main">
            <a class="title serif" href="/item/{r.itemId}">{r.title}</a>
            <span class="sub">{r.author}</span>
            {#if r.status === 'downloading'}
              <div class="dl">
                <Progress value={r.bytesTotal ? r.bytesDone / r.bytesTotal : 0} />
                <span class="faint num">{bytes(r.bytesDone)} of {bytes(r.bytesTotal)}</span>
              </div>
            {:else if r.status === 'failed'}
              <span class="err"><CircleAlert size={14} /> Download stopped{r.error ? `: ${r.error}` : ''}</span>
            {:else}
              <span class="faint num">
                {duration(r.duration, { short: true })} · {bytes(r.bytesTotal)}{p?.isFinished
                  ? ' · Finished'
                  : p?.progress
                    ? ` · ${Math.round(p.progress * 100)}%`
                    : ''}
              </span>
            {/if}
          </div>
          <div class="actions">
            {#if r.status === 'ready'}
              <button class="icon-btn" onclick={() => play(r)} aria-label={current && player.isPlaying ? `Pause ${r.title}` : `Play ${r.title}`}>
                {#if current && player.isPlaying}<Pause size={18} fill="currentColor" strokeWidth={0} />{:else}<Play
                    size={18}
                    fill="currentColor"
                    strokeWidth={0}
                  />{/if}
              </button>
              <button class="icon-btn" onclick={() => downloads.remove(r.key)} aria-label="Delete download" title="Delete download"><Trash2 size={17} /></button
              >
            {:else if r.status === 'downloading'}
              <button class="icon-btn" onclick={() => downloads.cancel(r.key)} aria-label="Cancel download" title="Cancel download"><X size={18} /></button>
            {:else}
              <button
                class="icon-btn"
                onclick={() => downloads.start(r.itemId, r.episodeId)}
                disabled={!session.online}
                aria-label="Retry download"
                title="Retry"
              >
                <RotateCw size={17} />
              </button>
              <button class="icon-btn" onclick={() => downloads.remove(r.key)} aria-label="Delete download" title="Delete download"><Trash2 size={17} /></button
              >
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .head {
    display: flex;
    align-items: baseline;
    gap: 14px;
    font-size: var(--t-sm);
  }
  .head .btn {
    align-self: center;
  }
  .spacer {
    flex: 1;
  }
  .list {
    list-style: none;
    margin: 28px 0 0;
    padding: 0;
    max-width: 900px;
  }
  .row {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) auto;
    gap: 18px;
    align-items: center;
    padding: 14px 0;
    border-bottom: 1px solid var(--rule-soft);
  }
  .art {
    display: block;
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: var(--t-sm);
  }
  .title {
    font-size: var(--t-md);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .current .title {
    color: var(--accent);
  }
  .title:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .sub {
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dl {
    display: grid;
    grid-template-columns: minmax(120px, 280px) auto;
    gap: 12px;
    align-items: center;
    margin-top: 4px;
  }
  .err {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--danger);
  }
  .actions {
    display: flex;
    gap: 4px;
  }
</style>
