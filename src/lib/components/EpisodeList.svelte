<script lang="ts">
  import { Search, X } from '@lucide/svelte';
  import type { LibraryItem, PodcastMedia } from '$lib/api/types';
  import { session } from '$lib/stores/session.svelte';
  import { nearEnd } from '$lib/util/dom';
  import { plural } from '$lib/util/format';
  import EpisodeRow from './EpisodeRow.svelte';

  /**
   * A podcast's episodes with search, a listening filter and sort. Shows them a page at a time and adds
   * more as the end comes into view, so a show with thousands of episodes stays quick.
   */
  let { podcast }: { podcast: LibraryItem & { media: PodcastMedia } } = $props();

  const PAGE = 40;
  type Filter = 'all' | 'unplayed' | 'in-progress' | 'finished';
  type Sort = 'newest' | 'oldest' | 'title';

  let query = $state('');
  let filter = $state<Filter>('all');
  let sort = $state<Sort>('newest');
  let limit = $state(PAGE);

  // Plain text once per podcast, for both search and the two-line previews. A regex is plenty for a preview
  // and far cheaper than parsing thousands of descriptions as HTML.
  const indexed = $derived(
    (podcast.media.episodes ?? []).map((ep) => {
      const summary = (ep.description ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
      return { ep, summary, text: `${ep.title} ${summary}`.toLocaleLowerCase() };
    })
  );

  const matches = $derived.by(() => {
    const q = query.trim().toLocaleLowerCase();
    const list = indexed.filter(({ ep, text }) => {
      if (q && !text.includes(q)) return false;
      if (filter === 'all') return true;
      const p = session.progressFor(podcast.id, ep.id);
      if (filter === 'finished') return !!p?.isFinished;
      if (filter === 'unplayed') return !p || (!p.isFinished && !p.currentTime);
      return !!p && !p.isFinished && p.currentTime > 0;
    });
    if (sort === 'title') return list.toSorted((a, b) => a.ep.title.localeCompare(b.ep.title, undefined, { numeric: true }));
    const dir = sort === 'newest' ? -1 : 1;
    return list.toSorted((a, b) => dir * ((a.ep.publishedAt ?? 0) - (b.ep.publishedAt ?? 0)));
  });
  const shown = $derived(matches.slice(0, limit));

  // A new search, filter or order starts again from the top page.
  $effect(() => {
    void [query, filter, sort, podcast.id];
    limit = PAGE;
  });

  const total = $derived(podcast.media.episodes?.length ?? 0);
</script>

<section class="episodes" aria-labelledby="episodes-h">
  <div class="ep-head">
    <h2 class="serif" id="episodes-h">Episodes</h2>
    <div class="tools">
      {#if total > 8}
        <label class="find">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            placeholder="Search episodes"
            aria-label="Search episodes"
            autocomplete="off"
            spellcheck="false"
            bind:value={query}
            onkeydown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                query = '';
              }
            }}
          />
          {#if query}<button class="x" onclick={() => (query = '')} aria-label="Clear episode search"><X size={14} /></button>{/if}
        </label>
      {/if}
      <select class="select" bind:value={filter} aria-label="Show episodes">
        <option value="all">All episodes</option>
        <option value="unplayed">Unplayed</option>
        <option value="in-progress">In progress</option>
        <option value="finished">Played</option>
      </select>
      <select class="select" bind:value={sort} aria-label="Order episodes">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="title">By title</option>
      </select>
    </div>
  </div>
  <p class="count faint num" aria-live="polite">
    {#if query || filter !== 'all'}{plural(matches.length, 'episode')} of {total.toLocaleString()}{:else}{plural(total, 'episode')}{/if}
  </p>

  <ol class="list">
    {#each shown as { ep, summary } (ep.id)}
      <EpisodeRow {podcast} episode={ep} {summary} />
    {:else}
      <li class="faint none">{query ? `No episodes match “${query.trim()}”.` : 'No episodes here.'}</li>
    {/each}
  </ol>
  {#if shown.length < matches.length}
    <!-- Loads the next page as it nears the viewport (re-observed per page, in case it's still in view);
         the button is there for keyboards and fallbacks. -->
    {#key limit}
      <div class="more" {@attach nearEnd(() => (limit += PAGE))}>
        <button class="btn btn-quiet" onclick={() => (limit += PAGE)}>Show more ({(matches.length - shown.length).toLocaleString()} left)</button>
      </div>
    {/key}
  {/if}
</section>

<style>
  .episodes {
    margin-top: 40px;
  }
  .ep-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  h2 {
    font-size: var(--t-lg);
    font-weight: 620;
  }
  .count {
    margin-top: 4px;
    font-size: var(--t-sm);
  }
  .find {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 200px;
    height: 32px;
    padding: 0 10px 0 12px;
    border-radius: 999px;
    border: 1px solid var(--rule);
    background: var(--raised);
    color: var(--text-3);
  }
  .find:focus-within {
    border-color: var(--accent);
  }
  .find input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    font-size: var(--t-sm);
    color: var(--text);
  }
  .find input::placeholder {
    color: var(--text-3);
  }
  .x {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    color: var(--text-2);
  }
  .list {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  .none {
    padding: 20px 0;
  }
  .more {
    display: flex;
    justify-content: center;
    padding: 20px 0;
  }
</style>
