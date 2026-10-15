<script lang="ts">
  import { BookOpen, ChartNoAxesColumn, Feather, House, LibraryBig, ListMusic, Mic, Settings, Shapes } from '@lucide/svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { session } from '$lib/stores/session.svelte';

  const isBooks = $derived(session.library?.mediaType !== 'podcast');
  const nav = $derived([
    { href: '/', label: 'Home', icon: House },
    { href: '/library', label: isBooks ? 'Books' : 'Podcasts', icon: LibraryBig },
    ...(isBooks
      ? [
          { href: '/series', label: 'Series', icon: Shapes },
          { href: '/authors', label: 'Authors', icon: Feather },
          { href: '/collections', label: 'Collections', icon: ListMusic }
        ]
      : [])
  ]);

  function active(href: string) {
    const path = page.url.pathname;
    return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
  }

  function pick(id: string) {
    session.selectLibrary(id);
    if (page.url.pathname !== '/') void goto('/');
  }
</script>

<nav class="sidebar" aria-label="Main">
  <div class="top" data-tauri-drag-region></div>
  <a class="mark" href="/" aria-label="Lectern home">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6.5c2.8-1.6 5.5-1.6 8 0 2.5-1.6 5.2-1.6 8 0V18c-2.8-1.4-5.5-1.4-8 0-2.5-1.4-5.2-1.4-8 0V6.5Z" fill="var(--accent)" />
      <path d="M12 6.5V18" stroke="var(--sidebar)" stroke-width="1.4" />
      <path d="M8 21h8" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" />
    </svg>
    <span>Lectern</span>
  </a>

  {#if session.libraries.length > 1}
    <div class="group" role="group" aria-label="Libraries">
      {#each session.libraries as lib (lib.id)}
        <button class="lib" class:on={lib.id === session.library?.id} onclick={() => pick(lib.id)}>
          {#if lib.mediaType === 'podcast'}<Mic size={15} />{:else}<BookOpen size={15} />{/if}
          <span>{lib.name}</span>
        </button>
      {/each}
    </div>
  {/if}

  <ul class="links">
    {#each nav as n (n.href)}
      <li>
        <a href={n.href} class:on={active(n.href)} aria-current={active(n.href) ? 'page' : undefined}>
          <n.icon size={18} strokeWidth={1.8} />
          {n.label}
        </a>
      </li>
    {/each}
    <li>
      <a href="/stats" class:on={active('/stats')} aria-current={active('/stats') ? 'page' : undefined}>
        <ChartNoAxesColumn size={18} strokeWidth={1.8} />
        Listening
      </a>
    </li>
  </ul>

  <div class="foot">
    <a href="/settings" class:on={active('/settings')} class="user">
      <span class="avatar" aria-hidden="true">{session.user?.username.slice(0, 1).toUpperCase()}</span>
      <span class="name">{session.user?.username}</span>
      <Settings size={16} />
    </a>
  </div>
</nav>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: var(--sidebar-w);
    height: 100%;
    background: var(--sidebar);
    border-right: 1px solid var(--rule-soft);
    padding: 0 12px 12px;
  }
  .top {
    height: 44px;
    flex: none;
    margin: 0 -12px;
  }
  .mark {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px 18px;
    font-family: var(--font-serif);
    font-size: 1.3rem;
    font-weight: 640;
    letter-spacing: -0.01em;
    font-variation-settings: 'opsz' 48;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    margin-bottom: 14px;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--text) 4%, transparent);
  }
  .lib {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
    font-weight: 550;
    color: var(--text-2);
    text-align: left;
  }
  .lib span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lib:hover {
    color: var(--text);
  }
  .lib.on {
    background: var(--raised-2);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
  }
  .links {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .links a {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 36px;
    padding: 0 10px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-weight: 550;
    font-size: var(--t-md);
    transition:
      color 120ms,
      background 120ms;
  }
  .links a:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 5%, transparent);
  }
  .links a.on {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 7%, transparent);
  }
  .links a.on :global(svg) {
    color: var(--accent);
  }
  .foot {
    margin-top: auto;
  }
  .user {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--r-md);
    color: var(--text-2);
  }
  .user:hover,
  .user.on {
    background: color-mix(in srgb, var(--text) 6%, transparent);
    color: var(--text);
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 700;
    font-size: var(--t-sm);
  }
  .name {
    flex: 1;
    font-size: var(--t-sm);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
