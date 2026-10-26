// Remembers each window's place between launches, in `<app data>/.window-state.json` (the file, and the keys and
// units, the Tauri window-state plugin used, so a window opens where the Tauri build left it). The file holds
// physical pixels; the windows here work in points, so the display's scale factor converts between the two.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configDir } from './paths';

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A display, as `Screen.getAllDisplays()` reports it: points, top-left origin. */
export interface DisplayInfo {
  bounds: Frame;
  scaleFactor: number;
  isPrimary?: boolean;
}

/** One window in the file. Pixel fields are physical; the rest is kept as found. */
export interface SavedWindow {
  x: number;
  y: number;
  width: number;
  height: number;
  prev_x?: number;
  prev_y?: number;
  maximized?: boolean;
  visible?: boolean;
  decorated?: boolean;
  fullscreen?: boolean;
}

export type StateFile = Record<string, SavedWindow>;

export interface Restored {
  frame: Frame;
  maximized: boolean;
  fullscreen: boolean;
}

// Where Tauri's window-state plugin kept it.
export const stateFilePath = () => join(configDir(), '.window-state.json');

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseState(text: string | null): StateFile {
  if (!text) return {};
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: StateFile = {};
    for (const [label, w] of Object.entries(raw as Record<string, unknown>)) {
      const s = w as Partial<SavedWindow> | null;
      if (s && finite(s.x) && finite(s.y) && finite(s.width) && finite(s.height) && s.width > 0 && s.height > 0) out[label] = s as SavedWindow;
    }
    return out;
  } catch {
    return {};
  }
}

/** Is a window at this place still on a display? One may have been unplugged since it was saved. */
export function onScreen(frame: Frame, displays: DisplayInfo[]): boolean {
  // A point just inside the window's top-left corner: enough of it to see and drag back.
  const px = frame.x + 40;
  const py = frame.y + 10;
  return displays.some(({ bounds: d }) => px >= d.x && px < d.x + d.width && py >= d.y && py < d.y + d.height);
}

/** The display a saved physical position belongs to: the one it lands inside once divided by that display's scale. */
export function toFrame(saved: SavedWindow, displays: DisplayInfo[]): Frame | null {
  const candidates = displays.length ? displays : [];
  for (const d of candidates) {
    const s = d.scaleFactor || 1;
    const frame = { x: saved.x / s, y: saved.y / s, width: saved.width / s, height: saved.height / s };
    if (onScreen(frame, [d])) return frame;
  }
  return null;
}

/** Scale factor for a window at `frame`: the display it is mostly on, else the primary one, else 1. */
export function scaleFor(frame: Frame, displays: DisplayInfo[]): number {
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const on = displays.find(({ bounds: d }) => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height);
  return (on ?? displays.find((d) => d.isPrimary) ?? displays[0])?.scaleFactor || 1;
}

export function toSaved(frame: Frame, scale: number, extra: { maximized: boolean; fullscreen: boolean }, previous?: SavedWindow): SavedWindow {
  const x = Math.round(frame.x * scale);
  const y = Math.round(frame.y * scale);
  return {
    ...previous,
    width: Math.round(frame.width * scale),
    height: Math.round(frame.height * scale),
    x,
    y,
    prev_x: x,
    prev_y: y,
    maximized: extra.maximized,
    visible: true,
    decorated: previous?.decorated ?? true,
    fullscreen: extra.fullscreen
  };
}

/** Where to open `label`, if it was saved and still fits on a display. */
export function restore(file: StateFile, label: string, displays: DisplayInfo[]): Restored | null {
  const saved = file[label];
  if (!saved) return null;
  const frame = toFrame(saved, displays);
  return frame ? { frame, maximized: saved.maximized === true, fullscreen: saved.fullscreen === true } : null;
}

export function readState(path = stateFilePath()): StateFile {
  try {
    return parseState(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/** Replaces one window's entry, leaving the others as they were. */
export function saveWindow(label: string, entry: SavedWindow, path = stateFilePath()) {
  const file = { ...readState(path), [label]: entry };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2));
  renameSync(tmp, path);
}
