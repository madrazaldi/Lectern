import { APP_VERSION } from '$lib/native';
import { request } from './client';
import type {
  Author,
  Bookmark,
  Chapter,
  Collection,
  FilterData,
  Library,
  LibraryItem,
  ListeningStats,
  MediaProgress,
  Paged,
  PlaybackSession,
  Playlist,
  SearchResults,
  Series,
  Shelf,
  User
} from './types';

/** Filter values are base64-encoded on the wire: `group.<base64(value)>`. */
export function encodeFilter(group: string, value: string) {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(value)));
  return `${group}.${b64}`;
}

export const getMe = () => request<User>('/api/me');

export const getLibraries = () => request<{ libraries: Library[] }>('/api/libraries').then((r) => r.libraries.sort((a, b) => a.displayOrder - b.displayOrder));

export const getPersonalized = (libraryId: string, limit = 12) =>
  request<Shelf[]>(`/api/libraries/${libraryId}/personalized`, { query: { limit, include: 'rssfeed,numEpisodesIncomplete' } });

export interface ItemsQuery {
  sort?: string;
  desc?: boolean;
  filter?: string;
  page?: number;
  limit?: number;
  collapseseries?: boolean;
}

export const getLibraryItems = (libraryId: string, q: ItemsQuery = {}, signal?: AbortSignal) =>
  request<Paged<LibraryItem>>(`/api/libraries/${libraryId}/items`, {
    signal,
    query: {
      sort: q.sort,
      desc: q.desc ? 1 : 0,
      filter: q.filter,
      page: q.page ?? 0,
      limit: q.limit ?? 60,
      collapseseries: q.collapseseries ? 1 : 0,
      minified: 1,
      include: 'rssfeed,numEpisodesIncomplete'
    }
  });

export const getFilterData = (libraryId: string) => request<FilterData>(`/api/libraries/${libraryId}/filterdata`);

export const getSeriesList = (libraryId: string, page = 0, sort = 'name', desc = false, limit = 60) =>
  request<Paged<Series>>(`/api/libraries/${libraryId}/series`, {
    query: { page, limit, sort, desc: desc ? 1 : 0, minified: 1 }
  });

export const getSeries = (seriesId: string) => request<Series>(`/api/series/${seriesId}`, { query: { include: 'progress' } });

export const getAuthors = (libraryId: string) => request<{ authors: Author[] }>(`/api/libraries/${libraryId}/authors`).then((r) => r.authors);

export const getAuthor = (authorId: string, libraryId?: string) =>
  request<Author>(`/api/authors/${authorId}`, { query: { include: 'items,series', library: libraryId } });

export const getCollections = (libraryId: string) =>
  request<Paged<Collection>>(`/api/libraries/${libraryId}/collections`, { query: { minified: 1 } }).then((r) => r.results);

export const getCollection = (id: string) => request<Collection>(`/api/collections/${id}`);

export const getPlaylists = (libraryId: string) => request<Paged<Playlist>>(`/api/libraries/${libraryId}/playlists`).then((r) => r.results);

export interface PlaylistEntry {
  libraryItemId: string;
  episodeId?: string | null;
}

export const getPlaylist = (id: string) => request<Playlist>(`/api/playlists/${id}`);

export const createPlaylist = (libraryId: string, name: string, items: PlaylistEntry[] = []) =>
  request<Playlist>('/api/playlists', { method: 'POST', body: { libraryId, name, items } });

export const updatePlaylist = (id: string, patch: { name?: string; description?: string | null; items?: PlaylistEntry[] }) =>
  request<Playlist>(`/api/playlists/${id}`, { method: 'PATCH', body: patch });

export const deletePlaylist = (id: string) => request<void>(`/api/playlists/${id}`, { method: 'DELETE' });

export const addToPlaylist = (id: string, entry: PlaylistEntry) =>
  request<Playlist>(`/api/playlists/${id}/item`, { method: 'POST', body: { libraryItemId: entry.libraryItemId, episodeId: entry.episodeId ?? undefined } });

export const removeFromPlaylist = (id: string, entry: PlaylistEntry) =>
  request<Playlist>(`/api/playlists/${id}/item/${entry.libraryItemId}${entry.episodeId ? `/${entry.episodeId}` : ''}`, { method: 'DELETE' });

export const getItem = (id: string) => request<LibraryItem>(`/api/items/${id}`, { query: { expanded: 1, include: 'progress,rssfeed,authors' } });

export const search = (libraryId: string, q: string, signal?: AbortSignal) =>
  request<SearchResults>(`/api/libraries/${libraryId}/search`, { query: { q, limit: 12 }, signal });

export const getListeningStats = () => request<ListeningStats>('/api/me/listening-stats');

export const getItemsInProgress = () => request<{ libraryItems: LibraryItem[] }>('/api/me/items-in-progress').then((r) => r.libraryItems);

/** The server's copy of one item's progress, or null if it has none. */
export const getProgress = (itemId: string, episodeId?: string | null, signal?: AbortSignal) =>
  request<MediaProgress>(`/api/me/progress/${itemId}${episodeId ? `/${episodeId}` : ''}`, { signal }).catch((err) => {
    if (err?.status === 404) return null;
    throw err;
  });

export const updateProgress = (itemId: string, patch: Partial<MediaProgress>, episodeId?: string | null) =>
  request<void>(`/api/me/progress/${itemId}${episodeId ? `/${episodeId}` : ''}`, { method: 'PATCH', body: patch });

export const removeFromContinueListening = (progressId: string) => request<User>(`/api/me/progress/${progressId}/remove-from-continue-listening`);

export const createBookmark = (itemId: string, time: number, title: string) =>
  request<Bookmark>(`/api/me/item/${itemId}/bookmark`, { method: 'POST', body: { time, title } });

export const updateBookmark = (itemId: string, time: number, title: string) =>
  request<Bookmark>(`/api/me/item/${itemId}/bookmark`, { method: 'PATCH', body: { time, title } });

export const deleteBookmark = (itemId: string, time: number) => request<void>(`/api/me/item/${itemId}/bookmark/${time}`, { method: 'DELETE' });

export const DEVICE_ID_KEY = 'lectern.deviceId';

function deviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function deviceInfo() {
  return { clientName: 'Lectern', clientVersion: APP_VERSION, deviceId: deviceId(), manufacturer: 'Lectern', model: 'Desktop' };
}

const SUPPORTED_MIME = ['audio/flac', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/x-aiff', 'audio/wav', 'audio/webm', 'audio/ogg'];

export const startPlayback = (itemId: string, episodeId?: string | null) =>
  request<PlaybackSession>(`/api/items/${itemId}/play${episodeId ? `/${episodeId}` : ''}`, {
    method: 'POST',
    body: {
      deviceInfo: deviceInfo(),
      supportedMimeTypes: SUPPORTED_MIME,
      mediaPlayer: 'html5',
      forceDirectPlay: true,
      forceTranscode: false
    }
  });

export interface SyncPayload {
  currentTime: number;
  timeListened: number;
  duration: number;
}

export const syncSession = (sessionId: string, body: SyncPayload) => request<void>(`/api/session/${sessionId}/sync`, { method: 'POST', body });

export const closeSession = (sessionId: string, body?: SyncPayload) => request<void>(`/api/session/${sessionId}/close`, { method: 'POST', body });

/**
 * A session listened to without the server (offline, or after the server dropped ours). The server files it
 * like any other session and only moves progress forward if this one is newer than what it already has.
 */
export interface LocalSession {
  id: string;
  userId?: string;
  libraryId: string;
  libraryItemId: string;
  episodeId: string | null;
  mediaType: 'book' | 'podcast';
  mediaMetadata: unknown;
  chapters: Chapter[];
  displayTitle: string;
  displayAuthor: string;
  coverPath: string | null;
  duration: number;
  playMethod: number;
  mediaPlayer: string;
  deviceInfo: ReturnType<typeof deviceInfo>;
  date: string;
  dayOfWeek: string;
  timeListening: number;
  startTime: number;
  currentTime: number;
  startedAt: number;
  updatedAt: number;
}

export const syncLocalSession = (s: LocalSession) => request<void>('/api/session/local', { method: 'POST', body: s });
