import { onAccountChanged } from '$lib/api/client';

/**
 * The last ebook downloaded, kept in memory so opening it again (back from the mini player, say) needs no second
 * download, and works offline. One book only: they can be large.
 */
let kept: { key: string; data: ArrayBuffer } | null = null;

onAccountChanged(() => (kept = null));

/** Which file of which title: the reader's cache key. */
export const bookKey = (itemId: string, ino: string) => `${itemId}:${ino}`;

export function keptBook(key: string): ArrayBuffer | null {
  return kept?.key === key ? kept.data : null;
}

export function keepBook(key: string, data: ArrayBuffer) {
  kept = { key, data };
}

/** Can this file be opened now: with the server, or from the kept copy without it? */
export function openable(online: boolean, itemId: string, ino: string | null | undefined) {
  return online || (!!ino && kept?.key === bookKey(itemId, ino));
}
