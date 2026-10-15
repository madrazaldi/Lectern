import * as abs from '$lib/api/abs';
import { emptyQueue, queueFor, reduceQueue, seedQueue } from '$lib/util/podcastFeed';
import { live } from './live.svelte';
import { session } from './session.svelte';

/**
 * The server's podcast episode downloads (not Lectern's own offline downloads): what it's fetching from feeds
 * right now and what waits behind it. Read once per library, then kept current by the socket.
 */
class EpisodeDownloads {
  state = $state(emptyQueue());

  /** Libraries read at least once; read again after a reconnect, since events sent meanwhile were missed. */
  private seen = new Set<string>();

  constructor() {
    live.onEpisodeEvent((event) => (this.state = reduceQueue(this.state, event)));
    session.onReconnect(() => Promise.allSettled([...this.seen].map((id) => this.load(id))));
  }

  async load(libraryId: string) {
    this.seen.add(libraryId);
    const server = await abs.getEpisodeDownloadQueue(libraryId);
    this.state = seedQueue(this.state, libraryId, server);
  }

  forItem(libraryItemId: string) {
    return queueFor(this.state, libraryItemId);
  }
}

export const episodeDownloads = new EpisodeDownloads();
