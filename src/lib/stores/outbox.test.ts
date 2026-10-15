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
  return {
    ApiError,
    scopedKey: (k: string) => `${k}.test`,
    clockSkew: () => skew.value,
    isUnreachable: (e: unknown) => e instanceof ApiError && e.status === 0,
    isAuthLost: (e: unknown) => e instanceof ApiError && e.status === 401
  };
});
vi.mock('$lib/api/abs', () => ({ getProgress: vi.fn(), updateProgress: vi.fn(), syncLocalSession: vi.fn(), closeSession: vi.fn() }));

const skew = vi.hoisted(() => ({ value: 0 }));

const abs = await import('$lib/api/abs');
const { ApiError } = await import('$lib/api/client');
const { outbox, progressKey } = await import('./outbox.svelte');

const getProgress = vi.mocked(abs.getProgress);
const updateProgress = vi.mocked(abs.updateProgress);
const syncLocalSession = vi.mocked(abs.syncLocalSession);
const closeSession = vi.mocked(abs.closeSession);

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
  outbox.prepare = () => {};
  skew.value = 0;
  updateProgress.mockResolvedValue(undefined);
  closeSession.mockResolvedValue(undefined);
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

  it('still sends progress when another device only moved its reading position since', async () => {
    getProgress.mockResolvedValue({ lastUpdate: 3000, currentTime: 100, ebookLocation: 'cfi' } as never);
    outbox.putProgress({ itemId: 'a', episodeId: null, currentTime: 321, duration: 1000, baseTime: 100, updatedAt: 2000 });
    await outbox.flush();
    expect(updateProgress).toHaveBeenCalledWith('a', { currentTime: 321, duration: 1000, progress: 0.321 }, null);
  });

  it('drops progress based on a position another device has listened on from', async () => {
    getProgress.mockResolvedValue({ lastUpdate: 3000, currentTime: 700 } as never);
    outbox.putProgress({ itemId: 'a', episodeId: null, currentTime: 321, duration: 1000, baseTime: 100, updatedAt: 2000 });
    await outbox.flush();
    expect(updateProgress).not.toHaveBeenCalled();
    expect(outbox.pending).toBe(0);
  });

  it('sets the position of an offline session the server ignored for a reading position saved elsewhere', async () => {
    const s = { ...localSession('s1'), episodeId: null, startTime: 100, currentTime: 400, duration: 1000 };
    outbox.putSession(s);
    // The server kept its own position (still where the session started): only the ebook moved elsewhere.
    getProgress.mockResolvedValue({ lastUpdate: 9000, currentTime: 100 } as never);
    await outbox.flush();
    expect(updateProgress).toHaveBeenCalledWith('a', { currentTime: 400, duration: 1000, progress: 0.4 }, null);

    // Another device listened on: its position stands.
    updateProgress.mockClear();
    outbox.putSession({ ...s, id: 's2' });
    getProgress.mockResolvedValue({ lastUpdate: 9000, currentTime: 800 } as never);
    await outbox.flush();
    expect(updateProgress).not.toHaveBeenCalled();
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

  it('closes the written-ahead session to credit its listening time', async () => {
    getProgress.mockResolvedValue({ lastUpdate: 1000, currentTime: 50 } as never);
    outbox.putProgress({ itemId: 'a', episodeId: null, currentTime: 321, duration: 1000, sessionId: 's1', timeListened: 42, updatedAt: 2000 });
    await outbox.flush();
    expect(closeSession).toHaveBeenCalledWith('s1', { currentTime: 321, timeListened: 42, duration: 1000 });
    expect(updateProgress).not.toHaveBeenCalled();
    expect(outbox.pending).toBe(0);
  });

  it('keeps the other device’s position when closing a session it has moved past', async () => {
    getProgress.mockResolvedValue({ lastUpdate: 3000, currentTime: 900 } as never);
    outbox.putProgress({ itemId: 'a', episodeId: null, currentTime: 321, duration: 1000, sessionId: 's1', timeListened: 42, updatedAt: 2000 });
    await outbox.flush();
    expect(closeSession).toHaveBeenCalledWith('s1', { currentTime: 900, timeListened: 42, duration: 1000 });
  });

  it('falls back to a plain progress update when the server has forgotten the session', async () => {
    getProgress.mockResolvedValue({ lastUpdate: 1000 } as never);
    closeSession.mockRejectedValue(new ApiError(404, 'Not Found'));
    outbox.putProgress({ itemId: 'a', episodeId: null, currentTime: 321, duration: 1000, sessionId: 's1', timeListened: 42, updatedAt: 2000 });
    await outbox.flush();
    expect(updateProgress).toHaveBeenCalledWith('a', { currentTime: 321, duration: 1000, progress: 0.321 }, null);
  });

  it('does not let a later position write drop an unsent finished mark', async () => {
    outbox.putProgress({ itemId: 'a', episodeId: null, currentTime: 10, duration: 1000, isFinished: true, updatedAt: 1 });
    outbox.putProgress({ itemId: 'a', episodeId: null, currentTime: 20, duration: 1000, sessionId: 's1', updatedAt: 2 });
    getProgress.mockResolvedValue(null);
    await outbox.flush();
    expect(closeSession).not.toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledWith('a', { isFinished: true }, null);
  });

  it('compares timestamps on the server’s clock', async () => {
    // Our clock runs 10 minutes behind the server's: a write at our 2000 happened at the server's 602000.
    skew.value = 600_000;
    getProgress.mockResolvedValue({ lastUpdate: 300_000 } as never);
    put('a', 2000, 321);
    await outbox.flush();
    expect(updateProgress).toHaveBeenCalled();
  });

  it('asks the player to fold in local listening before sending', async () => {
    const prepare = vi.fn(() => outbox.putSession(localSession('late')));
    outbox.prepare = prepare;
    await outbox.flush();
    expect(prepare).toHaveBeenCalled();
    expect(syncLocalSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'late' }));
  });

  it('keeps entries while the account needs to sign in again', async () => {
    getProgress.mockRejectedValue(new ApiError(401, 'signed out'));
    put('a', 1);
    await outbox.flush();
    expect(outbox.pending).toBe(1);
  });
});
