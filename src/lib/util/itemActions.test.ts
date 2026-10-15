import { afterEach, describe, expect, it } from 'vitest';
import type { LibraryItem } from '$lib/api/types';
import { itemActions, itemMenuRequest, registerItemAction } from './itemActions';

const book = { id: 'b1', mediaType: 'book', media: { metadata: { title: 'Long Night' } } } as unknown as LibraryItem;
const run = () => {};
const undo: (() => void)[] = [];
const reg = (...args: Parameters<typeof registerItemAction>) => undo.push(registerItemAction(...args));

afterEach(() => undo.splice(0).forEach((fn) => fn()));

describe('item action registry', () => {
  it('orders by section, then by order, and drops actions that do not apply', () => {
    reg({ id: 't-go', section: 'go', build: () => ({ label: 'Go', run }) });
    reg({ id: 't-play2', section: 'play', order: 2, build: () => ({ label: 'Second', run }) });
    reg({ id: 't-play1', section: 'play', order: 1, build: () => ({ label: 'First', run }) });
    reg({ id: 't-never', section: 'play', build: () => null });
    reg({ id: 't-custom', section: 'ebooks', build: () => ({ label: 'Read', run }) });
    const ids = itemActions({ item: book }).map((a) => a.id);
    expect(ids).toEqual(['t-play1', 't-play2', 't-go', 't-custom']);
  });

  it('passes the target to each action and tags its section', () => {
    reg({ id: 't-title', section: 'library', build: (t) => ({ label: t.item.media.metadata.title, run }) });
    const [a] = itemActions({ item: book });
    expect(a).toMatchObject({ id: 't-title', label: 'Long Night', section: 'library' });
  });

  it('replaces an action registered under the same id, and unregisters', () => {
    const off = registerItemAction({ id: 't-x', section: 'play', build: () => ({ label: 'Old', run }) });
    reg({ id: 't-x', section: 'play', build: () => ({ label: 'New', run }) });
    off(); // the replaced one; must not remove its replacement
    expect(itemActions({ item: book }).map((a) => a.label)).toEqual(['New']);
  });

  it('names the menu after the title, or has no menu at all', () => {
    expect(itemMenuRequest({ item: book })).toBeNull();
    reg({ id: 't-y', section: 'play', build: () => ({ label: 'Play', run }) });
    expect(itemMenuRequest({ item: book })?.label).toBe('Actions for Long Night');
  });
});
