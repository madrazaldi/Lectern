<script lang="ts">
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import { coverUrl } from '$lib/api/client';
  import { isBook, isPodcast } from '$lib/api/types';
  import BookDetail from '$lib/components/BookDetail.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import PodcastDetail from '$lib/components/PodcastDetail.svelte';
  import { downloads } from '$lib/stores/downloads.svelte';
  import { live } from '$lib/stores/live.svelte';
  import { tintFor, type Tint } from '$lib/util/color';
  import { resource } from '$lib/util/resource.svelte';
  import { pageTitle } from '$lib/util/title';

  const id = $derived(page.params.id!);

  const res = resource(() => id, {
    id: (k) => `item:${k}`,
    load: (k) => abs.getItem(k),
    // Offline: a downloaded copy still has everything the page needs.
    fallback: (k) => downloads.list.find((d) => d.itemId === k)?.item
  });
  const item = $derived(res.data);

  // The page takes on its own cover's colour. The guard drops a tint that arrives after navigating to another title.
  let tint = $state<Tint | null>(null);
  $effect(() => {
    const it = item;
    tint = null;
    if (!it) return;
    let current = true;
    void tintFor(coverUrl(it.id, 96, it.updatedAt)).then((t) => {
      if (current) tint = t;
    });
    return () => (current = false);
  });

  // Edits made elsewhere (another device, the web app) show up without leaving the page.
  $effect(() =>
    live.onItemChange((change, it) => {
      if (it.id === id && change === 'updated') void res.refresh();
    })
  );
</script>

<svelte:head><title>{pageTitle(item?.media.metadata.title)}</title></svelte:head>

{#if res.error}
  <div class="page"><ErrorState title="Couldn't open this title" message={res.error} cause={res.cause} onretry={() => res.refresh()} /></div>
{:else if !item}
  <Loading label="Loading title" />
{:else}
  <article class="tint-scope" style:--h={tint?.h} style:--s={tint ? `${tint.s}%` : undefined}>
    {#if isBook(item)}
      <BookDetail {item} />
    {:else if isPodcast(item)}
      <PodcastDetail {item} />
    {/if}
  </article>
{/if}
