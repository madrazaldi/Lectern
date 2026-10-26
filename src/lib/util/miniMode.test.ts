// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';

/** Enough of the app's window to switch modes: records calls, keeps position/size/maximized/fullscreen (in points). */
function fakeWindow(init: { x?: number; y?: number; width?: number; height?: number; maximized?: boolean; fullscreen?: boolean } = {}) {
  const state = { x: 100, y: 80, width: 1320, height: 860, maximized: false, fullscreen: false, ...init };
  const calls: string[] = [];
  const ok =
    (name: string, fn: (...args: never[]) => void = () => {}) =>
    (...args: never[]) => {
      calls.push(name);
      fn(...args);
      return Promise.resolve();
    };
  const win = {
    state: vi.fn(async () => ({ ...state })),
    stateValues: state,
    calls,
    setFullscreen: vi.fn(ok('setFullscreen', (on: boolean) => (state.fullscreen = on))),
    unmaximize: vi.fn(ok('unmaximize', () => (state.maximized = false))),
    maximize: vi.fn(ok('maximize', () => (state.maximized = true))),
    setAlwaysOnTop: vi.fn(ok('setAlwaysOnTop')),
    setResizable: vi.fn(ok('setResizable')),
    setDecorations: vi.fn(ok('setDecorations')),
    setMinSize: vi.fn(ok('setMinSize')),
    setSize: vi.fn(ok('setSize')),
    setPosition: vi.fn(ok('setPosition', (p: { x: number; y: number }) => Object.assign(state, { x: p.x, y: p.y }))),
    center: vi.fn(ok('center')),
    close: vi.fn(ok('close'))
  };
  return win;
}

const env = vi.hoisted(() => ({
  win: null as unknown,
  // One 1728×1117 display at the origin.
  displays: [{ x: 0, y: 0, width: 1728, height: 1117 }] as unknown[]
}));

vi.mock('$lib/native', () => ({ appWindow: () => env.win }));
vi.mock('$lib/ipc', () => ({ availableDisplays: async () => env.displays }));

const { mini, onScreen, MINI_SIZE, FULL_MIN_SIZE, FULL_DEFAULT_SIZE } = await import('./miniMode');
const { prefs } = await import('$lib/stores/prefs.svelte');

beforeEach(() => {
  Object.assign(prefs, { miniMode: false, miniPinned: true, miniRestore: null, miniPosition: null });
  env.displays = [{ x: 0, y: 0, width: 1728, height: 1117 }];
  env.win = null;
});

function use(win: ReturnType<typeof fakeWindow>) {
  env.win = win;
  return win;
}

describe('entering the mini player', () => {
  it('remembers the full window and shrinks it to a pinned, frameless strip', async () => {
    const win = use(fakeWindow());
    await mini.enter();

    expect(prefs.miniMode).toBe(true);
    expect(prefs.miniRestore).toEqual({ x: 100, y: 80, width: 1320, height: 860, maximized: false, fullscreen: false });
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(win.setResizable).toHaveBeenCalledWith(false);
    expect(win.setDecorations).toHaveBeenCalledWith(false);
    expect(win.setMinSize).toHaveBeenCalledWith(null);
    expect(win.setSize).toHaveBeenCalledWith(MINI_SIZE);
    // The minimum size goes before the resize, or the window couldn't get that small.
    expect(win.calls.indexOf('setMinSize')).toBeLessThan(win.calls.indexOf('setSize'));
    // Nowhere saved yet: it shrinks where it is.
    expect(win.setPosition).not.toHaveBeenCalled();
  });

  it('un-maximizes and leaves fullscreen first, and records both to go back to', async () => {
    const win = use(fakeWindow({ maximized: true, fullscreen: true }));
    await mini.enter();
    expect(win.setFullscreen).toHaveBeenCalledWith(false);
    expect(win.unmaximize).toHaveBeenCalled();
    expect(prefs.miniRestore).toMatchObject({ maximized: true, fullscreen: true });
  });

  it('goes back to where the mini player was last put', async () => {
    prefs.miniPosition = { x: 1500, y: 60 };
    const win = use(fakeWindow());
    await mini.enter();
    expect(win.setPosition).toHaveBeenCalledWith({ x: 1500, y: 60 });
  });

  it("stays put when the mini player's last place is on a display that's gone", async () => {
    prefs.miniPosition = { x: 3000, y: 60 };
    const win = use(fakeWindow());
    await mini.enter();
    expect(win.setPosition).not.toHaveBeenCalled();
  });

  it('keeps going when one window change fails', async () => {
    const win = use(fakeWindow());
    win.setDecorations.mockRejectedValueOnce(new Error('not allowed'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mini.enter();
    expect(win.setSize).toHaveBeenCalled();
    expect(prefs.miniMode).toBe(true);
  });

  it('does nothing when already small', async () => {
    prefs.miniMode = true;
    const win = use(fakeWindow());
    await mini.enter();
    expect(win.calls).toEqual([]);
  });

  it('persists the mode', async () => {
    use(fakeWindow());
    await mini.enter();
    flushSync();
    expect(JSON.parse(localStorage.getItem('lectern.prefs')!)).toMatchObject({ miniMode: true, miniRestore: { width: 1320, height: 860 } });
  });
});

describe('leaving the mini player', () => {
  it('returns to the exact size and place, with the frame and minimum size back', async () => {
    const win = use(fakeWindow());
    await mini.enter();
    win.stateValues.x = 1400;
    win.stateValues.y = 40;
    win.calls.length = 0;
    await mini.exit();

    expect(prefs.miniMode).toBe(false);
    expect(prefs.miniRestore).toBeNull();
    expect(prefs.miniPosition).toEqual({ x: 1400, y: 40 });
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    expect(win.setResizable).toHaveBeenLastCalledWith(true);
    expect(win.setDecorations).toHaveBeenLastCalledWith(true);
    expect(win.setSize).toHaveBeenLastCalledWith({ width: 1320, height: 860 });
    expect(win.setPosition).toHaveBeenLastCalledWith({ x: 100, y: 80 });
    expect(win.setMinSize).toHaveBeenLastCalledWith(FULL_MIN_SIZE);
    // The size goes back before the minimum does, so the minimum can't stretch the small window first.
    expect(win.calls.indexOf('setSize')).toBeLessThan(win.calls.indexOf('setMinSize'));
    expect(win.maximize).not.toHaveBeenCalled();
    expect(win.center).not.toHaveBeenCalled();
  });

  it('maximizes and goes fullscreen again if it was', async () => {
    const win = use(fakeWindow({ maximized: true, fullscreen: true }));
    await mini.enter();
    await mini.exit();
    expect(win.maximize).toHaveBeenCalled();
    expect(win.setFullscreen).toHaveBeenLastCalledWith(true);
    expect(win.calls.lastIndexOf('setSize')).toBeLessThan(win.calls.lastIndexOf('maximize'));
  });

  it("centres the window when its old place is on a display that's gone", async () => {
    prefs.miniMode = true;
    prefs.miniRestore = { x: 3000, y: 100, width: 2000, height: 1300, maximized: false, fullscreen: false };
    const win = use(fakeWindow());
    await mini.exit();
    expect(win.setSize).toHaveBeenCalledWith({ width: 2000, height: 1300 });
    expect(win.setPosition).not.toHaveBeenCalled();
    expect(win.center).toHaveBeenCalled();
  });

  it('falls back to the default size when nothing was saved', async () => {
    prefs.miniMode = true;
    const win = use(fakeWindow());
    await mini.exit();
    expect(win.setSize).toHaveBeenCalledWith(FULL_DEFAULT_SIZE);
    expect(win.center).toHaveBeenCalled();
    expect(prefs.miniMode).toBe(false);
  });
});

describe('launching', () => {
  it('shrinks the window again when the app was left as the mini player, keeping the saved full size', async () => {
    const saved = { x: 10, y: 20, width: 2000, height: 1300, maximized: false, fullscreen: false };
    Object.assign(prefs, { miniMode: true, miniRestore: saved, miniPosition: { x: 50, y: 60 } });
    const win = use(fakeWindow());
    await mini.restore();
    expect(win.setSize).toHaveBeenCalledWith(MINI_SIZE);
    expect(win.setDecorations).toHaveBeenCalledWith(false);
    // The main process already put it where it was.
    expect(win.setPosition).not.toHaveBeenCalled();
    expect(prefs.miniRestore).toEqual(saved);
  });

  it('leaves a full-size window alone, apart from making sure its minimum size is back', async () => {
    const win = use(fakeWindow());
    await mini.restore();
    expect(win.calls).toEqual(['setMinSize']);
    expect(win.setMinSize).toHaveBeenCalledWith(FULL_MIN_SIZE);
  });
});

describe('mini mode', () => {
  it('takes one switch at a time', async () => {
    const win = use(fakeWindow());
    const first = mini.toggle();
    const second = mini.toggle();
    await Promise.all([first, second]);
    expect(prefs.miniMode).toBe(false);
    expect(win.setDecorations.mock.calls).toEqual([[false], [true]]);
  });

  it('pins and unpins only while small, remembering the choice', async () => {
    const win = use(fakeWindow());
    await mini.setPinned(false);
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
    await mini.enter();
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    await mini.setPinned(true);
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
    expect(prefs.miniPinned).toBe(true);
  });

  it('switches the layout in a browser, where there is no window to resize', async () => {
    await mini.enter();
    expect(prefs.miniMode).toBe(true);
    expect(prefs.miniRestore).toBeNull();
    await mini.exit();
    expect(prefs.miniMode).toBe(false);
  });
});

describe('onScreen', () => {
  const displays = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 1920, y: -200, width: 2560, height: 1440 }
  ];

  it('accepts a window whose corner is on any display', () => {
    expect(onScreen(100, 100, displays)).toBe(true);
    expect(onScreen(2000, -150, displays)).toBe(true);
  });

  it('rejects one left on a display that is gone, or with too little showing to grab', () => {
    expect(onScreen(5000, 100, displays)).toBe(false);
    expect(onScreen(-100, 100, displays)).toBe(false);
    expect(onScreen(100, 1075, displays)).toBe(false);
  });
});
