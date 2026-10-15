// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

const http = vi.hoisted(() => ({ handler: null as null | ((url: URL, init: RequestInit) => Response | Promise<Response>), calls: [] as string[] }));
const keychain = vi.hoisted(() => ({ store: new Map<string, string>(), failWrites: false }));
const toast = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    http.calls.push(`${init.method ?? 'GET'} ${url.pathname}`);
    return new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('Request cancelled')));
      Promise.resolve()
        .then(() => http.handler!(url, init))
        .then(resolve, reject);
    });
  }
}));

vi.mock('$lib/native', () => ({
  inTauri: true,
  secrets: {
    get: async (key: string) => keychain.store.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (keychain.failWrites) throw new Error('keychain locked');
      // Windows Credential Manager: at most 2560 bytes, and keyring stores UTF-16.
      if (value.length * 2 > 2560) throw new Error('Attribute password is longer than platform limit of 2560 chars');
      keychain.store.set(key, value);
    },
    delete: async (key: string) => void keychain.store.delete(key)
  }
}));

vi.mock('$lib/stores/toast.svelte', () => ({ toast }));

type Client = typeof import('./client');
let client: Client;

const SERVER = 'https://abs.example.com';

/** A JWT-shaped token padded to a realistic length, expiring in an hour unless told otherwise. */
function jwt(name: string, expIn = 3600) {
  const payload = btoa(JSON.stringify({ userId: 'u1', name, exp: Math.floor(Date.now() / 1000) + expIn, pad: 'x'.repeat(200) }));
  return `eyJhbGciOiJIUzI1NiJ9.${payload.replace(/=+$/, '')}.${'s'.repeat(43)}`;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

/** A rejection, as the ApiError it should be. */
const caught = (e: unknown) => e as Error & { status: number };

function route(handler: Handler) {
  http.handler = handler;
}

async function fresh() {
  vi.resetModules();
  client = await import('./client');
  await client.initCredentials();
}

async function signIn(username = 'reader', userId = 'u1', access = jwt('a1'), refresh = jwt('r1')) {
  route((url) => {
    if (url.pathname === '/login') return json({ user: { id: userId, username, accessToken: access, refreshToken: refresh, mediaProgress: [] } });
    throw new Error(`unexpected ${url.pathname}`);
  });
  await client.loginWithPassword(SERVER, username, 'pw');
  http.calls = [];
}

beforeEach(async () => {
  keychain.store.clear();
  keychain.failWrites = false;
  localStorage.clear();
  http.calls = [];
  toast.mockClear();
  await fresh();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('token refresh', () => {
  it('refreshes on a 401 and retries with the new token', async () => {
    await signIn();
    const fresher = jwt('a2');
    route((url, init) => {
      if (url.pathname === '/auth/refresh') return json({ user: { accessToken: fresher, refreshToken: jwt('r2') } });
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === `Bearer ${fresher}` ? json({ ok: true }) : new Response('Unauthorized', { status: 401 });
    });
    await expect(client.request('/api/me')).resolves.toEqual({ ok: true });
    expect(http.calls).toEqual(['GET /api/me', 'POST /auth/refresh', 'GET /api/me']);
    expect(client.getCredentials()?.accessToken).toBe(fresher);
    // Persisted for next launch.
    expect(JSON.parse(keychain.store.get(`account.${client.getCredentials()!.id}`)!).accessToken).toBe(fresher);
  });

  it('coalesces concurrent refreshes into one', async () => {
    await signIn();
    const fresher = jwt('a2');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    route(async (url, init) => {
      if (url.pathname === '/auth/refresh') {
        await gate;
        return json({ user: { accessToken: fresher, refreshToken: jwt('r2') } });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === `Bearer ${fresher}` ? json({ path: url.pathname }) : new Response('Unauthorized', { status: 401 });
    });
    const all = Promise.all([client.request('/api/a'), client.request('/api/b'), client.request('/api/c')]);
    await vi.waitFor(() => expect(http.calls.filter((c) => c === 'POST /auth/refresh')).toHaveLength(1));
    release();
    await expect(all).resolves.toEqual([{ path: '/api/a' }, { path: '/api/b' }, { path: '/api/c' }]);
    expect(http.calls.filter((c) => c === 'POST /auth/refresh')).toHaveLength(1);
  });

  it('keeps the account when the refresh fails for lack of a connection', async () => {
    await signIn();
    const lost = vi.fn();
    client.onAuthLost(lost);
    route((url) => {
      if (url.pathname === '/auth/refresh') throw new TypeError('error sending request for url');
      return new Response('Unauthorized', { status: 401 });
    });
    const err = await client.request<never>('/api/me').catch(caught);
    expect(client.isUnreachable(err)).toBe(true);
    expect(client.needsReauth()).toBe(false);
    expect(lost).not.toHaveBeenCalled();
    expect(client.listAccounts()).toHaveLength(1);
    expect(client.getCredentials()).not.toBeNull();
    await fresh();
    expect(client.listAccounts()).toHaveLength(1);
  });

  it('treats a 5xx from the refresh endpoint as transient', async () => {
    await signIn();
    route((url) => (url.pathname === '/auth/refresh' ? new Response('oops', { status: 500 }) : new Response('Unauthorized', { status: 401 })));
    const err = await client.request<never>('/api/me').catch(caught);
    expect(client.isUnreachable(err)).toBe(true);
    expect(client.needsReauth()).toBe(false);
    expect(client.listAccounts()).toHaveLength(1);
  });

  it('backs off after a transient refresh failure instead of hammering the endpoint', async () => {
    await signIn();
    route((url) => (url.pathname === '/auth/refresh' ? new Response('busy', { status: 503 }) : new Response('Unauthorized', { status: 401 })));
    await client.request('/api/me').catch(() => {});
    await client.request('/api/me').catch(() => {});
    expect(http.calls.filter((c) => c === 'POST /auth/refresh')).toHaveLength(1);
  });

  it('flags the account for signing in again when the refresh token is rejected, without forgetting it', async () => {
    await signIn();
    const lost = vi.fn();
    client.onAuthLost(lost);
    const id = client.getCredentials()!.id;
    route((url) => (url.pathname === '/auth/refresh' ? json({ error: 'Invalid refresh token' }, 401) : new Response('Unauthorized', { status: 401 })));
    const err = await client.request<never>('/api/me').catch(caught);
    expect(err).toBeInstanceOf(client.ApiError);
    expect(err.status).toBe(401);
    expect(client.isUnreachable(err)).toBe(false);
    expect(client.needsReauth()).toBe(true);
    expect(lost).toHaveBeenCalledWith(id);
    expect(client.getCredentials()?.id).toBe(id);
    expect(keychain.store.has(`account.${id}`)).toBe(true);
    // No more refresh attempts until the user signs in again.
    await client.request('/api/me').catch(() => {});
    expect(http.calls.filter((c) => c === 'POST /auth/refresh')).toHaveLength(1);
  });

  it('flags an API key account on a 401', async () => {
    route(() => json({ id: 'u1', username: 'reader', mediaProgress: [] }));
    await client.loginWithApiKey(SERVER, 'key');
    route(() => new Response('Unauthorized', { status: 401 }));
    await client.request('/api/me').catch(() => {});
    expect(client.needsReauth()).toBe(true);
    expect(http.calls).not.toContain('POST /auth/refresh');
  });

  it('signs the same account in again in place, keeping its id', async () => {
    await signIn();
    const id = client.getCredentials()!.id;
    route((url) => (url.pathname === '/auth/refresh' ? json({ error: 'Invalid refresh token' }, 401) : new Response('Unauthorized', { status: 401 })));
    await client.request('/api/me').catch(() => {});
    expect(client.needsReauth()).toBe(true);

    const tokens = vi.fn();
    client.onTokenChange(tokens);
    const changed = vi.fn();
    client.onAccountChanged(changed);
    const access = jwt('a3');
    route((url) => {
      if (url.pathname === '/login') return json({ user: { id: 'u1', username: 'reader', accessToken: access, refreshToken: jwt('r3') } });
      return json({ ok: true });
    });
    await client.reauthenticate(id, 'pw');
    expect(client.needsReauth()).toBe(false);
    expect(client.getCredentials()).toMatchObject({ id, accessToken: access });
    expect(client.listAccounts()).toHaveLength(1);
    expect(tokens).toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    await expect(client.request('/api/me')).resolves.toEqual({ ok: true });
  });

  it('refuses to sign an account in again as a different user', async () => {
    await signIn();
    const id = client.getCredentials()!.id;
    route(() => json({ user: { id: 'someone-else', username: 'reader', accessToken: jwt('x'), refreshToken: jwt('y') } }));
    await expect(client.reauthenticate(id, 'pw')).rejects.toThrow();
    expect(client.getCredentials()?.accessToken).not.toContain('someone-else');
  });

  it('updates the saved account when the same user signs in again from the login screen', async () => {
    await signIn('reader', 'u1');
    const id = client.getCredentials()!.id;
    await signIn('reader', 'u1', jwt('newer'));
    expect(client.listAccounts()).toHaveLength(1);
    expect(client.getCredentials()?.id).toBe(id);
  });
});

describe('timeouts and reachability', () => {
  it('gives up on a request that never answers and reports the server unreachable', async () => {
    await signIn();
    const reach = vi.fn();
    client.onReachabilityChange(reach);
    vi.useFakeTimers();
    route(() => new Promise<Response>(() => {}));
    const pending = client.request<never>('/api/me').catch(caught);
    await vi.advanceTimersByTimeAsync(client.DEFAULT_TIMEOUT_MS + 10);
    const err = await pending;
    expect(client.isUnreachable(err)).toBe(true);
    expect(err.message).toMatch(/didn't answer in time/);
    expect(reach).toHaveBeenCalledWith(false);
  });

  it('honours a longer timeout for big responses', async () => {
    await signIn();
    vi.useFakeTimers();
    let answer!: (r: Response) => void;
    route(() => new Promise<Response>((r) => (answer = r)));
    const pending = client.request('/api/libraries/x/items', { timeout: 45_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    answer(json({ results: [] }));
    await expect(pending).resolves.toEqual({ results: [] });
  });

  it("surfaces the caller's own abort as an AbortError, not as being offline", async () => {
    await signIn();
    const reach = vi.fn();
    client.onReachabilityChange(reach);
    route(() => new Promise<Response>(() => {}));
    const ctrl = new AbortController();
    const pending = client.request<never>('/api/search', { signal: ctrl.signal }).catch(caught);
    ctrl.abort();
    const err = await pending;
    expect(err.name).toBe('AbortError');
    expect(client.isUnreachable(err)).toBe(false);
    expect(reach).not.toHaveBeenCalled();
  });

  it.each([
    ['a proxy whose server is down', () => new Response('Bad Gateway', { status: 502 }), true],
    ['a proxy timing out', () => new Response('Gateway Timeout', { status: 504 }), true],
    ['a Cloudflare origin error', () => new Response('', { status: 522 }), true],
    ['a captive portal page', () => new Response('<html>Sign in to Wi-Fi</html>', { headers: { 'content-type': 'text/html' } }), true],
    ['garbled JSON', () => new Response('{"user":', { headers: { 'content-type': 'application/json' } }), true],
    ['a server error', () => new Response('boom', { status: 500 }), false],
    ['not found', () => new Response('Not Found', { status: 404 }), false]
  ])('classifies %s', async (_, respond, unreachable) => {
    await signIn();
    const reach = vi.fn();
    client.onReachabilityChange(reach);
    route(respond);
    const err = await client.request<never>('/api/me').catch(caught);
    expect(err).toBeInstanceOf(client.ApiError);
    expect(client.isUnreachable(err)).toBe(unreachable);
    expect(reach).toHaveBeenLastCalledWith(!unreachable);
  });

  it('reads plain-text answers as text', async () => {
    await signIn();
    route(() => new Response('OK', { headers: { 'content-type': 'text/plain' } }));
    await expect(client.request('/api/session/x/sync', { method: 'POST', body: {} })).resolves.toBe('OK');
  });

  it('describes certificate failures differently from unreachable hosts', async () => {
    await signIn();
    route(() => {
      throw new TypeError('invalid peer certificate: UnknownIssuer');
    });
    const tls = await client.request<never>('/api/me').catch(caught);
    expect(tls.message).toMatch(/certificate isn't trusted/);
    route(() => {
      throw new TypeError('error sending request for url');
    });
    const down = await client.request<never>('/api/me').catch(caught);
    expect(down.message).toMatch(/Can't reach/);
  });

  it('pings the server without credentials', async () => {
    await signIn();
    route((url, init) => {
      expect(init.headers).toBeUndefined();
      return url.pathname === '/ping' ? json({ success: true }) : new Response('', { status: 404 });
    });
    await expect(client.ping()).resolves.toBe(true);
    route(() => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    await expect(client.ping()).resolves.toBe(false);
  });

  it('estimates the server clock from Date headers', async () => {
    await signIn();
    const ahead = new Date(Date.now() + 5 * 60_000).toUTCString();
    route(() => json({}, 200, { date: ahead }));
    await client.request('/api/me');
    expect(client.clockSkew()).toBeGreaterThan(4 * 60_000);
    route(() => json({}, 200, { date: new Date().toUTCString() }));
    await client.request('/api/me');
    expect(client.clockSkew()).toBe(0);
  });
});

describe('keychain', () => {
  it('stores each account in its own entry, small enough for Windows', async () => {
    await signIn('reader', 'u1');
    await signIn('second', 'u2');
    expect(client.listAccounts()).toHaveLength(2);
    expect(toast).not.toHaveBeenCalled();
    for (const value of keychain.store.values()) expect(value.length * 2).toBeLessThanOrEqual(2560);
    // And all of it comes back on the next launch.
    const active = client.getCredentials()!.id;
    await fresh();
    expect(client.listAccounts().map((a) => a.username)).toEqual(['reader', 'second']);
    expect(client.getCredentials()?.id).toBe(active);
    expect(client.getCredentials()?.refreshToken).toBeTruthy();
  });

  it('migrates the old single-entry vault', async () => {
    const accounts = [
      { id: 'a', serverUrl: SERVER, method: 'password', accessToken: 'ta', refreshToken: 'ra', username: 'one', userId: 'u1' },
      { id: 'b', serverUrl: SERVER, method: 'apikey', accessToken: 'tb', refreshToken: null, username: 'two', userId: 'u2' }
    ];
    keychain.store.set('accounts', JSON.stringify({ active: 'b', accounts }));
    await fresh();
    expect(client.getCredentials()).toMatchObject({ id: 'b', accessToken: 'tb' });
    expect(client.listAccounts()).toEqual(accounts);
    expect(keychain.store.has('accounts')).toBe(false);
    expect(keychain.store.get('account.a.refresh')).toBe('ra');
    expect(JSON.parse(keychain.store.get('accounts.index')!)).toEqual({ active: 'b', ids: ['a', 'b'] });
    await fresh();
    expect(client.listAccounts()).toEqual(accounts);
  });

  it('keeps the old vault if the new entries cannot be written', async () => {
    keychain.store.set(
      'accounts',
      JSON.stringify({ active: 'a', accounts: [{ id: 'a', serverUrl: SERVER, method: 'apikey', accessToken: 't', refreshToken: null }] })
    );
    keychain.failWrites = true;
    await fresh();
    expect(client.getCredentials()?.id).toBe('a');
    expect(keychain.store.has('accounts')).toBe(true);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/keychain/), expect.objectContaining({ tone: 'error' }));
  });

  it('still migrates plaintext credentials from localStorage', async () => {
    localStorage.setItem('lectern.credentials', JSON.stringify({ serverUrl: SERVER, method: 'apikey', accessToken: 't', refreshToken: null, username: 'old' }));
    localStorage.setItem('lectern.lastPlayed', '{"itemId":"x"}');
    await fresh();
    const id = client.getCredentials()!.id;
    expect(client.getCredentials()?.username).toBe('old');
    expect(localStorage.getItem('lectern.credentials')).toBeNull();
    expect(localStorage.getItem(`lectern.lastPlayed.${id}`)).toBe('{"itemId":"x"}');
    expect(keychain.store.has(`account.${id}`)).toBe(true);
  });

  it('tells the user when saving to the keychain fails', async () => {
    keychain.failWrites = true;
    await signIn();
    expect(client.getCredentials()).not.toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/keychain/), expect.objectContaining({ tone: 'error' }));
  });

  it('forgets a signed-out account’s entries', async () => {
    await signIn('reader', 'u1');
    const id = client.getCredentials()!.id;
    route(() => new Response('', { status: 200 }));
    await client.logout();
    expect([...keychain.store.keys()].filter((k) => k.includes(id))).toEqual([]);
    expect(client.getCredentials()).toBeNull();
  });
});

describe('account changes', () => {
  it('lets the old account finish up before switching', async () => {
    await signIn('reader', 'u1');
    const first = client.getCredentials()!.id;
    await signIn('second', 'u2');
    const order: string[] = [];
    client.beforeAccountChange(() => void order.push(`before:${client.getCredentials()!.username}:${client.scopedKey('k')}`));
    client.onAccountChanged((next, prev) => void order.push(`changed:${prev?.username}->${next?.username}`));
    await client.switchAccount(first);
    expect(order).toEqual([`before:second:k.${client.listAccounts()[1].id}`, 'changed:second->reader']);
  });

  it('signs out under the old account, then moves to the next one', async () => {
    await signIn('reader', 'u1');
    await signIn('second', 'u2');
    const seen: (string | undefined)[] = [];
    client.beforeAccountChange(() => void seen.push(client.getCredentials()?.username));
    route(() => new Response('', { status: 200 }));
    const next = await client.logout();
    expect(seen).toEqual(['second']);
    expect(next?.username).toBe('reader');
    expect(client.listAccounts()).toHaveLength(1);
  });
});
