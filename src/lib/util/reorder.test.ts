import { describe, expect, it, vi } from 'vitest';
import { move, OrderSync, sameOrder } from './reorder';

describe('move', () => {
  it('moves an entry up or down without touching the original', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(move(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(move(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });
  it('clamps the target and ignores a missing source', () => {
    expect(move(['a', 'b'], 0, 9)).toEqual(['b', 'a']);
    expect(move(['a', 'b'], 1, -3)).toEqual(['b', 'a']);
    expect(move(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('sameOrder', () => {
  const k = (x: { id: string }) => x.id;
  it('compares by key', () => {
    expect(sameOrder([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }], k)).toBe(true);
    expect(sameOrder([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'a' }], k)).toBe(false);
    expect(sameOrder([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }], k)).toBe(false);
  });
});

/** A save the test resolves or rejects by hand. */
function deferredSaves() {
  const calls: { order: string[]; resolve: (v: string) => void; reject: (e: unknown) => void }[] = [];
  const save = vi.fn(
    (order: string[]) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ order, resolve, reject });
      })
  );
  return { calls, save };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('OrderSync', () => {
  it('shows a change at once and reports the server’s answer', async () => {
    const shown: string[][] = [];
    const saved = vi.fn();
    const { calls, save } = deferredSaves();
    const sync = new OrderSync<string[], string>({ save, apply: (o) => shown.push(o), saved });
    void sync.change(['a', 'b'], ['b', 'a']);
    expect(shown).toEqual([['b', 'a']]);
    expect(sync.busy).toBe(true);
    await flush();
    calls[0].resolve('ok');
    await sync.settled();
    expect(saved).toHaveBeenCalledWith('ok');
    expect(sync.busy).toBe(false);
  });

  it('coalesces moves made during a save into one save of the latest order', async () => {
    const saved = vi.fn();
    const { calls, save } = deferredSaves();
    const sync = new OrderSync<string[], string>({ save, apply: () => {}, saved });
    void sync.change(['a', 'b', 'c'], ['b', 'a', 'c']);
    await flush();
    void sync.change(['b', 'a', 'c'], ['b', 'c', 'a']);
    void sync.change(['b', 'c', 'a'], ['c', 'b', 'a']);
    calls[0].resolve('first');
    await flush();
    // The first answer is stale by now: not reported.
    expect(saved).not.toHaveBeenCalled();
    expect(calls.map((c) => c.order)).toEqual([
      ['b', 'a', 'c'],
      ['c', 'b', 'a']
    ]);
    calls[1].resolve('second');
    await sync.settled();
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith('second');
  });

  it('rolls back to the last saved order when a save fails, dropping what was waiting', async () => {
    const shown: string[][] = [];
    const failed = vi.fn();
    const { calls, save } = deferredSaves();
    const sync = new OrderSync<string[], string>({ save, apply: (o) => shown.push(o), failed });
    void sync.change(['a', 'b', 'c'], ['b', 'a', 'c']);
    await flush();
    calls[0].resolve('ok');
    await sync.settled();

    void sync.change(['b', 'a', 'c'], ['b', 'c', 'a']);
    await flush();
    void sync.change(['b', 'c', 'a'], ['a', 'b', 'c']);
    calls[1].reject(new Error('offline'));
    await sync.settled();
    expect(failed).toHaveBeenCalledOnce();
    // Back to the order the server accepted, not the one shown before the failing move.
    expect(shown.at(-1)).toEqual(['b', 'a', 'c']);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('rolls back to the original order when the first save fails', async () => {
    const shown: string[][] = [];
    const sync = new OrderSync<string[]>({ save: () => Promise.reject(new Error('403')), apply: (o) => shown.push(o) });
    await sync.change(['a', 'b'], ['b', 'a']);
    expect(shown).toEqual([
      ['b', 'a'],
      ['a', 'b']
    ]);
    expect(sync.busy).toBe(false);
  });

  it('survives a save that throws synchronously and keeps working', async () => {
    let fail = true;
    const save = vi.fn(() => {
      if (fail) throw new Error('boom');
      return Promise.resolve('ok');
    });
    const sync = new OrderSync<string[], string>({ save, apply: () => {} });
    await sync.change(['a'], ['a']);
    fail = false;
    await sync.change(['a'], ['a']);
    expect(save).toHaveBeenCalledTimes(2);
    expect(sync.busy).toBe(false);
  });
});
