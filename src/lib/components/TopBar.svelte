<script lang="ts">
  import { ChevronLeft, ChevronRight, Search, X } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { isMacPlatform, modLabel } from '$lib/util/shortcuts';

  let input = $state<HTMLInputElement>();
  let q = $state('');
  let timer: ReturnType<typeof setTimeout>;
  const onSearch = $derived(page.url.pathname === '/search');
  const urlQuery = $derived(onSearch ? (page.url.searchParams.get('q') ?? '') : '');
  const hint = `${modLabel(isMacPlatform())}K`;

  // Follow the URL (Back to /search?q=x shows x; leaving search empties the box), but don't fight the
  // person typing: the URL only ever holds the trimmed text.
  $effect(() => {
    const u = urlQuery;
    untrack(() => {
      if (u !== q.trim()) q = u;
    });
  });

  function search(term: string) {
    clearTimeout(timer);
    if (term) void goto(`/search?q=${encodeURIComponent(term)}`, { replaceState: onSearch, keepFocus: true, noScroll: true });
    // Emptying the box on the results page empties the results too.
    else if (onSearch && urlQuery) void goto('/search', { replaceState: true, keepFocus: true, noScroll: true });
  }

  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(() => search(q.trim()), 220);
  }

  function clear() {
    q = '';
    search('');
    input?.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (q) clear();
      else input?.blur();
    } else if (e.key === 'Enter') search(q.trim());
  }

  $effect(() => {
    // ⌘K, / and the app menu's Search all arrive here (the layout's shortcut handler dispatches it).
    const focus = () => {
      input?.focus();
      input?.select();
    };
    window.addEventListener('lectern:focus-search', focus);
    return () => {
      window.removeEventListener('lectern:focus-search', focus);
      clearTimeout(timer);
    };
  });
</script>

<div class="bar" data-tauri-drag-region>
  <div class="hist">
    <button class="icon-btn" onclick={() => history.back()} aria-label="Back"><ChevronLeft size={20} /></button>
    <button class="icon-btn" onclick={() => history.forward()} aria-label="Forward"><ChevronRight size={20} /></button>
  </div>
  <label class="search" role="search">
    <Search size={16} aria-hidden="true" />
    <input
      bind:this={input}
      bind:value={q}
      oninput={onInput}
      onkeydown={onKey}
      type="search"
      aria-label="Search the library"
      placeholder="Search titles, authors, narrators, series"
      spellcheck="false"
      autocomplete="off"
    />
    {#if q}
      <button class="clear" onclick={clear} aria-label="Clear search"><X size={14} /></button>
    {:else}
      <kbd aria-hidden="true">{hint}</kbd>
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
  input::-webkit-search-cancel-button {
    display: none;
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
