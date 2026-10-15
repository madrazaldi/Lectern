<script lang="ts">
  import { LoaderCircle, Play } from '@lucide/svelte';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import type { LibraryItem, Series, SeriesRef } from '$lib/api/types';
  import { isBook } from '$lib/api/types';
  import Cover from '$lib/components/Cover.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { duration, plural, safeHtml } from '$lib/util/format';

  let series = $state<Series | null>(null);
  let books = $state<LibraryItem[] | null>(null);
  let error = $state<string | null>(null);

  const id = $derived(page.params.id!);

  $effect(() => {
    const current = id;
    series = null;
    books = null;
    Promise.all([
      abs.getSeries(current),
      abs.getLibraryItems(session.library!.id, { filter: abs.encodeFilter('series', current), sort: 'media.metadata.series.sequence', limit: 200 })
    ])
      .then(([s, res]) => {
        if (current !== id) return;
        series = s;
        books = res.results.map((b) => {
          const meta = isBook(b) ? b.media.metadata.series : undefined;
          const ref = (Array.isArray(meta) ? meta.find((x) => x.id === current) : meta) as SeriesRef | undefined;
          return { ...b, sequence: b.sequence ?? ref?.sequence ?? undefined };
        });
      })
      .catch((err) => (error = err.message));
  });

  const finished = $derived(books?.filter((b) => session.progressFor(b.id)?.isFinished).length ?? 0);
  const totalLength = $derived(books?.reduce((sum, b) => sum + (isBook(b) ? b.media.duration : 0), 0) ?? 0);
  const next = $derived(
    books?.find((b) => {
      const p = session.progressFor(b.id);
      return p && !p.isFinished && p.currentTime > 0;
    }) ?? books?.find((b) => !session.progressFor(b.id)?.isFinished)
  );
  const authors = $derived([...new Set(books?.map((b) => (isBook(b) ? b.media.metadata.authorName : '')).filter(Boolean))].join(', '));
</script>

{#if error}
  <div class="page"><EmptyState title="Couldn't open this series"><p>{error}</p></EmptyState></div>
{:else if !series || !books}
  <div class="loading"><LoaderCircle size={26} class="spin" /></div>
{:else}
  <div class="page">
    <header class="head">
      <div class="fan" aria-hidden="true">
        {#each books.slice(0, 5).toReversed() as b, i (b.id)}
          {@const n = Math.min(books.length, 5)}
          <div class="leaf" style:--i={n - 1 - i} style:z-index={i}>
            <Cover itemId={b.id} title={b.media.metadata.title} updatedAt={b.updatedAt} width={300} hasCover={!!b.media.coverPath} />
          </div>
        {/each}
      </div>
      <div class="info">
        <h1 class="page-title big">{series.name}</h1>
        {#if authors}<p class="by">{authors}</p>{/if}
        <p class="facts faint num">{[plural(books.length, 'book'), duration(totalLength), finished ? `${finished} finished` : ''].filter(Boolean).join(', ')}</p>
        {#if series.description}
          <div class="desc serif selectable">{@html safeHtml(series.description)}</div>
        {/if}
        {#if next}
          <div class="actions">
            <button class="btn btn-primary btn-lg" onclick={() => player.play(next.id)}>
              <Play size={18} fill="currentColor" strokeWidth={0} />
              {session.progressFor(next.id)?.currentTime ? 'Continue' : finished ? 'Start next' : 'Start'}
              {next.sequence ? `book ${next.sequence}` : next.media.metadata.title}
            </button>
          </div>
        {/if}
      </div>
    </header>

    <div class="grid">
      {#each books as b (b.id)}<ItemCard item={b} showSequence />{/each}
    </div>
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
    grid-template-columns: 300px 1fr;
    gap: 48px;
    align-items: center;
    margin-bottom: 48px;
  }
  .fan {
    position: relative;
    height: 230px;
  }
  .leaf {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 180px;
    transform: translateX(calc(var(--i) * 28px)) rotate(calc(var(--i) * 2.5deg));
    transform-origin: bottom left;
    filter: brightness(calc(1 - var(--i) * 0.1));
  }
  .big {
    font-size: var(--t-3xl);
    letter-spacing: -0.03em;
  }
  .by {
    margin-top: 10px;
    font-size: var(--t-lg);
    color: var(--text-2);
  }
  .facts {
    margin-top: 6px;
    font-size: var(--t-sm);
  }
  .desc {
    margin-top: 16px;
    max-width: 66ch;
    line-height: 1.6;
    color: var(--text-2);
  }
  .actions {
    margin-top: 22px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 30px 24px;
  }
</style>
