<script lang="ts">
  import type { Series } from '$lib/api/types';
  import { session } from '$lib/stores/session.svelte';
  import Cover from './Cover.svelte';
  import Progress from './Progress.svelte';

  let { series }: { series: Series } = $props();

  const books = $derived(series.books ?? []);
  const fan = $derived(books.slice(0, 3));
  const finished = $derived(books.filter((b) => session.progressFor(b.id)?.isFinished).length);
  const ratio = $derived(session.library?.settings.coverAspectRatio === 0 ? 1.6 : 1);
</script>

<a class="card" href="/series/{series.id}">
  <div class="fan" style:aspect-ratio="1 / {ratio}">
    {#each fan.toReversed() as b, i (b.id)}
      {@const depth = fan.length - 1 - i}
      <div class="leaf" style:--d={depth} style:z-index={i}>
        <Cover itemId={b.id} title={b.media.metadata.title} updatedAt={b.updatedAt} hasCover={!!b.media.coverPath} width={300} />
      </div>
    {:else}
      <div class="leaf"><Cover itemId={series.id} title={series.name} hasCover={false} /></div>
    {/each}
  </div>
  {#if books.length && finished}
    <div class="prog"><Progress value={finished / books.length} finished={finished === books.length} /></div>
  {/if}
  <div class="text">
    <span class="title">{series.name}</span>
    <span class="by">{books.length} {books.length === 1 ? 'book' : 'books'}{finished ? `, ${finished} finished` : ''}</span>
  </div>
</a>

<style>
  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .fan {
    position: relative;
    margin-right: 16px;
  }
  .leaf {
    position: absolute;
    inset: 0;
    transform: translateX(calc(var(--d, 0) * 8px)) scale(calc(1 - var(--d, 0) * 0.06));
    transform-origin: left center;
    filter: brightness(calc(1 - var(--d, 0) * 0.18));
    transition: transform 200ms var(--ease);
  }
  .card:hover .leaf {
    transform: translateX(calc(var(--d, 0) * 13px)) scale(calc(1 - var(--d, 0) * 0.06));
  }
  .prog {
    margin-top: 8px;
    margin-right: 16px;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 10px;
  }
  .title {
    font-family: var(--font-serif);
    font-size: var(--t-md);
    font-weight: 560;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .by {
    font-size: var(--t-sm);
    color: var(--text-2);
  }
</style>
