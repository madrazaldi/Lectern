<script lang="ts">
  import { Play } from '@lucide/svelte';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import type { SeriesRef } from '$lib/api/types';
  import { isBook } from '$lib/api/types';
  import Cover from '$lib/components/Cover.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import ReadMore from '$lib/components/ReadMore.svelte';
  import { live } from '$lib/stores/live.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { duration, plural, safeHtml } from '$lib/util/format';
  import { resource } from '$lib/util/resource.svelte';
  import { pageTitle } from '$lib/util/title';

  const id = $derived(page.params.id!);
  const library = session.library!;

  const res = resource(() => id, {
    id: (k) => `series:${k}`,
    load: async (k) => {
      const [series, list] = await Promise.all([
        abs.getSeries(k),
        abs.getLibraryItems(library.id, { filter: abs.encodeFilter('series', k), sort: 'media.metadata.series.sequence', limit: 200 })
      ]);
      const books = list.results.map((b) => {
        const meta = isBook(b) ? b.media.metadata.series : undefined;
        const ref = (Array.isArray(meta) ? meta.find((x) => x.id === k) : meta) as SeriesRef | undefined;
        return { ...b, sequence: b.sequence ?? ref?.sequence ?? undefined };
      });
      return { series, books };
    }
  });
  const series = $derived(res.data?.series);
  const books = $derived(res.data?.books);

  $effect(() =>
    live.onItemChange((_, it) => {
      if (it.libraryId === library.id && books?.some((b) => b.id === it.id)) void res.refresh();
    })
  );

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

<svelte:head><title>{pageTitle(series?.name ?? 'Series')}</title></svelte:head>

{#if res.error}
  <div class="page"><ErrorState title="Couldn't open this series" message={res.error} cause={res.cause} onretry={() => res.refresh()} /></div>
{:else if !series || !books}
  <Loading label="Loading series" />
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
        <p class="facts faint num">
          {[plural(books.length, 'book'), duration(totalLength), finished ? `${finished} finished` : ''].filter(Boolean).join(', ')}
        </p>
        {#if series.description}
          <div class="desc serif selectable">
            <ReadMore lines={5}>
              <!-- sanitised by safeHtml -->
              {@html safeHtml(series.description)}
            </ReadMore>
          </div>
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

    <h2 class="sr-only">Books</h2>
    <div class="grid">
      {#each books as b (b.id)}<ItemCard item={b} showSequence />{/each}
    </div>
  </div>
{/if}

<style>
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
  .desc :global(.more) {
    font-family: var(--font-sans);
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
