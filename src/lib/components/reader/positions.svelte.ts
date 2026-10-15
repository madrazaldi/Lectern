import { untrack } from 'svelte';
import * as abs from '$lib/api/abs';
import { clockSkew, isAuthLost, isUnreachable, scopedKey } from '$lib/api/client';
import type { MediaProgress } from '$lib/api/types';
import { session } from '$lib/stores/session.svelte';
import { overtaken, PositionSync, startPosition, type Position } from './sync';

const PENDING_KEY = 'lectern.reader.pending';
const LOCAL_KEY = 'lectern.reader.local';

/** Reading positions in the signed-in account's primary ebooks, synced to its progress on the server. */
export const positions = new PositionSync({
  send: (itemId, pos) => abs.updateEbookProgress(itemId, pos.location, pos.progress),
  retryable: (err) => isUnreachable(err) || isAuthLost(err),
  storage: localStorage,
  key: () => scopedKey(PENDING_KEY)
});

/** Send positions saved offline or left over from the last run, unless read on elsewhere since. */
export const flushPositions = () => positions.flushPending((itemId, entry) => overtaken(entry, session.progressFor(itemId), clockSkew()));

// On launch (once progress from other devices has been read), and after a reconnect once it has been re-read.
$effect.root(() => {
  const ready = $derived(session.status === 'ready');
  $effect(() => {
    if (ready) untrack(() => void flushPositions());
  });
});
session.onReconnect(flushPositions);

/** Where to open an item's primary ebook, given the server's progress for it. A waiting position the server has overtaken is dropped. */
export function openingPosition(itemId: string, server: MediaProgress | null | undefined): Position | null {
  positions.seen(itemId, server?.ebookLocation ?? null);
  const pending = positions.pending(itemId);
  if (pending && overtaken(pending, server, clockSkew())) positions.discard(itemId);
  return startPosition(server, positions.pending(itemId), clockSkew());
}

/** Show the position on the title's page right away, and queue it for the server. */
export function savePosition(itemId: string, pos: Position) {
  session.patchProgress(itemId, null, { ebookLocation: pos.location, ebookProgress: pos.progress });
  positions.update(itemId, pos);
}

/**
 * Supplementary ebooks (the other files in a title's folder) have no place on the server's progress record, so
 * their position is only remembered on this device.
 */
export const localPositions = {
  read(): Record<string, Position> {
    try {
      return JSON.parse(localStorage.getItem(scopedKey(LOCAL_KEY)) ?? '{}') ?? {};
    } catch {
      return {};
    }
  },
  get(key: string): Position | null {
    return this.read()[key] ?? null;
  },
  set(key: string, pos: Position) {
    try {
      localStorage.setItem(scopedKey(LOCAL_KEY), JSON.stringify({ ...this.read(), [key]: pos }));
    } catch {
      // Quota: this is a convenience.
    }
  }
};
