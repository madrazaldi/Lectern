/** A place in an ebook: an EPUB CFI (or a PDF page number) and how far through the book it is (0–1). */
export interface Position {
  location: string;
  progress: number;
}

export interface PendingPosition extends Position {
  /** Our clock, when the reader got there. */
  updatedAt: number;
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

  /** The reader moved: keep the position and send it once reading pauses. */
  update(itemId: string, pos: Position) {
    this.write({ ...this.read(), [itemId]: { location: pos.location, progress: pos.progress, updatedAt: this.now() } });
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
    try {
      await this.opts.send(itemId, { location: entry.location, progress: entry.progress });
    } catch (err) {
      if (this.opts.retryable(err)) return false;
      // The server refused it (the item is gone, say): retrying won't help.
      console.error('Could not save the reading position', err);
    }
    // Keep a position written while this one was on its way.
    const all = this.read();
    if (all[itemId]?.updatedAt === entry.updatedAt) {
      delete all[itemId];
      this.write(all);
    }
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
 * Where to open: the position waiting to be sent if it's newer than the server's, else the server's.
 * `skew` is the server's clock minus ours.
 */
export function startPosition(
  server: { ebookLocation?: string | null; ebookProgress?: number | null; lastUpdate: number } | undefined | null,
  pending: PendingPosition | null,
  skew = 0
): Position | null {
  if (pending && (!server?.ebookLocation || pending.updatedAt + skew > server.lastUpdate)) return { location: pending.location, progress: pending.progress };
  if (server?.ebookLocation) return { location: server.ebookLocation, progress: server.ebookProgress ?? 0 };
  return null;
}
