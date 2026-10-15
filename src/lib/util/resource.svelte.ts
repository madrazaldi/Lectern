import { untrack } from 'svelte';

/**
 * One request-backed value for a page: `data`, `error`, `loading` and `refresh()`, keyed by whatever the page
 * is showing (an id, a library, a search term).
 *
 * - Changing the key cancels the request in flight and ignores any late answer, so a slow response for the
 *   previous key never overwrites the current one.
 * - Answers are cached in memory by key. Coming back to a key shows the cached copy at once and refreshes it
 *   quietly in the background (stale-while-revalidate), so Back never flashes a spinner.
 * - A background refresh that fails keeps the cached copy rather than replacing the page with an error.
 */

interface Entry {
  value: unknown;
  at: number;
}

const MAX_ENTRIES = 120;
const store = new Map<string, Entry>();

function remember(id: string, value: unknown) {
  // Re-insert so the Map's order doubles as least-recently-used.
  store.delete(id);
  store.set(id, { value, at: Date.now() });
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
}

/** Drop cached answers whose id starts with `prefix` (everything when omitted). */
export function invalidate(prefix = '') {
  for (const id of [...store.keys()]) if (id.startsWith(prefix)) store.delete(id);
}

/** Read a cached answer without requesting anything. */
export function peek<T>(id: string): T | undefined {
  return store.get(id)?.value as T | undefined;
}

export interface ResourceOptions<K, T> {
  /** Requests the value for a key. Should pass `signal` on to the HTTP layer. */
  load: (key: K, signal: AbortSignal) => Promise<T>;
  /** Cache id for a key; also how key changes are detected. Defaults to JSON of the key. */
  id?: (key: K) => string;
  /** A value to show when the request fails (e.g. a downloaded copy while offline). */
  fallback?: (key: K, err: unknown) => T | undefined;
  /** Cached answers younger than this are shown without refreshing. Defaults to 0: always revalidate. */
  freshFor?: number;
  /** Don't read or write the shared cache. */
  noCache?: boolean;
}

export class Resource<K, T> {
  data = $state<T | undefined>(undefined);
  /** The last failure's message, or null. Cleared when the key changes or a request succeeds. */
  error = $state<string | null>(null);
  /** The last failure itself, for callers that need its type (e.g. to tell "offline" apart). */
  cause = $state<unknown>(null);
  /** A request is in flight (initial load or a background refresh). */
  loading = $state(false);
  /** Nothing to show yet: first load for this key and no cached copy. */
  pending = $derived(this.loading && this.data === undefined);

  #opts: ResourceOptions<K, T>;
  #key: K | null = null;
  #id: string | null = null;
  #ctl: AbortController | null = null;

  constructor(opts: ResourceOptions<K, T>) {
    this.#opts = opts;
  }

  get key() {
    return this.#key;
  }

  #idOf(key: K) {
    return this.#opts.id ? this.#opts.id(key) : JSON.stringify(key);
  }

  /** Point at a key. A no-op if it's the current one; null clears everything and idles. */
  set(key: K | null | undefined) {
    const id = key === null || key === undefined ? null : this.#idOf(key);
    if (id === this.#id) return;
    this.#abort();
    this.#key = key ?? null;
    this.#id = id;
    this.error = null;
    this.cause = null;
    if (id === null) {
      this.data = undefined;
      this.loading = false;
      return;
    }
    const hit = this.#opts.noCache ? undefined : store.get(id);
    this.data = hit?.value as T | undefined;
    if (hit && this.#opts.freshFor && Date.now() - hit.at < this.#opts.freshFor) {
      this.loading = false;
      return;
    }
    void this.#fetch();
  }

  /** Request the current key again, keeping what's shown until the answer arrives. */
  refresh() {
    if (this.#id === null) return Promise.resolve();
    this.#abort();
    this.error = null;
    this.cause = null;
    return this.#fetch();
  }

  /** Replace the value locally (after an edit the server confirmed) and update the cache. */
  mutate(value: T) {
    this.data = value;
    if (this.#id !== null && !this.#opts.noCache) remember(this.#id, value);
  }

  /** Cancel anything in flight. */
  dispose() {
    this.#abort();
  }

  #abort() {
    this.#ctl?.abort();
    this.#ctl = null;
  }

  async #fetch() {
    const key = this.#key as K;
    const id = this.#id!;
    const ctl = new AbortController();
    this.#ctl = ctl;
    this.loading = true;
    try {
      const value = await this.#opts.load(key, ctl.signal);
      if (ctl.signal.aborted || id !== this.#id) return;
      this.data = value;
      this.error = null;
      this.cause = null;
      if (!this.#opts.noCache) remember(id, value);
    } catch (err) {
      if (ctl.signal.aborted || id !== this.#id) return;
      const fallback = this.data === undefined ? this.#opts.fallback?.(key, err) : undefined;
      if (fallback !== undefined) this.data = fallback;
      // With something already on screen (cache or fallback), a failed refresh stays quiet.
      else if (this.data === undefined) {
        this.error = err instanceof Error ? err.message : String(err);
        this.cause = err;
      }
    } finally {
      if (this.#ctl === ctl) {
        this.#ctl = null;
        this.loading = false;
      }
    }
  }
}

/**
 * Create a Resource that follows `key()` reactively. Call during component initialisation; the request
 * is cancelled when the component goes away. Return null/undefined from `key` to idle.
 */
export function resource<K, T>(key: () => K | null | undefined, opts: ResourceOptions<K, T>) {
  const r = new Resource<K, T>(opts);
  // Synchronously too, so a cached copy is there for the very first render (and scroll restoration).
  r.set(untrack(key));
  $effect.pre(() => {
    const k = key();
    untrack(() => r.set(k));
  });
  $effect(() => () => r.dispose());
  return r;
}
