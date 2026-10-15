// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaProgress, User } from '$lib/api/types';

const hooks = vi.hoisted(() => ({
  reach: null as null | ((online: boolean) => void),
  authLost: null as null | ((id: string) => void),
  order: [] as string[]
}));

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getLibraries: vi.fn(),
  getProgress: vi.fn(),
  updateProgress: vi.fn(),
  syncLocalSession: vi.fn(),
  closeSession: vi.fn(),
  ping: vi.fn()
}));

vi.mock('$lib/api/client', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message = '',
      public unreachable = status === 0
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    isUnreachable: (e: unknown) => e instanceof ApiError && e.unreachable,
    isAuthLost: (e: unknown) => e instanceof ApiError && e.status === 401,
    getCredentials: () => ({ id: 'acc', serverUrl: 'http://abs' }),
    scopedKey: (k: string) => `${k}.acc`,
    clockSkew: () => 0,
    serverNow: () => Date.now(),
    needsReauth: () => false,
    onReachabilityChange: (fn: (online: boolean) => void) => (hooks.reach = fn),
    onAuthLost: (fn: (id: string) => void) => (hooks.authLost = fn),
    onAccountChanged: () => () => {},
    ping: api.ping,
    logout: vi.fn(),
    reauthenticate: vi.fn()
  };
});

vi.mock('$lib/api/abs', () => api);

const { ApiError } = await import('$lib/api/client');
type Session = (typeof import('./session.svelte'))['session'];
type Outbox = (typeof import('./outbox.svelte'))['outbox'];
let session: Session;
let outbox: Outbox;

function progress(itemId: string, currentTime: number, lastUpdate: number, extra: Partial<MediaProgress> = {}): MediaProgress {
  return {
    id: itemId,
    libraryItemId: itemId,
    episodeId: null,
    duration: 1000,
    progress: currentTime / 1000,
    currentTime,
    isFinished: false,
    hideFromContinueListening: false,
    startedAt: 0,
    finishedAt: null,
    lastUpdate,
    ...extra
  };
}

function user(mediaProgress: MediaProgress[] = []): User {
  return { id: 'u1', username: 'reader', mediaProgress, bookmarks: [] } as unknown as User;
}

const offline = () => new ApiError(0, 'offline');

beforeEach(async () => {
  for (const fn of Object.values(api)) fn.mockReset();
  hooks.order = [];
  localStorage.clear();
  vi.resetModules();
  ({ session } = await import('./session.svelte'));
  ({ outbox } = await import('./outbox.svelte'));
  api.getLibraries.mockResolvedValue([{ id: 'lib', name: 'Books', displayOrder: 0 }]);
  api.getMe.mockResolvedValue(user());
  api.getProgress.mockResolvedValue(null);
  api.updateProgress.mockResolvedValue(undefined);
  api.syncLocalSession.mockResolvedValue(undefined);
});

// Each test gets a fresh module; park the old instance so its window listeners stay quiet.
afterEach(() => {
  session.status = 'signed-out';
});

/** Start offline from the cache of an earlier launch. */
async function startOffline(cached: MediaProgress[] = []) {
  localStorage.setItem('lectern.cache.acc', JSON.stringify({ user: user(cached), libraries: [{ id: 'lib' }] }));
  api.getMe.mockRejectedValueOnce(offline());
  api.getLibraries.mockRejectedValueOnce(offline());
  await session.load();
  expect(session.status).toBe('ready');
  expect(session.online).toBe(false);
}

describe('applying the server’s copy of the user', () => {
  it('keeps progress listened offline that the server has not heard about yet', async () => {
    localStorage.setItem(
      'lectern.outbox.acc',
      JSON.stringify({ 'progress:a': { kind: 'progress', itemId: 'a', episodeId: null, currentTime: 600, duration: 1000, updatedAt: Date.now() } })
    );
    api.getMe.mockResolvedValue(user([progress('a', 100, Date.now() - 60_000), progress('b', 50, 1)]));
    api.getProgress.mockReturnValue(new Promise(() => {})); // The flush stays in flight.
    await session.load();
    expect(session.progressFor('a')?.currentTime).toBe(600);
    expect(session.progressFor('b')?.currentTime).toBe(50);
  });

  it('prefers the server when another device moved on after the pending write', async () => {
    localStorage.setItem(
      'lectern.outbox.acc',
      JSON.stringify({ 'progress:a': { kind: 'progress', itemId: 'a', episodeId: null, currentTime: 600, duration: 1000, updatedAt: 1000 } })
    );
    api.getMe.mockResolvedValue(user([progress('a', 900, Date.now())]));
    api.getProgress.mockReturnValue(new Promise(() => {}));
    await session.load();
    expect(session.progressFor('a')?.currentTime).toBe(900);
  });

  it('shows a pending finished mark', async () => {
    await startOffline([progress('a', 100, 1)]);
    api.updateProgress.mockRejectedValue(offline());
    await session.setFinished('a', null, true);
    expect(outbox.entries['progress:a']).toMatchObject({ isFinished: true });
    expect(session.progressFor('a')?.isFinished).toBe(true);
  });

  it('ignores live progress older than what it has, and passes newer progress on', async () => {
    await session.load();
    const seen = vi.fn();
    session.onRemoteProgress = seen;
    session.applyRemoteProgress(progress('a', 100, 2000), 'Phone');
    session.applyRemoteProgress(progress('a', 50, 1000));
    expect(session.progressFor('a')?.currentTime).toBe(100);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ currentTime: 100 }), 'Phone');
  });

  it('reports progress made elsewhere when re-reading the user', async () => {
    api.getMe.mockResolvedValueOnce(user([progress('a', 100, 1000)]));
    await session.load();
    const seen = vi.fn();
    session.onRemoteProgress = seen;
    api.getMe.mockResolvedValueOnce(user([progress('a', 300, 2000)]));
    await session.refreshUser(0);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ currentTime: 300 }));
  });
});

describe('coming back online', () => {
  it('sends waiting progress before re-reading the user, then tells listeners', async () => {
    await startOffline([progress('a', 100, 1)]);
    outbox.putProgress({ itemId: 'a', episodeId: null, currentTime: 700, duration: 1000, updatedAt: Date.now() });
    let landed!: () => void;
    api.updateProgress.mockImplementation(() => {
      hooks.order.push('updateProgress');
      return new Promise<void>((r) => (landed = r));
    });
    api.getMe.mockImplementation(async () => {
      hooks.order.push('getMe');
      return user([progress('a', 700, Date.now())]);
    });
    session.onReconnect(() => void hooks.order.push('listener'));

    hooks.reach!(true);
    await vi.waitFor(() => expect(hooks.order).toEqual(['updateProgress']));
    landed();
    await vi.waitFor(() => expect(hooks.order).toEqual(['updateProgress', 'getMe', 'listener']));
    expect(session.progressFor('a')?.currentTime).toBe(700);
    expect(outbox.pending).toBe(0);
  });

  it('probes with a ping while offline and reads the user once on the way back', async () => {
    await startOffline();
    api.getMe.mockClear();
    api.ping.mockResolvedValue(false);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(api.ping).toHaveBeenCalled());
    expect(session.online).toBe(false);
    expect(api.getMe).not.toHaveBeenCalled();

    api.getMe.mockResolvedValue(user());
    api.ping.mockResolvedValue(true);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(session.online).toBe(true));
    // A request succeeding during the reconnect reports reachability again; that mustn't start a second one.
    hooks.reach!(true);
    await vi.waitFor(() => expect(api.getMe).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(api.getMe).toHaveBeenCalledTimes(1);
  });

  it('throttles re-reading the user on window focus', async () => {
    await session.load();
    api.getMe.mockClear();
    await session.refreshUser();
    await session.refreshUser();
    expect(api.getMe).not.toHaveBeenCalled();
    await session.refreshUser(0);
    expect(api.getMe).toHaveBeenCalledTimes(1);
  });
});

describe('losing the sign-in', () => {
  it('starts from the cache and asks to sign in again instead of signing out', async () => {
    localStorage.setItem('lectern.cache.acc', JSON.stringify({ user: user([progress('a', 100, 1)]), libraries: [{ id: 'lib' }] }));
    api.getMe.mockImplementation(async () => {
      hooks.authLost!('acc');
      throw new ApiError(401, 'Your session ended.');
    });
    await session.load();
    expect(session.status).toBe('ready');
    expect(session.needsReauth).toBe(true);
    expect(session.online).toBe(true);
    expect(session.progressFor('a')?.currentTime).toBe(100);
  });

  it('ignores lost sign-ins of accounts other than the active one', async () => {
    await session.load();
    hooks.authLost!('someone-else');
    expect(session.needsReauth).toBe(false);
  });
});
