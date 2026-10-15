// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/client', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message = ''
    ) {
      super(message);
    }
  }
  return { ApiError, scopedKey: (k: string) => `${k}.test` };
});
vi.mock('$lib/api/abs', () => ({ getProgress: vi.fn(), updateProgress: vi.fn(), syncLocalSession: vi.fn() }));

const abs = await import('$lib/api/abs');
const { ApiError } = await import('$lib/api/client');
const { outbox, progressKey } = await import('./outbox.svelte');

const getProgress = vi.mocked(abs.getProgress);
const updateProgress = vi.mocked(abs.updateProgress);
const syncLocalSession = vi.mocked(abs.syncLocalSession);

function put(itemId: string, updatedAt: number, currentTime = 100) {
  outbox.putProgress({ itemId, episodeId: null, currentTime, duration: 1000, updatedAt });
}

const localSession = (id: string) => ({ id, updatedAt: 5, libraryItemId: 'a' }) as unknown as import('$lib/api/abs').LocalSession;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  outbox.load();
  outbox.entries = {};
  outbox.busy = () => false;
  updateProgress.mockResolvedValue(undefined);
  syncLocalSession.mockResolvedValue(undefined);
});

describe('outbox', () => {
  it('replays progress the server has not seen', async () => {
    getProgress.mockResolvedValue({ lastUpdate: 1000 } as never);
    put('a', 2000, 321);
    await outbox.flush();
    expect(updateProgress).toHaveBeenCalledWith('a', { currentTime: 321, duration: 1000, progress: 0.321 }, null);
    expect(outbox.pending).toBe(0);
  });

  it('drops progress when another device has moved on since', async () => {
    getProgress.mockResolvedValue({ lastUpdate: 3000 } as never);
    put('a', 2000);
    await outbox.flush();
    expect(updateProgress).not.toHaveBeenCalled();
    expect(outbox.pending).toBe(0);
  });

  it('keeps everything and stops when the server is unreachable', async () => {
    getProgress.mockRejectedValue(new ApiError(0, 'offline'));
    put('a', 1);
    put('b', 2);
    await outbox.flush();
    expect(getProgress).toHaveBeenCalledTimes(1);
    expect(outbox.pending).toBe(2);
  });

  it('discards entries the server rejects outright', async () => {
    getProgress.mockResolvedValue(null);
    updateProgress.mockRejectedValue(new ApiError(404, 'gone'));
    put('gone', 1);
    await outbox.flush();
    expect(outbox.pending).toBe(0);
  });

  it('sends offline sessions before plain progress', async () => {
    const order: string[] = [];
    getProgress.mockResolvedValue(null);
    updateProgress.mockImplementation(async () => void order.push('progress'));
    syncLocalSession.mockImplementation(async () => void order.push('session'));
    put('a', 1);
    outbox.putSession(localSession('s1'));
    await outbox.flush();
    expect(order).toEqual(['session', 'progress']);
  });

  it('skips entries the player is syncing itself', async () => {
    outbox.busy = (key) => key === progressKey('a', null);
    put('a', 1);
    await outbox.flush();
    expect(getProgress).not.toHaveBeenCalled();
    expect(outbox.pending).toBe(1);
  });

  it('only confirms writes up to the confirmed time', () => {
    put('a', 2000);
    outbox.confirm(progressKey('a', null), 1500);
    expect(outbox.pending).toBe(1);
    outbox.confirm(progressKey('a', null), 2000);
    expect(outbox.pending).toBe(0);
  });

  it('survives a restart', () => {
    put('a', 1);
    outbox.putSession(localSession('s1'));
    outbox.entries = {};
    outbox.load();
    expect(Object.keys(outbox.entries).sort()).toEqual(['progress:a', 'session:s1']);
  });
});
