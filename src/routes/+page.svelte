<script lang="ts">
  import { Info, Pause, Play } from '@lucide/svelte';
  import * as abs from '$lib/api/abs';
  import { coverUrl } from '$lib/api/client';
  import type { Author, LibraryItem, Series } from '$lib/api/types';
  import { isBook } from '$lib/api/types';
  import AuthorCard from '$lib/components/AuthorCard.svelte';
  import CardSkeleton from '$lib/components/CardSkeleton.svelte';
  import ChapterShelf from '$lib/components/ChapterShelf.svelte';
  import Cover from '$lib/components/Cover.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import SeriesCard from '$lib/components/SeriesCard.svelte';
  import Shelf from '$lib/components/Shelf.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { tintFor, type Tint } from '$lib/util/color';
  import { duration } from '$lib/util/format';
  import { playFrom, playOrToggle } from '$lib/util/play';
  import { resource } from '$lib/util/resource.svelte';
  import { pageTitle } from '$lib/util/title';

  const library = session.library;

  const res = resource(() => library?.id, {
    id: (k) => `home:${k}`,
    load: async (libraryId) => {
      const shelves = await abs.getPersonalized(libraryId);
      const candidate =
        (player.item?.libraryId === libraryId && !player.episode ? player.item : null) ??
        (shelves.find((x) => x.id === 'continue-listening')?.entities[0] as LibraryItem | undefined);
      // Resolve the hero before showing anything, so the page doesn't jump when it arrives.
      const hero = candidate?.mediaType === 'book' ? await abs.getItem(candidate.id).catch(() => null) : null;
      return { shelves, hero };
    }
  });

  const shelves = $derived(res.data?.shelves ?? null);
  const hero = $derived(res.data?.hero ?? null);

  let heroTint = $state<Tint | null>(null);
  $effect(() => {
    const h = hero;
    if (!h) return;
    let current = true;
    void tintFor(coverUrl(h.id, 96, h.updatedAt)).then((t) => {
      if (current) heroTint = t;
    });
    return () => (current = false);
  });

  const heroIsPlaying = $derived(!!hero && player.isCurrent(hero.id));
  const heroProgress = $derived(hero ? session.progressFor(hero.id) : undefined);
  const heroChapters = $derived(hero && isBook(hero) ? (hero.media.chapters ?? []) : []);
  const heroTime = $derived(heroIsPlaying ? player.currentTime : (heroProgress?.currentTime ?? 0));
  const heroDuration = $derived(hero && isBook(hero) ? hero.media.duration : 0);
  const heroChapterIndex = $derived(heroChapters.findIndex((c) => heroTime >= c.start && heroTime < c.end));
  const heroSeries = $derived.by(() => {
    if (!hero || !isBook(hero)) return null;
    const s = hero.media.metadata.series;
    const first = Array.isArray(s) ? s[0] : s;
    return first ?? null;
  });
  const heroLeft = $derived(Math.max(0, heroDuration - heroTime) / (hero ? player.rateFor(hero.id) : 1));

  const visibleShelves = $derived(
    (shelves ?? [])
      .map((s) => (s.id === 'continue-listening' && hero ? { ...s, entities: s.entities.filter((e) => e.id !== hero!.id) } : s))
      .filter((s) => s.entities.length)
  );
</script>

<svelte:head><title>{pageTitle('Home')}</title></svelte:head>

<div class="page">
  {#if hero && isBook(hero)}
    <section
      class="hero tint-scope"
      style:--h={heroTint?.h ?? undefined}
      style:--s={heroTint ? `${heroTint.s}%` : undefined}
      aria-label="Pick up where you left off"
    >
      <div class="wash" style:background-image="url({coverUrl(hero.id, 120, hero.updatedAt)})"></div>
      <a class="hero-cover" href="/item/{hero.id}">
        <Cover itemId={hero.id} title={hero.media.metadata.title} updatedAt={hero.updatedAt} width={520} hasCover={!!hero.media.coverPath} eager />
      </a>
      <div class="hero-body">
        {#if heroSeries}
          <a class="series" href="/series/{heroSeries.id}">{heroSeries.name}{heroSeries.sequence ? `, book ${heroSeries.sequence}` : ''}</a>
        {/if}
        <h1 class="serif"><a href="/item/{hero.id}">{hero.media.metadata.title}</a></h1>
        <p class="by">
          {#each hero.media.metadata.authors ?? [] as a, i (a.id)}{i ? ', ' : ''}<a href="/authors/{a.id}">{a.name}</a>{/each}
          {#if hero.media.metadata.narratorName}<span class="faint"> read by {hero.media.metadata.narratorName}</span>{/if}
        </p>

        <div class="hero-shelf">
          <ChapterShelf
            size="full"
            chapters={heroChapters.length ? heroChapters : [{ id: 0, start: 0, end: heroDuration, title: hero.media.metadata.title }]}
            time={heroTime}
            duration={heroDuration}
            onseek={(t) => playFrom(hero.id, t)}
          />
        </div>

        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" onclick={() => playOrToggle(hero.id)}>
            {#if heroIsPlaying && player.isPlaying}
              <Pause size={18} fill="currentColor" strokeWidth={0} /> Pause
            {:else}
              <Play size={18} fill="currentColor" strokeWidth={0} /> {heroTime > 0 ? 'Resume' : 'Start listening'}
            {/if}
          </button>
          <a class="btn btn-quiet btn-lg" href="/item/{hero.id}"><Info size={17} /> Details</a>
          <p class="where num">
            {#if heroChapters.length > 1 && heroChapterIndex >= 0}
              Chapter {heroChapterIndex + 1} of {heroChapters.length}<br />
            {/if}
            <span class="faint">{duration(heroLeft)} left</span>
          </p>
        </div>
      </div>
    </section>
  {/if}

  {#if res.error}
    <ErrorState title="Couldn't load your shelves" message={res.error} cause={res.cause} onretry={() => res.refresh()} />
  {:else if !shelves}
    <div class="loading"><CardSkeleton label="Loading your shelves" /></div>
  {:else if !visibleShelves.length && !hero}
    <EmptyState title="This library is empty">
      <p>Add audiobooks to the library folder on your server and run a scan. They'll show up here.</p>
    </EmptyState>
  {:else}
    {#each visibleShelves as shelf (shelf.id)}
      {#if shelf.type === 'authors'}
        <Shelf title={shelf.label} href="/authors" itemWidth={136}>
          {#each shelf.entities as a (a.id)}<AuthorCard author={a as Author} />{/each}
        </Shelf>
      {:else if shelf.type === 'series'}
        <Shelf title={shelf.label} href="/series" itemWidth={176}>
          {#each shelf.entities as s (s.id)}<SeriesCard series={s as Series} />{/each}
        </Shelf>
      {:else}
        <Shelf title={shelf.label}>
          {#each shelf.entities as item (item.id + ((item as LibraryItem).recentEpisode?.id ?? ''))}
            <ItemCard item={item as LibraryItem} />
          {/each}
        </Shelf>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .hero {
    position: relative;
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 40px;
    align-items: center;
    padding: 36px 40px;
    border-radius: var(--r-lg);
    overflow: hidden;
    isolation: isolate;
    background: var(--wash);
    animation: hero-in 600ms var(--ease) both;
  }
  .wash {
    position: absolute;
    inset: -60px;
    z-index: -1;
    background-size: cover;
    background-position: center;
    filter: blur(60px) saturate(1.4);
    opacity: 0.45;
  }
  .hero::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(100deg, transparent 20%, color-mix(in srgb, var(--wash) 80%, transparent));
  }
  @keyframes hero-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  .hero-cover {
    display: block;
    transition: transform 240ms var(--ease);
  }
  .hero-cover:hover {
    transform: translateY(-3px) rotate(-0.6deg);
  }
  .hero-body {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .series {
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 8px;
  }
  .series:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  h1 {
    font-size: var(--t-3xl);
    font-weight: 640;
    line-height: 1.02;
    letter-spacing: -0.03em;
    font-variation-settings: 'opsz' 72;
    text-wrap: balance;
    max-width: 18ch;
  }
  .by {
    margin-top: 10px;
    font-size: var(--t-lg);
    color: var(--text-2);
  }
  .by a:hover {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .hero-shelf {
    margin-top: 36px;
    max-width: 760px;
  }
  .hero-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 26px;
  }
  .where {
    margin-left: 14px;
    font-size: var(--t-sm);
    line-height: 1.4;
  }
  .loading {
    margin-top: 36px;
  }
</style>
