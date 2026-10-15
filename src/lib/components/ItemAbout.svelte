<script lang="ts">
  import { encodeFilter } from '$lib/api/abs';
  import type { LibraryItem } from '$lib/api/types';
  import { safeHtml } from '$lib/util/format';
  import ReadMore from './ReadMore.svelte';

  /** A title's description (clamped only if it's actually long) and its genre and tag links. */
  let { item }: { item: LibraryItem } = $props();

  const meta = $derived(item.media.metadata);
  const description = $derived(safeHtml(meta.description));
  const href = (group: string, value: string) => `/library?filter=${encodeURIComponent(encodeFilter(group, value))}&label=${encodeURIComponent(value)}`;
</script>

{#if description}
  <div class="desc serif selectable">
    <ReadMore lines={10}>
      <!-- sanitised by safeHtml -->
      {@html description}
    </ReadMore>
  </div>
{/if}

{#if meta.genres.length || item.media.tags.length}
  <div class="tags">
    {#each meta.genres as g (g)}
      <a class="tag" href={href('genres', g)}>{g}</a>
    {/each}
    {#each item.media.tags as t (t)}
      <a class="tag quiet" href={href('tags', t)}>{t}</a>
    {/each}
  </div>
{/if}

<style>
  .desc {
    font-size: 1.0625rem;
    line-height: 1.68;
    max-width: 68ch;
    color: color-mix(in srgb, var(--text) 88%, transparent);
  }
  .desc :global(p + p) {
    margin-top: 0.9em;
  }
  .desc :global(a) {
    color: var(--accent);
    text-decoration: underline;
  }
  .desc :global(.more) {
    font-family: var(--font-sans);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 28px;
  }
  .tag {
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--raised-2);
    font-size: var(--t-sm);
    font-weight: 550;
  }
  .tag.quiet {
    background: none;
    border: 1px solid var(--rule);
    color: var(--text-2);
  }
  .tag:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
