<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import { authorImageUrl } from '$lib/api/client';
  import type { Author } from '$lib/api/types';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import Shelf from '$lib/components/Shelf.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { plural, safeHtml } from '$lib/util/format';

  let author = $state<(Author & { updatedAt?: number }) | null>(null);
  let error = $state<string | null>(null);
  let imgFailed = $state(false);
  let expanded = $state(false);

  const id = $derived(page.params.id!);

  $effect(() => {
    const current = id;
    author = null;
    abs
      .getAuthor(current, session.library?.id)
      .then((a) => current === id && (author = a))
      .catch((err) => (error = err.message));
  });

  const inSeries = $derived(new Set(author?.series?.flatMap((s) => s.items.map((i) => i.id)) ?? []));
  const standalone = $derived(author?.libraryItems?.filter((i) => !inSeries.has(i.id)) ?? []);
</script>

{#if error}
  <div class="page"><EmptyState title="Couldn't open this author"><p>{error}</p></EmptyState></div>
{:else if !author}
  <div class="loading"><LoaderCircle size={26} class="spin" /></div>
{:else}
  <div class="page">
    <header class="head">
      <div class="portrait">
        {#if author.imagePath && !imgFailed}
          <img src={authorImageUrl(author.id, 400, author.updatedAt)} alt="" onerror={() => (imgFailed = true)} />
        {:else}
          <span class="serif">{author.name.slice(0, 1)}</span>
        {/if}
      </div>
      <div class="info">
        <h1 class="page-title big">{author.name}</h1>
        <p class="faint num">{plural(author.libraryItems?.length ?? 0, 'book')} in your library</p>
        {#if author.description}
          <div class="desc serif selectable" class:clamped={!expanded}>{@html safeHtml(author.description)}</div>
          {#if author.description.length > 400}
            <button class="more" onclick={() => (expanded = !expanded)}>{expanded ? 'Show less' : 'Read more'}</button>
          {/if}
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
  .loading {
    display: grid;
    place-items: center;
    height: 60vh;
    color: var(--text-3);
  }
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
  .desc.clamped {
    max-height: 6.5em;
    overflow: hidden;
    mask-image: linear-gradient(180deg, #000 50%, transparent);
  }
  .more {
    margin-top: 8px;
    font-weight: 650;
    font-size: var(--t-sm);
    color: var(--accent);
  }
</style>
