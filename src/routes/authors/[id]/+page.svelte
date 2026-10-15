<script lang="ts">
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import { authorImageUrl } from '$lib/api/client';
  import type { Author } from '$lib/api/types';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import ReadMore from '$lib/components/ReadMore.svelte';
  import Shelf from '$lib/components/Shelf.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { plural, safeHtml } from '$lib/util/format';
  import { resource } from '$lib/util/resource.svelte';
  import { pageTitle } from '$lib/util/title';

  const id = $derived(page.params.id!);

  const res = resource(() => id, {
    id: (k) => `author:${k}`,
    // The server sends updatedAt (used to bust the portrait cache) though the type doesn't declare it.
    load: (k) => abs.getAuthor(k, session.library?.id) as Promise<Author & { updatedAt?: number }>
  });
  const author = $derived(res.data);

  // Keyed by author so a broken portrait on one page doesn't hide the next author's.
  let imgFailedFor = $state<string | null>(null);

  const inSeries = $derived(new Set(author?.series?.flatMap((s) => s.items.map((i) => i.id)) ?? []));
  const standalone = $derived(author?.libraryItems?.filter((i) => !inSeries.has(i.id)) ?? []);
</script>

<svelte:head><title>{pageTitle(author?.name ?? 'Author')}</title></svelte:head>

{#if res.error}
  <div class="page"><ErrorState title="Couldn't open this author" message={res.error} cause={res.cause} onretry={() => res.refresh()} /></div>
{:else if !author}
  <Loading label="Loading author" />
{:else}
  <div class="page">
    <header class="head">
      <div class="portrait">
        {#if author.imagePath && imgFailedFor !== author.id}
          <img src={authorImageUrl(author.id, 400, author.updatedAt)} alt="" onerror={() => (imgFailedFor = author.id)} />
        {:else}
          <span class="serif" aria-hidden="true">{author.name.slice(0, 1)}</span>
        {/if}
      </div>
      <div class="info">
        <h1 class="page-title big">{author.name}</h1>
        <p class="faint num">{plural(author.libraryItems?.length ?? 0, 'book')} in your library</p>
        {#if author.description}
          <div class="desc serif selectable">
            <ReadMore lines={4}>
              <!-- sanitised by safeHtml -->
              {@html safeHtml(author.description)}
            </ReadMore>
          </div>
        {/if}
      </div>
    </header>

    {#each author.series ?? [] as s (s.id)}
      <Shelf title={s.name} href="/series/{s.id}">
        {#each s.items as item (item.id)}<ItemCard {item} />{/each}
      </Shelf>
    {/each}

    {#if standalone.length}
      <Shelf title={author.series?.length ? 'Other books' : 'Books'}>
        {#each standalone as item (item.id)}<ItemCard {item} />{/each}
      </Shelf>
    {/if}
  </div>
{/if}

<style>
  .head {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 40px;
    align-items: start;
  }
  .portrait {
    width: 180px;
    aspect-ratio: 1;
    border-radius: 50%;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: var(--raised-2);
    font-size: 4rem;
    color: var(--text-3);
    box-shadow: var(--shadow-cover);
  }
  .portrait img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .info {
    padding-top: 12px;
  }
  .big {
    font-size: var(--t-3xl);
    letter-spacing: -0.03em;
  }
  .info > p {
    margin-top: 6px;
    font-size: var(--t-sm);
  }
  .desc {
    margin-top: 16px;
    max-width: 68ch;
    line-height: 1.62;
    color: var(--text-2);
  }
  .desc :global(.more) {
    font-family: var(--font-sans);
  }
</style>
