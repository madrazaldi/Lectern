import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow, type Window } from '@tauri-apps/api/window';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';

/** True inside the Tauri shell; false when the UI is opened in a plain browser tab via `vite dev`. */
export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const APP_VERSION: string = __APP_VERSION__;

/** Call a Rust command, or resolve to `fallback` in a plain browser. */
export function call<T>(cmd: string, args?: Record<string, unknown>, fallback?: T): Promise<T> {
  if (!inTauri) return Promise.resolve(fallback as T);
  return invoke<T>(cmd, args);
}

export function on<T>(event: string, fn: (payload: T) => void): Promise<UnlistenFn> {
  if (!inTauri) return Promise.resolve(() => {});
  return listen<T>(event, (e) => fn(e.payload));
}

/** URL the webview can load for a file on disk (downloaded audio and covers). */
export function fileSrc(path: string) {
  return convertFileSrc(path);
}

// Secrets live in the OS keychain. A plain browser has none, so dev mode falls back to localStorage.
export const secrets = {
  get: (key: string) => (inTauri ? invoke<string | null>('secret_get', { key }) : Promise.resolve(localStorage.getItem(`lectern.secret.${key}`))),
  set: (key: string, value: string) =>
    inTauri ? invoke<void>('secret_set', { key, value }) : Promise.resolve(localStorage.setItem(`lectern.secret.${key}`, value)),
  delete: (key: string) => (inTauri ? invoke<void>('secret_delete', { key }) : Promise.resolve(localStorage.removeItem(`lectern.secret.${key}`)))
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

/** This webview's window, or null in a plain browser (where there is no window to move or resize). */
export const appWindow = (): Window | null => (inTauri ? getCurrentWindow() : null);
/** Relabel the "Mini Player" items in the app and tray menus. */
export const setMiniMenu = (mini: boolean) => call<void>('set_mini_menu', { mini });

/** Open a web page in the default browser. */
export async function openExternal(url: string) {
  if (inTauri) await openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

/**
 * Called with the URLs the OS hands the app (`lectern://…`, `audiobookshelf://…`), e.g. a sign-in coming back from the
 * browser. On Windows and Linux they arrive through the single-instance plugin. A plain browser never receives any.
 */
export function onDeepLink(fn: (urls: string[]) => void): Promise<UnlistenFn> {
  if (!inTauri) return Promise.resolve(() => {});
  return onOpenUrl(fn);
}
