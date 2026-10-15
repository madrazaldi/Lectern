import * as abs from '$lib/api/abs';
import { ApiError, scopedKey } from '$lib/api/client';

/**
 * Progress that hasn't reached the server yet, kept on disk so it survives being offline, a crash or a force-quit.
 *
 * - `progress` entries are written ahead while a server session plays and cleared once a sync confirms them;
 *   anything left over (the app died between syncs) is replayed on the next launch, unless the server has
 *   heard something newer from another device in the meantime.
 * - `session` entries are whole listening sessions played without the server. Re-sending one replaces the
 *   server's copy, so they carry cumulative totals and can be put again as listening continues.
 */
export type OutboxEntry =
  | {
      kind: 'progress';
      itemId: string;
      episodeId: string | null;
      currentTime: number;
      duration: number;
      isFinished?: boolean;
      updatedAt: number;
    }
  | { kind: 'session'; session: abs.LocalSession };

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

  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

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

  putProgress(entry: Omit<Extract<OutboxEntry, { kind: 'progress' }>, 'kind'>) {
    this.entries[progressKey(entry.itemId, entry.episodeId)] = { kind: 'progress', ...entry };
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

  /** Send everything that's waiting. Stops at the first sign the server is unreachable. */
  flush(): Promise<void> {
    this.flushing ??= this.run().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async run() {
    // Sessions first: they carry listening time as well as position.
    const keys = Object.keys(this.entries).sort((a, b) => Number(b.startsWith('session:')) - Number(a.startsWith('session:')));
    for (const key of keys) {
      const e = this.entries[key];
      if (!e || this.busy(key)) continue;
      try {
        await send(e);
        this.confirm(key, e.kind === 'progress' ? e.updatedAt : e.session.updatedAt);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 0 || err.status === 401 || err.status >= 500)) return;
        // The server rejected it outright (item deleted, malformed): retrying won't help.
        console.warn('Dropping unsendable progress', key, err);
        this.confirm(key);
      }
    }
  }
}

async function send(e: OutboxEntry) {
  if (e.kind === 'session') return abs.syncLocalSession(e.session);
  const server = await abs.getProgress(e.itemId, e.episodeId);
  // Another device moved on since: its position wins.
  if (server && server.lastUpdate > e.updatedAt) return;
  await abs.updateProgress(
    e.itemId,
    {
      currentTime: e.currentTime,
      duration: e.duration,
      progress: e.duration ? Math.min(1, e.currentTime / e.duration) : 0,
      ...(e.isFinished !== undefined ? { isFinished: e.isFinished } : {})
    },
    e.episodeId
  );
}

export const outbox = new Outbox();
