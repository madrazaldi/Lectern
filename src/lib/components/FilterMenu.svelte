<script lang="ts">
  import { Check, ListFilter, Search } from '@lucide/svelte';
  import { encodeFilter } from '$lib/api/abs';
  import type { FilterData } from '$lib/api/types';
  import { roving } from '$lib/util/roving';
  import Popover from './Popover.svelte';

  interface Props {
    filterData: FilterData | null;
    /** The library's current `filter` query value; the matching entry is ticked. */
    active?: string;
    /** Called with the encoded filter (`group.<base64>`) and a label for the page title / chip. */
    onselect: (value: string, label: string) => void;
  }
  let { filterData, active = '', onselect }: Props = $props();

  const MAX = 200;

  interface Option {
    /** What goes on the wire: an id for authors and series, the text itself for the rest. */
    value: string;
    text: string;
  }
  interface Group {
    key: string;
    label: string;
    noun: string;
    /** Page title / chip text for a picked option. */
    title: (text: string) => string;
    options: Option[];
  }

  const byText = (a: Option, b: Option) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base', numeric: true });
  const plain = (xs: string[]): Option[] => xs.map((x) => ({ value: x, text: x })).sort(byText);

  const groups = $derived.by<Group[]>(() => {
    const d = filterData;
    if (!d) return [];
    const all: Group[] = [
      { key: 'genres', label: 'Genre', noun: 'genres', title: (t) => t, options: plain(d.genres) },
      {
        key: 'authors',
        label: 'Author',
        noun: 'authors',
        title: (t) => `By ${t}`,
        options: d.authors.map((a) => ({ value: a.id, text: a.name })).sort(byText)
      },
      { key: 'narrators', label: 'Narrator', noun: 'narrators', title: (t) => `Read by ${t}`, options: plain(d.narrators) },
      { key: 'series', label: 'Series', noun: 'series', title: (t) => t, options: d.series.map((s) => ({ value: s.id, text: s.name })).sort(byText) },
      { key: 'tags', label: 'Tag', noun: 'tags', title: (t) => t, options: plain(d.tags) },
      { key: 'languages', label: 'Language', noun: 'languages', title: (t) => t, options: plain(d.languages) },
      { key: 'publishers', label: 'Publisher', noun: 'publishers', title: (t) => t, options: plain(d.publishers) }
    ];
    return all.filter((g) => g.options.length);
  });

  let picked = $state('');
  let query = $state('');

  const activeGroup = $derived(active.split('.', 1)[0]);
  const isActive = $derived(!!active && activeGroup !== 'progress' && groups.some((g) => g.key === activeGroup));
  const group = $derived(groups.find((g) => g.key === picked) ?? groups.find((g) => g.key === activeGroup) ?? groups[0]);
  const matches = $derived.by(() => {
    if (!group) return [];
    const q = query.trim().toLocaleLowerCase();
    return q ? group.options.filter((o) => o.text.toLocaleLowerCase().includes(q)) : group.options;
  });
  const shown = $derived(matches.slice(0, MAX));

  function pick(g: Group, o: Option, close: () => void) {
    onselect(encodeFilter(g.key, o.value), g.title(o.text));
    query = '';
    close();
  }
</script>

{#if groups.length}
  <div class="fm">
    <Popover label="Filter" placement="down" align="start" active={isActive} triggerClass="trigger">
      {#snippet trigger()}
        <ListFilter size={15} /> Filter
      {/snippet}
      {#snippet children({ close })}
        <div class="menu">
          <div class="groups" role="radiogroup" aria-label="Filter by" {@attach roving({ orientation: 'both' })}>
            {#each groups as g (g.key)}
              <button
                class="g"
                role="radio"
                aria-checked={group?.key === g.key}
                onclick={() => {
                  picked = g.key;
                  query = '';
                }}>{g.label}</button
              >
            {/each}
          </div>
          <label class="search">
            <Search size={14} />
            <input
              placeholder="Search {group?.noun}"
              aria-label="Search {group?.noun}"
              bind:value={query}
              {@attach (el) => el.focus()}
              onkeydown={(e) => {
                if (e.key === 'Enter' && group && shown.length) pick(group, shown[0], close);
              }}
            />
          </label>
          <div class="list">
            {#each shown as o (o.value)}
              {@const on = !!group && active === encodeFilter(group.key, o.value)}
              <button class="opt" class:on onclick={() => group && pick(group, o, close)} title={o.text}>
                <span class="t">{o.text}</span>
                {#if on}<Check size={14} />{/if}
              </button>
            {:else}
              <p class="none">Nothing matches.</p>
            {/each}
            {#if matches.length > MAX}
              <p class="more num">{(matches.length - MAX).toLocaleString()} more. Keep typing to narrow it down.</p>
            {/if}
          </div>
        </div>
      {/snippet}
    </Popover>
  </div>
{/if}

<style>
  .fm :global(.trigger) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid var(--rule);
    font-size: var(--t-sm);
    font-weight: 550;
    color: var(--text-2);
  }
  .fm :global(.trigger:hover) {
    color: var(--text);
    border-color: var(--text-3);
  }
  .fm :global(.trigger.active),
  .fm :global(.trigger[aria-expanded='true']) {
    color: var(--text);
    border-color: var(--accent);
  }
  .menu {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 300px;
  }
  .groups {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .g {
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--text-2);
  }
  .g:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }
  .g[aria-checked='true'] {
    background: var(--text);
    color: var(--ground);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--rule);
    background: var(--raised);
    color: var(--text-3);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    font-size: var(--t-sm);
    user-select: text;
  }
  .search input::placeholder {
    color: var(--text-3);
  }
  .list {
    display: flex;
    flex-direction: column;
    max-height: 288px;
    overflow-y: auto;
    margin: 0 -4px;
    padding: 0 4px;
  }
  .opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex: none;
    min-height: 32px;
    padding: 0 10px;
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
    text-align: left;
  }
  .opt:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }
  .opt.on {
    color: var(--accent);
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none,
  .more {
    padding: 8px 10px;
    font-size: var(--t-xs);
    color: var(--text-3);
  }
</style>
