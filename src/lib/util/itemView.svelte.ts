/**
 * What a card or row needs to know about a library entry: a book, a podcast, a podcast's latest episode
 * (shelves), or a collapsed series standing in for its books. Shared by ItemCard and ItemRow.
 */
import type { LibraryItem, PodcastMetadata } from '$lib/api/types';
import { isBook, isPodcast } from '$lib/api/types';
import { player } from '$lib/stores/player.svelte';
import { session } from '$lib/stores/session.svelte';
import { playOrToggle } from './play';

export class ItemView {
  #get: () => LibraryItem;

  constructor(item: () => LibraryItem) {
    this.#get = item;
  }

  item = $derived.by(() => this.#get());
  series = $derived(this.item.collapsedSeries ?? null);
  episode = $derived(this.item.recentEpisode ?? null);
  episodeId = $derived(this.episode?.id ?? null);
  href = $derived(this.series ? `/series/${this.series.id}` : `/item/${this.item.id}`);
  title = $derived(this.series ? this.series.name : (this.episode?.title ?? this.item.media.metadata.title));
  author = $derived.by(() => {
    const item = this.item;
    if (this.series) return '';
    if (isBook(item)) return item.media.metadata.authorName ?? '';
    return (item.media.metadata as PodcastMetadata).author ?? '';
  });
  progress = $derived(this.series ? undefined : session.progressFor(this.item.id, this.episodeId));
  current = $derived(!this.series && player.isCurrent(this.item.id, this.episodeId));
  playing = $derived(this.current && player.isPlaying);
  /** A series has nothing to play directly; a podcast needs an episode. */
  canPlay = $derived(!this.series && (!isPodcast(this.item) || !!this.episode) && !this.item.isMissing);
  playLabel = $derived(this.playing ? `Pause ${this.title}` : `Play ${this.title}`);

  play = () => {
    if (this.canPlay) playOrToggle(this.item.id, this.episodeId);
  };
}
