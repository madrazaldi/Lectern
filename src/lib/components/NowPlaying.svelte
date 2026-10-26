<script lang="ts">
  import { ArrowDownToLine, BookmarkPlus, ChevronDown, LoaderCircle, Pause, Play, SkipBack, SkipForward } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { coverUrl } from '$lib/api/client';
  import { player } from '$lib/stores/player.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { activeElement, returnFocus } from '$lib/util/dom';
  import { clock, duration } from '$lib/util/format';
  import { motion } from '$lib/util/motion';
  import { bookmarkHere } from '$lib/util/play';
  import { roving } from '$lib/util/roving';
  import BookmarkList from './BookmarkList.svelte';
  import ChapterList from './ChapterList.svelte';
  import ChapterShelf from './ChapterShelf.svelte';
  import Cover from './Cover.svelte';
  import SkipIcon from './SkipIcon.svelte';
  import SleepControl from './SleepControl.svelte';
  import SpeedControl from './SpeedControl.svelte';
  import UpNextList from './UpNextList.svelte';
  import VolumeControl from './VolumeControl.svelte';

  type Tab = 'chapters' | 'bookmarks' | 'queue';

  const item = $derived(player.item!);
  let tab = $state<Tab>('chapters');
  let closeButton: HTMLButtonElement;

  const marks = $derived(player.episode ? [] : session.bookmarksFor(item.id));
  const remaining = $derived(Math.max(0, player.duration - player.currentTime) / (player.rate || 1));
  const chapterLeft = $derived(player.chapter ? Math.max(0, player.chapter.end - player.currentTime) / (player.rate || 1) : 0);
  const hasChapters = $derived(player.chapters.length > 1);
  const tabs = $derived<{ id: Tab; label: string; count: number }[]>([
    { id: 'chapters', label: 'Chapters', count: player.chapters.length },
    ...(player.episode ? [] : [{ id: 'bookmarks' as const, label: 'Bookmarks', count: marks.length }]),
    { id: 'queue', label: 'Up next', count: player.queue.length }
  ]);

  // A modal view: focus moves in when it opens and goes back where it was when it closes.
  // (The layout makes everything behind it inert.)
  onMount(() => {
    const before = activeElement();
    closeButton.focus();
    return () => returnFocus(before, document.querySelector<HTMLElement>('.dock .art'));
  });

  async function addBookmark() {
    if (await bookmarkHere()) tab = 'bookmarks';
  }
</script>

<div class="np" transition:fly={motion({ y: 40, duration: 320, opacity: 0 })} role="dialog" aria-modal="true" aria-label="Now playing">
  <div class="backdrop" style:background-image="url({coverUrl(item.id, 200, item.updatedAt)})" transition:fade={motion({ duration: 400 })}></div>
  <div class="veil"></div>

  <header data-drag-region>
    <button bind:this={closeButton} class="icon-btn close" onclick={() => (player.expanded = false)} aria-label="Close now playing" title="Close (Esc)">
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
          range={player.track.chapter ? player.track : undefined}
          onseek={(t) => player.seek(t)}
          disabled={!player.duration}
        />
        <div class="times num">
          <span>{clock(Math.max(0, player.currentTime - player.track.start))}</span>
          <span>{duration(remaining, { short: true })} left{player.track.chapter ? ' in book' : ''} at {player.rate}×</span>
          <span>{clock(player.track.end - player.track.start)}</span>
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
      <div class="tabs" role="tablist" aria-label="Now playing lists" {@attach roving()}>
        {#each tabs as t (t.id)}
          <button role="tab" id="np-tab-{t.id}" aria-selected={tab === t.id} aria-controls="np-panel" onclick={() => (tab = t.id)}>
            {t.label} <span class="count num">{t.count}</span>
          </button>
        {/each}
      </div>

      <div class="panel" id="np-panel" role="tabpanel" aria-labelledby="np-tab-{tab}">
        {#if tab === 'chapters'}
          <ChapterList variant="panel" follow chapters={player.chapters} time={player.currentTime} onseek={(t) => player.seek(t)} />
        {:else if tab === 'queue'}
          <UpNextList />
        {:else}
          <BookmarkList variant="panel" itemId={item.id} {marks} onseek={(t) => player.seek(t)}>
            {#snippet empty()}
              <p>Mark a moment to come back to it.</p>
              <button class="btn btn-quiet" onclick={addBookmark} disabled={!player.ready}
                ><BookmarkPlus size={16} /> Add bookmark at {clock(player.currentTime)}</button
              >
            {/snippet}
          </BookmarkList>
        {/if}
      </div>
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
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
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
  .src {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-3);
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
