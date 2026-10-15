/** The built-in title actions (Play, Up Next, Finished, Download, Playlist, Go to…) and the attachment cards use. */
import { ArrowDownToLine, BookOpen, CircleCheck, CircleX, Feather, ListEnd, ListPlus, ListX, Pause, Play, Shapes, Trash2 } from '@lucide/svelte';
import { goto } from '$app/navigation';
import * as abs from '$lib/api/abs';
import type { LibraryItem, SeriesRef } from '$lib/api/types';
import { isBook, isPodcast } from '$lib/api/types';
import { inTauri } from '$lib/native';
import { downloads } from '$lib/stores/downloads.svelte';
import { player } from '$lib/stores/player.svelte';
import { session } from '$lib/stores/session.svelte';
import { errorMessage, toast } from '$lib/stores/toast.svelte';
import { contextMenuFor } from './contextMenu.svelte';
import { dialogs } from './dialogs.svelte';
import { itemMenuRequest, registerItemAction, type ItemTarget } from './itemActions';
import { playOrToggle, toggleFinished, toggleQueued } from './play';
import './actions/podcasts';

/** The episode a target plays: an explicit one, or a shelf's latest episode. Podcasts without one have nothing to play. */
function playable(t: ItemTarget) {
  const episode = t.episode ?? t.item.recentEpisode ?? null;
  if (t.item.collapsedSeries || (isPodcast(t.item) && !episode)) return null;
  return { item: t.item, episode, episodeId: episode?.id ?? null };
}

/** Minified library listings carry author and series names but not their ids; fetch the full item when needed. */
async function refs(item: LibraryItem) {
  const pick = (it: LibraryItem) => {
    if (!isBook(it)) return { series: [] as SeriesRef[], authors: [] as { id: string }[] };
    const s = it.media.metadata.series;
    return { series: !s ? [] : Array.isArray(s) ? s : [s], authors: it.media.metadata.authors ?? [] };
  };
  const have = pick(item);
  if (have.series.length || have.authors.length) return have;
  return pick(await abs.getItem(item.id));
}

async function goToRef(item: LibraryItem, kind: 'series' | 'authors') {
  try {
    const r = await refs(item);
    const first = r[kind][0];
    if (first) void goto(`/${kind}/${first.id}`);
    else toast(kind === 'series' ? 'This title isn’t in a series.' : 'No author is recorded for this title.');
  } catch (err) {
    toast(`Couldn't open it. ${errorMessage(err)}`, { tone: 'error' });
  }
}

registerItemAction({
  id: 'play',
  section: 'play',
  build: (t) => {
    const p = playable(t);
    if (!p) return null;
    const playing = player.isCurrent(p.item.id, p.episodeId) && player.isPlaying;
    return { label: playing ? 'Pause' : 'Play', icon: playing ? Pause : Play, disabled: p.item.isMissing, run: () => playOrToggle(p.item.id, p.episodeId) };
  }
});

registerItemAction({
  id: 'queue',
  section: 'play',
  order: 1,
  build: (t) => {
    const p = playable(t);
    if (!p || player.isCurrent(p.item.id, p.episodeId)) return null;
    const queued = player.inQueue(p.item.id, p.episodeId);
    return { label: queued ? 'Remove from Up Next' : 'Add to Up Next', icon: queued ? ListX : ListEnd, run: () => toggleQueued(p.item, p.episode) };
  }
});

registerItemAction({
  id: 'finished',
  section: 'library',
  build: (t) => {
    const p = playable(t);
    if (!p) return null;
    const done = !!session.progressFor(p.item.id, p.episodeId)?.isFinished;
    return { label: done ? 'Mark as not finished' : 'Mark as finished', icon: done ? CircleX : CircleCheck, run: () => toggleFinished(p.item.id, p.episodeId) };
  }
});

registerItemAction({
  id: 'download',
  section: 'library',
  order: 1,
  build: (t) => {
    const p = playable(t);
    if (!p || !inTauri || !session.canDownload) return null;
    const record = downloads.get(p.item.id, p.episodeId);
    if (record?.status === 'downloading') return { label: 'Cancel download', icon: CircleX, run: () => downloads.cancel(record.key) };
    if (record?.status === 'ready')
      return {
        label: 'Remove download',
        icon: Trash2,
        danger: true,
        run: async () => {
          await downloads.remove(record.key);
          toast(`Removed the download of ${record.title}.`);
        }
      };
    return {
      label: record?.status === 'failed' ? 'Retry download' : 'Download',
      icon: ArrowDownToLine,
      disabled: !session.online,
      run: () => downloads.start(p.item.id, p.episodeId)
    };
  }
});

registerItemAction({
  id: 'playlist',
  section: 'organize',
  build: (t) => {
    const p = playable(t);
    if (!p) return null;
    return {
      label: 'Add to playlist…',
      icon: ListPlus,
      run: () => {
        dialogs.playlist = {
          libraryId: p.item.libraryId,
          entry: { libraryItemId: p.item.id, episodeId: p.episodeId },
          title: p.episode?.title ?? p.item.media.metadata.title
        };
      }
    };
  }
});

registerItemAction({
  id: 'go-series',
  section: 'go',
  build: ({ item }) => {
    if (item.collapsedSeries) {
      const id = item.collapsedSeries.id;
      return { label: 'Go to series', icon: Shapes, run: () => goto(`/series/${id}`) };
    }
    if (!isBook(item) || !(item.media.metadata.series || item.media.metadata.seriesName)) return null;
    return { label: 'Go to series', icon: Shapes, run: () => goToRef(item, 'series') };
  }
});

registerItemAction({
  id: 'go-author',
  section: 'go',
  order: 1,
  build: ({ item }) => {
    if (item.collapsedSeries || !isBook(item) || !(item.media.metadata.authors?.length || item.media.metadata.authorName)) return null;
    return { label: 'Go to author', icon: Feather, run: () => goToRef(item, 'authors') };
  }
});

registerItemAction({
  id: 'go-podcast',
  section: 'go',
  order: 2,
  build: ({ item, episode }) => {
    // From a shelf's latest-episode card, the way to the rest of the show.
    if (episode || !item.recentEpisode) return null;
    return { label: 'Go to podcast', icon: BookOpen, run: () => goto(`/item/${item.id}`) };
  }
});

/** Attachment: this card/row offers the title's actions on right-click and Shift+F10. */
export function itemMenuFor(target: () => ItemTarget) {
  return contextMenuFor(() => itemMenuRequest(target()));
}
