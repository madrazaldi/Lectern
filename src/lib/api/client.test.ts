// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

const http = vi.hoisted(() => ({ handler: null as null | ((url: URL, init: RequestInit) => Response | Promise<Response>), calls: [] as string[] }));
const keychain = vi.hoisted(() => ({ store: new Map<string, string>(), failWrites: false }));
const toast = vi.hoisted(() => vi.fn());

vi.mock('$lib/ipc', () => ({
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
  inApp: true,
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

describe('resolveServer', () => {
  const status = { app: 'audiobookshelf', serverVersion: '2.37.1', isInit: true, authMethods: ['local'] };

  it('falls back to plain HTTP when no scheme was typed and HTTPS has nobody answering', async () => {
    route((url) => {
      if (url.protocol === 'https:') throw new TypeError('connection refused');
      return json(status);
    });
    expect((await client.resolveServer('192.168.1.20:13378')).url).toBe('http://192.168.1.20:13378');
  });

  it('prefers HTTPS when it answers', async () => {
    route(() => json(status));
    expect((await client.resolveServer('abs.example.com/')).url).toBe('https://abs.example.com');
  });

  it('keeps an explicit scheme', async () => {
    route(() => {
      throw new TypeError('connection refused');
    });
    await expect(client.resolveServer('https://abs.example.com')).rejects.toThrow();
    expect(http.calls).toEqual(['GET /status']);
  });
});

describe('single sign-on', () => {
  const IDP = 'https://idp.example.com/authorize?client_id=abs';

  /** A redirect as the native HTTP plugin hands it over: Set-Cookie stays readable (the plugin rebuilds the headers). */
  function redirect(
    location: string,
    cookies: string[] = ['connect.sid=s%3Aabc.def; Path=/; HttpOnly', 'auth_method=openid-mobile; Max-Age=315360000; Path=/; HttpOnly']
  ) {
    const res = new Response('Found. Redirecting', { status: 302 });
    Object.defineProperty(res, 'headers', { value: new Headers([['location', location], ...cookies.map((c): [string, string] => ['set-cookie', c])]) });
    return res;
  }

  /** The server's side: allows the given redirect URIs, and finishes the sign-in for `user` when the cookie and verifier check out. */
  function ssoServer(opts: { allowed?: string[]; user?: Record<string, unknown> } = {}) {
    const allowed = opts.allowed ?? ['audiobookshelf://oauth'];
    const seen = { challenge: '', redirectUri: '', state: '', cookie: '', verifier: '', maxRedirections: undefined as unknown };
    route(async (url, init) => {
      if (url.pathname === '/auth/openid') {
        seen.maxRedirections = (init as { maxRedirections?: number }).maxRedirections;
        seen.redirectUri = url.searchParams.get('redirect_uri')!;
        if (!allowed.includes(seen.redirectUri)) return new Response('Invalid redirect_uri', { status: 400 });
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        seen.challenge = url.searchParams.get('code_challenge')!;
        seen.state = url.searchParams.get('state')!;
        return redirect(IDP);
      }
      if (url.pathname === '/auth/openid/callback') {
        seen.cookie = (init.headers as Record<string, string>).Cookie ?? '';
        seen.verifier = url.searchParams.get('code_verifier')!;
        if (!seen.cookie.includes('connect.sid=')) return new Response('No session', { status: 400 });
        if ((await client.pkceChallenge(seen.verifier)) !== seen.challenge || url.searchParams.get('state') !== seen.state) {
          return new Response('Unauthorized', { status: 401 });
        }
        const user = opts.user ?? { id: 'u1', username: 'reader' };
        return json({ user: { ...user, accessToken: jwt('sso-a'), refreshToken: jwt('sso-r'), mediaProgress: [] }, userDefaultLibraryId: 'lib' });
      }
      if (url.pathname === '/auth/refresh') return json({ user: { accessToken: jwt('sso-a2'), refreshToken: jwt('sso-r2') } });
      return new Response('', { status: 200 });
    });
    return seen;
  }

  async function ssoSignIn() {
    const pending = await client.beginOpenIdLogin(SERVER);
    await client.completeOpenIdLogin(pending, `audiobookshelf://oauth/?code=abc&state=${pending.state}`);
    http.calls = [];
    return pending;
  }

  it('makes PKCE challenges as RFC 7636 does', async () => {
    await expect(client.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const verifier = client.randomToken();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(client.randomToken()).not.toBe(verifier);
  });

  it('collects every cookie the server sets, with or without getSetCookie', () => {
    const headers = new Headers([
      ['set-cookie', 'connect.sid=s%3Aabc; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly'],
      ['set-cookie', 'auth_method=openid-mobile; Path=/']
    ]);
    expect(client.cookiesFrom(headers)).toBe('connect.sid=s%3Aabc; auth_method=openid-mobile');
    // Older webviews: one comma-joined value, with a comma inside the date.
    const joined = new Headers({ 'set-cookie': 'connect.sid=s%3Aabc; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly, auth_method=openid-mobile; Path=/' });
    Object.defineProperty(joined, 'getSetCookie', { value: undefined });
    expect(client.cookiesFrom(joined)).toBe('connect.sid=s%3Aabc; auth_method=openid-mobile');
    expect(client.cookiesFrom(new Headers())).toBe('');
  });

  it('starts with the server’s redirect, without following it, and keeps its cookies', async () => {
    const seen = ssoServer();
    const pending = await client.beginOpenIdLogin(SERVER);
    expect(seen.maxRedirections).toBe(0);
    expect(pending).toMatchObject({ serverUrl: SERVER, authorizeUrl: IDP, redirectUri: 'audiobookshelf://oauth', state: seen.state });
    expect(pending.cookie).toBe('connect.sid=s%3Aabc.def; auth_method=openid-mobile');
    await expect(client.pkceChallenge(pending.verifier)).resolves.toBe(seen.challenge);
  });

  it('falls back to lectern://oauth when the server doesn’t allow audiobookshelf://oauth', async () => {
    ssoServer({ allowed: ['lectern://oauth'] });
    const pending = await client.beginOpenIdLogin(SERVER);
    expect(pending.redirectUri).toBe('lectern://oauth');
    expect(http.calls).toEqual(['GET /auth/openid', 'GET /auth/openid']);
  });

  it('tells the user what to ask their admin when no redirect is allowed', async () => {
    ssoServer({ allowed: [] });
    const err = await client.beginOpenIdLogin(SERVER).then(() => null, caught);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/lectern:\/\/oauth.*Allowed Mobile Redirect URIs/);
  });

  describe('where links can come back', () => {
    const setPlatform = (platform: string | undefined) => {
      (window as unknown as { __lectern?: unknown }).__lectern = platform ? { files: '', platform } : undefined;
    };
    afterEach(() => setPlatform(undefined));

    it('on macOS offers the custom schemes, then the loopback address', () => {
      setPlatform('darwin');
      expect(client.openIdRedirectUris()).toEqual(['audiobookshelf://oauth', 'lectern://oauth', 'http://127.0.0.1:47017/oauth']);
    });

    it('on Windows and Linux only the loopback address can reach the app', async () => {
      setPlatform('win32');
      expect(client.openIdRedirectUris()).toEqual(['http://127.0.0.1:47017/oauth']);
      ssoServer({ allowed: ['http://127.0.0.1:47017/oauth'] });
      const pending = await client.beginOpenIdLogin(SERVER);
      expect(pending.redirectUri).toBe('http://127.0.0.1:47017/oauth');
    });

    it('reads the code from a loopback link, and ignores other pages on that machine', () => {
      const pending = { redirectUri: 'http://127.0.0.1:47017/oauth', state: 'st' };
      expect(client.parseOpenIdCallback(pending, 'http://127.0.0.1:47017/oauth?code=c1&state=st')).toBe('c1');
      expect(client.isOpenIdCallback(pending, 'http://127.0.0.1:8080/oauth?code=c1&state=st')).toBe(false);
    });

    it('asks the admin for the address that applies', async () => {
      setPlatform('linux');
      ssoServer({ allowed: [] });
      const err = await client.beginOpenIdLogin(SERVER).then(() => null, caught);
      expect(err!.message).toMatch(/add http:\/\/127\.0\.0\.1:47017\/oauth under Settings/);
    });
  });

  it('only opens web pages in the browser', async () => {
    route(() => redirect('file:///etc/passwd'));
    await expect(client.beginOpenIdLogin(SERVER)).rejects.toThrow(/couldn’t start single sign-on/);
    route(() => new Response('OpenID not configured', { status: 500 }));
    await expect(client.beginOpenIdLogin(SERVER)).rejects.toThrow(/couldn’t start single sign-on/);
  });

  it('reads the deep link the browser comes back with', () => {
    const pending = { redirectUri: 'audiobookshelf://oauth', state: 'st' };
    // ABS adds a trailing slash; accept it either way.
    expect(client.parseOpenIdCallback(pending, 'audiobookshelf://oauth/?code=c%2B1&state=st')).toBe('c+1');
    expect(client.parseOpenIdCallback(pending, 'audiobookshelf://oauth?code=c1&state=st')).toBe('c1');
    expect(client.isOpenIdCallback(pending, 'lectern://oauth/?code=c1&state=st')).toBe(false);
    expect(client.isOpenIdCallback({ redirectUri: 'lectern://oauth' }, 'lectern://oauth/?code=c1&state=st')).toBe(true);
    expect(client.isOpenIdCallback(pending, 'audiobookshelf://item/abc')).toBe(false);
    expect(() => client.parseOpenIdCallback(pending, 'audiobookshelf://oauth/?code=c1&state=other')).toThrow(/earlier attempt/);
    expect(() => client.parseOpenIdCallback(pending, 'audiobookshelf://oauth/?code=c1')).toThrow(/earlier attempt/);
    // The identity provider said no: ABS passes that on as code=undefined.
    expect(() => client.parseOpenIdCallback(pending, 'audiobookshelf://oauth/?code=undefined&state=st')).toThrow(/didn’t complete/);
    expect(() => client.parseOpenIdCallback(pending, 'audiobookshelf://oauth/?state=st')).toThrow(/didn’t complete/);
  });

  it('finishes with the session cookie and verifier, and saves a refreshable account', async () => {
    const seen = ssoServer();
    const pending = await client.beginOpenIdLogin(SERVER);
    const data = await client.completeOpenIdLogin(pending, `audiobookshelf://oauth/?code=abc&state=${pending.state}`);
    expect(data.userDefaultLibraryId).toBe('lib');
    expect(seen.cookie).toBe(pending.cookie);
    expect(seen.verifier).toBe(pending.verifier);
    const account = client.getCredentials()!;
    expect(account).toMatchObject({ serverUrl: SERVER, method: 'openid', username: 'reader', userId: 'u1' });
    expect(account.refreshToken).toBeTruthy();
    // Renews like a password account when the access token runs out.
    const fresher = jwt('sso-a2');
    http.calls = [];
    route((url, init) => {
      if (url.pathname === '/auth/refresh') return json({ user: { accessToken: fresher, refreshToken: jwt('sso-r2') } });
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === `Bearer ${fresher}` ? json({ ok: true }) : new Response('Unauthorized', { status: 401 });
    });
    await expect(client.request('/api/me')).resolves.toEqual({ ok: true });
    expect(http.calls).toEqual(['GET /api/me', 'POST /auth/refresh', 'GET /api/me']);
    // And the account comes back next launch.
    await fresh();
    expect(client.getCredentials()).toMatchObject({ method: 'openid', userId: 'u1' });
  });

  it('refuses a callback for another sign-in without asking the server', async () => {
    ssoServer();
    const pending = await client.beginOpenIdLogin(SERVER);
    http.calls = [];
    await expect(client.completeOpenIdLogin(pending, 'audiobookshelf://oauth/?code=abc&state=forged')).rejects.toThrow(/earlier attempt/);
    expect(http.calls).toEqual([]);
    expect(client.getCredentials()).toBeNull();
  });

  it('explains a lost session', async () => {
    ssoServer();
    const pending = await client.beginOpenIdLogin(SERVER);
    await expect(client.completeOpenIdLogin({ ...pending, cookie: '' }, `audiobookshelf://oauth/?code=abc&state=${pending.state}`)).rejects.toThrow(
      /took too long or the server restarted/
    );
  });

  it('reuses the saved account for the same server and user', async () => {
    await signIn('reader', 'u1');
    const id = client.getCredentials()!.id;
    ssoServer({ user: { id: 'u1', username: 'reader' } });
    await ssoSignIn();
    expect(client.listAccounts()).toHaveLength(1);
    expect(client.getCredentials()).toMatchObject({ id, method: 'openid' });
  });

  it('signs an SSO account in again in place', async () => {
    ssoServer();
    await ssoSignIn();
    const id = client.getCredentials()!.id;
    route((url) => (url.pathname === '/auth/refresh' ? json({ error: 'Invalid refresh token' }, 401) : new Response('Unauthorized', { status: 401 })));
    await client.request('/api/me').catch(() => {});
    expect(client.needsReauth()).toBe(true);
    // A password won't do for this account.
    await expect(client.reauthenticate(id, 'pw')).rejects.toThrow(/single sign-on/);

    ssoServer();
    const changed = vi.fn();
    client.onAccountChanged(changed);
    const pending = await client.beginOpenIdLogin(SERVER);
    await client.reauthenticateWithOpenId(id, pending, `audiobookshelf://oauth/?code=abc&state=${pending.state}`);
    expect(client.needsReauth()).toBe(false);
    expect(client.getCredentials()).toMatchObject({ id, method: 'openid' });
    expect(changed).not.toHaveBeenCalled();
  });

  it('refuses to sign an SSO account in again as someone else', async () => {
    ssoServer();
    await ssoSignIn();
    const id = client.getCredentials()!.id;
    const before = client.getCredentials()!.accessToken;
    ssoServer({ user: { id: 'u2', username: 'other' } });
    const pending = await client.beginOpenIdLogin(SERVER);
    await expect(client.reauthenticateWithOpenId(id, pending, `audiobookshelf://oauth/?code=abc&state=${pending.state}`)).rejects.toThrow(/as other/);
    expect(client.getCredentials()?.accessToken).toBe(before);
  });

  it('ends the server session on sign-out', async () => {
    ssoServer();
    await ssoSignIn();
    await client.logout();
    expect(http.calls).toEqual(['POST /logout']);
  });
});

describe('binary responses', () => {
  it('returns the body as bytes, sending the token as a header and renewing it on a 401', async () => {
    await signIn();
    let refreshed = false;
    route((url, init) => {
      if (url.pathname === '/auth/refresh') {
        refreshed = true;
        return json({ user: { id: 'u1', accessToken: jwt('a2'), refreshToken: jwt('r2') } });
      }
      const auth = new Headers(init.headers).get('authorization') ?? '';
      if (!refreshed) return new Response('Unauthorized', { status: 401 });
      expect(url.searchParams.has('token')).toBe(false);
      expect(auth).toMatch(/^Bearer /);
      return new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { headers: { 'content-type': 'application/epub+zip' } });
    });
    const bytes = await client.request<ArrayBuffer>('/api/items/i1/ebook', { bytes: true });
    expect(Array.from(new Uint8Array(bytes))).toEqual([0x50, 0x4b, 3, 4]);
  });

  it('still reports errors as text', async () => {
    await signIn();
    route(() => new Response('No ebook', { status: 404 }));
    const err = caught(await client.request('/api/items/i1/ebook', { bytes: true }).catch((e) => e));
    expect(err.status).toBe(404);
    expect(err.message).toBe('No ebook');
  });
});
