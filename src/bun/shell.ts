// The native shell: the main window and everything attached to it. Owns the menu bar and tray, closing-versus-quitting
// (closing hides the window so playback goes on; quitting saves our place first), the window controls the mini player
// needs, and the window's saved place.
import Electrobun, { ApplicationMenu, Screen, Tray, Utils, type BrowserWindow } from 'electrobun/main';
import { register } from './commands';
import { emit } from './events';
import { buildAppMenu, buildTrayMenu, initialMenuState, isAction, needsWindow, type MenuState } from './menu';
import { type DisplayInfo, type Frame, readState, restore, saveWindow, scaleFor, toSaved, type SavedWindow, stateFilePath } from './windowState';
import type { NowPlayingState } from '../shared/rpc';

export const isMac = process.platform === 'darwin';

export const MIN_SIZE = { width: 980, height: 640 };
export const DEFAULT_SIZE = { width: 1320, height: 860 };
/** How long to wait for the page to save its place before quitting anyway. */
const QUIT_GRACE_MS = 4000;
/** Where macOS puts the traffic lights; moved out of sight when the window has no title bar. */
export const TRAFFIC_LIGHTS = { x: 20, y: 26 };
const HIDDEN_LIGHTS = { x: 4000, y: 4000 };

interface ShellState {
  /** Closing the window hides it (playback goes on). */
  hideOnClose: boolean;
  /** Quitting has been asked for and the page is saving. */
  quitting: boolean;
  /** The page has answered (or time ran out): let the app go. */
  exiting: boolean;
}

export const state: ShellState = { hideOnClose: true, quitting: false, exiting: false };

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
const menus: MenuState = initialMenuState();
let lastAppMenu = '';
let lastTrayMenu = '';

// Window behaviour the page asks for. Electrobun has no minimum size, fixed size or title bar toggle, so they are
// enforced from the resize event instead.
let minSize: { width: number; height: number } | null = MIN_SIZE;
let resizable = true;
let lockedSize: { width: number; height: number } | null = null;

const displays = () => Screen.getAllDisplays() as unknown as DisplayInfo[];

export function mainWindow(): BrowserWindow {
  if (!win) throw new Error('no window yet');
  return win;
}

export function focusMain() {
  if (!win) return;
  win.show();
  win.unminimize();
  win.activate();
}

// ---- Quitting ----

/** Asks the page to save its place and call `quit_now`; quits on its own if the page never does. */
export function requestQuit() {
  if (state.quitting) return;
  state.quitting = true;
  saveWindowState();
  emit('app-quit-requested', null);
  setTimeout(() => quitNow(), QUIT_GRACE_MS);
}

export function quitNow() {
  state.exiting = true;
  saveWindowState();
  Utils.quit();
}

// ---- Window state ----

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function saveWindowState() {
  clearTimeout(saveTimer);
  if (!win) return;
  try {
    const previous = readState()['main'];
    const maximized = win.isMaximized();
    const fullscreen = win.isFullScreen();
    // A maximized or full-screen window keeps the size it will go back to.
    const frame = maximized || fullscreen ? undefined : win.getFrame();
    const all = displays();
    let entry: SavedWindow;
    if (frame) entry = toSaved(frame, scaleFor(frame, all), { maximized, fullscreen }, previous);
    else if (previous) entry = { ...previous, maximized, fullscreen };
    else return;
    saveWindow('main', entry);
  } catch (err) {
    console.warn(`could not save the window state (${stateFilePath()}): ${err}`);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWindowState, 500);
}

/** Where the main window should open, from the last run (or the Tauri build's), if that is still on a display. */
export function initialPlacement() {
  const restored = restore(readState(), 'main', displays());
  if (!restored) return { frame: { ...DEFAULT_SIZE } as Partial<Frame> & { width: number; height: number }, maximized: false, fullscreen: false };
  const { frame } = restored;
  // Left as the mini player: the page takes it from here, so no minimum applies until it says so.
  if (frame.width < MIN_SIZE.width || frame.height < MIN_SIZE.height) minSize = null;
  return { frame, maximized: restored.maximized, fullscreen: restored.fullscreen };
}

export function attachWindow(w: BrowserWindow, placement: { maximized: boolean; fullscreen: boolean }) {
  win = w;
  if (placement.maximized) w.maximize();
  if (placement.fullscreen) w.setFullScreen(true);

  w.on('resize', (e: unknown) => {
    const { width, height } = (e as { data: { width: number; height: number } }).data;
    if (!w.isFullScreen()) {
      if (lockedSize && (width !== lockedSize.width || height !== lockedSize.height)) w.setSize(lockedSize.width, lockedSize.height);
      else if (minSize && (width < minSize.width || height < minSize.height)) w.setSize(Math.max(width, minSize.width), Math.max(height, minSize.height));
    }
    scheduleSave();
  });
  w.on('move', scheduleSave);

  // Closing hides the window when asked to; otherwise it is a quit.
  w.on('will-close', (e: unknown) => {
    if (state.exiting) {
      saveWindowState();
      return;
    }
    (e as { response?: { allow: boolean } }).response = { allow: false };
    if (state.hideOnClose && !state.quitting) w.hide();
    else requestQuit();
  });

  Electrobun.app.on('reopen', () => focusMain());
  // ⌘Q, the Dock's Quit and the app menu all arrive here.
  Electrobun.events.on('before-quit', (e: unknown) => {
    if (state.exiting) return;
    (e as { response?: { allow: boolean } }).response = { allow: false };
    requestQuit();
  });
}

// ---- Menus and tray ----

function refreshMenus() {
  if (isMac) {
    const items = buildAppMenu(menus);
    const key = JSON.stringify(items);
    if (key !== lastAppMenu) {
      lastAppMenu = key;
      ApplicationMenu.setApplicationMenu(items);
    }
  }
  if (tray) {
    const items = buildTrayMenu(menus);
    const key = JSON.stringify(items);
    if (key !== lastTrayMenu) {
      lastTrayMenu = key;
      tray.setMenu(items);
    }
  }
}

function onMenuAction(id: string | undefined) {
  if (!id) return;
  if (id === 'quit') requestQuit();
  else if (id === 'show') focusMain();
  else if (isAction(id)) {
    if (needsWindow(id)) focusMain();
    emit('menu-action', id);
  }
}

export function installMenus() {
  Electrobun.events.on('application-menu-clicked', (e: unknown) => onMenuAction((e as { data?: { action?: string } }).data?.action));

  tray = new Tray({
    title: '',
    // macOS menu bar icons are monochrome templates that adapt to light and dark bars; elsewhere use the app icon.
    image: isMac ? 'views://tray/tray-template.png' : 'views://tray/icon.png',
    template: isMac,
    width: 22,
    height: 22
  });
  tray.on('tray-clicked', (e: unknown) => {
    const action = (e as { data?: { action?: string } }).data?.action;
    // Off macOS the icon itself brings the window back; the menu is on the right button.
    if (!action) {
      if (!isMac) focusMain();
      return;
    }
    onMenuAction(action);
  });
  refreshMenus();
}

/** Links from the OS (a sign-in coming back from the browser): bring the app forward and give them to the page. */
export function handleLinks(links: string[]) {
  if (!links.length) return;
  focusMain();
  emit('deep-link', links);
}

// ---- Commands ----

const clampFrame = (v: unknown) => Math.max(0, Math.round(Number(v)));

register({
  quit_now: () => quitNow(),
  set_close_behavior: (a: { hide: boolean }) => {
    state.hideOnClose = !!a.hide;
  },
  show_main_window: () => focusMain(),
  set_now_playing: (a: { state: NowPlayingState }) => {
    menus.nowPlaying = a.state;
    refreshMenus();
  },
  set_mini_menu: (a: { mini: boolean }) => {
    menus.mini = !!a.mini;
    refreshMenus();
  },
  open_external: (a: { url: string }) => {
    if (!/^(https?:|mailto:|tel:)/i.test(a.url)) throw new Error('Refusing to open this link');
    if (!Utils.openExternal(a.url)) throw new Error('Could not open the link');
  },

  // The window, in points with a top-left origin.
  window_state: () => {
    const w = mainWindow();
    return { ...w.getFrame(), maximized: w.isMaximized(), fullscreen: w.isFullScreen() };
  },
  window_displays: () => displays().map((d) => d.bounds),
  window_set_fullscreen: (a: { fullscreen: boolean }) => void mainWindow().setFullScreen(!!a.fullscreen),
  window_maximize: () => void mainWindow().maximize(),
  window_unmaximize: () => void mainWindow().unmaximize(),
  window_set_always_on_top: (a: { onTop: boolean }) => void mainWindow().setAlwaysOnTop(!!a.onTop),
  window_set_resizable: (a: { resizable: boolean }) => {
    resizable = !!a.resizable;
    if (resizable) lockedSize = null;
  },
  window_set_min_size: (a: { size: { width: number; height: number } | null }) => {
    minSize = a.size ? { width: clampFrame(a.size.width), height: clampFrame(a.size.height) } : null;
  },
  window_set_size: (a: { width: number; height: number }) => {
    const size = { width: clampFrame(a.width), height: clampFrame(a.height) };
    // A window that can't be resized stays exactly this size.
    if (!resizable) lockedSize = size;
    mainWindow().setSize(size.width, size.height);
  },
  window_set_position: (a: { x: number; y: number }) => void mainWindow().setPosition(Math.round(a.x), Math.round(a.y)),
  window_center: () => void mainWindow().center(),
  // Without a title bar there are no traffic lights over the mini player's cover (macOS; elsewhere the frame stays).
  window_set_decorations: (a: { decorations: boolean }) => {
    if (isMac) mainWindow().setWindowButtonPosition(a.decorations ? TRAFFIC_LIGHTS.x : HIDDEN_LIGHTS.x, a.decorations ? TRAFFIC_LIGHTS.y : HIDDEN_LIGHTS.y);
  },
  // Closing goes through the same hide-or-quit decision as the red button.
  window_close: () => void mainWindow().requestClose()
});
