<script lang="ts">
  import { CircleAlert, Pause, Play, RotateCw, Trash2, X } from '@lucide/svelte';
  import Cover from '$lib/components/Cover.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Progress from '$lib/components/Progress.svelte';
  import { inTauri } from '$lib/native';
  import { downloads, type DownloadRecord } from '$lib/stores/downloads.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { bytes, duration, timeLeft } from '$lib/util/format';

  let confirmAll = $state(false);
  /** Folder of the row whose delete is waiting for a second click. */
  let confirming = $state<string | null>(null);

  $effect(() => {
    if (!confirming) return;
    const t = setTimeout(() => (confirming = null), 6000);
    return () => clearTimeout(t);
  });

  /** Downloads from other accounts, grouped by who made them. */
  const otherGroups = $derived.by(() => {
    const groups = new Map<string, { label: string; records: DownloadRecord[]; size: number }>();
    for (const r of downloads.others) {
      const label = downloads.accountLabel(r);
      const g = groups.get(label) ?? { label, records: [], size: 0 };
      g.records.push(r);
      g.size += onDisk(r);
      groups.set(label, g);
    }
    return [...groups.values()];
  });

  function play(r: DownloadRecord) {
    if (player.isCurrent(r.itemId, r.episodeId)) player.toggle();
    else void player.play(r.itemId, r.episodeId);
  }

  function progressOf(r: DownloadRecord) {
    return session.progressFor(r.itemId, r.episodeId);
  }

  function onDisk(r: DownloadRecord) {
    return r.status === 'ready' ? r.bytesTotal : r.bytesDone;
  }

  function pct(r: DownloadRecord) {
    return r.bytesTotal ? Math.floor((r.bytesDone / r.bytesTotal) * 100) : 0;
  }

  function remove(r: DownloadRecord) {
    confirming = null;
    void downloads.remove(r);
  }

  /** "File 2 of 5 · 1.2 MB/s · 3m left" for a running download. */
  function detail(r: DownloadRecord) {
    const job = downloads.job(r);
    if (!job || job.phase === 'starting') return 'Starting…';
    if (job.phase === 'retrying') return 'Connection trouble, trying again…';
    const parts = [];
    if (r.tracks.length > 1) {
      const filePct = job.trackTotal ? Math.floor((job.trackReceived / job.trackTotal) * 100) : 0;
      parts.push(`File ${job.track} of ${r.tracks.length} (${filePct}%)`);
    }
    if (job.speed > 0) {
      parts.push(`${bytes(job.speed)}/s`);
      parts.push(timeLeft(Math.max(1, (r.bytesTotal - r.bytesDone) / job.speed)));
    }
    return parts.join(' · ');
  }
</script>

{#snippet deleteButton(r: DownloadRecord)}
  {#if confirming === r.dir}
    <span class="confirm" role="group" aria-label="Delete {r.title}?">
      <button class="btn btn-danger" onclick={() => remove(r)}>Delete</button>
      <button class="btn btn-quiet" onclick={() => (confirming = null)}>Keep</button>
    </span>
  {:else}
    <button class="icon-btn" onclick={() => (confirming = r.dir)} aria-label="Delete download of {r.title}" title="Delete download"><Trash2 size={17} /></button
    >
  {/if}
{/snippet}

<div class="page">
  <header class="head">
    <h1 class="page-title">Downloads</h1>
    {#if downloads.list.length || downloads.others.length}
      <span class="faint num">{bytes(downloads.usage)} on this computer</span>
    {/if}
    {#if downloads.list.length}
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
        {@const running = !!downloads.job(r)}
        <li class="row" class:current>
          <a class="art" href="/item/{r.itemId}">
            <Cover itemId={r.itemId} title={r.title} updatedAt={r.item.updatedAt} width={120} aspect={1} hasCover={!!r.item.media.coverPath} />
          </a>
          <div class="main">
            <a class="title serif" href="/item/{r.itemId}">{r.title}</a>
            <span class="sub">{r.author}</span>
            {#if running || r.status === 'downloading'}
              <div class="dl">
                <Progress value={r.bytesTotal ? r.bytesDone / r.bytesTotal : 0} />
                <span class="faint num">{bytes(r.bytesDone)} of {bytes(r.bytesTotal)}</span>
              </div>
              <span class="faint num small" aria-live="polite">{detail(r)}</span>
            {:else if r.status === 'paused'}
              <div class="dl">
                <Progress value={r.bytesTotal ? r.bytesDone / r.bytesTotal : 0} />
                <span class="faint num">Paused · {pct(r)}% · {bytes(r.bytesDone)} of {bytes(r.bytesTotal)}</span>
              </div>
            {:else if r.status === 'failed'}
              <span class="err"><CircleAlert size={14} /> Download stopped{r.error ? `: ${r.error}` : ''}</span>
              {#if r.bytesDone > 0}<span class="faint num small">{pct(r)}% done; retrying continues from there.</span>{/if}
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
            {#if running}
              <button class="icon-btn" onclick={() => downloads.pause(r)} aria-label="Pause download of {r.title}" title="Pause"><Pause size={17} /></button>
              <button class="icon-btn" onclick={() => downloads.cancel(r)} aria-label="Cancel download of {r.title}" title="Cancel and delete"
                ><X size={18} /></button
              >
            {:else if r.status === 'ready'}
              <button class="icon-btn" onclick={() => play(r)} aria-label={current && player.isPlaying ? `Pause ${r.title}` : `Play ${r.title}`}>
                {#if current && player.isPlaying}<Pause size={18} fill="currentColor" strokeWidth={0} />{:else}<Play
                    size={18}
                    fill="currentColor"
                    strokeWidth={0}
                  />{/if}
              </button>
              {@render deleteButton(r)}
            {:else}
              <button
                class="btn btn-quiet"
                onclick={() => downloads.start(r.itemId, r.episodeId)}
                disabled={!session.online}
                aria-label="{r.status === 'paused' ? 'Resume' : 'Retry'} download of {r.title}"
                title={session.online ? undefined : 'Needs a connection to the server'}
              >
                <RotateCw size={15} />
                {r.status === 'paused' ? 'Resume' : 'Retry'}
              </button>
              {@render deleteButton(r)}
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if inTauri && otherGroups.length}
    <section class="others">
      <h2 class="serif">From other accounts</h2>
      <p class="faint small">These were downloaded while signed in to another account. They can't be played from this one, but they still take up space.</p>
      {#each otherGroups as g (g.label)}
        <h3 class="group">{g.label} <span class="faint num">· {bytes(g.size)}</span></h3>
        <ul class="list compact">
          {#each g.records as r (r.dir)}
            <li class="row">
              <div class="main">
                <span class="title serif">{r.title}</span>
                <span class="sub">
                  {r.author ? `${r.author} · ` : ''}{bytes(onDisk(r))}{r.status === 'ready'
                    ? ''
                    : ` · ${r.status === 'downloading' ? 'Downloading' : 'Incomplete'}`}
                </span>
              </div>
              <div class="actions">{@render deleteButton(r)}</div>
            </li>
          {/each}
        </ul>
      {/each}
    </section>
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
  .compact {
    margin-top: 8px;
  }
  .compact .row {
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 10px 0;
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
  a.title:hover {
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
  .small {
    font-size: var(--t-xs);
  }
  .err {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--danger);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .confirm {
    display: inline-flex;
    gap: 6px;
  }
  .others {
    margin-top: 48px;
    max-width: 900px;
  }
  .others p {
    margin: 6px 0 0;
  }
  .group {
    margin: 24px 0 0;
    font-size: var(--t-sm);
    font-weight: 600;
  }
</style>
