import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismiss, pause, resume, toast, toasts } from './toast.svelte';

const ids = () => toasts.map((t) => t.id);

describe('toasts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const t of [...toasts]) dismiss(t.id);
    vi.useRealTimers();
  });

  it('gives errors and action toasts longer on screen', () => {
    const info = toast('Saved.');
    const error = toast('Failed.', { tone: 'error' });
    const undo = toast('Removed.', { action: { label: 'Undo', run: () => {} } });
    vi.advanceTimersByTime(4000);
    expect(ids()).toEqual([error, undo]);
    vi.advanceTimersByTime(3000);
    expect(ids()).toEqual([undo]);
    vi.advanceTimersByTime(1999);
    expect(ids()).toEqual([undo]);
    vi.advanceTimersByTime(1);
    expect(ids()).toEqual([]);
    expect(info).toBeLessThan(error);
  });

  it('holds while paused and resumes with the time that was left', () => {
    const id = toast('Saved.');
    vi.advanceTimersByTime(1000);
    pause(id);
    vi.advanceTimersByTime(60_000);
    expect(ids()).toEqual([id]);
    resume(id);
    vi.advanceTimersByTime(2999);
    expect(ids()).toEqual([id]);
    vi.advanceTimersByTime(1);
    expect(ids()).toEqual([]);
  });

  it('leaves a moment to finish reading after the pointer leaves', () => {
    const id = toast('Saved.');
    vi.advanceTimersByTime(3900);
    pause(id);
    resume(id);
    vi.advanceTimersByTime(1499);
    expect(ids()).toEqual([id]);
    vi.advanceTimersByTime(1);
    expect(ids()).toEqual([]);
  });
});
