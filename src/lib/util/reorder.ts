/** Reordering a list the server keeps (playlists, collections): local moves first, saves in the background. */

/** A copy of `list` with the entry at `from` moved to `to` (clamped). */
export function move<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, it);
  return out;
}

/** Same entries in the same order, compared by key. */
export function sameOrder<T>(a: readonly T[], b: readonly T[], key: (t: T) => string) {
  return a.length === b.length && a.every((x, i) => key(x) === key(b[i]));
}

export interface OrderSyncOptions<T, R> {
  /** Send an order to the server. */
  save: (order: T) => Promise<R>;
  /** Show an order: the new one at once, or the last saved one after a failure. */
  apply: (order: T) => void;
  /** The server's answer, once nothing newer is waiting to go out. */
  saved?: (result: R) => void;
  failed?: (err: unknown) => void;
}

/**
 * Optimistic reordering. Each change shows immediately; saves go out one at a time, and moves made while one
 * is in flight are coalesced into a single save of the latest order. If a save fails, the list goes back to
 * the last order the server accepted and anything still waiting is dropped.
 */
export class OrderSync<T, R = unknown> {
  #opts: OrderSyncOptions<T, R>;
  #confirmed: T | undefined;
  #queued: { order: T } | null = null;
  #running: Promise<void> | null = null;

  constructor(opts: OrderSyncOptions<T, R>) {
    this.#opts = opts;
  }

  /** A save is in flight or waiting. */
  get busy() {
    return this.#running !== null;
  }

  /** Show `next` and save it. `prev` is what was showing, the order to return to if nothing has been saved since. */
  change(prev: T, next: T) {
    if (!this.#running) this.#confirmed = prev;
    this.#queued = { order: next };
    this.#opts.apply(next);
    this.#running ??= this.#run();
    return this.#running;
  }

  /** Resolves once every save has settled. */
  settled() {
    return this.#running ?? Promise.resolve();
  }

  async #run() {
    try {
      while (this.#queued) {
        const { order } = this.#queued;
        this.#queued = null;
        try {
          // Always asynchronous, so `#running` is set before this can finish.
          const result = await Promise.resolve().then(() => this.#opts.save(order));
          this.#confirmed = order;
          if (!this.#queued) this.#opts.saved?.(result);
        } catch (err) {
          this.#queued = null;
          this.#opts.apply(this.#confirmed as T);
          this.#opts.failed?.(err);
        }
      }
    } finally {
      // In the same step as the loop's last check, so a change can't slip in between and be left unsent.
      this.#running = null;
    }
  }
}
