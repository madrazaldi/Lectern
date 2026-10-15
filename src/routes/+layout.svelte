<script lang="ts">
  import '@fontsource-variable/literata/opsz.css';
  import '@fontsource-variable/literata/opsz-italic.css';
  import '@fontsource-variable/schibsted-grotesk';
  import '../app.css';

  import { CloudOff, LoaderCircle } from '@lucide/svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { initCredentials } from '$lib/api/client';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import Dialogs from '$lib/components/Dialogs.svelte';
  import Login from '$lib/components/Login.svelte';
  import MiniPlayer from '$lib/components/MiniPlayer.svelte';
  import NowPlaying from '$lib/components/NowPlaying.svelte';
  import PlayerDock from '$lib/components/PlayerDock.svelte';
  import ReauthBanner from '$lib/components/ReauthBanner.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import Toasts from '$lib/components/Toasts.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import { inTauri, on, quitNow, setCloseBehavior, setMiniMenu, showMainWindow } from '$lib/native';
  import { downloads } from '$lib/stores/downloads.svelte';
  import { live } from '$lib/stores/live.svelte';
  import { outbox } from '$lib/stores/outbox.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { contextMenu } from '$lib/util/contextMenu.svelte';
  import { dialogs } from '$lib/util/dialogs.svelte';
  import { restoreScroll } from '$lib/util/dom';
  import { mini } from '$lib/util/miniMode';
  import { bookmarkHere, nudgeRate, nudgeVolume, toggleMute } from '$lib/util/play';
  import { isMacPlatform, matchShortcut, navAllowed } from '$lib/util/shortcuts';

  let { children } = $props();
  let main = $state<HTMLElement>();
  const scrollPositions = new Map<string, number>();
  let cancelRestore: (() => void) | undefined;
  const mac = isMacPlatform();
  const where = $derived({ books: session.library?.mediaType !== 'podcast', desktop: inTauri });
  // Now Playing is modal: everything behind it is inert.
  const modal = $derived(player.expanded && !!player.item && !prefs.miniMode);
  /** Actions that need the full window: pages, search, Now Playing, the shortcut list. */
  const FULL_WINDOW = new Set(['search', 'back', 'forward', 'help', 'now-playing']);

  onMount(() => {
    // Left as the mini player last time: the window opens full size, so shrink it straight away.
    void mini.restore();
    void initCredentials().then(() => session.load());

    const unlisten = [
      on<string>('menu-action', (action) => perform(action, 'menu')),
      // Quitting from the menu, tray or last window: save our place first, then let the app go.
      on<null>('app-quit-requested', async () => {
        await player.shutdown().catch(() => {});
        await quitNow();
      })
    ];
    return () => unlisten.forEach((p) => p.then((fn) => fn()));
  });

  $effect(() => {
    if (session.status !== 'ready') return;
    untrack(() => {
      player.init();
      void downloads.load();
      live.connect();
    });
  });

  $effect(() => {
    void setCloseBehavior(prefs.keepPlayingWhenClosed).catch(() => {});
  });

  $effect(() => {
    void setMiniMenu(prefs.miniMode).catch(() => {});
  });

  // Signing in, and the "can't reach your server" screen, need the full window.
  $effect(() => {
    if (prefs.miniMode && (session.status === 'signed-out' || session.addingAccount || (session.status === 'loading' && session.error))) void mini.exit();
  });

  // Going small: close what the mini player can't show, so it isn't waiting (and holding the keyboard) on the way back.
  let scrollBeforeMini: number | null = null;
  $effect.pre(() => {
    if (!prefs.miniMode) return;
    untrack(() => {
      // Runs before the shell is taken down, while the page still has its scroll position.
      scrollBeforeMini = main?.scrollTop ?? 0;
      player.expanded = false;
      contextMenu.close(false);
      dialogs.shortcuts = false;
      dialogs.playlist = null;
    });
  });

  // Back to the full window: same place on the page, and focus on the button that makes it small again.
  $effect(() => {
    if (prefs.miniMode || !main || scrollBeforeMini === null) return;
    const el = main;
    const top = scrollBeforeMini;
    scrollBeforeMini = null;
    untrack(() => {
      cancelRestore?.();
      cancelRestore = restoreScroll(el, top);
      document.querySelector<HTMLElement>('[data-mini-toggle]')?.focus();
    });
  });

  // Let the playing cover tint the whole interface.
  $effect(() => {
    const root = document.documentElement.style;
    const t = prefs.coverTint ? player.tint : null;
    if (t) {
      root.setProperty('--h', String(t.h));
      root.setProperty('--s', `${t.s}%`);
    } else {
      root.removeProperty('--h');
      root.removeProperty('--s');
    }
  });

  beforeNavigate(({ from }) => {
    cancelRestore?.();
    contextMenu.close(false);
    if (from && main) scrollPositions.set(from.url.href, main.scrollTop);
  });

  afterNavigate(({ type, from, to }) => {
    if (!main) return;
    // Back/Forward: return to where the reader was, once the page has rendered enough to scroll that far.
    if (type === 'popstate' && to) cancelRestore = restoreScroll(main, scrollPositions.get(to.url.href) ?? 0);
    // A page updating its own query (filter text, search term) keeps its place.
    else if (!(type === 'goto' && from && to && from.url.pathname === to.url.pathname)) main.scrollTop = 0;
  });

  function navigate(href: string) {
    // The native Go menu offers Series, Authors and Collections in podcast libraries too.
    if (!navAllowed(href, where)) return;
    if (prefs.miniMode) return void mini.exit().then(() => navigate(href));
    player.expanded = false;
    void goto(href);
  }

  /** Actions from the app menu, the menu bar (tray) icon and the keyboard. */
  function perform(action: string, from: 'menu' | 'key') {
    if (session.status !== 'ready') return;
    if (action === 'mini-player') return void mini.toggle();
    if (prefs.miniMode && FULL_WINDOW.has(action))
      return void mini
        .exit()
        .then(tick)
        .then(() => perform(action, from));
    if (action.startsWith('nav:')) return navigate(action.slice(4));
    switch (action) {
      case 'search':
        player.expanded = false;
        window.dispatchEvent(new CustomEvent('lectern:focus-search'));
        return;
      case 'back':
        return history.back();
      case 'forward':
        return history.forward();
      case 'help':
        dialogs.shortcuts = true;
        return;
    }
    if (!player.item) return;
    switch (action) {
      case 'play-pause':
        return player.toggle();
      case 'skip-back':
        return void player.skip(-prefs.skipBack);
      case 'skip-forward':
        return void player.skip(prefs.skipForward);
      case 'prev-chapter':
        return void player.prevChapter();
      case 'next-chapter':
        return void player.nextChapter();
      case 'speed-up':
        return nudgeRate(0.1);
      case 'speed-down':
        return nudgeRate(-0.1);
      case 'volume-up':
        return nudgeVolume(0.1);
      case 'volume-down':
        return nudgeVolume(-0.1);
      case 'mute':
        return toggleMute();
      case 'add-bookmark':
        return void bookmarkHere();
      case 'now-playing':
        if (from === 'key') {
          player.expanded = !player.expanded;
          return;
        }
        void showMainWindow();
        player.expanded = true;
        return;
      case 'sleep-off':
        return player.setSleep({ kind: 'off' });
      case 'sleep-chapter':
        return player.sleepAtChapterEnd();
      default:
        if (action.startsWith('sleep-')) player.sleepInMinutes(Number(action.slice(6)));
    }
  }

  // Single keys belong to the focused control when it uses them itself.
  const OWNS_KEYS =
    'input, textarea, select, [contenteditable], [role="slider"], [role="radio"], [role="tab"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"]';

  function onKeydown(e: KeyboardEvent) {
    if (session.status !== 'ready' || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    // Dialogs and the context menu handle their own keys (including Escape).
    if (dialogs.any || contextMenu.current) return;
    // Escape before anything else: it closes Now Playing even from its scrubber or volume slider. Text fields
    // keep it (renaming a bookmark cancels the rename instead).
    if (e.key === 'Escape') {
      if (modal && !target.closest('input:not([type="range"]), textarea, [contenteditable]')) {
        e.preventDefault();
        player.expanded = false;
      }
      return;
    }
    const shortcut = matchShortcut(e, { ...where, expanded: modal, nativeMenu: inTauri && mac });
    if (!shortcut) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod && target.closest(OWNS_KEYS)) return;
    if (shortcut.id === 'play-pause' && target.closest('button, a, summary')) return;
    e.preventDefault();
    if (shortcut.href) navigate(shortcut.href);
    else perform(shortcut.id, 'key');
  }
</script>

<svelte:window onkeydown={onKeydown} onfocus={() => session.refreshUser()} />

{#if session.status === 'signed-out' || session.addingAccount}
  <Login />
{:else if session.status === 'loading'}
  <div class="splash" data-tauri-drag-region>
    {#if session.error}
      <div class="splash-error">
        <h1 class="serif">Can't reach your server</h1>
        <p class="muted">{session.error}</p>
        <div class="row">
          <button class="btn btn-primary" onclick={() => session.load()}>Try again</button>
          <button class="btn btn-quiet" onclick={() => session.signOut()}>Use a different server</button>
        </div>
      </div>
    {:else}
      <div role="status">
        <LoaderCircle size={28} class="spin" aria-hidden="true" />
        <span class="sr-only">Connecting to your server…</span>
      </div>
    {/if}
  </div>
{:else if prefs.miniMode}
  <MiniPlayer />
{:else}
  <div class="shell" class:has-dock={!!player.item} inert={modal}>
    <Sidebar />
    <main bind:this={main}>
      <TopBar />
      {#if !session.online}
        <div class="offline" role="status">
          <CloudOff size={16} />
          <span>
            You're offline. Downloaded titles still play, and your progress{outbox.pending ? ` (${outbox.pending} waiting)` : ''} syncs when the server is back.
          </span>
          {#if inTauri}<a href="/downloads">Downloads</a>{/if}
        </div>
      {/if}
      {#key session.library?.id}
        {@render children()}
      {/key}
    </main>
    {#if player.item}
      <div class="dock-slot"><PlayerDock /></div>
    {/if}
  </div>
  {#if modal}
    <NowPlaying />
  {/if}
  <ContextMenu />
  <Dialogs />
{/if}

{#if session.status !== 'signed-out' && !session.addingAccount && !prefs.miniMode}<ReauthBanner />{/if}
<Toasts />

<style>
  .shell {
    display: grid;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    height: 100vh;
  }
  .shell.has-dock {
    grid-template-rows: minmax(0, 1fr) var(--dock-h);
  }
  main {
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
  }
  .offline {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 4px 40px 12px;
    padding: 10px 14px;
    border-radius: var(--r-md);
    background: var(--raised);
    border: 1px solid var(--rule-soft);
    font-size: var(--t-sm);
    color: var(--text-2);
  }
  .offline a {
    margin-left: auto;
    font-weight: 650;
    color: var(--accent);
  }
  .dock-slot {
    grid-column: 1 / -1;
  }
  .splash {
    display: grid;
    place-items: center;
    height: 100vh;
    color: var(--text-3);
  }
  .splash-error {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 440px;
    text-align: center;
    align-items: center;
  }
  .splash-error h1 {
    font-size: var(--t-xl);
    color: var(--text);
  }
  .row {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
</style>
