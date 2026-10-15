import { describe, expect, it } from 'vitest';
import { firstEnabled, menuKey, opensContextMenu, placeMenu } from './menu';

const items = [{ label: 'Play' }, { label: 'Add to Up Next' }, { label: 'Download', disabled: true }, { label: 'Go to series' }, { label: 'Go to author' }];

describe('context menu keyboard', () => {
  it('opens with Shift+F10 or the context-menu key only', () => {
    expect(opensContextMenu({ key: 'F10', shiftKey: true })).toBe(true);
    expect(opensContextMenu({ key: 'ContextMenu', shiftKey: false })).toBe(true);
    expect(opensContextMenu({ key: 'F10', shiftKey: false })).toBe(false);
  });

  it('starts on the first enabled item', () => {
    expect(firstEnabled(items)).toBe(0);
    expect(firstEnabled([{ label: 'x', disabled: true }, { label: 'y' }])).toBe(1);
    expect(firstEnabled([])).toBe(-1);
  });

  it('moves with the arrows, skipping disabled items and wrapping', () => {
    expect(menuKey('ArrowDown', 1, items)).toEqual({ type: 'move', index: 3 });
    expect(menuKey('ArrowDown', 4, items)).toEqual({ type: 'move', index: 0 });
    expect(menuKey('ArrowUp', 0, items)).toEqual({ type: 'move', index: 4 });
    expect(menuKey('ArrowUp', 3, items)).toEqual({ type: 'move', index: 1 });
  });

  it('jumps to the ends with Home and End', () => {
    expect(menuKey('Home', 3, items)).toEqual({ type: 'move', index: 0 });
    expect(menuKey('End', 0, items)).toEqual({ type: 'move', index: 4 });
  });

  it('activates with Enter or Space, but not a disabled item', () => {
    expect(menuKey('Enter', 1, items)).toEqual({ type: 'activate', index: 1 });
    expect(menuKey(' ', 3, items)).toEqual({ type: 'activate', index: 3 });
    expect(menuKey('Enter', 2, items)).toBeNull();
  });

  it('closes with Escape or Tab', () => {
    expect(menuKey('Escape', 0, items)).toEqual({ type: 'close' });
    expect(menuKey('Tab', 0, items)).toEqual({ type: 'close' });
  });

  it('jumps to the next item starting with a typed letter', () => {
    expect(menuKey('g', 0, items)).toEqual({ type: 'move', index: 3 });
    expect(menuKey('G', 3, items)).toEqual({ type: 'move', index: 4 });
    expect(menuKey('d', 0, items)).toBeNull();
    expect(menuKey('x', 0, items)).toBeNull();
  });

  it('keeps a menu inside the window', () => {
    const vp = { width: 1000, height: 800 };
    expect(placeMenu(100, 100, { width: 200, height: 300 }, vp)).toEqual({ left: 100, top: 100 });
    expect(placeMenu(900, 100, { width: 200, height: 300 }, vp)).toEqual({ left: 700, top: 100 });
    expect(placeMenu(100, 700, { width: 200, height: 300 }, vp)).toEqual({ left: 100, top: 492 });
  });
});
