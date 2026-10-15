import { describe, expect, it, vi } from 'vitest';

const accountChanged = vi.hoisted(() => [] as (() => void)[]);
vi.mock('$lib/api/client', () => ({ onAccountChanged: (fn: () => void) => void accountChanged.push(fn) }));

const { bookKey, keepBook, keptBook, openable } = await import('./kept');

describe('the kept book', () => {
  it('keeps the last book opened, and only that one', () => {
    const a = new ArrayBuffer(4);
    keepBook(bookKey('item', 'ino1'), a);
    expect(keptBook('item:ino1')).toBe(a);
    keepBook(bookKey('item', 'ino2'), new ArrayBuffer(2));
    expect(keptBook('item:ino1')).toBeNull();
  });

  it('can be opened offline; other books can’t', () => {
    keepBook(bookKey('item', 'ino1'), new ArrayBuffer(4));
    expect(openable(false, 'item', 'ino1')).toBe(true);
    expect(openable(false, 'item', 'ino2')).toBe(false);
    expect(openable(false, 'item', undefined)).toBe(false);
    expect(openable(true, 'other', null)).toBe(true);
  });

  it('is forgotten when the account changes', () => {
    keepBook(bookKey('item', 'ino1'), new ArrayBuffer(4));
    accountChanged.forEach((fn) => fn());
    expect(keptBook('item:ino1')).toBeNull();
  });
});
