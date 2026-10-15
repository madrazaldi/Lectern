<script lang="ts">
  import {
    ArrowDown,
    ArrowDownToLine,
    ArrowUp,
    Bookmark,
    BookmarkPlus,
    ChevronDown,
    LoaderCircle,
    Pause,
    Pencil,
    Play,
    SkipBack,
    SkipForward,
    Trash2,
    X
  } from '@lucide/svelte';
  import { fade, fly } from 'svelte/transition';
  import { coverUrl } from '$lib/api/client';
  import { player } from '$lib/stores/player.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { clock, duration } from '$lib/util/format';
  import ChapterShelf from './ChapterShelf.svelte';
  import Cover from './Cover.svelte';
  import SkipIcon from './SkipIcon.svelte';
  import SleepControl from './SleepControl.svelte';
  import SpeedControl from './SpeedControl.svelte';
  import VolumeControl from './VolumeControl.svelte';

  const item = $derived(player.item!);
  let tab = $state<'chapters' | 'bookmarks' | 'queue'>('chapters');
  let list = $state<HTMLOListElement>();
  let editing = $state<number | null>(null);
  let editTitle = $state('');

  const marks = $derived(player.episode ? [] : session.bookmarksFor(item.id));
  const remaining = $derived(Math.max(0, player.duration - player.currentTime) / (player.rate || 1));
  const chapterLeft = $derived(player.chapter ? Math.max(0, player.chapter.end - player.currentTime) / (player.rate || 1) : 0);
  const hasChapters = $derived(player.chapters.length > 1);

  // Keep the current chapter in view as playback moves on.
  $effect(() => {
    void player.chapterIndex;
    if (tab !== 'chapters' || !list) return;
    list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  function playFromQueue(i: number) {
    const q = player.queue[i];
    player.removeFromQueue(i);
    void player.play(q.itemId, q.episodeId);
  }

  async function addBookmark() {
    if (!player.ready) return;
    const at = player.currentTime;
    const label = player.chapter && hasChapters ? `${player.chapter.title} at ${clock(at - player.chapter.start)}` : clock(at);
    try {
      await session.addBookmark(item.id, at, label);
      tab = 'bookmarks';
      toast(`Bookmark added at ${clock(at)}.`);
    } catch (err) {
      toast(`Couldn't add the bookmark. ${errorMessage(err)}`, { tone: 'error' });
    }
  }

  async function saveTitle(time: number) {
    const title = editTitle.trim();
    editing = null;
    if (!title) return;
    try {
      await session.renameBookmark(item.id, time, title);
    } catch (err) {
      toast(`Couldn't rename the bookmark. ${errorMessage(err)}`, { tone: 'error' });
    }
  }

  async function remove(time: number) {
    try {
      await session.removeBookmark(item.id, time);
    } catch (err) {
      toast(`Couldn't remove the bookmark. ${errorMessage(err)}`, { tone: 'error' });
    }
  }
</script>

<div class="np" transition:fly={{ y: 40, duration: 320, opacity: 0 }} role="dialog" aria-modal="true" aria-label="Now playing">
  <div class="backdrop" style:background-image="url({coverUrl(item.id, 200, item.updatedAt)})" transition:fade={{ duration: 400 }}></div>
  <div class="veil"></div>

  <header data-tauri-drag-region>
    <button class="icon-btn close" onclick={() => (player.expanded = false)} aria-label="Close now playing" title="Close (Esc)">
      <ChevronDown size={22} />
    </button>
  </header>

  <div class="body">
    <section class="stage">
      <div class="cover">
        <Cover
          itemId={item.id}
          title={player.title}
          updatedAt={item.updatedAt}
          width={900}
          aspect={1}
          hasCover={!!item.media.coverPath}
          radius="var(--r-md)"
          eager
        />
      </div>

      <div class="heading">
        <h1 class="serif">{player.title}</h1>
        <p class="by">{player.author}</p>
      </div>

      <div class="chapter-line">
        {#if player.fromDownload}<span class="src" title="Playing the downloaded copy"><ArrowDownToLine size={13} /> Downloaded</span>{/if}
        {#if hasChapters && player.chapter}
          <span class="ch">{player.chapter.title}</span>
          <span class="faint num">{duration(chapterLeft, { short: true })} left in chapter</span>
        {:else}
          <span class="faint num">{duration(remaining, { short: true })} left</span>
        {/if}
      </div>

      <div class="shelf">
        <ChapterShelf
          size="full"
          chapters={player.chapters}
          time={player.currentTime}
          duration={player.duration}
          bookmarks={marks}
          onseek={(t) => player.seek(t)}
          disabled={!player.duration}
        />
        <div class="times num">
          <span>{clock(player.currentTime)}</span>
          <span>{duration(remaining, { short: true })} left at {player.rate}×</span>
          <span>{clock(player.duration)}</span>
        </div>
      </div>

      <div class="controls">
        <button class="icon-btn big" onclick={() => player.prevChapter()} disabled={!player.ready} aria-label="Previous chapter"><SkipBack size={22} /></button>
        <button class="icon-btn big" onclick={() => player.skip(-prefs.skipBack)} disabled={!player.ready} aria-label="Back {prefs.skipBack} seconds">
          <SkipIcon seconds={prefs.skipBack} direction="back" size={32} />
        </button>
        <button class="main" onclick={() => player.toggle()} aria-label={player.isPlaying ? 'Pause' : 'Play'}>
          {#if player.status === 'loading' || (player.buffering && player.isPlaying)}
            <LoaderCircle size={30} class="spin" />
          {:else if player.isPlaying}
            <Pause size={30} fill="currentColor" strokeWidth={0} />
          {:else}
            <Play size={30} fill="currentColor" strokeWidth={0} style="margin-left:3px" />
          {/if}
        </button>
        <button class="icon-btn big" onclick={() => player.skip(prefs.skipForward)} disabled={!player.ready} aria-label="Forward {prefs.skipForward} seconds">
          <SkipIcon seconds={prefs.skipForward} direction="forward" size={32} />
        </button>
        <button class="icon-btn big" onclick={() => player.nextChapter()} disabled={!player.ready} aria-label="Next chapter"><SkipForward size={22} /></button>
      </div>

      <div class="tools">
        <SpeedControl />
        <SleepControl showLabel />
        {#if !player.episode}
          <button class="icon-btn" onclick={addBookmark} disabled={!player.ready} aria-label="Add bookmark" title="Add bookmark (B)">
            <BookmarkPlus size={18} />
          </button>
        {/if}
        <VolumeControl />
      </div>
    </section>

    <aside class="side">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'chapters'} onclick={() => (tab = 'chapters')}>
          Chapters <span class="count num">{player.chapters.length}</span>
        </button>
        {#if !player.episode}
          <button role="tab" aria-selected={tab === 'bookmarks'} onclick={() => (tab = 'bookmarks')}>
            Bookmarks <span class="count num">{marks.length}</span>
          </button>
        {/if}
        <button role="tab" aria-selected={tab === 'queue'} onclick={() => (tab = 'queue')}>
          Up next <span class="count num">{player.queue.length}</span>
        </button>
      </div>

      {#if tab === 'chapters'}
        <ol class="list" bind:this={list}>
          {#each player.chapters as c, i (c.id ?? i)}
            {@const on = i === player.chapterIndex}
            {@const done = i < player.chapterIndex}
            <li>
              <button class="row" class:on class:done aria-current={on} onclick={() => player.seek(c.start)}>
                <span class="idx num">{i + 1}</span>
                <span class="name">{c.title}</span>
                <span class="len num">{clock(c.end - c.start)}</span>
                {#if on}
                  <span class="bar" style:width="{((player.currentTime - c.start) / Math.max(1, c.end - c.start)) * 100}%"></span>
                {/if}
              </button>
            </li>
          {/each}
        </ol>
      {:else if tab === 'queue'}
        <ol class="list">
          {#each player.queue as q, i (q.itemId + (q.episodeId ?? ''))}
            <li class="mark-row">
              <button class="row q" onclick={() => playFromQueue(i)} title="Play now">
                <span class="thumb"><Cover itemId={q.itemId} title={q.title} updatedAt={q.updatedAt} width={80} aspect={1} radius="4px" /></span>
                <span class="qtext">
                  <span class="name">{q.title}</span>
                  <span class="qsub">{q.subtitle}</span>
                </span>
              </button>
              <div class="mark-actions">
                <button class="icon-btn" aria-label="Move up" onclick={() => player.moveInQueue(i, -1)} disabled={i === 0}><ArrowUp size={14} /></button>
                <button class="icon-btn" aria-label="Move down" onclick={() => player.moveInQueue(i, 1)} disabled={i === player.queue.length - 1}
                  ><ArrowDown size={14} /></button
                >
                <button class="icon-btn" aria-label="Remove from Up Next" onclick={() => player.removeFromQueue(i)}><X size={14} /></button>
              </div>
            </li>
          {:else}
            <li class="empty">
              <p>Add titles from their page to play them one after another.</p>
            </li>
          {/each}
          <li class="auto">
            <label>
              <input type="checkbox" bind:checked={prefs.autoContinue} />
              When Up Next is empty, continue with the {player.episode ? 'next episode' : 'next book in the series'}
            </label>
            {#if player.queue.length}<button class="link" onclick={() => player.clearQueue()}>Clear</button>{/if}
          </li>
        </ol>
      {:else}
        <ol class="list">
          {#each marks as b (b.time)}
            <li class="mark-row">
              {#if editing === b.time}
                <form
                  class="edit"
                  onsubmit={(e) => {
                    e.preventDefault();
                    void saveTitle(b.time);
                  }}
                >
                  <!-- svelte-ignore a11y_autofocus -->
                  <input class="field" bind:value={editTitle} autofocus onblur={() => saveTitle(b.time)} aria-label="Bookmark name" />
                </form>
              {:else}
                <button class="row" onclick={() => player.seek(b.time)}>
                  <span class="idx"><Bookmark size={14} /></span>
                  <span class="name">{b.title}</span>
                  <span class="len num">{clock(b.time)}</span>
                </button>
                <div class="mark-actions">
                  <button
                    class="icon-btn"
                    aria-label="Rename bookmark"
                    onclick={() => {
                      editing = b.time;
                      editTitle = b.title;
                    }}><Pencil size={14} /></button
                  >
                  <button class="icon-btn" aria-label="Delete bookmark" onclick={() => remove(b.time)}><Trash2 size={14} /></button>
                </div>
              {/if}
            </li>
          {:else}
            <li class="empty">
              <p>Mark a moment to come back to it.</p>
              <button class="btn btn-quiet" onclick={addBookmark} disabled={!player.ready}
                ><BookmarkPlus size={16} /> Add bookmark at {clock(player.currentTime)}</button
              >
            </li>
          {/each}
        </ol>
      {/if}
    </aside>
  </div>
</div>

<style>
  .np {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    background: var(--ground);
    overflow: hidden;
  }
  .backdrop {
    position: absolute;
    inset: -80px;
    background-size: cover;
    background-position: center;
    filter: blur(70px) saturate(1.3);
    opacity: 0.38;
    transform: scale(1.1);
  }
  :global([data-theme='light']) .backdrop {
    opacity: 0.3;
  }
  .veil {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 30% 30%, transparent, var(--ground) 80%),
      linear-gradient(180deg, color-mix(in srgb, var(--wash) 60%, transparent), var(--ground));
  }
  header {
    position: relative;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 20px;
    flex: none;
  }
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.85fr);
    gap: 56px;
    padding: 0 56px 40px;
  }
  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 0;
    gap: 18px;
  }
  .cover {
    width: min(42vh, 440px, 100%);
    flex: none;
  }
  .cover :global(.cover) {
    box-shadow:
      0 2px 4px rgb(0 0 0 / 0.3),
      0 40px 80px -24px rgb(0 0 0 / 0.7);
  }
  .heading {
    text-align: center;
    max-width: 640px;
    margin-top: 10px;
  }
  h1 {
    font-size: clamp(1.6rem, 3.2vh, 2.4rem);
    line-height: 1.12;
    font-weight: 620;
    letter-spacing: -0.02em;
    font-variation-settings: 'opsz' 72;
    text-wrap: balance;
  }
  .by {
    margin-top: 6px;
    color: var(--text-2);
    font-size: var(--t-lg);
  }
  .chapter-line {
    display: flex;
    gap: 12px;
    align-items: baseline;
    font-size: var(--t-sm);
  }
  .ch {
    color: var(--accent);
    font-weight: 600;
  }
  .shelf {
    width: min(100%, 720px);
    margin-top: 12px;
  }
  .times {
    display: flex;
    justify-content: space-between;
    margin-top: 12px;
    font-size: var(--t-xs);
    color: var(--text-3);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .big {
    width: 48px;
    height: 48px;
  }
  .main {
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 14px 30px -10px hsl(var(--h) var(--s) 40% / 0.8);
    transition:
      transform 140ms var(--ease),
      background 200ms;
  }
  .main:hover {
    transform: scale(1.05);
    background: var(--accent-strong);
  }
  .main:active {
    transform: scale(0.96);
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .side {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: color-mix(in srgb, var(--raised) 72%, transparent);
    border: 1px solid var(--rule-soft);
    border-radius: var(--r-lg);
    backdrop-filter: blur(20px);
    overflow: hidden;
  }
  .tabs {
    display: flex;
    gap: 4px;
    padding: 10px 10px 0;
    border-bottom: 1px solid var(--rule-soft);
  }
  .tabs button {
    padding: 10px 12px 12px;
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--text-3);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tabs button[aria-selected='true'] {
    color: var(--text);
    border-color: var(--accent);
  }
  .count {
    margin-left: 4px;
    color: var(--text-3);
    font-weight: 500;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 8px;
    overflow-y: auto;
    flex: 1;
  }
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 34px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 9px 10px;
    border-radius: var(--r-sm);
    text-align: left;
    font-size: var(--t-sm);
    overflow: hidden;
  }
  .row:hover {
    background: var(--rule-soft);
  }
  .row.done {
    color: var(--text-3);
  }
  .row.on {
    background: var(--accent-soft);
    color: var(--text);
  }
  .row.on .name {
    font-weight: 650;
  }
  .row.on .idx {
    color: var(--accent);
  }
  .idx {
    color: var(--text-3);
    font-size: var(--t-xs);
    display: inline-flex;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .len {
    color: var(--text-3);
    font-size: var(--t-xs);
  }
  .bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: var(--accent);
  }
  .mark-row {
    position: relative;
    display: flex;
    align-items: center;
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
  .edit {
    width: 100%;
    padding: 2px;
  }
  .edit input {
    width: 100%;
    height: 34px;
  }
  .q {
    grid-template-columns: 40px 1fr;
    gap: 12px;
  }
  .thumb {
    width: 40px;
  }
  .qtext {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .qsub {
    font-size: var(--t-xs);
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .src {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-3);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 16px 12px;
    color: var(--text-2);
    font-size: var(--t-sm);
  }

  @media (max-width: 1100px) {
    .body {
      grid-template-columns: 1fr;
      overflow-y: auto;
    }
    .side {
      min-height: 360px;
    }
  }
</style>
