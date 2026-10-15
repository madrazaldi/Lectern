<script lang="ts">
  import { ChevronLeft, ChevronRight, Search, X } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  let input = $state<HTMLInputElement>();
  let q = $state(page.url.pathname === '/search' ? (page.url.searchParams.get('q') ?? '') : '');
  let timer: ReturnType<typeof setTimeout>;

  $effect(() => {
    if (page.url.pathname !== '/search') q = '';
  });

  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const term = q.trim();
      if (term) void goto(`/search?q=${encodeURIComponent(term)}`, { replaceState: page.url.pathname === '/search', keepFocus: true });
    }, 220);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      q = '';
      input?.blur();
    }
  }

  $effect(() => {
    const focus = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, [contenteditable]');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        input?.focus();
        input?.select();
      }
    };
    // Search from the app menu (⌘F).
    const fromMenu = () => {
      input?.focus();
      input?.select();
    };
    window.addEventListener('keydown', focus);
    window.addEventListener('lectern:focus-search', fromMenu);
    return () => {
      window.removeEventListener('keydown', focus);
      window.removeEventListener('lectern:focus-search', fromMenu);
    };
  });
</script>

<div class="bar" data-tauri-drag-region>
  <div class="hist">
    <button class="icon-btn" onclick={() => history.back()} aria-label="Back"><ChevronLeft size={20} /></button>
    <button class="icon-btn" onclick={() => history.forward()} aria-label="Forward"><ChevronRight size={20} /></button>
  </div>
  <label class="search">
    <Search size={16} />
    <input bind:this={input} bind:value={q} oninput={onInput} onkeydown={onKey} placeholder="Search titles, authors, narrators, series" spellcheck="false" />
    {#if q}
      <button class="clear" onclick={() => (q = '')} aria-label="Clear search"><X size={14} /></button>
    {:else}
      <kbd>⌘K</kbd>
    {/if}
  </label>
</div>

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 16px;
    height: 60px;
    padding: 0 40px 0 28px;
    background: color-mix(in srgb, var(--ground) 82%, transparent);
    backdrop-filter: blur(16px) saturate(1.2);
  }
  .hist {
    display: flex;
    gap: 2px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(440px, 100%);
    height: 36px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--raised);
    border: 1px solid var(--rule-soft);
    color: var(--text-3);
    transition: border-color 120ms;
  }
  .search:focus-within {
    border-color: var(--accent);
    color: var(--text-2);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: none;
    font-size: var(--t-sm);
    color: var(--text);
  }
  input::placeholder {
    color: var(--text-3);
  }
  kbd {
    font-family: var(--font-sans);
    font-size: var(--t-xs);
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--rule);
  }
  .clear {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--rule);
    color: var(--text);
  }
</style>
