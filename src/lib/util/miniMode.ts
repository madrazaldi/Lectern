/**
 * The mini player is the main window shrunk to a small, always-on-top strip rather than a second window: the
 * audio element lives in this webview, and another window would be another webview without it.
 *
 * The main process saves whatever size the window has when the app quits (the small one, if that's how it was
 * left), so the full window's bounds are kept in prefs instead of trusting it to bring them back.
 *
 * Positions and sizes are points (what the window manager of the app works in), not device pixels.
 */
import { availableDisplays, type AppWindow } from '$lib/ipc';
import { appWindow } from '$lib/native';
import { prefs, type WindowBounds } from '$lib/stores/prefs.svelte';

/** Logical size of the mini player. */
export const MINI_SIZE = { width: 380, height: 120 };
/** The main window's minimum size (src/bun/shell.ts), put back on the way out. */
export const FULL_MIN_SIZE = { width: 980, height: 640 };
/** For when there is nothing to go back to (prefs cleared while small). */
export const FULL_DEFAULT_SIZE = { width: 1320, height: 860 };

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Is a window at (x, y) still on one of these displays? One may have been unplugged since it was saved. */
export function onScreen(x: number, y: number, displays: Rect[]) {
  // A point just inside the window's top-left corner: enough of it to see and drag back.
  const px = x + 40;
  const py = y + 10;
  return displays.some((d) => px >= d.x && px < d.x + d.width && py >= d.y && py < d.y + d.height);
}

async function placeable(x: number, y: number) {
  try {
    return onScreen(x, y, await availableDisplays());
  } catch {
    return true;
  }
}

async function until(done: () => Promise<boolean>, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (!(await done()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
}

/** Every step runs even if one fails: a window that missed one setting beats one left half-switched. */
async function steps(...fns: (() => Promise<unknown> | undefined)[]) {
  for (const fn of fns) {
    try {
      await fn();
    } catch (err) {
      console.warn('Mini player: window change failed', err);
    }
  }
}

/** The full window's bounds, taken out of fullscreen and un-maximized first so they're the ones to go back to. */
async function readBounds(win: AppWindow): Promise<WindowBounds> {
  let at = await win.state();
  const fullscreen = at.fullscreen;
  if (fullscreen) {
    await win.setFullscreen(false);
    await until(async () => !(await win.state()).fullscreen);
    at = await win.state();
  }
  // Asked after leaving fullscreen: a full-screen window also reports itself as maximized.
  const maximized = at.maximized;
  if (maximized) {
    await win.unmaximize();
    await until(async () => !(await win.state()).maximized);
    at = await win.state();
  }
  return { x: at.x, y: at.y, width: at.width, height: at.height, maximized, fullscreen };
}

/** Make the window the mini player; `moveTo` is where it was last put, if anywhere. */
async function shrink(win: AppWindow, moveTo: { x: number; y: number } | null) {
  const move = !!moveTo && (await placeable(moveTo.x, moveTo.y));
  await steps(
    () => win.setAlwaysOnTop(prefs.miniPinned),
    // Not resizable, so a double-click on the drag region can't maximize it either.
    () => win.setResizable(false),
    // No title bar: the traffic lights / caption buttons would sit on top of the cover. The mini player has its own close button.
    () => win.setDecorations(false),
    () => win.setMinSize(null),
    () => win.setSize(MINI_SIZE),
    () => (move && moveTo ? win.setPosition({ x: moveTo.x, y: moveTo.y }) : undefined)
  );
}

async function grow(win: AppWindow, to: WindowBounds | null) {
  const move = !!to && (await placeable(to.x, to.y));
  await steps(
    () => win.setAlwaysOnTop(false),
    () => win.setResizable(true),
    () => win.setDecorations(true),
    () => win.setSize(to ? { width: to.width, height: to.height } : FULL_DEFAULT_SIZE),
    () => (move && to ? win.setPosition({ x: to.x, y: to.y }) : win.center()),
    () => win.setMinSize(FULL_MIN_SIZE),
    () => (to?.maximized ? win.maximize() : undefined),
    () => (to?.fullscreen ? win.setFullscreen(true) : undefined)
  );
}

class MiniMode {
  private chain: Promise<void> = Promise.resolve();

  /** Showing the mini player (persisted, so the app reopens the way it was left). */
  get active() {
    return prefs.miniMode;
  }

  /** One switch at a time: a second press waits for the window to finish the first. */
  private serial(fn: () => Promise<void>) {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => {});
    return run;
  }

  private async doEnter() {
    if (prefs.miniMode) return;
    const win = appWindow();
    if (win) prefs.miniRestore = await readBounds(win).catch(() => null);
    prefs.miniMode = true;
    if (win) await shrink(win, prefs.miniPosition);
  }

  private async doExit() {
    if (!prefs.miniMode) return;
    const win = appWindow();
    if (win) {
      const at = await win.state().catch(() => null);
      if (at) prefs.miniPosition = { x: at.x, y: at.y };
      await grow(win, prefs.miniRestore);
    }
    prefs.miniMode = false;
    prefs.miniRestore = null;
  }

  enter() {
    return this.serial(() => this.doEnter());
  }

  exit() {
    return this.serial(() => this.doExit());
  }

  toggle() {
    return this.serial(() => (prefs.miniMode ? this.doExit() : this.doEnter()));
  }

  /** On launch the window opens where it was; if the app was left as the mini player, shrink it again. */
  restore() {
    return this.serial(async () => {
      const win = appWindow();
      if (!win) return;
      // The main process has already put it where the mini player was.
      if (prefs.miniMode) await shrink(win, null);
      // Otherwise it opens as the full window, so the minimum applies (it was lifted if a small frame was saved).
      else await steps(() => win.setMinSize(FULL_MIN_SIZE));
    });
  }

  /** Keep the mini player above other windows, or not. */
  setPinned(pinned: boolean) {
    prefs.miniPinned = pinned;
    return this.serial(async () => {
      if (prefs.miniMode) await steps(() => appWindow()?.setAlwaysOnTop(pinned));
    });
  }
}

export const mini = new MiniMode();
