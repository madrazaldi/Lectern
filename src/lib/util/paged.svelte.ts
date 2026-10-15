/**
 * An infinitely scrolled list fetched page by page, remembered per query so leaving and coming back
 * (Back to the library) restores every loaded page, not just the first.
 */

export interface Page<T> {
  results: T[];
  total: number;
}

interface Snapshot<T> {
  items: T[];
  total: number | null;
  next: number;
  at: number;
}

export interface PagedOptions<Q, T> {
  fetch: (query: Q, page: number, signal: AbortSignal) => Promise<Page<T>>;
  /** Stable identity of an entry. Duplicates (a page boundary shifting under us) are dropped. */
  key: (item: T) => string;
  /** Cache id for a query. Defaults to JSON of the query. */
  id?: (query: Q) => string;
  /** Snapshots older than this are thrown away instead of restored. Defaults to 10 minutes. */
  maxAge?: number;
  /** Shared across instances (module-level), so a remounted page finds its old snapshot. */
  cache?: Map<string, Snapshot<T>>;
}

export function pagedCache<T>() {
  return new Map<string, Snapshot<T>>();
}

export class PagedList<Q, T> {
  items = $state<T[]>([]);
  total = $state<number | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  cause = $state<unknown>(null);
  done = $derived(this.total !== null && this.items.length >= this.total);

  #opts: PagedOptions<Q, T>;
  #cache: Map<string, Snapshot<T>>;
  #query: Q | null = null;
  #id: string | null = null;
  #next = 0;
  #ctl: AbortController | null = null;

  constructor(opts: PagedOptions<Q, T>) {
    this.#opts = opts;
    this.#cache = opts.cache ?? new Map();
  }

  /** Switch to a query, restoring its snapshot if one is fresh, otherwise loading the first page. */
  set(query: Q, force = false) {
    const id = this.#opts.id ? this.#opts.id(query) : JSON.stringify(query);
    if (id === this.#id && !force) return;
    this.#ctl?.abort();
    this.#ctl = null;
    this.#query = query;
    this.#id = id;
    this.error = null;
    this.cause = null;
    this.loading = false;
    const snap = force ? undefined : this.#cache.get(id);
    if (snap && Date.now() - snap.at < (this.#opts.maxAge ?? 10 * 60_000)) {
      this.items = snap.items;
      this.total = snap.total;
      this.#next = snap.next;
      return;
    }
    this.#cache.delete(id);
    this.items = [];
    this.total = null;
    this.#next = 0;
    void this.loadMore();
  }

  /** Reload the current query from the first page. */
  reload() {
    if (this.#query !== null) this.set(this.#query, true);
  }

  async loadMore() {
    if (this.#query === null || this.loading || this.done) return;
    const id = this.#id;
    const ctl = new AbortController();
    this.#ctl = ctl;
    this.loading = true;
    this.error = null;
    this.cause = null;
    try {
      const res = await this.#opts.fetch(this.#query, this.#next, ctl.signal);
      if (ctl.signal.aborted || id !== this.#id) return;
      const seen = new Set(this.items.map(this.#opts.key));
      const fresh = res.results.filter((it) => {
        const k = this.#opts.key(it);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      this.items = [...this.items, ...fresh];
      this.#next++;
      // A page that adds nothing new means the server ran out early (or keeps repeating itself): stop asking.
      this.total = fresh.length ? res.total : this.items.length;
      this.#save();
    } catch (err) {
      if (ctl.signal.aborted || id !== this.#id) return;
      this.error = err instanceof Error ? err.message : String(err);
      this.cause = err;
    } finally {
      if (this.#ctl === ctl) {
        this.#ctl = null;
        this.loading = false;
      }
    }
  }

  /** Edit the loaded entries in place (live updates) and keep the snapshot in step. */
  update(fn: (items: T[]) => T[], totalDelta = 0) {
    this.items = fn(this.items);
    if (this.total !== null) this.total = Math.max(this.items.length, this.total + totalDelta);
    this.#save();
  }

  dispose() {
    this.#ctl?.abort();
    this.#ctl = null;
  }

  #save() {
    if (this.#id !== null) this.#cache.set(this.#id, { items: this.items, total: this.total, next: this.#next, at: Date.now() });
  }
}
