import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { overtaken, PositionSync, startPosition, type Position } from './sync';

class Offline extends Error {}

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

function setup() {
  const storage = memoryStorage();
  const send = vi.fn<(itemId: string, pos: Position) => Promise<unknown>>(() => Promise.resolve());
  let now = 1000;
  const sync = new PositionSync({ send, storage, key: () => 'pending', retryable: (e) => e instanceof Offline, delay: 2000, now: () => now });
  return { sync, send, storage, tick: (ms = 1) => (now += ms) };
}

const at = (location: string, progress = 0.1): Position => ({ location, progress });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('PositionSync', () => {
  it('writes every page turn to disk at once, and sends only the last once reading pauses', async () => {
    const { sync, send } = setup();
    sync.update('a', at('cfi-1'));
    await vi.advanceTimersByTimeAsync(1500);
    sync.update('a', at('cfi-2'));
    expect(sync.pending('a')?.location).toBe('cfi-2');
    await vi.advanceTimersByTimeAsync(1500);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('a', at('cfi-2'));
    expect(sync.pending('a')).toBeNull();
  });

  it('sends right away on flush, and does nothing when nothing is waiting', async () => {
    const { sync, send } = setup();
    await sync.flush('a');
    expect(send).not.toHaveBeenCalled();
    sync.update('a', at('cfi-1'));
    await sync.flush('a');
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps a position the server could not be reached for, and sends it later', async () => {
    const { sync, send } = setup();
    send.mockRejectedValueOnce(new Offline());
    sync.update('a', at('cfi-1', 0.4));
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.pending('a')).toMatchObject({ location: 'cfi-1', progress: 0.4 });
    await sync.flushPending();
    expect(send).toHaveBeenCalledTimes(2);
    expect(sync.pending('a')).toBeNull();
  });

  it('drops a position the server refused, rather than retrying it forever', async () => {
    const { sync, send } = setup();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    send.mockRejectedValueOnce(new Error('404'));
    sync.update('a', at('cfi-1'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.pending('a')).toBeNull();
    err.mockRestore();
  });

  it('keeps a newer position written while an older one was on its way', async () => {
    const { sync, send, tick } = setup();
    let finish!: () => void;
    send.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    sync.update('a', at('cfi-1'));
    const sending = sync.flush('a');
    tick();
    sync.update('a', at('cfi-2'));
    finish();
    await sending;
    expect(sync.pending('a')?.location).toBe('cfi-2');
  });

  it('flushes waiting positions, skipping stale ones and stopping while offline', async () => {
    const { sync, send, storage } = setup();
    storage.setItem(
      'pending',
      JSON.stringify({
        a: { location: 'a1', progress: 0.1, updatedAt: 1 },
        b: { location: 'b1', progress: 0.2, updatedAt: 1 },
        c: { location: 'c1', progress: 0.3, updatedAt: 1 }
      })
    );
    send.mockRejectedValueOnce(new Offline());
    await sync.flushPending();
    // a failed (offline): b and c weren't tried.
    expect(send).toHaveBeenCalledTimes(1);
    expect(Object.keys(JSON.parse(storage.getItem('pending')!))).toEqual(['a', 'b', 'c']);

    await sync.flushPending((id) => id === 'b');
    expect(send.mock.calls.map((c) => c[0])).toEqual(['a', 'a', 'c']);
    expect(JSON.parse(storage.getItem('pending')!)).toEqual({});
  });

  it('records the server position each waiting one carries on from', async () => {
    const { sync, send, tick } = setup();
    send.mockRejectedValue(new Offline());
    sync.seen('a', 'server-1');
    sync.update('a', at('cfi-1'));
    await vi.advanceTimersByTimeAsync(2000);
    // Still unsent: later positions carry on from the same server position.
    sync.update('a', at('cfi-2'));
    expect(sync.pending('a')).toMatchObject({ location: 'cfi-2', base: 'server-1' });

    // Once one gets through, a position written meanwhile carries on from it.
    let finish!: () => void;
    send.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    const sending = sync.flush('a');
    tick();
    sync.update('a', at('cfi-3'));
    finish();
    await sending;
    expect(sync.pending('a')).toMatchObject({ location: 'cfi-3', base: 'cfi-2' });
  });

  it('survives an unreadable store', () => {
    const { sync, storage } = setup();
    storage.setItem('pending', '{nope');
    expect(sync.pending('a')).toBeNull();
    sync.update('a', at('cfi-1'));
    expect(sync.pending('a')?.location).toBe('cfi-1');
  });
});

describe('startPosition', () => {
  const server = { ebookLocation: 'server', ebookProgress: 0.5, lastUpdate: 10_000 };

  it("opens at the server's position, or the start when there is none", () => {
    expect(startPosition(server, null)).toEqual({ location: 'server', progress: 0.5 });
    expect(startPosition(null, null)).toBeNull();
    expect(startPosition({ ...server, ebookLocation: null }, null)).toBeNull();
  });

  it('prefers a position still waiting to be sent when it is newer, allowing for clock skew', () => {
    const pending = { location: 'local', progress: 0.6, updatedAt: 9_000 };
    expect(startPosition(server, pending)?.location).toBe('server');
    // Our clock runs 2s behind the server's: the local position is actually newer.
    expect(startPosition(server, pending, 2_000)?.location).toBe('local');
    expect(startPosition(null, pending)?.location).toBe('local');
  });
});

describe('overtaken', () => {
  const pending = { location: 'mine', progress: 0.6, updatedAt: 1_000, base: 'before' };

  it('keeps a waiting position when only the shared timestamp moved (listening, say)', () => {
    expect(overtaken(pending, { ebookLocation: 'before', lastUpdate: 99_000 })).toBe(false);
    expect(startPosition({ ebookLocation: 'before', ebookProgress: 0.2, lastUpdate: 99_000 }, pending)?.location).toBe('mine');
  });

  it('drops it once the server’s reading position moved elsewhere, however old', () => {
    expect(overtaken(pending, { ebookLocation: 'elsewhere', lastUpdate: 1 })).toBe(true);
    expect(overtaken({ ...pending, base: null }, { ebookLocation: 'elsewhere', lastUpdate: 1 })).toBe(true);
    expect(overtaken(pending, { ebookLocation: 'mine', lastUpdate: 99_000 })).toBe(false);
    expect(overtaken(pending, { ebookLocation: null, lastUpdate: 99_000 })).toBe(false);
  });

  it('compares timestamps for positions saved without a base', () => {
    const legacy = { location: 'mine', progress: 0.6, updatedAt: 1_000 };
    expect(overtaken(legacy, { ebookLocation: 'elsewhere', lastUpdate: 2_000 })).toBe(true);
    expect(overtaken(legacy, { ebookLocation: 'elsewhere', lastUpdate: 500 })).toBe(false);
  });
});
