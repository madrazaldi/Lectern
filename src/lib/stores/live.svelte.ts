import { io, type Socket } from 'socket.io-client';
import { ensureFreshToken, getCredentials, needsReauth, onAccountChanged, onTokenChange, token } from '$lib/api/client';
import type { LibraryItem, MediaProgress } from '$lib/api/types';
import { player } from './player.svelte';
import { session } from './session.svelte';

export type ItemChange = 'added' | 'updated' | 'removed';

interface ProgressEvent {
  id: string;
  sessionId?: string | null;
  deviceDescription?: string;
  data: MediaProgress;
}

/** After the server refuses our token twice, wait this long (or for a new token) before connecting again. */
const AUTH_RETRY_MS = 60_000;
/** Catching up after a reconnect re-reads the user unless that just happened (e.g. the app itself reconnecting). */
const CATCH_UP_MS = 5_000;

/**
 * Audiobookshelf's socket.io feed: progress from other devices and library changes arrive as they happen,
 * instead of on the next window focus.
 */
class Live {
  connected = $state(false);

  private socket: Socket | null = null;
  /** connect() was asked for and disconnect() wasn't: reconnect on our own after giving up on auth. */
  private wanted = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private itemListeners = new Set<(change: ItemChange, item: LibraryItem) => void>();

  constructor() {
    // A different user: the socket is authenticated as the old one.
    onAccountChanged(() => this.disconnect());
    // A refreshed token or signing in again: if we'd given up on auth, try with the new one now.
    onTokenChange(() => {
      if (this.wanted && !this.socket) this.connect();
    });
    session.onReconnect(() => {
      if (!this.wanted) return;
      if (!this.socket) this.connect();
      else if (!this.socket.connected) this.socket.connect();
    });
  }

  connect() {
    const creds = getCredentials();
    if (!creds || this.socket) return;
    this.wanted = true;
    this.clearRetry();
    // No point offering a token the server has already turned down; signing in again brings us back (onTokenChange).
    if (needsReauth()) return;
    const url = new URL(creds.serverUrl);
    const base = url.pathname.replace(/\/+$/, '');
    // Websocket only: socket.io's long-polling fallback is plain XHR, which the server's CORS handling blocks.
    const s = io(url.origin, { path: `${base}/socket.io`, transports: ['websocket'], reconnectionDelayMax: 30_000 });
    this.socket = s;
    let refused = 0;
    let initialized = false;

    s.on('connect', () => s.emit('auth', token()));
    s.on('init', () => {
      this.connected = true;
      refused = 0;
      // Back after a drop (network, server restart): anything sent meanwhile was missed, so re-read progress.
      if (initialized) void session.refreshUser(CATCH_UP_MS);
      initialized = true;
    });
    s.on('auth_failed', async () => {
      if (this.socket !== s) return;
      refused++;
      if (refused === 1) {
        await ensureFreshToken(true);
        if (this.socket === s) s.emit('auth', token());
        return;
      }
      // Still refused: stop for now. A new token, or a while, brings us back.
      this.teardown();
      this.retry = setTimeout(() => {
        this.retry = null;
        if (this.wanted) this.connect();
      }, AUTH_RETRY_MS);
    });
    s.on('disconnect', () => (this.connected = false));

    s.on('user_item_progress_updated', (e: ProgressEvent) => {
      // Our own syncs echo back with our session id.
      if (e.sessionId && e.sessionId === player.session?.id) return;
      session.applyRemoteProgress(e.data, e.deviceDescription || undefined);
    });
    s.on('user_updated', () => void session.refreshUser(0));

    const relay = (change: ItemChange) => (item: LibraryItem) => {
      for (const fn of this.itemListeners) fn(change, item);
    };
    s.on('item_added', relay('added'));
    s.on('item_updated', relay('updated'));
    s.on('item_removed', relay('removed'));
    s.on('items_added', (items: LibraryItem[]) => items.forEach(relay('added')));
    s.on('items_updated', (items: LibraryItem[]) => items.forEach(relay('updated')));
  }

  disconnect() {
    this.wanted = false;
    this.clearRetry();
    this.teardown();
  }

  private teardown() {
    const s = this.socket;
    this.socket = null;
    this.connected = false;
    if (!s) return;
    s.removeAllListeners();
    s.disconnect();
  }

  private clearRetry() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  /** Subscribe to library item changes. Returns an unsubscribe function (usable as an $effect teardown). */
  onItemChange(fn: (change: ItemChange, item: LibraryItem) => void) {
    this.itemListeners.add(fn);
    return () => void this.itemListeners.delete(fn);
  }
}

export const live = new Live();
