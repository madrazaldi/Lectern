<script lang="ts">
  import '@fontsource-variable/literata/opsz.css';
  import '@fontsource-variable/literata/opsz-italic.css';
  import '@fontsource-variable/schibsted-grotesk';
  import '../app.css';

  import { CloudOff, LoaderCircle } from '@lucide/svelte';
  import { onMount, untrack } from 'svelte';
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { initCredentials } from '$lib/api/client';
  import Login from '$lib/components/Login.svelte';
  import NowPlaying from '$lib/components/NowPlaying.svelte';
  import PlayerDock from '$lib/components/PlayerDock.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import Toasts from '$lib/components/Toasts.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import { on, quitNow, setCloseBehavior, showMainWindow } from '$lib/native';
  import { downloads } from '$lib/stores/downloads.svelte';
  import { live } from '$lib/stores/live.svelte';
  import { outbox } from '$lib/stores/outbox.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { clock } from '$lib/util/format';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';

  let { children } = $props();
  let main = $state<HTMLElement>();
  const scrollPositions = new Map<string, number>();

  onMount(() => {
    void initCredentials().then(() => session.load());

    const unlisten = [
      on<string>('menu-action', (action) => runAction(action)),
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
    if (from && main) scrollPositions.set(from.url.href, main.scrollTop);
  });

  afterNavigate(({ type, to }) => {
    if (!main) return;
    main.scrollTop = type === 'popstate' && to ? (scrollPositions.get(to.url.href) ?? 0) : 0;
  });

  function addBookmark() {
    if (!player.item || !player.ready || player.episode) return;
    const at = player.currentTime;
    session
      .addBookmark(
        player.item.id,
        at,
        player.chapter && player.chapters.length > 1 ? `${player.chapter.title} at ${clock(at - player.chapter.start)}` : clock(at)
      )
      .then(() => toast(`Bookmark added at ${clock(at)}.`))
      .catch((err) => toast(`Couldn't add the bookmark. ${errorMessage(err)}`, { tone: 'error' }));
  }

  /** Actions from the app menu and the menu bar (tray) icon. */
  function runAction(action: string) {
    if (session.status !== 'ready') return;
    if (action.startsWith('nav:')) {
      player.expanded = false;
      void goto(action.slice(4));
      return;
    }
    switch (action) {
      case 'search':
        player.expanded = false;
        window.dispatchEvent(new CustomEvent('lectern:focus-search'));
        return;
      case 'back':
        return history.back();
      case 'forward':
        return history.forward();
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
        return player.setRate(player.rate + 0.1);
      case 'speed-down':
        return player.setRate(player.rate - 0.1);
      case 'add-bookmark':
        return addBookmark();
      case 'now-playing':
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

  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable], [role="slider"]')) return;
    if (session.status !== 'ready') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === ',') {
      e.preventDefault();
      void goto('/settings');
      return;
    }
    if (mod || e.altKey || !player.item) return;
    switch (e.key) {
      case ' ':
        if (target.closest('button, a')) return;
        e.preventDefault();
        player.toggle();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) void player.prevChapter();
        else void player.skip(-prefs.skipBack);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) void player.nextChapter();
        else void player.skip(prefs.skipForward);
        break;
      case 'ArrowUp':
        if (!player.expanded) return;
        e.preventDefault();
        player.setRate(player.rate + 0.1);
        break;
      case 'ArrowDown':
        if (!player.expanded) return;
        e.preventDefault();
        player.setRate(player.rate - 0.1);
        break;
      case 'b':
      case 'B':
        addBookmark();
        break;
      case 'f':
      case 'F':
        player.expanded = !player.expanded;
        break;
      case 'Escape':
        if (player.expanded) player.expanded = false;
        break;
    }
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
      <LoaderCircle size={28} class="spin" />
    {/if}
  </div>
{:else}
  <div class="shell" class:has-dock={!!player.item}>
    <Sidebar />
    <main bind:this={main}>
      <TopBar />
      {#if !session.online}
        <div class="offline" role="status">
          <CloudOff size={16} />
          <span>
            You're offline. Downloaded titles still play, and your progress{outbox.pending ? ` (${outbox.pending} waiting)` : ''} syncs when the server is back.
          </span>
          <a href="/downloads">Downloads</a>
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
  {#if player.expanded && player.item}
    <NowPlaying />
  {/if}
{/if}

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
  :global(.spin) {
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
