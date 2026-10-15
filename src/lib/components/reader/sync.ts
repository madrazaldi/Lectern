/** A place in an ebook: an EPUB CFI (or a PDF page number) and how far through the book it is (0–1). */
export interface Position {
  location: string;
  progress: number;
}

export interface PendingPosition extends Position {
  /** Our clock, when the reader got there. */
  updatedAt: number;
  /**
   * The server's position this one carries on from (null: it had none). The server keeps one timestamp for audio
   * and ebook progress alike, so this, not the timestamp, tells whether someone has read on elsewhere since.
   * Missing on positions saved by older versions.
   */
  base?: string | null;
}

/** The server's ebook progress, as far as deciding between it and a waiting position goes. */
export interface ServerPosition {
  ebookLocation?: string | null;
  ebookProgress?: number | null;
  lastUpdate: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PositionSyncOptions {
  send: (itemId: string, pos: Position) => Promise<unknown>;
  /** Whether a failed send should be kept and tried again later (offline, signed out) rather than dropped. */
  retryable: (err: unknown) => boolean;
  storage: StorageLike;
  /** Where pending positions live; called on every access so it can follow the signed-in account. */
  key: () => string;
  /** Quiet time after the last page turn before the position goes to the server. */
  delay?: number;
  now?: () => number;
}

/**
 * Reading positions on their way to the server. Every page turn is written to disk at once and sent once
 * reading pauses; the disk copy is only dropped when the server has confirmed that very position. Whatever
 * is left (offline, a crash) goes out on the next `flushPending`.
 */
export class PositionSync {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The server's position for each item as last seen (opening the book, or confirming a send). */
  private bases = new Map<string, string | null>();
  private flushing: Promise<void> | null = null;
  private readonly delay: number;
  private readonly now: () => number;

  constructor(private opts: PositionSyncOptions) {
    this.delay = opts.delay ?? 2000;
    this.now = opts.now ?? Date.now;
  }

  private read(): Record<string, PendingPosition> {
    try {
      const data = JSON.parse(this.opts.storage.getItem(this.opts.key()) ?? '{}');
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  private write(all: Record<string, PendingPosition>) {
    try {
      this.opts.storage.setItem(this.opts.key(), JSON.stringify(all));
    } catch {
      // Quota: the position still goes to the server; only the offline copy is lost.
    }
  }

  /** The position waiting for the server, if any. */
  pending(itemId: string): PendingPosition | null {
    return this.read()[itemId] ?? null;
  }

  /** The server's position for an item as just read, which the next new waiting position carries on from. */
  seen(itemId: string, location: string | null) {
    this.bases.set(itemId, location);
  }

  /** The reader moved: keep the position and send it once reading pauses. */
  update(itemId: string, pos: Position) {
    const all = this.read();
    // The previous position is still unconfirmed, so the server is still where it was then.
    const base = all[itemId]?.base !== undefined ? all[itemId].base : this.bases.get(itemId);
    this.write({ ...all, [itemId]: { location: pos.location, progress: pos.progress, updatedAt: this.now(), ...(base !== undefined ? { base } : {}) } });
    clearTimeout(this.timers.get(itemId));
    this.timers.set(
      itemId,
      setTimeout(() => void this.send(itemId), this.delay)
    );
  }

  /** Send now instead of waiting (leaving the reader, the window going away). */
  flush(itemId: string) {
    if (!this.timers.has(itemId)) return Promise.resolve();
    return this.send(itemId);
  }

  /** Drop a waiting position without sending it, e.g. the server has a newer one from another device. */
  discard(itemId: string) {
    clearTimeout(this.timers.get(itemId));
    this.timers.delete(itemId);
    const all = this.read();
    if (!(itemId in all)) return;
    delete all[itemId];
    this.write(all);
  }

  /** Resolves true once the server has the position (or there was nothing to send), false if it's kept for later. */
  private async send(itemId: string): Promise<boolean> {
    clearTimeout(this.timers.get(itemId));
    this.timers.delete(itemId);
    const entry = this.pending(itemId);
    if (!entry) return true;
    let sent = true;
    try {
      await this.opts.send(itemId, { location: entry.location, progress: entry.progress });
      this.bases.set(itemId, entry.location);
    } catch (err) {
      if (this.opts.retryable(err)) return false;
      // The server refused it (the item is gone, say): retrying won't help.
      console.error('Could not save the reading position', err);
      sent = false;
    }
    const all = this.read();
    const latest = all[itemId];
    if (latest?.updatedAt === entry.updatedAt) delete all[itemId];
    // Keep a position written while this one was on its way; it now carries on from this one.
    else if (latest && sent) all[itemId] = { ...latest, base: entry.location };
    else return true;
    this.write(all);
    return true;
  }

  /**
   * Send everything still waiting (after reconnecting, or on launch). `isStale` can drop entries the server has
   * since overtaken. Stops at the first one that can't get through, since the rest won't either.
   */
  flushPending(isStale: (itemId: string, entry: PendingPosition) => boolean = () => false): Promise<void> {
    this.flushing ??= (async () => {
      for (const [itemId, entry] of Object.entries(this.read())) {
        if (this.timers.has(itemId)) continue; // being read right now: its own timer sends it
        if (isStale(itemId, entry)) {
          this.discard(itemId);
          continue;
        }
        if (!(await this.send(itemId))) break;
      }
    })().finally(() => (this.flushing = null));
    return this.flushing;
  }
}

/**
 * The server has another position than the waiting one, reached on another device since: the server's ebook
 * position moved away from the one the waiting position carries on from. (A newer timestamp alone says nothing:
 * listening bumps it too.) Positions without a base fall back to comparing timestamps; `skew` is the server's
 * clock minus ours.
 */
export function overtaken(entry: PendingPosition, server: ServerPosition | undefined | null, skew = 0) {
  const theirs = server?.ebookLocation;
  if (!theirs || theirs === entry.location) return false;
  if (entry.base !== undefined) return theirs !== entry.base;
  return server.lastUpdate > entry.updatedAt + skew;
}

/** Where to open: the position waiting to be sent unless the server has overtaken it, else the server's. */
export function startPosition(server: ServerPosition | undefined | null, pending: PendingPosition | null, skew = 0): Position | null {
  if (pending && !overtaken(pending, server, skew)) return { location: pending.location, progress: pending.progress };
  if (server?.ebookLocation) return { location: server.ebookLocation, progress: server.ebookProgress ?? 0 };
  return null;
}
