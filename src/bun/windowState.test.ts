import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onScreen, parseState, readState, restore, saveWindow, scaleFor, toFrame, toSaved, type DisplayInfo } from './windowState';

const scratch = mkdtempSync(join(tmpdir(), 'lectern-ws-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const retina: DisplayInfo = { bounds: { x: 0, y: 0, width: 1470, height: 956 }, scaleFactor: 2, isPrimary: true };
const external: DisplayInfo = { bounds: { x: 1470, y: -100, width: 2560, height: 1440 }, scaleFactor: 1 };

// The file the Tauri build wrote on this Mac.
const TAURI_FILE = `{
  "main": { "width": 2640, "height": 1666, "x": 150, "y": 66, "prev_x": 150, "prev_y": 66, "maximized": false, "visible": true, "decorated": true, "fullscreen": false }
}`;

describe('reading the Tauri window-state file', () => {
  it('turns physical pixels into points', () => {
    const r = restore(parseState(TAURI_FILE), 'main', [retina]);
    expect(r).toEqual({ frame: { x: 75, y: 33, width: 1320, height: 833 }, maximized: false, fullscreen: false });
  });

  it('ignores damaged files and entries', () => {
    expect(parseState(null)).toEqual({});
    expect(parseState('not json')).toEqual({});
    expect(parseState('[1]')).toEqual({});
    expect(parseState('{"main":{"x":1,"y":2,"width":0,"height":5}}')).toEqual({});
    expect(Object.keys(parseState('{"main":{"x":1,"y":2,"width":3,"height":5},"bad":{"x":"1"}}'))).toEqual(['main']);
  });

  it('has nothing for a window it has not seen', () => {
    expect(restore(parseState(TAURI_FILE), 'other', [retina])).toBeNull();
  });
});

describe('placing windows', () => {
  it('knows when a window has been left on a display that is gone', () => {
    expect(onScreen({ x: 100, y: 100, width: 800, height: 600 }, [retina])).toBe(true);
    expect(onScreen({ x: 3000, y: 100, width: 800, height: 600 }, [retina])).toBe(false);
    expect(onScreen({ x: -100, y: 100, width: 800, height: 600 }, [retina])).toBe(false);
  });

  it('works out the scale from the display the position falls on', () => {
    const saved = { x: 3500, y: 100, width: 1000, height: 700 };
    // 1x external display on the right: physical == points there.
    expect(toFrame(saved, [retina, external])).toEqual({ x: 3500, y: 100, width: 1000, height: 700 });
    // Without it the position is off every display.
    expect(toFrame(saved, [retina])).toBeNull();
  });

  it('picks the scale of the display a frame is mostly on', () => {
    expect(scaleFor({ x: 100, y: 100, width: 800, height: 600 }, [retina, external])).toBe(2);
    expect(scaleFor({ x: 2000, y: 100, width: 800, height: 600 }, [retina, external])).toBe(1);
    expect(scaleFor({ x: 9000, y: 100, width: 800, height: 600 }, [retina, external])).toBe(2);
    expect(scaleFor({ x: 0, y: 0, width: 1, height: 1 }, [])).toBe(1);
  });

  it('round-trips a frame exactly', () => {
    const frame = { x: 211, y: 61, width: 1101, height: 701 };
    const saved = toSaved(frame, 2, { maximized: false, fullscreen: false });
    expect(saved).toMatchObject({ x: 422, y: 122, width: 2202, height: 1402, maximized: false, fullscreen: false });
    expect(toFrame(saved, [retina])).toEqual(frame);
  });
});

describe('saving', () => {
  it('replaces one window and keeps the rest of the file', () => {
    const path = join(scratch, '.window-state.json');
    writeFileSync(path, TAURI_FILE.replace('"main"', '"other"'));
    saveWindow('main', toSaved({ x: 10, y: 20, width: 800, height: 600 }, 2, { maximized: true, fullscreen: false }), path);
    const file = readState(path);
    expect(Object.keys(file).sort()).toEqual(['main', 'other']);
    expect(file.main).toMatchObject({ x: 20, y: 40, width: 1600, height: 1200, maximized: true, decorated: true });
    expect(file.other?.width).toBe(2640);
    expect(readdirSync(scratch).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(JSON.parse(readFileSync(path, 'utf8')).main.prev_x).toBe(20);
  });

  it('keeps the fields it does not know about', () => {
    const previous = { x: 1, y: 2, width: 3, height: 4, decorated: false, extra: 'kept' } as never;
    const saved = toSaved({ x: 5, y: 6, width: 7, height: 8 }, 1, { maximized: false, fullscreen: false }, previous);
    expect(saved).toMatchObject({ decorated: false, extra: 'kept', x: 5 });
  });
});
