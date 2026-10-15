// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate, peek, Resource, resource } from './resource.svelte';

/** A load function whose answers the test settles by hand. */
function deferredLoader<T>() {
  const calls: { key: string; signal: AbortSignal; resolve: (v: T) => void; reject: (e: unknown) => void }[] = [];
  const load = vi.fn(
    (key: string, signal: AbortSignal) =>
      new Promise<T>((resolve, reject) => {
        calls.push({ key, signal, resolve, reject });
      })
  );
  return { load, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => invalidate());

describe('Resource', () => {
  it('loads a key and caches the answer', async () => {
    const { load, calls } = deferredLoader<string>();
    const r = new Resource<string, string>({ load });
    r.set('a');
    expect(r.loading).toBe(true);
    expect(r.pending).toBe(true);
    calls[0].resolve('A');
    await tick();
    expect(r.data).toBe('A');
    expect(r.loading).toBe(false);
    expect(peek('"a"')).toBe('A');
  });

  it('ignores a late answer for a key it has moved away from, and aborts it', async () => {
    const { load, calls } = deferredLoader<string>();
    const r = new Resource<string, string>({ load });
    r.set('a');
    r.set('b');
    expect(calls[0].signal.aborted).toBe(true);
    calls[1].resolve('B');
    calls[0].resolve('A (late)');
    await tick();
    expect(r.data).toBe('B');
    expect(peek('"a"')).toBeUndefined();
  });

  it('ignores a late failure for an old key', async () => {
    const { load, calls } = deferredLoader<string>();
    const r = new Resource<string, string>({ load });
    r.set('a');
    r.set('b');
    calls[0].reject(new Error('boom'));
    calls[1].resolve('B');
    await tick();
    expect(r.error).toBeNull();
    expect(r.data).toBe('B');
  });

  it('shows the cached copy at once and revalidates quietly', async () => {
    const { load, calls } = deferredLoader<string>();
    const first = new Resource<string, string>({ load });
    first.set('a');
    calls[0].resolve('old');
    await tick();

    const again = new Resource<string, string>({ load });
    again.set('a');
    expect(again.data).toBe('old');
    expect(again.pending).toBe(false);
    expect(again.loading).toBe(true);
    calls[1].resolve('new');
    await tick();
    expect(again.data).toBe('new');
  });

  it('keeps cached data when a background refresh fails', async () => {
    const { load, calls } = deferredLoader<string>();
    const r = new Resource<string, string>({ load });
    r.set('a');
    calls[0].resolve('A');
    await tick();
    void r.refresh();
    calls[1].reject(new Error('offline'));
    await tick();
    expect(r.data).toBe('A');
    expect(r.error).toBeNull();
  });

  it('reports a failure with nothing to show, and clears it when the key changes', async () => {
    const { load, calls } = deferredLoader<string>();
    const r = new Resource<string, string>({ load });
    r.set('a');
    const err = new Error('nope');
    calls[0].reject(err);
    await tick();
    expect(r.error).toBe('nope');
    expect(r.cause).toBe(err);
    r.set('b');
    expect(r.error).toBeNull();
    expect(r.data).toBeUndefined();
  });

  it('clears the error on refresh and recovers', async () => {
    const { load, calls } = deferredLoader<string>();
    const r = new Resource<string, string>({ load });
    r.set('a');
    calls[0].reject(new Error('nope'));
    await tick();
    const done = r.refresh();
    expect(r.error).toBeNull();
    calls[1].resolve('A');
    await done;
    expect(r.data).toBe('A');
  });

  it('uses the fallback when a first load fails', async () => {
    const { load, calls } = deferredLoader<string>();
    const r = new Resource<string, string>({ load, fallback: (k) => (k === 'a' ? 'saved' : undefined) });
    r.set('a');
    calls[0].reject(new Error('offline'));
    await tick();
    expect(r.data).toBe('saved');
    expect(r.error).toBeNull();
  });

  it('skips the request while a cached copy is fresh', () => {
    const { load, calls } = deferredLoader<string>();
    const r = new Resource<string, string>({ load, freshFor: 60_000 });
    r.mutate('ignored: no key yet');
    r.set('a');
    calls[0].resolve('A');
    return tick().then(() => {
      const again = new Resource<string, string>({ load, freshFor: 60_000 });
      again.set('a');
      expect(again.loading).toBe(false);
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  it('idles on a null key', async () => {
    const { load, calls } = deferredLoader<string>();
    const r = new Resource<string, string>({ load });
    r.set('a');
    r.set(null);
    expect(calls[0].signal.aborted).toBe(true);
    expect(r.loading).toBe(false);
    expect(r.data).toBeUndefined();
  });
});

describe('resource()', () => {
  // `flushSync` from 'svelte' resolves to the server build under vitest, so let effects run on a tick instead.
  it('follows a reactive key', async () => {
    const { load, calls } = deferredLoader<string>();
    let key = $state('a');
    let r!: Resource<string, string>;
    const stop = $effect.root(() => {
      r = resource(() => key, { load });
    });
    expect(calls.map((c) => c.key)).toEqual(['a']);
    key = 'b';
    await tick();
    expect(calls.map((c) => c.key)).toEqual(['a', 'b']);
    expect(calls[0].signal.aborted).toBe(true);
    expect(r.key).toBe('b');
    stop();
    expect(calls[1].signal.aborted).toBe(true);
  });
});
