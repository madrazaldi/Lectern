<script lang="ts">
  import type { LibraryItem, PodcastMedia } from '$lib/api/types';
  import EpisodeList from './EpisodeList.svelte';
  import ItemAbout from './ItemAbout.svelte';
  import ItemHero from './ItemHero.svelte';

  /** A podcast's page: header, description, then its episodes. */
  let { item }: { item: LibraryItem & { media: PodcastMedia } } = $props();
</script>

<ItemHero {item} />

<div class="body">
  <ItemAbout {item} />
  <EpisodeList podcast={item} />
</div>

<style>
  .body {
    padding: 12px 40px 64px;
  }
</style>
