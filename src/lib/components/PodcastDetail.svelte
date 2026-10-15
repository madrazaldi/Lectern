<script lang="ts">
  import { ListPlus, RefreshCw, Settings2 } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { LibraryItem, PodcastAutoDownload, PodcastMedia } from '$lib/api/types';
  import { episodeDownloads } from '$lib/stores/episodeDownloads.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { checkForNewEpisodes } from '$lib/util/actions/podcasts';
  import { podcastPermissions } from '$lib/util/podcastFeed';
  import EpisodeList from './EpisodeList.svelte';
  import EpisodeQueue from './EpisodeQueue.svelte';
  import FindEpisodes from './FindEpisodes.svelte';
  import ItemAbout from './ItemAbout.svelte';
  import ItemHero from './ItemHero.svelte';
  import PodcastSettings from './PodcastSettings.svelte';

  /** A podcast's page: header (with the server-side tools for those allowed), description, downloads in flight, then its episodes. */
  let { item }: { item: LibraryItem & { media: PodcastMedia & Partial<PodcastAutoDownload> } } = $props();

  const perms = $derived(podcastPermissions(session.user));
  const feedUrl = $derived(item.media.metadata.feedUrl);

  let finding = $state(false);
  let editing = $state(false);
  let checking = $state(false);

  async function check() {
    checking = true;
    await checkForNewEpisodes(item);
    checking = false;
  }

  onMount(() => {
    void episodeDownloads.load(item.libraryId).catch(() => {});
    // Arriving from "Add podcast": open the feed to pick episodes, once.
    if (page.url.searchParams.has('find')) {
      if (perms.download && feedUrl) finding = true;
      const url = new URL(page.url);
      url.searchParams.delete('find');
      void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
    }
  });
</script>

<ItemHero {item}>
  {#if perms.download || perms.update}
    <div class="manage">
      {#if perms.download && feedUrl}
        <button class="btn btn-quiet" onclick={() => (finding = true)} disabled={!session.online}><ListPlus size={16} /> Find episodes</button>
        <button class="btn btn-quiet" onclick={check} disabled={checking || !session.online}>
          <RefreshCw size={16} class={checking ? 'spin' : ''} />
          {checking ? 'Checking…' : 'Check for new episodes'}
        </button>
      {/if}
      {#if perms.update}
        <button class="btn btn-quiet" onclick={() => (editing = true)} disabled={!session.online}><Settings2 size={16} /> Download settings</button>
      {/if}
    </div>
    {#if item.media.autoDownloadEpisodes}<p class="auto faint">The server downloads new episodes automatically.</p>{/if}
  {/if}
</ItemHero>

<div class="body">
  <ItemAbout {item} />
  <EpisodeQueue itemId={item.id} canClear={perms.download} />
  <EpisodeList podcast={item} />
</div>

{#if finding}<FindEpisodes podcast={item} onclose={() => (finding = false)} />{/if}
{#if editing}<PodcastSettings podcast={item} onclose={() => (editing = false)} />{/if}

<style>
  .body {
    padding: 12px 40px 64px;
  }
  .manage {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 26px;
  }
  .auto {
    margin-top: 10px;
    font-size: var(--t-xs);
  }
</style>
