import * as abs from '$lib/api/abs';
import { onAccountChanged } from '$lib/api/client';
import { emptyQueue, queueFor, reduceQueue, seedQueue } from '$lib/util/podcastFeed';
import { live } from './live.svelte';
import { session } from './session.svelte';

/**
 * The server's podcast episode downloads (not Lectern's own offline downloads): what it's fetching from feeds
 * right now and what waits behind it. Read once per library, then kept current by the socket.
 */
class EpisodeDownloads {
  state = $state(emptyQueue());

  /** Libraries read at least once; read again after a reconnect (the app's or the socket's), since events sent meanwhile were missed. */
  private seen = new Set<string>();
  /** Bumped on account change, so a queue read for the previous account isn't shown. */
  private account = 0;

  constructor() {
    live.onEpisodeEvent((event) => (this.state = reduceQueue(this.state, event)));
    session.onReconnect(() => this.reload());
    live.onResync(() => void this.reload());
    // Another account sees other libraries (and may not be allowed to see the queue at all).
    onAccountChanged(() => {
      this.account++;
      this.seen.clear();
      this.state = emptyQueue();
    });
  }

  async load(libraryId: string) {
    this.seen.add(libraryId);
    const account = this.account;
    const server = await abs.getEpisodeDownloadQueue(libraryId);
    if (account === this.account) this.state = seedQueue(this.state, libraryId, server);
  }

  private reload() {
    return Promise.allSettled([...this.seen].map((id) => this.load(id)));
  }

  forItem(libraryItemId: string) {
    return queueFor(this.state, libraryItemId);
  }
}

export const episodeDownloads = new EpisodeDownloads();
