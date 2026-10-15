// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { PagedList, pagedCache, type Page } from './paged.svelte';

const tick = () => new Promise((r) => setTimeout(r, 0));

function pages(data: Record<string, string[][]>) {
  return vi.fn(async (q: string, page: number): Promise<Page<string>> => {
    const all = data[q] ?? [];
    return { results: all[page] ?? [], total: all.flat().length };
  });
}

describe('PagedList', () => {
  it('appends pages until the total is reached', async () => {
    const fetch = pages({ q: [['a', 'b'], ['c']] });
    const list = new PagedList<string, string>({ fetch, key: (x) => x });
    list.set('q');
    await tick();
    expect(list.items).toEqual(['a', 'b']);
    expect(list.done).toBe(false);
    await list.loadMore();
    expect(list.items).toEqual(['a', 'b', 'c']);
    expect(list.done).toBe(true);
    await list.loadMore();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('drops entries a later page repeats, and stops when a page adds nothing new', async () => {
    const fetch = pages({ q: [['a', 'b'], ['b', 'c'], ['c']] });
    const list = new PagedList<string, string>({ fetch, key: (x) => x });
    list.set('q');
    await tick();
    await list.loadMore();
    expect(list.items).toEqual(['a', 'b', 'c']);
    await list.loadMore();
    expect(list.done).toBe(true);
  });

  it('restores a remembered query instead of starting over', async () => {
    const cache = pagedCache<string>();
    const fetch = pages({ q: [['a'], ['b']], r: [['x']] });
    const first = new PagedList<string, string>({ fetch, key: (x) => x, cache });
    first.set('q');
    await tick();
    await first.loadMore();

    const again = new PagedList<string, string>({ fetch, key: (x) => x, cache });
    again.set('q');
    expect(again.items).toEqual(['a', 'b']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a page that arrives after the query changed', async () => {
    let release!: (p: Page<string>) => void;
    const fetch = vi.fn((q: string) => (q === 'slow' ? new Promise<Page<string>>((r) => (release = r)) : Promise.resolve({ results: ['x'], total: 1 })));
    const list = new PagedList<string, string>({ fetch, key: (x) => x });
    list.set('slow');
    list.set('fast');
    await tick();
    release({ results: ['late'], total: 1 });
    await tick();
    expect(list.items).toEqual(['x']);
  });

  it('keeps the snapshot in step with live edits', async () => {
    const cache = pagedCache<string>();
    const fetch = pages({ q: [['a', 'b']] });
    const list = new PagedList<string, string>({ fetch, key: (x) => x, cache });
    list.set('q');
    await tick();
    list.update((items) => items.filter((x) => x !== 'a'), -1);
    expect(list.total).toBe(1);
    const again = new PagedList<string, string>({ fetch, key: (x) => x, cache });
    again.set('q');
    expect(again.items).toEqual(['b']);
  });
});
