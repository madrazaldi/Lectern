// What crosses between the webview and the Bun main process. Commands are named requests (src/bun/commands.ts); the
// webview-side bridge is src/lib/ipc.ts. Bun pushes events to the page with the `event` message.
/** Result of a command: a value, or the error to reject with (kept as data so objects survive the trip). */
export type Reply = { ok: unknown } | { err: unknown };

export interface WindowBoundsLogical {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything Bun pushes to the page, by event name. */
export interface PushEvents {
  /** A menu bar, application menu or tray item was chosen (the item's id). */
  'menu-action': string;
  /** Quitting was asked for: save our place, then call `quit_now`. */
  'app-quit-requested': null;
  'download-progress': { id: string; received: number; total: number | null };
  /** Links the OS handed the app (`lectern://…`, `audiobookshelf://…`). */
  'deep-link': string[];
}

/** The Now Playing state the page reports for the menu bar, tray and application menu. */
export interface NowPlayingState {
  title: string | null;
  subtitle: string | null;
  playing: boolean;
  canControl: boolean;
  sleepLabel: string | null;
}

/** Request made by the page's `fetch` shim; Bun performs it without CORS. */
export interface HttpRequest {
  id: string;
  url: string;
  method: string;
  headers: [string, string][];
  /** Request body, base64. */
  body?: string;
  /** Follow redirects (default) or hand the first answer back. */
  redirect?: 'follow' | 'manual';
}

export interface HttpResponse {
  status: number;
  statusText: string;
  /** Pairs, so repeated headers (Set-Cookie) survive. */
  headers: [string, string][];
  /** Response body, base64. */
  body: string;
  url: string;
}
