import * as abs from '$lib/api/abs';
import {
  clockSkew,
  getCredentials,
  isAuthLost,
  isUnreachable,
  logout,
  needsReauth,
  onAccountChanged,
  onAuthLost,
  onReachabilityChange,
  ping,
  reauthenticate,
  scopedKey,
  serverNow
} from '$lib/api/client';
import type { Bookmark, Library, MediaProgress, User } from '$lib/api/types';
import { outbox } from './outbox.svelte';

const LIB_KEY = 'lectern.library';
const CACHE_KEY = 'lectern.cache';
const RETRY_MS = 20_000;
/** Re-reading the user on window focus is a convenience; live updates cover the rest. */
const FOCUS_REFRESH_MS = 60_000;

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
  /** The server stopped accepting this account's sign-in. Everything stays as it is until the user signs in again. */
  needsReauth = $state(false);
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

  private reconnectListeners = new Set<() => unknown>();
  private retry: ReturnType<typeof setInterval> | null = null;
  private reconnecting: Promise<void> | null = null;
  private refreshing: Promise<void> | null = null;
  private lastRefresh = 0;

  constructor() {
    onAuthLost((id) => {
      if (getCredentials()?.id === id) this.needsReauth = true;
    });
    onReachabilityChange((online) => this.setOnline(online));
    onAccountChanged(() => {
      // Per-account state from here on belongs to the new account (or nobody).
      this.needsReauth = needsReauth();
      this.lastRefresh = 0;
      this.stopProbing();
      this.online = true;
      outbox.load();
    });
    window.addEventListener('online', () => void this.probe());
  }

  /** Called (and awaited) after the connection comes back, once waiting progress has gone out and the user is re-read. */
  onReconnect(fn: () => unknown) {
    this.reconnectListeners.add(fn);
    return () => void this.reconnectListeners.delete(fn);
  }

  async load() {
    if (!getCredentials()) {
      this.status = 'signed-out';
      return;
    }
    this.libraryId = localStorage.getItem(scopedKey(LIB_KEY));
    this.needsReauth = needsReauth();
    outbox.load();
    this.status = this.user ? 'ready' : 'loading';
    this.error = null;
    try {
      const [user, libraries] = await Promise.all([abs.getMe(), abs.getLibraries()]);
      this.applyUser(user);
      this.lastRefresh = Date.now();
      this.libraries = libraries;
      if (!libraries.some((l) => l.id === this.libraryId)) this.selectLibrary(libraries[0]?.id ?? null);
      this.status = 'ready';
      this.saveCache(user, libraries);
      void outbox.flush();
    } catch (err) {
      if (!getCredentials()) return;
      // Start from the last good copy so downloads stay playable: offline, or signed out by the server (the banner asks to sign in again).
      const cached = isUnreachable(err) || isAuthLost(err) ? this.readCache() : null;
      if (cached) {
        this.applyUser(cached.user);
        this.libraries = cached.libraries;
        this.status = 'ready';
        if (isUnreachable(err)) this.setOnline(false);
      } else {
        this.error = (err as Error).message;
      }
    }
  }

  private setOnline(online: boolean) {
    if (online === this.online) return;
    this.online = online;
    if (online) {
      this.stopProbing();
      void this.reconnect();
    } else {
      this.retry ??= setInterval(() => void this.probe(), RETRY_MS);
    }
  }

  private stopProbing() {
    if (this.retry) clearInterval(this.retry);
    this.retry = null;
  }

  /** While offline: is the server back? An unauthenticated ping rather than a full /api/me. */
  private async probe() {
    if (this.online || !getCredentials()) return;
    if (await ping()) this.setOnline(true);
  }

  /**
   * Back online. Send what waited first, so the fresh copy of the user already includes it (rather than the
   * server's older progress overwriting what was listened to offline); then let the player and live feed catch up.
   */
  private reconnect() {
    this.reconnecting ??= (async () => {
      await outbox.flush().catch(() => {});
      await this.refreshUser(0);
      await Promise.allSettled([...this.reconnectListeners].map(async (fn) => fn()));
    })().finally(() => (this.reconnecting = null));
    return this.reconnecting;
  }

  /** Sign the current account in again after the server stopped accepting it. */
  async reauthenticate(secret: string) {
    const account = getCredentials();
    if (!account) return;
    await reauthenticate(account.id, secret);
    this.needsReauth = false;
    this.error = null;
    if (this.status !== 'ready') return this.load();
    this.online = true;
    this.stopProbing();
    await this.reconnect();
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

  /**
   * Re-read progress and bookmarks, unless that was done within `maxAgeMs` (window focus uses the default; pass 0
   * to force). Does nothing while offline: the probe brings us back.
   */
  refreshUser(maxAgeMs = FOCUS_REFRESH_MS): Promise<void> {
    if (this.status !== 'ready' || !this.online) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    if (Date.now() - this.lastRefresh < maxAgeMs) return Promise.resolve();
    this.refreshing = (async () => {
      try {
        const user = await abs.getMe();
        this.lastRefresh = Date.now();
        this.applyUser(user, true);
        if (this.libraries.length) this.saveCache(user, this.libraries);
      } catch {
        // Offline or server restarting — keep what we have.
      }
    })().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private applyUser(user: User, notify = false) {
    const before = this.progress;
    this.user = user;
    const map: Record<string, MediaProgress> = {};
    for (const p of user.mediaProgress) map[keyFor(p.libraryItemId, p.episodeId)] = withPending(p);
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
    const now = serverNow();
    const base: MediaProgress = this.progress[key] ?? {
      id: key,
      libraryItemId: itemId,
      episodeId,
      duration: 0,
      progress: 0,
      currentTime: 0,
      isFinished: false,
      hideFromContinueListening: false,
      startedAt: now,
      finishedAt: null,
      lastUpdate: now
    };
    this.progress[key] = { ...base, ...patch, lastUpdate: now };
  }

  async setFinished(itemId: string, episodeId: string | null, isFinished: boolean) {
    const prev = this.progressFor(itemId, episodeId);
    this.patchProgress(itemId, episodeId, {
      isFinished,
      progress: isFinished ? 1 : 0,
      ...(isFinished ? { finishedAt: serverNow() } : { currentTime: 0 })
    });
    try {
      await abs.updateProgress(itemId, isFinished ? { isFinished } : { isFinished, progress: 0, currentTime: 0 }, episodeId);
    } catch (err) {
      if (isUnreachable(err) || isAuthLost(err)) {
        // Offline (or waiting to sign in again): keep the change and send it later.
        const p = this.progressFor(itemId, episodeId)!;
        outbox.putProgress({ itemId, episodeId, currentTime: p.currentTime, duration: p.duration, isFinished, updatedAt: Date.now() });
        return;
      }
      if (prev) this.progress[keyFor(itemId, episodeId)] = prev;
      throw err;
    }
  }

  /** Drop a title's progress locally, after the server deleted it (Reset progress). */
  forgetProgress(itemId: string, episodeId: string | null = null) {
    delete this.progress[keyFor(itemId, episodeId)];
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

  /**
   * Sign the current account out. The player stops and saves under it first (see `beforeAccountChange`). If
   * another account is saved, the app restarts into it.
   */
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
    this.needsReauth = false;
    this.status = 'signed-out';
  }
}

/** Overlay progress that's still waiting in the outbox (listened offline) on the server's older copy. */
function withPending(p: MediaProgress): MediaProgress {
  const pending = outbox.pendingFor(p.libraryItemId, p.episodeId ?? null);
  if (!pending) return p;
  const lastUpdate = pending.updatedAt + clockSkew();
  if (lastUpdate <= p.lastUpdate) return p;
  const duration = pending.duration || p.duration;
  const isFinished = pending.isFinished ?? p.isFinished;
  return {
    ...p,
    currentTime: pending.currentTime,
    duration,
    progress: isFinished ? 1 : duration ? Math.min(1, pending.currentTime / duration) : p.progress,
    isFinished,
    lastUpdate
  };
}

function keyFor(itemId: string, episodeId?: string | null) {
  return episodeId ? `${itemId}:${episodeId}` : itemId;
}

export const session = new Session();
