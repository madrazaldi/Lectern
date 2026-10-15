import * as abs from '$lib/api/abs';
import { getCredentials, logout, onSessionExpired } from '$lib/api/client';
import type { Bookmark, Library, MediaProgress, User } from '$lib/api/types';

const LIB_KEY = 'lectern.library';

class Session {
  status = $state<'signed-out' | 'loading' | 'ready'>(getCredentials() ? 'loading' : 'signed-out');
  user = $state<User | null>(null);
  libraries = $state<Library[]>([]);
  libraryId = $state<string | null>(localStorage.getItem(LIB_KEY));
  /** Keyed by `itemId` or `itemId:episodeId`. */
  progress = $state<Record<string, MediaProgress>>({});
  bookmarks = $state<Bookmark[]>([]);
  error = $state<string | null>(null);

  library = $derived(this.libraries.find((l) => l.id === this.libraryId) ?? this.libraries[0] ?? null);

  constructor() {
    onSessionExpired(() => this.signOut(false));
  }

  async load() {
    if (!getCredentials()) {
      this.status = 'signed-out';
      return;
    }
    this.status = this.user ? 'ready' : 'loading';
    this.error = null;
    try {
      const [user, libraries] = await Promise.all([abs.getMe(), abs.getLibraries()]);
      this.applyUser(user);
      this.libraries = libraries;
      if (!libraries.some((l) => l.id === this.libraryId)) this.selectLibrary(libraries[0]?.id ?? null);
      this.status = 'ready';
    } catch (err) {
      if (getCredentials()) this.error = (err as Error).message;
    }
  }

  /** Re-read progress and bookmarks, e.g. after the window regains focus. */
  async refreshUser() {
    if (this.status !== 'ready') return;
    try {
      this.applyUser(await abs.getMe());
    } catch {
      // Offline or server restarting — keep what we have.
    }
  }

  private applyUser(user: User) {
    this.user = user;
    const map: Record<string, MediaProgress> = {};
    for (const p of user.mediaProgress) map[p.episodeId ? `${p.libraryItemId}:${p.episodeId}` : p.libraryItemId] = p;
    this.progress = map;
    this.bookmarks = user.bookmarks ?? [];
  }

  selectLibrary(id: string | null) {
    this.libraryId = id;
    if (id) localStorage.setItem(LIB_KEY, id);
    else localStorage.removeItem(LIB_KEY);
  }

  progressFor(itemId: string, episodeId?: string | null) {
    return this.progress[episodeId ? `${itemId}:${episodeId}` : itemId];
  }

  /** Optimistically patch local progress so the UI keeps up with playback between server round-trips. */
  patchProgress(itemId: string, episodeId: string | null, patch: Partial<MediaProgress>) {
    const key = episodeId ? `${itemId}:${episodeId}` : itemId;
    const base: MediaProgress = this.progress[key] ?? {
      id: key,
      libraryItemId: itemId,
      episodeId,
      duration: 0,
      progress: 0,
      currentTime: 0,
      isFinished: false,
      hideFromContinueListening: false,
      startedAt: Date.now(),
      finishedAt: null,
      lastUpdate: Date.now()
    };
    this.progress[key] = { ...base, ...patch, lastUpdate: Date.now() };
  }

  async setFinished(itemId: string, episodeId: string | null, isFinished: boolean) {
    const prev = this.progressFor(itemId, episodeId);
    this.patchProgress(itemId, episodeId, { isFinished, progress: isFinished ? 1 : 0, ...(isFinished ? {} : { currentTime: 0 }) });
    try {
      await abs.updateProgress(itemId, isFinished ? { isFinished } : { isFinished, progress: 0, currentTime: 0 }, episodeId);
    } catch (err) {
      if (prev) this.progress[episodeId ? `${itemId}:${episodeId}` : itemId] = prev;
      throw err;
    }
  }

  bookmarksFor(itemId: string) {
    return this.bookmarks.filter((b) => b.libraryItemId === itemId).sort((a, b) => a.time - b.time);
  }

  async addBookmark(itemId: string, time: number, title: string) {
    const b = await abs.createBookmark(itemId, Math.floor(time), title);
    this.bookmarks = [...this.bookmarks.filter((x) => !(x.libraryItemId === itemId && x.time === b.time)), b];
    return b;
  }

  async renameBookmark(itemId: string, time: number, title: string) {
    const b = await abs.updateBookmark(itemId, time, title);
    this.bookmarks = this.bookmarks.map((x) => (x.libraryItemId === itemId && x.time === time ? b : x));
  }

  async removeBookmark(itemId: string, time: number) {
    await abs.deleteBookmark(itemId, time);
    this.bookmarks = this.bookmarks.filter((x) => !(x.libraryItemId === itemId && x.time === time));
  }

  async signOut(callServer = true) {
    if (callServer) await logout();
    else await logout().catch(() => {});
    this.user = null;
    this.libraries = [];
    this.progress = {};
    this.bookmarks = [];
    this.status = 'signed-out';
  }
}

export const session = new Session();
