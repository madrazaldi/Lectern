<script lang="ts">
  import { ChevronUp, LoaderCircle, Pause, Play, PictureInPicture2, SkipBack, SkipForward } from '@lucide/svelte';
  import { player } from '$lib/stores/player.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { clock } from '$lib/util/format';
  import { mini } from '$lib/util/miniMode';
  import { shortcutKeys } from '$lib/util/shortcuts';
  import ChapterShelf from './ChapterShelf.svelte';
  import Cover from './Cover.svelte';
  import SkipIcon from './SkipIcon.svelte';
  import SleepControl from './SleepControl.svelte';
  import SpeedControl from './SpeedControl.svelte';
  import VolumeControl from './VolumeControl.svelte';

  const item = $derived(player.item!);
  const remaining = $derived(Math.max(0, player.duration - player.currentTime) / (player.rate || 1));
  const marks = $derived(player.episode ? [] : session.bookmarksFor(item.id));
  const subtitle = $derived(player.episode ? player.author : player.chapters.length > 1 && player.chapter ? player.chapter.title : player.author);
  const miniShortcut = shortcutKeys('mini-player');
</script>

<footer class="dock">
  <div class="now">
    <button class="art" onclick={() => (player.expanded = true)} aria-label="Open now playing">
      <Cover itemId={item.id} title={player.title} updatedAt={item.updatedAt} width={160} aspect={1} hasCover={!!item.media.coverPath} eager />
      <span class="up"><ChevronUp size={18} /></span>
    </button>
    <div class="meta">
      <a class="title" href="/item/{item.id}">{player.title}</a>
      <span class="sub">{subtitle}</span>
    </div>
  </div>

  <div class="center">
    <div class="controls">
      <button class="icon-btn" onclick={() => player.prevChapter()} disabled={!player.ready} aria-label="Previous chapter" title="Previous chapter">
        <SkipBack size={17} />
      </button>
      <button class="icon-btn skip" onclick={() => player.skip(-prefs.skipBack)} disabled={!player.ready} aria-label="Back {prefs.skipBack} seconds">
        <SkipIcon seconds={prefs.skipBack} direction="back" size={24} />
      </button>
      <button class="main" onclick={() => player.toggle()} aria-label={player.isPlaying ? 'Pause' : 'Play'} disabled={player.status === 'loading'}>
        {#if player.status === 'loading' || (player.buffering && player.isPlaying)}
          <LoaderCircle size={20} class="spin" />
        {:else if player.isPlaying}
          <Pause size={20} fill="currentColor" strokeWidth={0} />
        {:else}
          <Play size={20} fill="currentColor" strokeWidth={0} style="margin-left:2px" />
        {/if}
      </button>
      <button class="icon-btn skip" onclick={() => player.skip(prefs.skipForward)} disabled={!player.ready} aria-label="Forward {prefs.skipForward} seconds">
        <SkipIcon seconds={prefs.skipForward} direction="forward" size={24} />
      </button>
      <button class="icon-btn" onclick={() => player.nextChapter()} disabled={!player.ready} aria-label="Next chapter" title="Next chapter">
        <SkipForward size={17} />
      </button>
    </div>
    <div class="scrub">
      <span class="t num">{clock(player.currentTime)}</span>
      <ChapterShelf
        chapters={player.chapters}
        time={player.currentTime}
        duration={player.duration}
        bookmarks={marks}
        onseek={(t) => player.seek(t)}
        disabled={!player.duration}
      />
      <span class="t num right">−{clock(remaining)}</span>
    </div>
  </div>

  <div class="tools">
    <SpeedControl />
    <SleepControl showLabel />
    <VolumeControl />
    <!-- Focus comes back here when the mini player is closed. -->
    <button class="icon-btn" data-mini-toggle onclick={() => mini.enter()} aria-label="Mini player" title="Mini player ({miniShortcut})">
      <PictureInPicture2 size={17} />
    </button>
  </div>
</footer>

<style>
  .dock {
    position: relative;
    display: grid;
    grid-template-columns: minmax(220px, 1fr) minmax(380px, 2.1fr) minmax(220px, 1fr);
    align-items: center;
    gap: 28px;
    height: var(--dock-h);
    padding: 0 20px 0 16px;
    background: color-mix(in srgb, var(--sidebar) 88%, var(--wash));
    border-top: 1px solid var(--rule-soft);
  }
  .now {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  .art {
    position: relative;
    flex: none;
    width: 58px;
    border-radius: var(--r-sm);
  }
  .up {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border-radius: var(--r-sm);
    background: rgb(0 0 0 / 0.45);
    color: #fff;
    opacity: 0;
    transition: opacity 140ms;
  }
  .art:hover .up,
  .art:focus-visible .up {
    opacity: 1;
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: var(--t-md);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: var(--text-3);
  }
  .sub {
    font-size: var(--t-sm);
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .skip {
    width: 38px;
    height: 38px;
  }
  .main {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--text);
    color: var(--ground);
    transition: transform 120ms var(--ease);
  }
  .main:hover:not(:disabled) {
    transform: scale(1.06);
  }
  .main:active:not(:disabled) {
    transform: scale(0.96);
  }
  .scrub {
    display: grid;
    grid-template-columns: 64px 1fr 64px;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding-top: 2px;
  }
  .t {
    font-size: var(--t-xs);
    color: var(--text-3);
    padding-top: 6px;
  }
  .right {
    text-align: right;
  }
  .tools {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
  }
  @media (max-width: 1120px) {
    .dock {
      grid-template-columns: minmax(180px, 1fr) minmax(340px, 2fr) auto;
      gap: 18px;
    }
    .tools :global(.vol input) {
      display: none;
    }
  }
</style>
