import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { inTauri, secrets } from '$lib/native';
import { toast } from '$lib/stores/toast.svelte';
import type { User } from './types';

// Requests go through the Rust HTTP client: Audiobookshelf answers CORS preflights
// with 401, so the webview's own fetch can't reach most servers.
// In a plain browser (vite dev without Tauri), the dev server relays requests instead; see vite.config.js.
const httpFetch: typeof fetch = inTauri ? (tauriFetch as typeof fetch) : (input, init) => fetch(`/__abs_proxy?url=${encodeURIComponent(String(input))}`, init);

export type AuthMethod = 'password' | 'apikey' | 'openid';

/** Signed in with a session that renews itself with a refresh token (as opposed to an API key). */
const usesRefreshToken = (method: AuthMethod) => method === 'password' || method === 'openid';

export interface Credentials {
  serverUrl: string;
  method: AuthMethod;
  accessToken: string;
  refreshToken: string | null;
  username?: string;
}

export interface Account extends Credentials {
  id: string;
  userId?: string;
}

interface Vault {
  active: string | null;
  accounts: Account[];
}

// Keychain layout: a small index, plus one entry per account and one for its refresh token. Windows Credential
// Manager caps an entry at 2560 bytes of UTF-16, which a single blob holding every account outgrew at two accounts.
const INDEX_KEY = 'accounts.index';
const accountKey = (id: string) => `account.${id}`;
const refreshKey = (id: string) => `account.${id}.refresh`;
/** Pre-index format: every account in one entry. Migrated on launch. */
const VAULT_KEY = 'accounts';
/** Plaintext localStorage copy from before the keychain. Migrated on launch. */
const LEGACY_KEY = 'lectern.credentials';

export const DEFAULT_TIMEOUT_MS = 15_000;
/** For responses that grow with the library (item lists, the user with all their progress). */
export const LONG_TIMEOUT_MS = 45_000;
/** Answers a reverse proxy gives when the server behind it is down. */
const PROXY_DOWN = new Set([502, 503, 504, 511, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530]);
/** After failing to renew a token for a transient reason, wait this long before trying again (the endpoint is rate-limited). */
const REFRESH_BACKOFF_MS = 15_000;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The server couldn't be reached at all (or something other than the server answered): run offline. */
    public unreachable = status === 0
  ) {
    super(message);
  }
}

/** The request never got a real answer from the server: no connection, a timeout, a proxy with the server down, or a captive portal. */
export function isUnreachable(err: unknown): boolean {
  return err instanceof ApiError && err.unreachable;
}

/** The server no longer accepts this account's sign-in. */
export function isAuthLost(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

let vault: Vault = { active: null, accounts: [] };
let creds: Account | null = null;
/** Keychain entries as last read or written, so a save only touches what changed. */
const stored = new Map<string, string>();
let saving: Promise<boolean> = Promise.resolve(true);
let refreshing: Promise<RefreshResult> | null = null;
let refreshRetryAt = 0;
/** Accounts whose refresh token (or API key) the server rejected. Kept until the user signs in again. */
const authLost = new Set<string>();
/** Server clock minus ours, from response Date headers. */
let skew = 0;

let onReachability: ((online: boolean) => void) | null = null;
const authLostListeners = new Set<(accountId: string) => void>();
const beforeChangeListeners = new Set<() => unknown>();
const changeListeners = new Set<(next: Account | null, prev: Account | null) => void>();
const tokenListeners = new Set<() => void>();

/** Load accounts from the keychain. Call once before anything else touches the API. */
export async function initCredentials() {
  vault = { active: null, accounts: [] };
  stored.clear();
  let migrateFrom: string | null = null;
  try {
    const index = await secrets.get(INDEX_KEY);
    if (index) {
      stored.set(INDEX_KEY, index);
      const { active, ids } = JSON.parse(index) as { active: string | null; ids: string[] };
      for (const id of ids) {
        const raw = await secrets.get(accountKey(id));
        if (!raw) continue;
        stored.set(accountKey(id), raw);
        const refresh = await secrets.get(refreshKey(id));
        if (refresh) stored.set(refreshKey(id), refresh);
        vault.accounts.push({ ...(JSON.parse(raw) as Omit<Account, 'refreshToken'>), id, refreshToken: refresh || null });
      }
      vault.active = active;
    } else {
      const single = await secrets.get(VAULT_KEY);
      if (single) {
        vault = JSON.parse(single) as Vault;
        migrateFrom = VAULT_KEY;
      }
    }
  } catch (err) {
    console.error('Could not read saved accounts', err);
    vault = { active: null, accounts: [] };
  }
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      const old = JSON.parse(legacy) as Credentials;
      if (!vault.accounts.some((a) => a.serverUrl === old.serverUrl && a.username === old.username)) {
        const id = crypto.randomUUID();
        vault.accounts.push({ ...old, id });
        vault.active ??= id;
        migrateScopedKeys(id);
      }
      migrateFrom ??= LEGACY_KEY;
    } catch {
      // Unreadable leftovers: drop them rather than keep a plaintext token around.
      localStorage.removeItem(LEGACY_KEY);
    }
  }
  if (migrateFrom && (await persist())) {
    // Only forget the old copies once the new entries are safely written.
    if (migrateFrom === VAULT_KEY) await secrets.delete(VAULT_KEY).catch(() => {});
    localStorage.removeItem(LEGACY_KEY);
  }
  creds = vault.accounts.find((a) => a.id === vault.active) ?? vault.accounts[0] ?? null;
}

/** Keys written before accounts existed move under the migrated account's namespace. */
function migrateScopedKeys(id: string) {
  for (const key of ['lectern.library', 'lectern.lastPlayed']) {
    const v = localStorage.getItem(key);
    if (v !== null) {
      localStorage.setItem(`${key}.${id}`, v);
      localStorage.removeItem(key);
    }
  }
}

async function writeVault() {
  const want = new Map<string, string>();
  for (const { refreshToken, ...rest } of vault.accounts) {
    want.set(accountKey(rest.id), JSON.stringify(rest));
    if (refreshToken) want.set(refreshKey(rest.id), refreshToken);
  }
  // Accounts before the index, so the index never names an entry that isn't there yet.
  for (const [key, value] of want) {
    if (stored.get(key) === value) continue;
    await secrets.set(key, value);
    stored.set(key, value);
  }
  const index = JSON.stringify({ active: vault.active, ids: vault.accounts.map((a) => a.id) });
  if (stored.get(INDEX_KEY) !== index) {
    await secrets.set(INDEX_KEY, index);
    stored.set(INDEX_KEY, index);
  }
  for (const key of [...stored.keys()]) {
    if (key === INDEX_KEY || want.has(key)) continue;
    await secrets.delete(key);
    stored.delete(key);
  }
}

/** Write accounts to the keychain. Resolves false (after telling the user) if that failed. */
function persist(): Promise<boolean> {
  saving = saving.then(() =>
    writeVault().then(
      () => true,
      (err) => {
        console.error('Could not save credentials', err);
        toast(`Couldn't save your sign-in to the system keychain, so you may have to sign in again next time. ${String(err)}`, {
          tone: 'error',
          ms: 10_000
        });
        return false;
      }
    )
  );
  return saving;
}

function updateAccount(id: string, patch: Partial<Account>) {
  vault.accounts = vault.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a));
  if (creds?.id === id) creds = vault.accounts.find((a) => a.id === id) ?? null;
  return persist();
}

export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

export function getCredentials() {
  return creds;
}

export function listAccounts(): Account[] {
  return vault.accounts;
}

/** Whether this account (by default the signed-in one) has to sign in again before the server will talk to it. */
export function needsReauth(id = creds?.id) {
  return !!id && authLost.has(id);
}

/** localStorage key namespaced to the signed-in account, for per-account state (library choice, queue, etc.). */
export function scopedKey(key: string) {
  return creds ? `${key}.${creds.id}` : key;
}

/**
 * Make another account (or none) the active one. Listeners registered with `beforeAccountChange` run first, while
 * requests and scoped keys still belong to the old account, so the player can save and close under it.
 */
async function activate(next: Account | null, prepared = false) {
  const prev = creds;
  const changing = prev?.id !== next?.id;
  if (changing && !prepared) await runBeforeChange();
  creds = next;
  vault.active = next?.id ?? null;
  await persist();
  if (changing) for (const fn of changeListeners) fn(next, prev);
}

async function runBeforeChange() {
  for (const fn of beforeChangeListeners) {
    try {
      await fn();
    } catch (err) {
      console.error(err);
    }
  }
}

export async function switchAccount(id: string) {
  const next = vault.accounts.find((a) => a.id === id);
  if (next) await activate(next);
}

function sameUser(a: Omit<Account, 'id'>, b: Omit<Account, 'id'>) {
  if (a.serverUrl !== b.serverUrl) return false;
  return a.userId && b.userId ? a.userId === b.userId : a.username === b.username;
}

/** Add an account, or update the saved one for the same server and user (keeping its id, so its downloads and pending progress stay attached). */
async function addAccount(next: Omit<Account, 'id'>) {
  const existing = vault.accounts.find((a) => sameUser(a, next));
  const account: Account = { ...next, id: existing?.id ?? crypto.randomUUID() };
  vault.accounts = existing ? vault.accounts.map((a) => (a.id === existing.id ? account : a)) : [...vault.accounts, account];
  authLost.delete(account.id);
  refreshRetryAt = 0;
  if (creds?.id === account.id) {
    creds = account;
    await persist();
    for (const fn of tokenListeners) fn();
  } else {
    await activate(account);
  }
}

/** Told when the server stops accepting an account's sign-in. The account and its data stay; see `reauthenticate`. */
export function onAuthLost(fn: (accountId: string) => void) {
  authLostListeners.add(fn);
  return () => void authLostListeners.delete(fn);
}

/** Run (and await) before the active account changes, while the old one is still active. */
export function beforeAccountChange(fn: () => unknown) {
  beforeChangeListeners.add(fn);
  return () => void beforeChangeListeners.delete(fn);
}

/** Told after the active account changed (sign in, switch, sign out). Per-account state should reload. */
export function onAccountChanged(fn: (next: Account | null, prev: Account | null) => void) {
  changeListeners.add(fn);
  return () => void changeListeners.delete(fn);
}

/** Told when the active account's tokens change (refreshed, or signed in again). */
export function onTokenChange(fn: () => void) {
  tokenListeners.add(fn);
  return () => void tokenListeners.delete(fn);
}

/** Told whenever a request reaches the server (true) or fails to (false). */
export function onReachabilityChange(fn: (online: boolean) => void) {
  onReachability = fn;
}

export function serverUrl() {
  return creds?.serverUrl ?? '';
}

export function token() {
  return creds?.accessToken ?? '';
}

export function authHeaders(): Record<string, string> {
  return creds ? { Authorization: `Bearer ${creds.accessToken}` } : {};
}

/** Our best guess at the server's clock, for comparing our timestamps with the ones it sends. */
export function serverNow() {
  return Date.now() + skew;
}

/** Server clock minus ours, in ms (0 when they agree to within the Date header's one-second resolution). */
export function clockSkew() {
  return skew;
}

function noteServerDate(date: string | null, sentAt: number) {
  const server = date ? Date.parse(date) : NaN;
  if (Number.isNaN(server)) return;
  // The header is truncated to the second: assume the middle of it, against the middle of our round trip.
  const offset = server + 500 - (sentAt + Date.now()) / 2;
  skew = Math.abs(offset) < 2000 ? 0 : Math.round(offset);
}

/** Absolute URL for a server path, with the access token attached for media the webview loads directly. */
export function mediaUrl(path: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(serverUrl() + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  url.searchParams.set('token', token());
  return url.toString();
}

function publicUrl(path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(serverUrl() + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  return url.toString();
}

// Covers and author portraits are served without auth, so keep tokens out of those URLs.
export function coverUrl(itemId: string, width = 400, updatedAt?: number) {
  return publicUrl(`/api/items/${itemId}/cover`, { width, ts: updatedAt });
}

export function authorImageUrl(authorId: string, width = 300, updatedAt?: number) {
  return publicUrl(`/api/authors/${authorId}/image`, { width, ts: updatedAt });
}

class Timeout extends Error {}

function abortError() {
  return new DOMException('The request was aborted.', 'AbortError');
}

/**
 * fetch with a deadline covering the whole exchange, body included. The caller's own abort surfaces as an
 * AbortError; anything else that goes wrong (including the deadline) is left for `unreachableError` to describe.
 */
async function timedFetch<T>(url: string, init: RequestInit & { timeout?: number; maxRedirections?: number }, read: (res: Response) => Promise<T>): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT_MS, signal: outer, ...rest } = init;
  if (outer?.aborted) throw abortError();
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeout);
  const forward = () => ctrl.abort();
  outer?.addEventListener('abort', forward, { once: true });
  // Don't rely on the fetch implementation rejecting promptly on abort (the native one may be mid-body).
  const aborted = new Promise<never>((_, reject) => ctrl.signal.addEventListener('abort', () => reject(abortError()), { once: true }));
  try {
    return await Promise.race([httpFetch(url, { ...rest, signal: ctrl.signal }).then(read), aborted]);
  } catch (err) {
    if (outer?.aborted) throw abortError();
    if (timedOut) throw new Timeout();
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', forward);
  }
}

/** Turn a failure to get any answer into a message that says what likely went wrong. */
function unreachableError(err: unknown, server: string, otherwise = `Can't reach ${server}. Check your connection or the server address.`) {
  if (err instanceof ApiError) return err;
  if (err instanceof Timeout) return new ApiError(0, `${server} didn't answer in time. Check your connection or the server.`);
  if (/certificate|UnknownIssuer|self[- ]signed|CERT_|x509|tls|ssl|handshake/i.test(String(err))) {
    return new ApiError(
      0,
      `The server's certificate isn't trusted by this computer. If ${server} uses its own certificate authority, add it to your system's trusted certificates.`
    );
  }
  return new ApiError(0, otherwise);
}

interface Raw {
  status: number;
  statusText: string;
  type: string;
  body: string;
  /** A successful answer's body, for `bytes` requests. */
  bytes?: ArrayBuffer;
}

const readRaw = async (res: Response): Promise<Raw> => ({
  status: res.status,
  statusText: res.statusText,
  type: res.headers.get('content-type') ?? '',
  body: await res.text()
});

/** Whether a response came from something other than the server: a proxy whose upstream is down, or a captive portal's page. */
function foreignAnswer(raw: Raw, server: string): ApiError | null {
  if (PROXY_DOWN.has(raw.status)) return new ApiError(raw.status, `${server} isn't answering right now (${raw.status}).`, true);
  if (raw.status >= 200 && raw.status < 300 && raw.type.includes('text/html')) {
    return new ApiError(0, `Something other than your server answered at ${server}. If you're on public Wi-Fi, you may need to sign in to it first.`);
  }
  return null;
}

type RefreshResult = 'ok' | 'rejected' | 'unreachable' | 'unavailable';

/**
 * Renew the access token. Only an explicit 401/403 from /auth/refresh means the sign-in is gone; anything else
 * (no connection, a timeout, a 5xx, rate limiting) is transient and leaves the account as it is.
 */
async function refreshAccessToken(): Promise<RefreshResult> {
  const account = creds;
  if (!account) return 'unavailable';
  if (authLost.has(account.id)) return 'rejected';
  if (!usesRefreshToken(account.method) || !account.refreshToken) return 'unavailable';
  if (Date.now() < refreshRetryAt) return 'unreachable';
  refreshing ??= (async (): Promise<RefreshResult> => {
    let raw: Raw;
    try {
      raw = await timedFetch(`${account.serverUrl}/auth/refresh`, { method: 'POST', headers: { 'x-refresh-token': account.refreshToken! } }, readRaw);
    } catch {
      refreshRetryAt = Date.now() + REFRESH_BACKOFF_MS;
      return 'unreachable';
    }
    if (raw.status === 401 || raw.status === 403) {
      markAuthLost(account.id);
      return 'rejected';
    }
    let user: User | null = null;
    try {
      user = raw.status >= 200 && raw.status < 300 ? (JSON.parse(raw.body) as { user: User }).user : null;
    } catch {
      // Not JSON: a portal or proxy page.
    }
    const accessToken = user?.accessToken ?? user?.token;
    if (!user || !accessToken) {
      refreshRetryAt = Date.now() + REFRESH_BACKOFF_MS;
      return 'unreachable';
    }
    await updateAccount(account.id, { accessToken, refreshToken: user.refreshToken ?? account.refreshToken });
    if (creds?.id === account.id) for (const fn of tokenListeners) fn();
    return 'ok';
  })().finally(() => (refreshing = null));
  return refreshing;
}

function markAuthLost(id: string) {
  if (authLost.has(id)) return;
  authLost.add(id);
  for (const fn of authLostListeners) fn(id);
}

function jwtExpiry(jwt: string): number | null {
  try {
    const [, payload] = jwt.split('.');
    const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Ask for a fresh access token now if it's about to expire (or `force`), e.g. before handing a stream URL to the audio element. */
export async function ensureFreshToken(force = false) {
  if (!creds || !usesRefreshToken(creds.method)) return;
  const exp = jwtExpiry(creds.accessToken);
  // Not a JWT we can read: the 401 path still covers it.
  if (force || (exp !== null && exp - Date.now() < 5 * 60_000)) await refreshAccessToken();
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** Milliseconds before giving up and treating the server as unreachable. */
  timeout?: number;
  /** Resolve with the body as an ArrayBuffer (e.g. an ebook) instead of parsed JSON or text. */
  bytes?: boolean;
}

export async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const account = creds;
  if (!account) throw new ApiError(401, 'Not signed in');
  const url = new URL(account.serverUrl + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const used = account.accessToken;
  const headers: Record<string, string> = { Authorization: `Bearer ${used}` };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const sentAt = Date.now();
  let raw: Raw;
  try {
    raw = await timedFetch(
      url.toString(),
      {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
        timeout: opts.timeout
      },
      async (res) => {
        noteServerDate(res.headers.get('date'), sentAt);
        if (opts.bytes && res.ok && !res.headers.get('content-type')?.includes('text/html')) {
          return { status: res.status, statusText: res.statusText, type: res.headers.get('content-type') ?? '', body: '', bytes: await res.arrayBuffer() };
        }
        return readRaw(res);
      }
    );
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    onReachability?.(false);
    throw unreachableError(err, account.serverUrl);
  }
  const foreign = foreignAnswer(raw, account.serverUrl);
  if (foreign) {
    onReachability?.(false);
    throw foreign;
  }
  onReachability?.(true);

  if (raw.status === 401) {
    if (!retried) {
      // Another request renewed the token while this one was out: just try again with it.
      if (creds?.id === account.id && creds.accessToken !== used) return request<T>(path, opts, true);
      const refreshed = await refreshAccessToken();
      if (refreshed === 'ok') return request<T>(path, opts, true);
      if (refreshed === 'unreachable') {
        onReachability?.(false);
        throw new ApiError(0, `Couldn't renew your sign-in with ${account.serverUrl}. Lectern will keep trying.`);
      }
    }
    markAuthLost(account.id);
    throw new ApiError(401, 'Your session ended. Sign in again to continue.');
  }
  if (raw.status < 200 || raw.status >= 300) throw new ApiError(raw.status, raw.body || `${raw.status} ${raw.statusText}`);
  if (raw.bytes) return raw.bytes as T;
  if (raw.type.includes('application/json')) {
    try {
      return JSON.parse(raw.body) as T;
    } catch {
      onReachability?.(false);
      throw new ApiError(0, `${account.serverUrl} sent a garbled answer. Check your connection.`);
    }
  }
  return raw.body as unknown as T;
}

/** Fetch raw bytes through the native client (used to sample cover colors without tainting a canvas). */
export async function fetchBlob(url: string): Promise<Blob> {
  return timedFetch(url, { timeout: 20_000 }, async (res) => {
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return res.blob();
  });
}

/** Whether the signed-in account's server answers at all. Cheap and unauthenticated, for polling while offline. */
export async function ping(): Promise<boolean> {
  const server = creds?.serverUrl;
  if (!server) return false;
  try {
    const raw = await timedFetch(`${server}/ping`, { timeout: 8000 }, readRaw);
    return raw.status === 200 && (JSON.parse(raw.body) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}

export interface ServerStatus {
  app: string;
  serverVersion: string;
  isInit: boolean;
  authMethods: string[];
  authFormData?: {
    authLoginCustomMessage?: string;
    authOpenIDButtonText?: string;
    authOpenIDAutoLaunch?: boolean;
  };
}

export async function probeServer(serverUrl: string): Promise<ServerStatus> {
  let raw: Raw;
  try {
    raw = await timedFetch(`${serverUrl}/status`, { timeout: 10_000 }, readRaw);
  } catch (err) {
    throw unreachableError(err, serverUrl, `Nothing answered at ${serverUrl}. Check the address and that the server is running.`);
  }
  if (raw.status < 200 || raw.status >= 300) throw new ApiError(raw.status, `${serverUrl} answered with ${raw.status}. Is this an Audiobookshelf server?`);
  let data: ServerStatus | null = null;
  try {
    data = JSON.parse(raw.body) as ServerStatus;
  } catch {
    // Handled below.
  }
  if (data?.app !== 'audiobookshelf') throw new ApiError(0, `${serverUrl} isn't an Audiobookshelf server.`);
  return data;
}

/**
 * Find the server behind what the user typed. Without a scheme, try HTTPS first and fall back to plain HTTP, since most
 * servers on a home network (e.g. `192.168.1.20:13378`) only speak HTTP.
 */
export async function resolveServer(input: string): Promise<{ url: string; status: ServerStatus }> {
  const url = normalizeServerUrl(input);
  try {
    return { url, status: await probeServer(url) };
  } catch (err) {
    if (/^https?:\/\//i.test(input.trim())) throw err;
    const plain = url.replace(/^https:/i, 'http:');
    const status = await probeServer(plain).catch(() => null);
    if (status) return { url: plain, status };
    throw err;
  }
}

async function passwordSignIn(serverUrl: string, username: string, password: string) {
  let raw: Raw;
  try {
    raw = await timedFetch(
      `${serverUrl}/login`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-return-tokens': 'true' }, body: JSON.stringify({ username, password }) },
      readRaw
    );
  } catch (err) {
    throw unreachableError(err, serverUrl);
  }
  if (raw.status === 401) throw new ApiError(401, 'That username and password combination didn’t work.');
  if (raw.status === 429) throw new ApiError(429, 'Too many sign-in attempts. Wait a minute and try again.');
  if (raw.status < 200 || raw.status >= 300) throw new ApiError(raw.status, `Sign-in failed (${raw.status}).`);
  let data: { user: User; userDefaultLibraryId?: string };
  try {
    data = JSON.parse(raw.body);
  } catch {
    throw new ApiError(0, `${serverUrl} didn't answer like an Audiobookshelf server.`);
  }
  const accessToken = data.user.accessToken ?? data.user.token;
  if (!accessToken) throw new ApiError(0, 'The server didn’t return a token.');
  const account: Omit<Account, 'id'> = {
    serverUrl,
    method: 'password',
    accessToken,
    refreshToken: data.user.refreshToken ?? null,
    username: data.user.username,
    userId: data.user.id
  };
  return { data, account };
}

async function apiKeySignIn(serverUrl: string, apiKey: string) {
  const key = apiKey.trim();
  let raw: Raw;
  try {
    raw = await timedFetch(`${serverUrl}/api/me`, { headers: { Authorization: `Bearer ${key}` }, timeout: LONG_TIMEOUT_MS }, readRaw);
  } catch (err) {
    throw unreachableError(err, serverUrl);
  }
  if (raw.status === 401) throw new ApiError(401, 'The server didn’t accept that API key.');
  if (raw.status < 200 || raw.status >= 300) throw new ApiError(raw.status, `Sign-in failed (${raw.status}).`);
  let user: User;
  try {
    user = JSON.parse(raw.body);
  } catch {
    throw new ApiError(0, `${serverUrl} didn't answer like an Audiobookshelf server.`);
  }
  const account: Omit<Account, 'id'> = { serverUrl, method: 'apikey', accessToken: key, refreshToken: null, username: user.username, userId: user.id };
  return { user, account };
}

export async function loginWithPassword(serverUrl: string, username: string, password: string) {
  const { data, account } = await passwordSignIn(serverUrl, username, password);
  await addAccount(account);
  return data;
}

export async function loginWithApiKey(serverUrl: string, apiKey: string) {
  const { user, account } = await apiKeySignIn(serverUrl, apiKey);
  await addAccount(account);
  return user;
}

/**
 * Sign a saved account in again after the server stopped accepting it, with its password (or a new API key for
 * key accounts). The account keeps its id, so its downloads, queue and pending progress stay attached.
 */
export async function reauthenticate(accountId: string, secret: string): Promise<Account> {
  const account = vault.accounts.find((a) => a.id === accountId);
  if (!account) throw new ApiError(0, 'That account is no longer saved.');
  if (account.method === 'openid') throw new ApiError(0, 'This account signs in through your browser. Use single sign-on.');
  const { account: fresh } =
    account.method === 'password' ? await passwordSignIn(account.serverUrl, account.username ?? '', secret) : await apiKeySignIn(account.serverUrl, secret);
  if (!sameUser(account, fresh)) throw new ApiError(0, `That key belongs to a different user. Use one for ${account.username ?? 'this account'}.`);
  return signedInAgain(accountId, fresh);
}

async function signedInAgain(accountId: string, fresh: Omit<Account, 'id'>) {
  authLost.delete(accountId);
  refreshRetryAt = 0;
  await updateAccount(accountId, { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, username: fresh.username, userId: fresh.userId });
  if (creds?.id === accountId) for (const fn of tokenListeners) fn();
  return vault.accounts.find((a) => a.id === accountId)!;
}

// --- Single sign-on (OpenID Connect) ---
// Audiobookshelf's flow for apps: we start it from our own HTTP client (keeping the session cookie it sets), the user
// signs in at their identity provider in the browser, and the server hands the result back to us through a deep link.

/**
 * Where the server sends the browser back to. `audiobookshelf://oauth` is allowed by default on every server (it's the
 * mobile app's); `lectern://oauth` is for servers whose admin removed that or prefers to name us.
 */
export const OPENID_REDIRECT_URIS = ['audiobookshelf://oauth', 'lectern://oauth'] as const;

/** A sign-on waiting for the browser. Holds secrets: keep it in memory only. */
export interface OpenIdPending {
  serverUrl: string;
  /** The identity provider's sign-in page, to open in the browser. */
  authorizeUrl: string;
  redirectUri: string;
  state: string;
  /** PKCE code verifier: proves to the server that whoever finishes the sign-in also started it. */
  verifier: string;
  /** The server's cookies from the start of the flow; finishing without them fails with "No session". */
  cookie: string;
}

function base64url(bytes: Uint8Array) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** URL-safe random string with `bytes` of entropy (32 bytes makes a 43-character PKCE verifier). */
export function randomToken(bytes = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256 challenge for a verifier. */
export async function pkceChallenge(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** The cookies a response sets, as a `Cookie` header value to send back. */
export function cookiesFrom(headers: Headers) {
  // Older webviews lack getSetCookie(); there the values arrive joined with commas, which also appear inside Expires dates.
  const lines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : (headers.get('set-cookie')?.split(/,(?=\s*[^;,=\s]+=)/) ?? []);
  return lines
    .map((line) => line.split(';')[0].trim())
    .filter((pair) => pair.indexOf('=') > 0)
    .join('; ');
}

/** Whether a deep link is the server sending a sign-on back to us (as opposed to some other link). */
export function isOpenIdCallback(pending: Pick<OpenIdPending, 'redirectUri'>, link: string) {
  try {
    const url = new URL(link);
    const expected = new URL(pending.redirectUri);
    return url.protocol === expected.protocol && url.host === expected.host;
  } catch {
    return false;
  }
}

/** The authorization code from the deep link that ends a sign-on, after checking it belongs to this one. */
export function parseOpenIdCallback(pending: Pick<OpenIdPending, 'redirectUri' | 'state'>, link: string) {
  if (!isOpenIdCallback(pending, link)) throw new ApiError(0, 'That link isn’t a sign-in from your server.');
  // ABS adds a trailing slash (audiobookshelf://oauth/?code=…); the query is all that matters.
  const params = new URL(link).searchParams;
  if (params.get('state') !== pending.state) {
    throw new ApiError(0, 'That sign-in came from an earlier attempt. Finish signing in from the newest browser tab, or start again.');
  }
  const code = params.get('code');
  // When the identity provider reports an error, ABS drops it and sends code=undefined.
  if (!code || code === 'undefined' || params.has('error')) {
    throw new ApiError(401, 'Your identity provider didn’t complete the sign-in. It may have been cancelled or refused; try again.');
  }
  return code;
}

/**
 * Start signing in to `serverUrl` with single sign-on. Open `authorizeUrl` in the browser, then pass the deep link the
 * browser comes back with to `completeOpenIdLogin` (or `reauthenticateWithOpenId`).
 */
export async function beginOpenIdLogin(serverUrl: string): Promise<OpenIdPending> {
  for (const redirectUri of OPENID_REDIRECT_URIS) {
    const verifier = randomToken();
    const state = randomToken(16);
    const url = new URL(`${serverUrl}/auth/openid`);
    url.search = new URLSearchParams({
      response_type: 'code',
      redirect_uri: redirectUri,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
      state
    }).toString();
    let res: Raw & { location: string | null; cookie: string };
    try {
      // The redirect is the answer: its Location is the provider's sign-in page, and it carries the session cookie.
      res = await timedFetch(url.toString(), { maxRedirections: 0 }, async (r) => ({
        ...(await readRaw(r)),
        location: r.headers.get('location'),
        cookie: cookiesFrom(r.headers)
      }));
    } catch (err) {
      throw unreachableError(err, serverUrl);
    }
    if (res.status === 400 && /redirect_uri/i.test(res.body)) continue;
    if (res.status === 429) throw new ApiError(429, 'Too many sign-in attempts. Wait a few minutes and try again.');
    let authorizeUrl: URL | null = null;
    try {
      authorizeUrl = res.status >= 300 && res.status < 400 && res.location ? new URL(res.location, serverUrl) : null;
    } catch {
      // Handled below.
    }
    // Only ever hand the browser a web page.
    if (!authorizeUrl || !/^https?:$/.test(authorizeUrl.protocol)) {
      throw new ApiError(res.status, `${serverUrl} couldn’t start single sign-on (${res.status}). Check that OpenID is set up on the server.`);
    }
    return { serverUrl, authorizeUrl: authorizeUrl.toString(), redirectUri, state, verifier, cookie: res.cookie };
  }
  throw new ApiError(
    400,
    `${serverUrl} doesn’t let desktop apps finish single sign-on. Ask your server admin to add lectern://oauth (or audiobookshelf://oauth) under Settings → Authentication → Allowed Mobile Redirect URIs.`
  );
}

async function openIdSignIn(pending: OpenIdPending, link: string) {
  const code = parseOpenIdCallback(pending, link);
  const { serverUrl } = pending;
  const url = new URL(`${serverUrl}/auth/openid/callback`);
  url.search = new URLSearchParams({ code, state: pending.state, code_verifier: pending.verifier }).toString();
  let raw: Raw;
  try {
    raw = await timedFetch(url.toString(), { headers: pending.cookie ? { Cookie: pending.cookie } : {}, timeout: LONG_TIMEOUT_MS }, readRaw);
  } catch (err) {
    throw unreachableError(err, serverUrl);
  }
  if (raw.status === 400 && /session/i.test(raw.body)) throw new ApiError(400, 'The sign-in took too long or the server restarted. Start again.');
  if (raw.status === 401) {
    throw new ApiError(401, 'The server didn’t accept that sign-in. If this is your first time, your server admin may need to create your account first.');
  }
  if (raw.status === 429) throw new ApiError(429, 'Too many sign-in attempts. Wait a few minutes and try again.');
  if (raw.status < 200 || raw.status >= 300)
    throw new ApiError(raw.status, `Single sign-on failed (${raw.status}${raw.body ? `: ${raw.body.slice(0, 120)}` : ''}).`);
  let data: { user: User; userDefaultLibraryId?: string };
  try {
    data = JSON.parse(raw.body);
  } catch {
    throw new ApiError(0, `${serverUrl} didn't answer like an Audiobookshelf server.`);
  }
  const accessToken = data.user?.accessToken ?? data.user?.token;
  if (!accessToken) throw new ApiError(0, 'The server didn’t return a token.');
  const account: Omit<Account, 'id'> = {
    serverUrl,
    method: 'openid',
    accessToken,
    refreshToken: data.user.refreshToken ?? null,
    username: data.user.username,
    userId: data.user.id
  };
  return { data, account };
}

/** Finish a sign-on with the deep link the browser came back with, and make it the active account. */
export async function completeOpenIdLogin(pending: OpenIdPending, link: string) {
  const { data, account } = await openIdSignIn(pending, link);
  await addAccount(account);
  return data;
}

/** `reauthenticate` for accounts that sign in with single sign-on. */
export async function reauthenticateWithOpenId(accountId: string, pending: OpenIdPending, link: string): Promise<Account> {
  const account = vault.accounts.find((a) => a.id === accountId);
  if (!account) throw new ApiError(0, 'That account is no longer saved.');
  const { account: fresh } = await openIdSignIn(pending, link);
  if (!sameUser(account, fresh)) {
    throw new ApiError(
      0,
      `You signed in as ${fresh.username ?? 'a different user'}. Sign in as ${account.username ?? 'the same user'} to continue this account.`
    );
  }
  return signedInAgain(accountId, fresh);
}

/** Sign the active account out and forget it. Returns the account that becomes active next, if any. */
export async function logout(): Promise<Account | null> {
  const current = creds;
  if (!current) return null;
  // Let the player close its session while the token still works.
  await runBeforeChange();
  if (usesRefreshToken(current.method) && current.refreshToken) {
    await timedFetch(
      `${current.serverUrl}/logout`,
      { method: 'POST', headers: { 'x-refresh-token': current.refreshToken }, timeout: 5000 },
      async () => {}
    ).catch(() => {});
  }
  vault.accounts = vault.accounts.filter((a) => a.id !== current.id);
  authLost.delete(current.id);
  await activate(vault.accounts[0] ?? null, true);
  return creds;
}
