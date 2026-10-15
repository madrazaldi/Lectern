/**
 * What the play buttons around the app do, in one place: the item page, the Home hero, cards, rows,
 * episode rows and context menus all go through these.
 */
import type { LibraryItem, PodcastEpisode, PodcastMetadata } from '$lib/api/types';
import { isBook } from '$lib/api/types';
import { player } from '$lib/stores/player.svelte';
import { prefs } from '$lib/stores/prefs.svelte';
import { session } from '$lib/stores/session.svelte';
import { errorMessage, toast } from '$lib/stores/toast.svelte';
import { clock } from './format';
import type { QueueEntry } from './playback';

/** Pause/resume if this is what's loaded, otherwise start it. */
export function playOrToggle(itemId: string, episodeId: string | null = null) {
  if (player.isCurrent(itemId, episodeId)) player.toggle();
  else void player.play(itemId, episodeId);
}

/** Jump to `time`: seek if it's already playing, otherwise start there. */
export function playFrom(itemId: string, time: number, episodeId: string | null = null) {
  if (player.isCurrent(itemId, episodeId) && player.ready) void player.seek(time);
  else void player.play(itemId, episodeId, time);
}

export function queueEntry(item: LibraryItem, episode: PodcastEpisode | null = null): QueueEntry {
  return {
    itemId: item.id,
    episodeId: episode?.id ?? null,
    title: episode?.title ?? item.media.metadata.title,
    subtitle: episode
      ? item.media.metadata.title
      : isBook(item)
        ? (item.media.metadata.authorName ?? '')
        : ((item.media.metadata as PodcastMetadata).author ?? ''),
    updatedAt: item.updatedAt
  };
}

/** Add to Up Next, or take it off again if it's already there. */
export function toggleQueued(item: LibraryItem, episode: PodcastEpisode | null = null) {
  const episodeId = episode?.id ?? null;
  const at = player.queue.findIndex((q) => q.itemId === item.id && q.episodeId === episodeId);
  if (at >= 0) {
    player.removeFromQueue(at);
    toast('Removed from Up Next.');
    return;
  }
  player.enqueue(queueEntry(item, episode));
  toast(player.item ? 'Added to Up Next. It plays when the current title finishes.' : 'Added to Up Next.');
}

/** Flip finished / not finished, with a toast either way. */
export async function toggleFinished(itemId: string, episodeId: string | null = null) {
  const next = !session.progressFor(itemId, episodeId)?.isFinished;
  try {
    await session.setFinished(itemId, episodeId, next);
    toast(next ? 'Marked as finished.' : 'Marked as not finished.');
  } catch (err) {
    toast(`Couldn't update progress. ${errorMessage(err)}`, { tone: 'error' });
  }
}

/** Bookmark the current position of whatever is playing (books only). Resolves to whether one was added. */
export async function bookmarkHere(): Promise<boolean> {
  if (!player.item || !player.ready || player.episode) return false;
  const at = player.currentTime;
  const label = player.chapter && player.chapters.length > 1 ? `${player.chapter.title} at ${clock(at - player.chapter.start)}` : clock(at);
  try {
    await session.addBookmark(player.item.id, at, label);
    toast(`Bookmark added at ${clock(at)}.`);
    return true;
  } catch (err) {
    toast(`Couldn't add the bookmark. ${errorMessage(err)}`, { tone: 'error' });
    return false;
  }
}

/** Remove a bookmark, offering Undo. */
export async function removeBookmark(itemId: string, mark: { time: number; title: string }) {
  try {
    await session.removeBookmark(itemId, mark.time);
    toast('Bookmark deleted.', {
      action: {
        label: 'Undo',
        run: () => void session.addBookmark(itemId, mark.time, mark.title).catch((err) => toast(`Couldn't restore it. ${errorMessage(err)}`, { tone: 'error' }))
      }
    });
  } catch (err) {
    toast(`Couldn't delete the bookmark. ${errorMessage(err)}`, { tone: 'error' });
  }
}

// Volume shortcuts and the mute button share what the volume was before muting.
let beforeMute = 1;

export function toggleMute() {
  if (prefs.volume > 0) {
    beforeMute = prefs.volume;
    player.setVolume(0);
  } else player.setVolume(beforeMute || 1);
}

export function nudgeVolume(by: number) {
  player.setVolume(Math.round((prefs.volume + by) * 100) / 100);
}

/** Speed steps for the keyboard: a tenth at a time. */
export function nudgeRate(by: number) {
  player.setRate(player.rate + by);
}
