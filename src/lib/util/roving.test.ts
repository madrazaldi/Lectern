// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { roving, rovingIndex } from './roving';

describe('rovingIndex', () => {
  it('moves along the orientation and wraps', () => {
    expect(rovingIndex('ArrowRight', 0, 3)).toBe(1);
    expect(rovingIndex('ArrowRight', 2, 3)).toBe(0);
    expect(rovingIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(rovingIndex('ArrowDown', 0, 3)).toBeNull();
    expect(rovingIndex('ArrowDown', 0, 3, 'vertical')).toBe(1);
    expect(rovingIndex('ArrowRight', 0, 3, 'vertical')).toBeNull();
    expect(rovingIndex('ArrowUp', 1, 3, 'both')).toBe(0);
  });

  it('jumps to the ends', () => {
    expect(rovingIndex('Home', 2, 4)).toBe(0);
    expect(rovingIndex('End', 0, 4)).toBe(3);
  });

  it('skips disabled items', () => {
    const enabled = (i: number) => i !== 1;
    expect(rovingIndex('ArrowRight', 0, 3, 'horizontal', enabled)).toBe(2);
    expect(rovingIndex('Home', 2, 3, 'horizontal', (i) => i > 0)).toBe(1);
  });

  it('ignores other keys', () => {
    expect(rovingIndex('a', 0, 3)).toBeNull();
    expect(rovingIndex('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('roving attachment', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    document.body.innerHTML = '';
  });

  function group(checked: number | null) {
    const el = document.createElement('div');
    el.setAttribute('role', 'radiogroup');
    const clicks: number[] = [];
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('button');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === checked));
      b.addEventListener('click', () => {
        clicks.push(i);
        for (const x of el.children) x.setAttribute('aria-checked', String(x === b));
      });
      el.append(b);
    }
    document.body.append(el);
    cleanup = roving()(el);
    return { el, buttons: Array.from(el.children) as HTMLButtonElement[], clicks };
  }

  it('leaves only the checked item in the tab order', () => {
    const { buttons } = group(1);
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('falls back to the first item when nothing is checked', () => {
    const { buttons } = group(null);
    expect(buttons.map((b) => b.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves focus and selection with the arrows, without letting the key reach the page', async () => {
    const { el, buttons, clicks } = group(0);
    const page = vi.fn();
    document.addEventListener('keydown', page);
    buttons[0].focus();
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    expect(clicks).toEqual([1]);
    expect(page).not.toHaveBeenCalled();
    // The MutationObserver re-syncs tab stops after the selection changes.
    await new Promise((r) => setTimeout(r, 0));
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    document.removeEventListener('keydown', page);
    expect(el.getAttribute('role')).toBe('radiogroup');
  });
});
