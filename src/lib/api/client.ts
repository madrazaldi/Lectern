import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { User } from './types';

// Requests go through the Rust HTTP client: Audiobookshelf answers CORS preflights
// with 401, so the webview's own fetch can't reach most servers.
// In a plain browser (vite dev without Tauri), the dev server relays requests instead; see vite.config.js.
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const httpFetch: typeof fetch = inTauri
  ? (tauriFetch as typeof fetch)
  : (input, init) => fetch(`/__abs_proxy?url=${encodeURIComponent(String(input))}`, init);

export type AuthMethod = 'password' | 'apikey';

export interface Credentials {
  serverUrl: string;
  method: AuthMethod;
  accessToken: string;
  refreshToken: string | null;
  username?: string;
}

const STORAGE_KEY = 'lectern.credentials';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

let creds: Credentials | null = load();
let refreshing: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

function load(): Credentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Credentials) : null;
  } catch {
    return null;
  }
}

function persist() {
  if (creds) localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
  else localStorage.removeItem(STORAGE_KEY);
}

export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

export function getCredentials() {
  return creds;
}

export function setCredentials(next: Credentials | null) {
  creds = next;
  persist();
}

export function onSessionExpired(fn: () => void) {
  onSignedOut = fn;
}

export function serverUrl() {
  return creds?.serverUrl ?? '';
}

export function token() {
  return creds?.accessToken ?? '';
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

async function refreshAccessToken(): Promise<boolean> {
  if (!creds || creds.method !== 'password' || !creds.refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await httpFetch(`${creds!.serverUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'x-refresh-token': creds!.refreshToken! }
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { user: User };
      creds = {
        ...creds!,
        accessToken: data.user.accessToken ?? data.user.token ?? creds!.accessToken,
        refreshToken: data.user.refreshToken ?? creds!.refreshToken
      };
      persist();
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

/** Ask for a fresh access token now, e.g. before handing a stream URL to the audio element. */
export async function ensureFreshToken() {
  if (!creds || creds.method !== 'password') return;
  try {
    const [, payload] = creds.accessToken.split('.');
    const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof exp === 'number' && exp * 1000 - Date.now() < 5 * 60_000) await refreshAccessToken();
  } catch {
    // Not a JWT we can read; the 401 path still covers it.
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  if (!creds) throw new ApiError(401, 'Not signed in');
  const url = new URL(creds.serverUrl + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${creds.accessToken}` };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await httpFetch(url.toString(), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, `Can't reach ${creds.serverUrl}. Check your connection or the server address.`);
  }

  if (res.status === 401 && !retried) {
    if (await refreshAccessToken()) return request<T>(path, opts, true);
    onSignedOut?.();
    throw new ApiError(401, 'Your session ended. Sign in again to continue.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || `${res.status} ${res.statusText}`);
  }
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

/** Fetch raw bytes through the native client (used to sample cover colors without tainting a canvas). */
export async function fetchBlob(url: string): Promise<Blob> {
  const res = await httpFetch(url);
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return res.blob();
}

export interface ServerStatus {
  app: string;
  serverVersion: string;
  isInit: boolean;
  authMethods: string[];
}

export async function probeServer(serverUrl: string): Promise<ServerStatus> {
  let res: Response;
  try {
    res = await httpFetch(`${serverUrl}/status`);
  } catch {
    throw new ApiError(0, `Nothing answered at ${serverUrl}. Check the address and that the server is running.`);
  }
  if (!res.ok) throw new ApiError(res.status, `${serverUrl} answered with ${res.status}. Is this an Audiobookshelf server?`);
  const data = (await res.json().catch(() => null)) as ServerStatus | null;
  if (data?.app !== 'audiobookshelf') throw new ApiError(0, `${serverUrl} isn't an Audiobookshelf server.`);
  return data;
}

export async function loginWithPassword(serverUrl: string, username: string, password: string) {
  let res: Response;
  try {
    res = await httpFetch(`${serverUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-return-tokens': 'true' },
      body: JSON.stringify({ username, password })
    });
  } catch {
    throw new ApiError(0, `Can't reach ${serverUrl}.`);
  }
  if (res.status === 401) throw new ApiError(401, 'That username and password combination didn’t work.');
  if (res.status === 429) throw new ApiError(429, 'Too many sign-in attempts. Wait a minute and try again.');
  if (!res.ok) throw new ApiError(res.status, `Sign-in failed (${res.status}).`);
  const data = (await res.json()) as { user: User; userDefaultLibraryId?: string };
  const accessToken = data.user.accessToken ?? data.user.token;
  if (!accessToken) throw new ApiError(0, 'The server didn’t return a token.');
  setCredentials({
    serverUrl,
    method: 'password',
    accessToken,
    refreshToken: data.user.refreshToken ?? null,
    username: data.user.username
  });
  return data;
}

export async function loginWithApiKey(serverUrl: string, apiKey: string) {
  setCredentials({ serverUrl, method: 'apikey', accessToken: apiKey.trim(), refreshToken: null });
  try {
    const user = await request<User>('/api/me');
    creds = { ...creds!, username: user.username };
    persist();
    return user;
  } catch (err) {
    setCredentials(null);
    if (err instanceof ApiError && err.status === 401) throw new ApiError(401, 'The server didn’t accept that API key.');
    throw err;
  }
}

export async function logout() {
  if (creds?.method === 'password' && creds.refreshToken) {
    await httpFetch(`${creds.serverUrl}/logout`, {
      method: 'POST',
      headers: { 'x-refresh-token': creds.refreshToken }
    }).catch(() => {});
  }
  setCredentials(null);
}
