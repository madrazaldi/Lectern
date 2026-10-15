/**
 * Podcast management actions (check for new episodes, remove an episode from the server) and Reset progress for
 * any title. Registered as context-menu actions here; the podcast page's buttons call the same functions.
 */
import { RefreshCw, RotateCcw, Trash2 } from '@lucide/svelte';
import * as abs from '$lib/api/abs';
import { isAuthLost, isUnreachable, serverNow } from '$lib/api/client';
import type { LibraryItem, MediaProgress, PodcastEpisode } from '$lib/api/types';
import { isPodcast } from '$lib/api/types';
import { player } from '$lib/stores/player.svelte';
import { session } from '$lib/stores/session.svelte';
import { errorMessage, toast } from '$lib/stores/toast.svelte';
import { confirmDialog } from '$lib/util/confirm';
import { plural } from '$lib/util/format';
import { registerItemAction } from '$lib/util/itemActions';
import { podcastPermissions } from '$lib/util/podcastFeed';

/** Progress worth resetting: something listened to, and not what's playing (which would write it straight back). */
function resettable(itemId: string, episodeId: string | null) {
  const p = session.progressFor(itemId, episodeId);
  if (!p || (!p.isFinished && !p.currentTime && !p.progress)) return null;
  return player.isCurrent(itemId, episodeId) ? null : p;
}

/** Forget a title's progress on the server (it starts from the beginning again), with Undo. */
export async function resetProgress(itemId: string, episodeId: string | null, title: string) {
  const before = session.progressFor(itemId, episodeId);
  if (!before) return;
  try {
    // Progress only patched locally carries a made-up id; the server's record has its own.
    const local = before.id === (episodeId ? `${itemId}:${episodeId}` : itemId);
    const id = local ? (await abs.getProgress(itemId, episodeId))?.id : before.id;
    if (id) await abs.deleteProgress(id);
    session.forgetProgress(itemId, episodeId);
    toast(`Reset progress on ${title}.`, { action: { label: 'Undo', run: () => void restore(before) } });
  } catch (err) {
    toast(`Couldn't reset progress. ${errorMessage(err)}`, { tone: 'error' });
  }
}

async function restore(p: MediaProgress) {
  const patch = { currentTime: p.currentTime, duration: p.duration, progress: p.progress, isFinished: p.isFinished };
  try {
    await abs.updateProgress(p.libraryItemId, patch, p.episodeId);
    session.patchProgress(p.libraryItemId, p.episodeId, patch);
  } catch (err) {
    toast(`Couldn't restore progress. ${errorMessage(err)}`, { tone: 'error' });
  }
}

/** Mark many episodes played in one request. */
export async function markAllPlayed(podcast: LibraryItem, episodes: PodcastEpisode[]) {
  const todo = episodes.filter((ep) => !session.progressFor(podcast.id, ep.id)?.isFinished);
  if (!todo.length) return;
  if (todo.length > 1) {
    const ok = await confirmDialog({
      title: `Mark ${plural(todo.length, 'episode')} as played?`,
      message: 'They move out of Continue Listening and the unplayed list.',
      confirmLabel: 'Mark as played'
    });
    if (!ok) return;
  }
  const before = todo.map((ep) => [ep.id, session.progressFor(podcast.id, ep.id)] as const);
  for (const ep of todo) session.patchProgress(podcast.id, ep.id, { isFinished: true, progress: 1, finishedAt: serverNow(), duration: ep.duration ?? 0 });
  try {
    await abs.batchUpdateProgress(todo.map((ep) => ({ libraryItemId: podcast.id, episodeId: ep.id, isFinished: true })));
    toast(todo.length === 1 ? 'Marked as played.' : `Marked ${plural(todo.length, 'episode')} as played.`);
  } catch (err) {
    // Put back what was there; unlike a single toggle this isn't queued for later.
    for (const [id, p] of before) {
      if (p) session.patchProgress(podcast.id, id, p);
      else session.forgetProgress(podcast.id, id);
    }
    const why = isUnreachable(err) || isAuthLost(err) ? 'The server can’t be reached.' : errorMessage(err);
    toast(`Couldn't mark them as played. ${why}`, { tone: 'error' });
  }
}

/** Ask the server to look for episodes newer than its last check and download them. */
export async function checkForNewEpisodes(item: LibraryItem) {
  if (!isPodcast(item) || !item.media.metadata.feedUrl) {
    toast('This podcast has no RSS feed to check.', { tone: 'error' });
    return [];
  }
  try {
    const found = await abs.checkNewEpisodes(item.id);
    toast(found.length ? `Found ${plural(found.length, 'new episode')}. Downloading to the server.` : `No new episodes of ${item.media.metadata.title}.`);
    return found;
  } catch (err) {
    toast(`Couldn't check for new episodes. ${errorMessage(err)}`, { tone: 'error' });
    return [];
  }
}

/** Remove an episode from the server, after asking; optionally its audio file too. Resolves to whether it went. */
export async function removeEpisode(item: LibraryItem, episode: PodcastEpisode) {
  const answer = await confirmDialog({
    title: `Remove “${episode.title}”?`,
    message: 'It disappears from this podcast for everyone, along with its listening progress and playlist entries.',
    option: 'Also delete the audio file from the server',
    confirmLabel: 'Remove',
    danger: true
  });
  if (!answer) return false;
  try {
    if (player.isCurrent(item.id, episode.id)) await player.stop();
    await abs.deleteEpisode(item.id, episode.id, answer.option);
    session.forgetProgress(item.id, episode.id);
    toast(answer.option ? `Deleted “${episode.title}” and its file.` : `Removed “${episode.title}” from the server.`);
    return true;
  } catch (err) {
    toast(`Couldn't remove the episode. ${errorMessage(err)}`, { tone: 'error' });
    return false;
  }
}

registerItemAction({
  id: 'reset-progress',
  section: 'library',
  order: 2,
  build: ({ item, episode }) => {
    // A podcast card stands for the show, not an episode: nothing to reset.
    if (item.collapsedSeries || (isPodcast(item) && !episode)) return null;
    const episodeId = episode?.id ?? null;
    if (!resettable(item.id, episodeId)) return null;
    return {
      label: 'Reset progress',
      icon: RotateCcw,
      disabled: !session.online,
      run: () => resetProgress(item.id, episodeId, episode?.title ?? item.media.metadata.title)
    };
  }
});

registerItemAction({
  id: 'podcast-check-new',
  section: 'server',
  build: ({ item, episode }) => {
    if (!isPodcast(item) || episode || !item.media.metadata.feedUrl || !podcastPermissions(session.user).manage) return null;
    return { label: 'Check for new episodes', icon: RefreshCw, disabled: !session.online, run: () => checkForNewEpisodes(item) };
  }
});

registerItemAction({
  id: 'episode-delete',
  section: 'server',
  order: 1,
  build: ({ item, episode }) => {
    if (!isPodcast(item) || !episode || !podcastPermissions(session.user).delete) return null;
    return { label: 'Remove from server…', icon: Trash2, danger: true, disabled: !session.online, run: () => removeEpisode(item, episode) };
  }
});
