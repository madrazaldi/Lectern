import * as abs from '$lib/api/abs';
import { ApiError, getCredentials, logout, onReachabilityChange, onSessionExpired, scopedKey } from '$lib/api/client';
import type { Bookmark, Library, MediaProgress, User } from '$lib/api/types';
import { outbox } from './outbox.svelte';

const LIB_KEY = 'lectern.library';
const CACHE_KEY = 'lectern.cache';
const RETRY_MS = 20_000;

interface Cached {
  user: User;
  libraries: Library[];
}

class Session {
  status = $state<'signed-out' | 'loading' | 'ready'>('loading');
  /** The login screen is open to add another account on top of a signed-in one. */
  addingAccount = $state(false);
  /** Whether the last request reached the server. False means we're running from cache and downloads. */
  online = $state(true);
  user = $state<User | null>(null);
  libraries = $state<Library[]>([]);
  libraryId = $state<string | null>(null);
  /** Keyed by `itemId` or `itemId:episodeId`. */
  progress = $state<Record<string, MediaProgress>>({});
  bookmarks = $state<Bookmark[]>([]);
  error = $state<string | null>(null);

  library = $derived(this.libraries.find((l) => l.id === this.libraryId) ?? this.libraries[0] ?? null);
  canDownload = $derived(this.user?.permissions?.download !== false);

  /** Called when the server reports progress that may have come from another device. */
  onRemoteProgress: ((p: MediaProgress, from?: string) => void) | null = null;
  /** Called when the connection comes back after being offline. */
  onReconnect: (() => void) | null = null;

  private retry: ReturnType<typeof setInterval> | null = null;

  constructor() {
    onSessionExpired(() => void this.signOut());
    onReachabilityChange((online) => this.setOnline(online));
    window.addEventListener('online', () => void this.refreshUser(true));
  }

  async load() {
    if (!getCredentials()) {
      this.status = 'signed-out';
      return;
    }
    this.libraryId = localStorage.getItem(scopedKey(LIB_KEY));
    outbox.load();
    this.status = this.user ? 'ready' : 'loading';
    this.error = null;
    try {
      const [user, libraries] = await Promise.all([abs.getMe(), abs.getLibraries()]);
      this.applyUser(user);
      this.libraries = libraries;
      if (!libraries.some((l) => l.id === this.libraryId)) this.selectLibrary(libraries[0]?.id ?? null);
      this.status = 'ready';
      this.saveCache(user, libraries);
      void outbox.flush();
    } catch (err) {
      if (!getCredentials()) return;
      const cached = err instanceof ApiError && err.status === 0 ? this.readCache() : null;
      if (cached) {
        // Start offline from the last good copy so downloads stay playable.
        this.applyUser(cached.user);
        this.libraries = cached.libraries;
        this.status = 'ready';
        this.setOnline(false);
      } else {
        this.error = (err as Error).message;
      }
    }
  }

  private setOnline(online: boolean) {
    if (online === this.online) return;
    this.online = online;
    if (online) {
      if (this.retry) clearInterval(this.retry);
      this.retry = null;
      void outbox.flush();
      void this.refreshUser();
      this.onReconnect?.();
    } else {
      this.retry ??= setInterval(() => void this.refreshUser(true), RETRY_MS);
    }
  }

  private saveCache(user: User, libraries: Library[]) {
    try {
      const { accessToken: _a, refreshToken: _r, token: _t, ...safe } = user;
      localStorage.setItem(scopedKey(CACHE_KEY), JSON.stringify({ user: safe, libraries } satisfies Cached));
    } catch {
      // Quota: the cache is a convenience.
    }
  }

  private readCache(): Cached | null {
    try {
      return JSON.parse(localStorage.getItem(scopedKey(CACHE_KEY)) ?? 'null');
    } catch {
      return null;
    }
  }

  /** Re-read progress and bookmarks, e.g. after the window regains focus. `probe` also runs while offline. */
  async refreshUser(probe = false) {
    if (this.status !== 'ready' || (!this.online && !probe)) return;
    try {
      const user = await abs.getMe();
      this.applyUser(user, true);
      if (this.libraries.length) this.saveCache(user, this.libraries);
    } catch {
      // Offline or server restarting — keep what we have.
    }
  }

  private applyUser(user: User, notify = false) {
    const before = this.progress;
    this.user = user;
    const map: Record<string, MediaProgress> = {};
    for (const p of user.mediaProgress) map[keyFor(p.libraryItemId, p.episodeId)] = p;
    this.progress = map;
    this.bookmarks = user.bookmarks ?? [];
    if (notify && this.onRemoteProgress) {
      for (const [k, p] of Object.entries(map)) if (p.lastUpdate > (before[k]?.lastUpdate ?? 0)) this.onRemoteProgress(p);
    }
  }

  /** Progress pushed by the server (live socket), possibly from another device. */
  applyRemoteProgress(p: MediaProgress, from?: string) {
    const key = keyFor(p.libraryItemId, p.episodeId);
    if ((this.progress[key]?.lastUpdate ?? 0) > p.lastUpdate) return;
    this.progress[key] = p;
    this.onRemoteProgress?.(p, from);
  }

  selectLibrary(id: string | null) {
    this.libraryId = id;
    if (id) localStorage.setItem(scopedKey(LIB_KEY), id);
    else localStorage.removeItem(scopedKey(LIB_KEY));
  }

  progressFor(itemId: string, episodeId?: string | null) {
    return this.progress[keyFor(itemId, episodeId)];
  }

  /** Optimistically patch local progress so the UI keeps up with playback between server round-trips. */
  patchProgress(itemId: string, episodeId: string | null, patch: Partial<MediaProgress>) {
    const key = keyFor(itemId, episodeId);
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
    this.patchProgress(itemId, episodeId, {
      isFinished,
      progress: isFinished ? 1 : 0,
      ...(isFinished ? { finishedAt: Date.now() } : { currentTime: 0 })
    });
    try {
      await abs.updateProgress(itemId, isFinished ? { isFinished } : { isFinished, progress: 0, currentTime: 0 }, episodeId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        // Offline: keep the change and send it later.
        const p = this.progressFor(itemId, episodeId)!;
        outbox.putProgress({ itemId, episodeId, currentTime: p.currentTime, duration: p.duration, isFinished, updatedAt: Date.now() });
        return;
      }
      if (prev) this.progress[keyFor(itemId, episodeId)] = prev;
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

  /** Sign the current account out. If another account is saved, the app restarts into it. */
  async signOut() {
    const next = await logout().catch(() => getCredentials());
    if (next) {
      location.reload();
      return;
    }
    this.user = null;
    this.libraries = [];
    this.progress = {};
    this.bookmarks = [];
    this.status = 'signed-out';
  }
}

function keyFor(itemId: string, episodeId?: string | null) {
  return episodeId ? `${itemId}:${episodeId}` : itemId;
}

export const session = new Session();
