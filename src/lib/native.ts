import { convertFileSrc, currentWindow, inApp, invoke, listen, onOpenUrl, openUrl, type AppWindow, type UnlistenFn } from '$lib/ipc';
import type { PushEvents } from '../shared/rpc';

export { inApp };

export const APP_VERSION: string = __APP_VERSION__;

/** Call a backend command, or resolve to `fallback` in a plain browser. */
export function call<T>(cmd: string, args?: Record<string, unknown>, fallback?: T): Promise<T> {
  if (!inApp) return Promise.resolve(fallback as T);
  return invoke<T>(cmd, args);
}

export function on<K extends keyof PushEvents>(event: K, fn: (payload: PushEvents[K]) => void): Promise<UnlistenFn> {
  if (!inApp) return Promise.resolve(() => {});
  return listen(event, fn);
}

/** URL the page can load for a file on disk (downloaded audio and covers). */
export function fileSrc(path: string) {
  return convertFileSrc(path);
}

// Secrets live in the OS keychain. A plain browser has none, so dev mode falls back to localStorage.
export const secrets = {
  get: (key: string) => (inApp ? invoke<string | null>('secret_get', { key }) : Promise.resolve(localStorage.getItem(`lectern.secret.${key}`))),
  set: (key: string, value: string) =>
    inApp ? invoke<void>('secret_set', { key, value }) : Promise.resolve(localStorage.setItem(`lectern.secret.${key}`, value)),
  delete: (key: string) => (inApp ? invoke<void>('secret_delete', { key }) : Promise.resolve(localStorage.removeItem(`lectern.secret.${key}`)))
};

export interface NowPlayingState {
  title: string | null;
  subtitle: string | null;
  playing: boolean;
  canControl: boolean;
  sleepLabel: string | null;
}

export const setNowPlaying = (state: NowPlayingState) => call<void>('set_now_playing', { state });
export const setCloseBehavior = (hide: boolean) => call<void>('set_close_behavior', { hide });
export const quitNow = () => call<void>('quit_now');
export const showMainWindow = () => call<void>('show_main_window');

/** This app's window, or null in a plain browser (where there is no window to move or resize). */
export const appWindow = (): AppWindow | null => (inApp ? currentWindow : null);
/** Relabel the "Mini Player" items in the app and tray menus. */
export const setMiniMenu = (mini: boolean) => call<void>('set_mini_menu', { mini });

/** Open a web page in the default browser. */
export async function openExternal(url: string) {
  if (inApp) await openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

/**
 * Called with the URLs the OS hands the app (`lectern://…`, `audiobookshelf://…`), e.g. a sign-in coming back from the
 * browser. On macOS they arrive as an `open-url` event; on Windows and Linux a second launch hands them to the running
 * copy. A plain browser never receives any.
 */
export function onDeepLink(fn: (urls: string[]) => void): Promise<UnlistenFn> {
  if (!inApp) return Promise.resolve(() => {});
  return onOpenUrl(fn);
}
