import { io, type Socket } from 'socket.io-client';
import { ensureFreshToken, getCredentials, token } from '$lib/api/client';
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

/**
 * Audiobookshelf's socket.io feed: progress from other devices and library changes arrive as they happen,
 * instead of on the next window focus.
 */
class Live {
  connected = $state(false);

  private socket: Socket | null = null;
  private itemListeners = new Set<(change: ItemChange, item: LibraryItem) => void>();

  connect() {
    const creds = getCredentials();
    if (!creds || this.socket) return;
    const url = new URL(creds.serverUrl);
    const base = url.pathname.replace(/\/+$/, '');
    // Websocket only: socket.io's long-polling fallback is plain XHR, which the server's CORS handling blocks.
    const s = io(url.origin, { path: `${base}/socket.io`, transports: ['websocket'], reconnectionDelayMax: 30_000 });
    this.socket = s;
    let retriedAuth = false;

    s.on('connect', () => s.emit('auth', token()));
    s.on('init', () => {
      this.connected = true;
      retriedAuth = false;
    });
    s.on('auth_failed', async () => {
      if (retriedAuth) return s.disconnect();
      retriedAuth = true;
      await ensureFreshToken();
      s.emit('auth', token());
    });
    s.on('disconnect', () => (this.connected = false));

    s.on('user_item_progress_updated', (e: ProgressEvent) => {
      // Our own syncs echo back with our session id.
      if (e.sessionId && e.sessionId === player.session?.id) return;
      session.applyRemoteProgress(e.data, e.deviceDescription || undefined);
    });
    s.on('user_updated', () => void session.refreshUser());

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
    this.socket?.disconnect();
    this.socket = null;
    this.connected = false;
  }

  /** Subscribe to library item changes. Returns an unsubscribe function (usable as an $effect teardown). */
  onItemChange(fn: (change: ItemChange, item: LibraryItem) => void) {
    this.itemListeners.add(fn);
    return () => void this.itemListeners.delete(fn);
  }
}

export const live = new Live();
