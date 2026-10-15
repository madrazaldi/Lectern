/**
 * Podcast management logic that doesn't need the UI: which feed episodes the server already has, the server's
 * download queue as socket events change it, where a new podcast's folder goes, and who may do what.
 */
import type { EpisodeDownload, FeedEpisode, LibraryItem, ServerEpisode, User } from '$lib/api/types';

/**
 * An episode URL without the query parameters some hosts add per request (Patreon's expiring tokens), so the same
 * episode matches across fetches. An `id` parameter is kept: some feeds use it to tell episodes apart (as in the
 * server's web client). Also undoes the percent-encoding the server applies to queued download URLs.
 */
export function cleanEpisodeUrl(url: string) {
  let decoded = url;
  try {
    decoded = decodeURI(url);
  } catch {
    // Malformed escapes: compare as given.
  }
  const [base, query] = decoded.split('?', 2);
  if (!query) return decoded;
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()]) if (key !== 'id') params.delete(key);
  const kept = params.toString();
  return kept ? `${base}?${kept}` : base;
}

export type FeedEpisodeState = 'new' | 'queued' | 'downloaded';

export interface FeedEntry {
  /** Stable per episode within the feed (its cleaned enclosure URL). */
  key: string;
  episode: FeedEpisode;
  state: FeedEpisodeState;
}

/**
 * Sort a feed's episodes (newest first) into those already on the server, those queued or downloading there, and
 * new ones. The server matches by guid first and falls back to the enclosure URL, so this does too. Episodes
 * without audio can't be downloaded and are left out.
 */
export function feedEntries(feed: FeedEpisode[], have: ServerEpisode[], pending: EpisodeDownload[]): FeedEntry[] {
  const guids = new Set<string>();
  const urls = new Set<string>();
  for (const ep of have) {
    if (ep.guid) guids.add(ep.guid);
    if (ep.enclosure?.url) urls.add(cleanEpisodeUrl(ep.enclosure.url));
  }
  const pendingGuids = new Set(pending.flatMap((d) => (d.guid ? [d.guid] : [])));
  const pendingUrls = new Set(pending.map((d) => cleanEpisodeUrl(d.url)));

  const seen = new Set<string>();
  const out: FeedEntry[] = [];
  for (const episode of feed) {
    const url = episode.enclosure?.url;
    if (!url) continue;
    const key = cleanEpisodeUrl(url);
    // A feed that lists the same file twice would otherwise offer it twice.
    if (seen.has(key)) continue;
    seen.add(key);
    const state: FeedEpisodeState =
      (episode.guid && guids.has(episode.guid)) || urls.has(key)
        ? 'downloaded'
        : (episode.guid && pendingGuids.has(episode.guid)) || pendingUrls.has(key)
          ? 'queued'
          : 'new';
    out.push({ key, episode, state });
  }
  return out.sort((a, b) => (b.episode.publishedAt ?? 0) - (a.episode.publishedAt ?? 0));
}

/** Socket events about the server's episode downloads, as `live` relays them. */
export type EpisodeEvent =
  | { type: 'queued' | 'started' | 'finished'; download: EpisodeDownload }
  | { type: 'cleared'; libraryItemId: string }
  | { type: 'added'; episode: ServerEpisode & { libraryItem?: LibraryItem } };

export interface QueueState {
  current: EpisodeDownload | null;
  queued: EpisodeDownload[];
  /** Finished downloads (succeeded or failed) seen this session, newest first. */
  done: EpisodeDownload[];
}

const DONE_KEPT = 30;

export const emptyQueue = (): QueueState => ({ current: null, queued: [], done: [] });

/** The next queue state after a socket event. Events arrive in order but may repeat (reconnects), so each is idempotent. */
export function reduceQueue(state: QueueState, event: EpisodeEvent): QueueState {
  switch (event.type) {
    case 'queued': {
      const d = event.download;
      if (state.current?.id === d.id || state.queued.some((q) => q.id === d.id)) return state;
      return { ...state, queued: [...state.queued, d] };
    }
    case 'started': {
      const d = event.download;
      return { ...state, current: d, queued: state.queued.filter((q) => q.id !== d.id) };
    }
    case 'finished': {
      const d = event.download;
      return {
        current: state.current?.id === d.id ? null : state.current,
        queued: state.queued.filter((q) => q.id !== d.id),
        done: [d, ...state.done.filter((x) => x.id !== d.id)].slice(0, DONE_KEPT)
      };
    }
    case 'cleared':
      return { ...state, queued: state.queued.filter((q) => q.libraryItemId !== event.libraryItemId) };
    default:
      return state;
  }
}

/** Replace what's in flight with the server's own account (after loading a page or reconnecting); keep the history. */
export function seedQueue(state: QueueState, libraryId: string, server: { currentDownload?: EpisodeDownload | null; queue: EpisodeDownload[] }): QueueState {
  const other = (d: EpisodeDownload) => d.libraryId !== libraryId;
  const current = server.currentDownload ?? (state.current && other(state.current) ? state.current : null);
  return { ...state, current, queued: [...state.queued.filter(other), ...server.queue] };
}

/** Everything in flight or recently finished for one podcast, in the order the server works through it. */
export function queueFor(state: QueueState, libraryItemId: string) {
  const mine = (d: EpisodeDownload) => d.libraryItemId === libraryItemId;
  return {
    current: state.current && mine(state.current) ? state.current : null,
    queued: state.queued.filter(mine),
    done: state.done.filter(mine)
  };
}

/** The server's own filename rules (sanitizeFilename), minus the byte-length trimming: a podcast's folder name. */
export function sanitizeFilename(name: string) {
  return (
    name
      .normalize('NFC')
      .replace(':', ' - ')
      .replace(/[/?<>\\:*|"]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x80-\x9f]/g, '')
      .replace(/^\.+$/, '')
      .replace(/[\n\r]/g, '')
      .replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, '')
      .replace(/[. ]+$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
  );
}

/** Where a podcast titled `title` goes inside a library folder, using the folder's own separator (Windows servers too). */
export function podcastPath(folderPath: string, title: string) {
  const name = sanitizeFilename(title);
  if (!name) return '';
  const sep = folderPath.includes('\\') && !folderPath.includes('/') ? '\\' : '/';
  return `${folderPath.replace(/[\\/]+$/, '')}${sep}${name}`;
}

/**
 * What a user may do with podcasts. The server only lets admins add podcasts, read feeds and queue downloads;
 * editing settings needs the update permission and removing episodes the delete permission.
 */
export function podcastPermissions(user: User | null | undefined) {
  const admin = user?.type === 'admin' || user?.type === 'root';
  // The server checks these even for admins and root.
  const can = (p: string) => !!user?.permissions?.[p];
  return {
    /** Add podcasts and fetch their feeds. */
    manage: admin,
    /** Queue episodes for the server to download (POST also needs update). */
    download: admin && can('update'),
    update: can('update'),
    delete: can('delete')
  };
}
