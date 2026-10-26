// The page's side of the bridge to the Bun main process (src/bun). It stands in for what `@tauri-apps/*` used to
// provide, so call sites keep their shape: `invoke`, `listen`, `fetch`, `openUrl`, `convertFileSrc`, the window.
//
//   page  --rpc.request.invoke({ cmd, args })-->  Bun main process  --> src/bun/commands.ts, shell.ts
//   page  <--rpc message "event" ----------------  Bun main process  <-- backend `emit`
//
// In a plain browser tab (`bun run dev`) there is no Bun process; `inApp` is false and callers fall back.
import type { PushEvents, Reply } from '../shared/rpc';

export type UnlistenFn = () => void;
type Listener = (payload: unknown) => void;

declare global {
  interface Window {
    /** Set by the main process before the page's own scripts run (see src/bun/index.ts). */
    __lectern?: { files: string; platform: string; debug?: boolean };
    /** Only with LECTERN_DEBUG=1 (see src/bun/index.ts): lets a debugger call commands. */
    __lecternInvoke?: typeof invoke;
    __lecternFetch?: typeof fetch;
    __lecternEvents?: { event: string; payload: unknown }[];
  }
}

/** True inside the desktop app; false when the UI is opened in a plain browser tab via `vite dev`. */
export const inApp = typeof window !== 'undefined' && typeof window.__electrobunWebviewId === 'number';

const listeners = new Map<string, Set<Listener>>();

function dispatchEvent(event: string, payload: unknown) {
  if (typeof window !== 'undefined' && window.__lectern?.debug) (window.__lecternEvents ??= []).push({ event, payload });
  for (const fn of [...(listeners.get(event) ?? [])]) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`listener for "${event}" threw`, err);
    }
  }
}

interface Rpc {
  request: { invoke(params: { cmd: string; args: Record<string, unknown> }): Promise<Reply> };
}

let bridge: Promise<Rpc> | null = null;

function connect(): Promise<Rpc> {
  return (bridge ??= (async () => {
    const { Electroview } = await import('electrobun/view');
    const rpc = Electroview.defineRPC({
      // Downloads outlive Electrobun's one-second default.
      maxRequestTime: Infinity,
      handlers: {
        requests: {},
        messages: { event: ({ event, payload }: { event: string; payload: unknown }) => dispatchEvent(event, payload) }
      }
      // Commands are plain names rather than a closed set, so the schema stays open.
    } as never);
    new Electroview({ rpc });
    return rpc as unknown as Rpc;
  })());
}

/** Call a backend command. Rejects with whatever the command threw (a string, or an object such as a download error). */
export async function invoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!inApp) throw new Error('no backend is available');
  const rpc = await connect();
  const reply = await rpc.request.invoke({ cmd, args });
  if ('err' in reply) throw reply.err;
  return reply.ok as T;
}

/** Subscribe to a backend event. Resolves to an unsubscribe function once the bridge is up. */
export async function listen<K extends keyof PushEvents>(event: K, fn: (payload: PushEvents[K]) => void): Promise<UnlistenFn> {
  let set = listeners.get(event);
  if (!set) listeners.set(event, (set = new Set()));
  const listener = fn as Listener;
  set.add(listener);
  await connect();
  return () => void set.delete(listener);
}

// --- Files ---

/** URL the page can load for a file in the downloads folder (downloaded audio and covers). */
export function convertFileSrc(path: string): string {
  const base = window.__lectern?.files;
  return base ? `${base}/file?path=${encodeURIComponent(path)}` : path;
}

// --- Opening links ---

export const openUrl = (url: string): Promise<void> => invoke('open_external', { url });

/**
 * Called with links that come back to the app: the OS's (`lectern://…`, `audiobookshelf://…`, macOS) or the loopback
 * address's, which is listened on only while someone is waiting.
 */
export async function onOpenUrl(fn: (urls: string[]) => void): Promise<UnlistenFn> {
  const unlisten = await listen('deep-link', fn);
  // Best effort: macOS has the schemes, and the port may be taken.
  await invoke('oauth_loopback_start').catch(() => {});
  return () => {
    unlisten();
    void invoke('oauth_loopback_stop').catch(() => {});
  };
}

// --- HTTP ---

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const abortError = () => new DOMException('The request was aborted.', 'AbortError');
let requestSeq = 0;

/** A request body as bytes, plus the Content-Type the browser would have chosen for it. */
async function bodyBytes(body: BodyInit | null | undefined): Promise<{ bytes: Uint8Array; type: string | null } | null> {
  if (body == null) return null;
  const probe = new Response(body);
  return { bytes: new Uint8Array(await probe.arrayBuffer()), type: probe.headers.get('content-type') };
}

/**
 * `fetch` for server requests, made by the Bun process so CORS never applies (Audiobookshelf answers preflights with
 * 401). Same shape as the Tauri plugin's: `maxRedirections: 0` hands back the first answer. The whole body arrives at
 * once, which is all the app needs.
 */
export async function fetch(input: string | URL, init: RequestInit & { maxRedirections?: number } = {}): Promise<Response> {
  const { signal, maxRedirections, ...rest } = init;
  if (signal?.aborted) throw abortError();
  const url = String(input);
  if (!/^https?:\/\//i.test(url)) throw new TypeError(`Unsupported URL: ${url}`);

  const method = (rest.method ?? 'GET').toUpperCase();
  const headers = new Headers(rest.headers);
  const body = method === 'GET' || method === 'HEAD' ? null : await bodyBytes(rest.body);
  if (body?.type && !headers.has('content-type')) headers.set('content-type', body.type);

  const id = `http-${Date.now().toString(36)}-${requestSeq++}`;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      void invoke('http_abort', { id }).catch(() => {});
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const res = await Promise.race([
      invoke<import('../shared/rpc').HttpResponse>('http_fetch', {
        id,
        url,
        method,
        headers: [...headers.entries()],
        ...(body ? { body: toBase64(body.bytes) } : {}),
        redirect: maxRedirections === 0 || rest.redirect === 'manual' ? 'manual' : 'follow'
      }),
      aborted
    ]);
    const noBody = res.status === 204 || res.status === 205 || res.status === 304;
    const response = new Response(noBody ? null : fromBase64(res.body), { status: res.status, statusText: res.statusText });
    // A Response filters out Set-Cookie; the sign-in flow needs it. A free-standing Headers keeps everything.
    Object.defineProperty(response, 'headers', { value: new Headers(res.headers) });
    Object.defineProperty(response, 'url', { value: res.url });
    return response;
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    aborted.catch(() => {});
  }
}

if (inApp && window.__lectern?.debug) {
  window.__lecternInvoke = invoke;
  window.__lecternFetch = fetch;
}

// --- The window ---

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}

/** The window's frame in points, origin at the top-left of the primary display. */
export interface WindowState extends Point, Size {
  maximized: boolean;
  fullscreen: boolean;
}

/** The app's one window. Positions and sizes are in points. */
export interface AppWindow {
  state(): Promise<WindowState>;
  setFullscreen(on: boolean): Promise<void>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  setAlwaysOnTop(on: boolean): Promise<void>;
  setResizable(on: boolean): Promise<void>;
  /** Show or hide the title bar (the traffic lights on macOS). */
  setDecorations(on: boolean): Promise<void>;
  /** `null` lifts the minimum. */
  setMinSize(size: Size | null): Promise<void>;
  setSize(size: Size): Promise<void>;
  setPosition(at: Point): Promise<void>;
  center(): Promise<void>;
  close(): Promise<void>;
}

export const currentWindow: AppWindow = {
  state: () => invoke<WindowState>('window_state'),
  setFullscreen: (fullscreen) => invoke('window_set_fullscreen', { fullscreen }),
  maximize: () => invoke('window_maximize'),
  unmaximize: () => invoke('window_unmaximize'),
  setAlwaysOnTop: (onTop) => invoke('window_set_always_on_top', { onTop }),
  setResizable: (resizable) => invoke('window_set_resizable', { resizable }),
  setDecorations: (decorations) => invoke('window_set_decorations', { decorations }),
  setMinSize: (size) => invoke('window_set_min_size', { size }),
  setSize: ({ width, height }) => invoke('window_set_size', { width, height }),
  setPosition: ({ x, y }) => invoke('window_set_position', { x, y }),
  center: () => invoke('window_center'),
  close: () => invoke('window_close')
};

/** The displays, as rectangles in points. */
export const availableDisplays = (): Promise<(Point & Size)[]> => invoke('window_displays');
