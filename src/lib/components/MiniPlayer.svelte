<script lang="ts">
  import { KeyRound, LoaderCircle, Maximize2, Pause, Pin, PinOff, Play, X } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { appWindow, inApp } from '$lib/native';
  import { player } from '$lib/stores/player.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { ssoReauth } from '$lib/stores/reauth.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { clock } from '$lib/util/format';
  import { mini } from '$lib/util/miniMode';
  import { motion } from '$lib/util/motion';
  import { shortcutKeys } from '$lib/util/shortcuts';
  import Cover from './Cover.svelte';
  import SkipIcon from './SkipIcon.svelte';

  /**
   * The whole window while it is the mini player. Everything that isn't a control drags the window, since there
   * is no title bar to hold.
   */

  let playButton = $state<HTMLButtonElement>();
  let expandButton = $state<HTMLButtonElement>();

  const item = $derived(player.item);
  const subtitle = $derived(player.episode ? player.author : player.chapters.length > 1 && player.chapter ? player.chapter.title : player.author);
  const remaining = $derived(Math.max(0, player.track.end - player.currentTime) / (player.rate || 1));
  const shortcut = shortcutKeys('mini-player');

  let dragTime = $state<number | null>(null);
  /** Set briefly after a keyboard seek, so the announced position is exact while someone is seeking. */
  let seeking = $state(false);
  let seekTimer: ReturnType<typeof setTimeout> | undefined;
  const shown = $derived(dragTime ?? player.currentTime);
  const span = $derived(player.track.end - player.track.start);
  const filled = $derived(span > 0 ? Math.min(100, Math.max(0, ((shown - player.track.start) / span) * 100)) : 0);
  // As in the dock's scrubber: whole minutes only, so a screen reader isn't re-reading the position every second.
  const spoken = $derived(seeking ? player.currentTime : Math.floor(player.currentTime / 60) * 60);

  onMount(() => {
    // Focus follows the switch into the mini player.
    (playButton && !playButton.disabled ? playButton : expandButton)?.focus();
    return () => clearTimeout(seekTimer);
  });

  function seekTo(t: number) {
    seeking = true;
    clearTimeout(seekTimer);
    seekTimer = setTimeout(() => (seeking = false), 2000);
    void player.seek(Math.max(0, Math.min(player.duration, t)));
  }

  function onScrubKey(e: KeyboardEvent) {
    // The same steps as the skip buttons (Shift for a minute) instead of the range input's one second.
    const t = player.currentTime;
    const chapters = player.chapters;
    let to: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') to = t + (e.shiftKey ? 60 : prefs.skipForward);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') to = t - (e.shiftKey ? 60 : prefs.skipBack);
    else if (e.key === 'PageDown') to = chapters[player.chapterIndex + 1]?.start ?? null;
    else if (e.key === 'PageUp') to = chapters[Math.max(0, player.chapterIndex - 1)]?.start ?? null;
    else if (e.key === 'Home') to = player.track.start;
    else if (e.key === 'End') to = player.track.end - 1;
    if (to === null) return;
    e.preventDefault();
    seekTo(to);
  }
</script>

{#snippet windowButtons()}
  <div class="window">
    {#if session.needsReauth}
      <!-- Signing in again needs the banner, which only the full window has room for. -->
      <button
        class="icon-btn reauth"
        onclick={() => mini.exit()}
        aria-label="Signed out. Open the full window to sign in again"
        title={ssoReauth.waiting ? 'Waiting for your browser to sign you in again' : 'Signed out: sign in again in the full window'}
      >
        {#if ssoReauth.waiting}<LoaderCircle size={15} class="spin" />{:else}<KeyRound size={15} />{/if}
      </button>
    {/if}
    <button
      class="icon-btn"
      aria-pressed={prefs.miniPinned}
      onclick={() => mini.setPinned(!prefs.miniPinned)}
      aria-label="Keep on top"
      title="Keep on top of other windows"
    >
      {#if prefs.miniPinned}<Pin size={15} />{:else}<PinOff size={15} />{/if}
    </button>
    <button class="icon-btn" bind:this={expandButton} onclick={() => mini.exit()} aria-label="Full window" title="Full window ({shortcut})">
      <Maximize2 size={15} />
    </button>
    {#if inApp}
      <!-- There is no title bar in the mini player; closing behaves like closing the full window. -->
      <button class="icon-btn" onclick={() => appWindow()?.close()} aria-label="Close window" title="Close window">
        <X size={16} />
      </button>
    {/if}
  </div>
{/snippet}

<section class="mini" class:preview={!inApp} aria-label="Mini player" data-drag-region="deep" in:fade={motion({ duration: 160 })}>
  {#if item}
    <div class="art">
      <Cover itemId={item.id} title={player.title} updatedAt={item.updatedAt} width={160} aspect={1} hasCover={!!item.media.coverPath} eager />
    </div>
    <div class="body">
      <div class="top">
        <div class="meta">
          <span class="title" title={player.title}>{player.title}</span>
          <span class="sub">{subtitle}</span>
        </div>
        {@render windowButtons()}
      </div>
      <div class="controls">
        <button class="icon-btn skip" onclick={() => player.skip(-prefs.skipBack)} disabled={!player.ready} aria-label="Back {prefs.skipBack} seconds">
          <SkipIcon seconds={prefs.skipBack} direction="back" size={22} />
        </button>
        <button
          class="main"
          bind:this={playButton}
          onclick={() => player.toggle()}
          aria-label={player.isPlaying ? 'Pause' : 'Play'}
          disabled={player.status === 'loading'}
        >
          {#if player.status === 'loading' || (player.buffering && player.isPlaying)}
            <LoaderCircle size={16} class="spin" />
          {:else if player.isPlaying}
            <Pause size={16} fill="currentColor" strokeWidth={0} />
          {:else}
            <Play size={16} fill="currentColor" strokeWidth={0} style="margin-left:2px" />
          {/if}
        </button>
        <button class="icon-btn skip" onclick={() => player.skip(prefs.skipForward)} disabled={!player.ready} aria-label="Forward {prefs.skipForward} seconds">
          <SkipIcon seconds={prefs.skipForward} direction="forward" size={22} />
        </button>
        <span class="left num"><span class="sr-only">Time left </span><span aria-hidden="true">−</span>{clock(remaining)}</span>
      </div>
    </div>
    <input
      class="scrub"
      type="range"
      min={Math.round(player.track.start)}
      max={Math.max(Math.round(player.track.start) + 1, Math.round(player.track.end))}
      step="1"
      value={Math.round(shown)}
      disabled={!player.duration}
      style:--filled="{filled}%"
      aria-label="Position"
      aria-valuetext="{clock(Math.max(0, spoken - player.track.start))} of {clock(span)}{player.chapter && player.chapters.length > 1
        ? `, ${player.chapter.title}`
        : ''}"
      oninput={(e) => (dragTime = Number(e.currentTarget.value))}
      onchange={(e) => {
        void player.seek(Number(e.currentTarget.value));
        dragTime = null;
      }}
      onkeydown={onScrubKey}
    />
  {:else}
    <div class="body empty">
      <div class="top">
        <span class="sub">Nothing playing</span>
        {@render windowButtons()}
      </div>
    </div>
  {/if}
</section>

<style>
  .mini {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 100vh;
    padding: 12px 10px 16px 12px;
    overflow: hidden;
    background: color-mix(in srgb, var(--sidebar) 88%, var(--wash));
  }
  /* In a browser tab the window can't shrink, so the mini player is drawn at its window size instead. */
  .mini.preview {
    position: fixed;
    top: 50%;
    left: 50%;
    width: 380px;
    height: 120px;
    transform: translate(-50%, -50%);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    box-shadow: 0 24px 60px -16px rgb(0 0 0 / 0.6);
  }
  .art {
    flex: none;
    width: 78px;
    border-radius: var(--r-sm);
    box-shadow: var(--shadow-cover);
  }
  .body {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 6px;
    flex: 1;
    min-width: 0;
    align-self: stretch;
  }
  .empty {
    justify-content: center;
  }
  .top {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  .empty .top {
    align-items: center;
    padding-left: 4px;
  }
  .meta {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    padding-top: 1px;
  }
  .title {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: var(--t-md);
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    flex: 1;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .window {
    display: flex;
    flex: none;
    margin-top: -2px;
  }
  .window .icon-btn {
    width: 26px;
    height: 26px;
  }
  .window .reauth {
    color: var(--accent);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: -4px;
  }
  .skip {
    width: 32px;
    height: 32px;
  }
  .main {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin: 0 2px;
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
  .left {
    margin-left: auto;
    padding-right: 4px;
    font-size: var(--t-xs);
    color: var(--text-3);
  }

  /* A thin bar along the window's bottom edge, with a handle that shows on hover and focus. */
  .scrub {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 12px;
    margin: 0;
    background: transparent;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
  }
  .scrub:disabled {
    cursor: default;
  }
  .scrub:focus-visible {
    outline: none;
  }
  .scrub::-webkit-slider-runnable-track {
    height: 3px;
    background: linear-gradient(90deg, var(--accent) var(--filled), var(--spine-empty) var(--filled));
    transition: height 120ms;
  }
  .scrub::-webkit-slider-thumb {
    width: 12px;
    height: 12px;
    margin-top: -4.5px;
    border-radius: 50%;
    background: var(--text);
    appearance: none;
    -webkit-appearance: none;
    opacity: 0;
    transition: opacity 120ms;
  }
  .scrub:not(:disabled):hover::-webkit-slider-thumb,
  .scrub:focus-visible::-webkit-slider-thumb {
    opacity: 1;
  }
  .scrub:focus-visible::-webkit-slider-runnable-track {
    height: 4px;
    box-shadow: 0 0 0 1px var(--accent);
  }
</style>
