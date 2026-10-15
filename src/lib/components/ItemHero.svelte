<script lang="ts">
  import { BookOpenText, Check, CircleCheck } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import { encodeFilter } from '$lib/api/abs';
  import { coverUrl } from '$lib/api/client';
  import type { LibraryItem, PodcastMetadata, SeriesRef } from '$lib/api/types';
  import { isBook, isPodcast } from '$lib/api/types';
  import { session } from '$lib/stores/session.svelte';
  import { duration } from '$lib/util/format';
  import { toggleFinished } from '$lib/util/play';
  import Cover from './Cover.svelte';
  import { canRead, ebookFormat, formatOf, hasAudio, otherEbooks, readHref } from './reader/ebook';

  /** The top of a title's page: cover, series, title, people and facts. Book or podcast specifics go in `children`. */
  let { item, children }: { item: LibraryItem; children?: Snippet } = $props();

  const meta = $derived(item.media.metadata);
  const book = $derived(isBook(item) ? item : null);
  const podcast = $derived(isPodcast(item) ? item : null);
  const chapters = $derived(book?.media.chapters ?? []);
  const seriesList = $derived.by<SeriesRef[]>(() => {
    const s = book?.media.metadata.series;
    return !s ? [] : Array.isArray(s) ? s : [s];
  });

  const audio = $derived(hasAudio(item));
  const readable = $derived(canRead(item));
  const format = $derived(ebookFormat(item));
  const others = $derived(otherEbooks(item));
  const progress = $derived(session.progressFor(item.id));
  const readPct = $derived(progress?.ebookLocation ? Math.round((progress.ebookProgress ?? 0) * 100) : null);
  let marking = $state(false);

  async function finished() {
    marking = true;
    await toggleFinished(item.id);
    marking = false;
  }

  const narratorHref = (n: string) => `/library?filter=${encodeURIComponent(encodeFilter('narrators', n))}&label=${encodeURIComponent(`Read by ${n}`)}`;
</script>

<header class="top">
  <div class="wash" style:background-image="url({coverUrl(item.id, 120, item.updatedAt)})"></div>
  <div class="cover">
    <Cover itemId={item.id} title={meta.title} updatedAt={item.updatedAt} width={640} hasCover={!!item.media.coverPath} radius="var(--r-md)" eager />
  </div>
  <div class="head">
    {#if seriesList.length}
      <p class="series">
        {#each seriesList as s, i (s.id)}{i ? ', ' : ''}<a href="/series/{s.id}">{s.name}{s.sequence ? `, book ${s.sequence}` : ''}</a>{/each}
      </p>
    {/if}
    <h1 class="serif selectable">{meta.title}</h1>
    {#if book?.media.metadata.subtitle}<p class="subtitle serif">{book.media.metadata.subtitle}</p>{/if}

    <p class="people">
      {#if book}
        {#each book.media.metadata.authors ?? [] as a, i (a.id)}{i ? ', ' : ''}<a href="/authors/{a.id}">{a.name}</a>{/each}
        {#if book.media.metadata.narrators?.length}
          <span class="faint">read by</span>
          {#each book.media.metadata.narrators as n, i (n)}{i ? ', ' : ''}<a href={narratorHref(n)}>{n}</a>{/each}
        {/if}
      {:else}
        {(meta as PodcastMetadata).author}
      {/if}
    </p>

    <dl class="facts">
      {#if book && audio}
        <div>
          <dt>Length</dt>
          <dd class="num">{duration(book.media.duration)}</dd>
        </div>
        {#if chapters.length > 1}<div>
            <dt>Chapters</dt>
            <dd class="num">{chapters.length}</dd>
          </div>{/if}
      {:else if podcast}
        <div>
          <dt>Episodes</dt>
          <dd class="num">{(podcast.media.episodes?.length ?? 0).toLocaleString()}</dd>
        </div>
      {/if}
      {#if book?.media.metadata.publishedYear}<div>
          <dt>Published</dt>
          <dd>{book.media.metadata.publishedYear}</dd>
        </div>{/if}
      {#if book?.media.metadata.publisher}<div>
          <dt>Publisher</dt>
          <dd>{book.media.metadata.publisher}</dd>
        </div>{/if}
      {#if meta.language}<div>
          <dt>Language</dt>
          <dd>{meta.language}</dd>
        </div>{/if}
      {#if format}<div>
          <dt>Ebook</dt>
          <dd>{format.toUpperCase()}</dd>
        </div>{/if}
    </dl>

    <!-- A book with no audio has nothing to play: its listening controls (children) give way to reading ones. -->
    {#if book && !audio}
      <div class="actions">
        {#if readable}
          <a class="btn btn-primary btn-lg" href={readHref(item.id)} class:disabled={item.isMissing} aria-disabled={item.isMissing}>
            <BookOpenText size={18} />
            {readPct !== null ? 'Continue reading' : 'Read'}
          </a>
        {/if}
        <button class="btn btn-quiet btn-lg" onclick={finished} disabled={marking}>
          {#if progress?.isFinished}<CircleCheck size={18} /> Finished{:else}<Check size={18} /> Mark as finished{/if}
        </button>
        {#if readPct !== null && !progress?.isFinished}<span class="where faint num">{readPct}% read</span>{/if}
      </div>
    {:else}
      {@render children?.()}
      {#if readable}
        <p class="read">
          <a class="btn btn-quiet" href={readHref(item.id)}><BookOpenText size={16} /> {readPct !== null ? 'Continue reading the ebook' : 'Read the ebook'}</a>
          {#if readPct !== null}<span class="faint num">{readPct}% read</span>{/if}
        </p>
      {/if}
    {/if}
    {#if others.length}
      <p class="others faint">
        Also as
        {#each others as f, i (f.ino)}{i ? ', ' : ' '}<a href={readHref(item.id, f.ino)} title={f.metadata.filename}>{formatOf(f).toUpperCase()}</a>{/each}
      </p>
    {/if}
  </div>
</header>

<style>
  .top {
    position: relative;
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 44px;
    padding: 24px 40px 44px;
    isolation: isolate;
    margin-top: -60px;
    padding-top: 84px;
  }
  .wash {
    position: absolute;
    inset: 0 0 -80px;
    z-index: -1;
    background-size: cover;
    background-position: center 30%;
    filter: blur(80px) saturate(1.4);
    opacity: 0.4;
    mask-image: linear-gradient(180deg, #000 30%, transparent);
  }
  .cover {
    align-self: start;
  }
  .cover :global(.cover) {
    box-shadow:
      0 2px 4px rgb(0 0 0 / 0.3),
      0 30px 60px -20px rgb(0 0 0 / 0.65);
  }
  .head {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding-top: 8px;
  }
  .series {
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 10px;
  }
  .series a:hover,
  .people a:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  h1 {
    font-size: var(--t-3xl);
    line-height: 1.04;
    font-weight: 640;
    letter-spacing: -0.03em;
    font-variation-settings: 'opsz' 72;
    text-wrap: balance;
    max-width: 22ch;
  }
  .subtitle {
    margin-top: 8px;
    font-size: var(--t-lg);
    font-style: italic;
    color: var(--text-2);
  }
  .people {
    margin-top: 14px;
    font-size: var(--t-lg);
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 32px;
    margin: 24px 0 0;
  }
  .facts div {
    display: flex;
    flex-direction: column;
  }
  dt {
    font-size: var(--t-xs);
    color: var(--text-3);
  }
  dd {
    margin: 2px 0 0;
    font-size: var(--t-md);
    font-weight: 550;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 28px;
  }
  .actions .disabled {
    pointer-events: none;
    opacity: 0.5;
  }
  .where {
    margin-left: 10px;
    font-size: var(--t-sm);
  }
  .read {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 14px;
    font-size: var(--t-sm);
  }
  .others {
    margin-top: 10px;
    font-size: var(--t-sm);
  }
  .others a {
    font-weight: 600;
    color: var(--text-2);
  }
  .others a:hover {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  @media (max-width: 1180px) {
    .top {
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 32px;
    }
  }
</style>
