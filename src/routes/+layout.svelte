<script lang="ts">
  import '@fontsource-variable/literata/opsz.css';
  import '@fontsource-variable/literata/opsz-italic.css';
  import '@fontsource-variable/schibsted-grotesk';
  import '../app.css';

  import { LoaderCircle } from '@lucide/svelte';
  import { onMount, untrack } from 'svelte';
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import Login from '$lib/components/Login.svelte';
  import NowPlaying from '$lib/components/NowPlaying.svelte';
  import PlayerDock from '$lib/components/PlayerDock.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import Toasts from '$lib/components/Toasts.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { prefs } from '$lib/stores/prefs.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { clock } from '$lib/util/format';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';

  let { children } = $props();
  let main = $state<HTMLElement>();
  const scrollPositions = new Map<string, number>();

  onMount(() => {
    void session.load();
  });

  $effect(() => {
    if (session.status === 'ready') untrack(() => player.init());
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
        player.setRate(prefs.playbackRate + 0.1);
        break;
      case 'ArrowDown':
        if (!player.expanded) return;
        e.preventDefault();
        player.setRate(prefs.playbackRate - 0.1);
        break;
      case 'b':
      case 'B':
        if (player.session && !player.episode) {
          const at = player.currentTime;
          session
            .addBookmark(player.item.id, at, player.chapter ? `${player.chapter.title} at ${clock(at - player.chapter.start)}` : clock(at))
            .then(() => toast(`Bookmark added at ${clock(at)}.`))
            .catch((err) => toast(`Couldn't add the bookmark. ${errorMessage(err)}`, { tone: 'error' }));
        }
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

{#if session.status === 'signed-out'}
  <Login />
{:else if session.status === 'loading'}
  <div class="splash" data-tauri-drag-region>
    {#if session.error}
      <div class="splash-error">
        <h1 class="serif">Can't reach your server</h1>
        <p class="muted">{session.error}</p>
        <div class="row">
          <button class="btn btn-primary" onclick={() => session.load()}>Try again</button>
          <button class="btn btn-quiet" onclick={() => session.signOut(false)}>Use a different server</button>
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
