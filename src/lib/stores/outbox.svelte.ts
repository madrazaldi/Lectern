import * as abs from '$lib/api/abs';
import { ApiError, clockSkew, isAuthLost, isUnreachable, scopedKey } from '$lib/api/client';

/**
 * Progress that hasn't reached the server yet, kept on disk so it survives being offline, a crash or a force-quit.
 *
 * - `progress` entries are written ahead while a server session plays and cleared once a sync confirms them;
 *   anything left over (the app died between syncs) is replayed on the next launch, unless the server has
 *   heard something newer from another device in the meantime. Written-ahead entries name their server session
 *   and the listening time it hasn't been told about, so the replay can close that session and credit the time.
 * - `session` entries are whole listening sessions played without the server. Re-sending one replaces the
 *   server's copy, so they carry cumulative totals and can be put again as listening continues.
 *
 * `updatedAt` is our clock; comparisons with the server's timestamps correct for the skew between the two.
 */
export type OutboxEntry =
  | {
      kind: 'progress';
      itemId: string;
      episodeId: string | null;
      currentTime: number;
      duration: number;
      isFinished?: boolean;
      sessionId?: string;
      timeListened?: number;
      updatedAt: number;
    }
  | { kind: 'session'; session: abs.LocalSession };

type ProgressEntry = Extract<OutboxEntry, { kind: 'progress' }>;

const KEY = 'lectern.outbox';
const RETRY_MS = 30_000;

export function progressKey(itemId: string, episodeId: string | null) {
  return `progress:${episodeId ? `${itemId}:${episodeId}` : itemId}`;
}

class Outbox {
  entries = $state<Record<string, OutboxEntry>>({});
  pending = $derived(Object.keys(this.entries).length);

  /** Entries the player is currently keeping in sync itself; flushing them too would race its own syncs. */
  busy: (key: string) => boolean = () => false;
  /** Called before each flush, so listening still being recorded (an offline session) goes out with it. */
  prepare: () => void = () => {};

  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Read the signed-in account's entries. Call again after the account changes. */
  load() {
    try {
      this.entries = JSON.parse(localStorage.getItem(scopedKey(KEY)) ?? '{}');
    } catch {
      this.entries = {};
    }
    this.timer ??= setInterval(() => this.pending && void this.flush(), RETRY_MS);
  }

  private save() {
    localStorage.setItem(scopedKey(KEY), JSON.stringify(this.entries));
  }

  putProgress(entry: Omit<ProgressEntry, 'kind'>) {
    const key = progressKey(entry.itemId, entry.episodeId);
    const prev = this.entries[key];
    // An explicit finished/unfinished mark that hasn't gone out yet outlives later position writes.
    const isFinished = entry.isFinished ?? (prev?.kind === 'progress' ? prev.isFinished : undefined);
    this.entries[key] = { kind: 'progress', ...entry, ...(isFinished !== undefined ? { isFinished } : {}) };
    this.save();
  }

  putSession(session: abs.LocalSession) {
    this.entries[`session:${session.id}`] = { kind: 'session', session: { ...session } };
    this.save();
  }

  /** Drop an entry once the server has it, unless it was rewritten after `confirmedAt`. */
  confirm(key: string, confirmedAt = Infinity) {
    const e = this.entries[key];
    if (!e) return;
    const updatedAt = e.kind === 'progress' ? e.updatedAt : e.session.updatedAt;
    if (updatedAt > confirmedAt) return;
    delete this.entries[key];
    this.save();
  }

  /** The newest position waiting to go out for an item, if any, in our clock. */
  pendingFor(itemId: string, episodeId: string | null): { currentTime: number; duration: number; isFinished?: boolean; updatedAt: number } | null {
    let best: { currentTime: number; duration: number; isFinished?: boolean; updatedAt: number } | null = null;
    for (const e of Object.values(this.entries)) {
      const p =
        e.kind === 'progress'
          ? e.itemId === itemId && e.episodeId === episodeId
            ? e
            : null
          : e.session.libraryItemId === itemId && (e.session.episodeId ?? null) === episodeId
            ? e.session
            : null;
      if (p && (!best || p.updatedAt > best.updatedAt)) best = p;
    }
    return best;
  }

  /** Send everything that's waiting. Stops at the first sign the server is unreachable. */
  flush(): Promise<void> {
    this.flushing ??= this.run().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async run() {
    try {
      this.prepare();
    } catch (err) {
      console.error(err);
    }
    // Sessions first: they carry listening time as well as position.
    const keys = Object.keys(this.entries).sort((a, b) => Number(b.startsWith('session:')) - Number(a.startsWith('session:')));
    for (const key of keys) {
      const e = this.entries[key];
      if (!e || this.busy(key)) continue;
      const snapshot = $state.snapshot(e) as OutboxEntry;
      try {
        await send(snapshot);
        this.confirm(key, snapshot.kind === 'progress' ? snapshot.updatedAt : snapshot.session.updatedAt);
      } catch (err) {
        if (isUnreachable(err) || isAuthLost(err) || (err instanceof ApiError && (err.status === 429 || err.status >= 500))) return;
        // The server rejected it outright (item deleted, malformed): retrying won't help.
        console.warn('Dropping unsendable progress', key, err);
        this.confirm(key);
      }
    }
  }
}

async function send(e: OutboxEntry) {
  const skew = clockSkew();
  if (e.kind === 'session') {
    const s = e.session;
    // The server only moves progress on if the session is newer than what it has, by its own clock.
    return abs.syncLocalSession({ ...s, startedAt: s.startedAt + skew, updatedAt: s.updatedAt + skew });
  }
  const server = await abs.getProgress(e.itemId, e.episodeId);
  // Another device moved on since: its position wins.
  const newer = !!server && server.lastUpdate > e.updatedAt + skew;
  if (e.sessionId && e.isFinished === undefined) {
    // The session is still open on the server unless it restarted since: closing it credits the listening time
    // too. If another device moved on, close it at their position so ours doesn't win.
    const closed = await abs
      .closeSession(e.sessionId, {
        currentTime: newer && server ? server.currentTime : e.currentTime,
        timeListened: Math.max(0, Math.round(e.timeListened ?? 0)),
        duration: e.duration
      })
      .then(
        () => true,
        (err) => {
          if (err instanceof ApiError && err.status === 404) return false;
          throw err;
        }
      );
    if (closed) return;
  }
  if (newer) return;
  if (e.isFinished !== undefined) {
    // Sent alone, like marking it from the item page: with a position the server may decide it's unfinished again.
    return abs.updateProgress(e.itemId, e.isFinished ? { isFinished: true } : { isFinished: false, progress: 0, currentTime: 0 }, e.episodeId);
  }
  await abs.updateProgress(
    e.itemId,
    {
      currentTime: e.currentTime,
      duration: e.duration,
      progress: e.duration ? Math.min(1, e.currentTime / e.duration) : 0
    },
    e.episodeId
  );
}

export const outbox = new Outbox();
