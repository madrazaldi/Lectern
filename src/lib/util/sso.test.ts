// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  deliver: null as null | ((urls: string[]) => void),
  unlisten: vi.fn(),
  opened: [] as string[]
}));

vi.mock('$lib/native', () => ({
  inApp: true,
  secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
  onDeepLink: async (fn: (urls: string[]) => void) => {
    native.deliver = fn;
    return native.unlisten;
  },
  openExternal: async (url: string) => void native.opened.push(url),
  showMainWindow: async () => {}
}));

vi.mock('$lib/stores/toast.svelte', () => ({ toast: vi.fn() }));

const { SSO_TIMEOUT_MS, isCancelled, waitForBrowser } = await import('./sso');

const pending = {
  serverUrl: 'https://abs.example.com',
  authorizeUrl: 'https://idp.example.com/authorize',
  redirectUri: 'audiobookshelf://oauth',
  state: 'st',
  verifier: 'v',
  cookie: 'connect.sid=x'
};

beforeEach(() => {
  native.deliver = null;
  native.unlisten.mockClear();
  native.opened = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForBrowser', () => {
  it('opens the provider page once listening, and resolves with the matching deep link', async () => {
    const result = waitForBrowser(pending);
    await vi.waitFor(() => expect(native.opened).toEqual([pending.authorizeUrl]));
    native.deliver!(['lectern://something-else']);
    native.deliver!(['audiobookshelf://item/1', 'audiobookshelf://oauth/?code=c&state=st']);
    await expect(result).resolves.toBe('audiobookshelf://oauth/?code=c&state=st');
    expect(native.unlisten).toHaveBeenCalled();
  });

  it('stops waiting when cancelled', async () => {
    const ctrl = new AbortController();
    const result = waitForBrowser(pending, { signal: ctrl.signal }).catch((e) => e);
    await vi.waitFor(() => expect(native.opened).toHaveLength(1));
    ctrl.abort();
    const err = await result;
    expect(isCancelled(err)).toBe(true);
    expect(native.unlisten).toHaveBeenCalled();
  });

  it('does not open the browser if cancelled before listening started', async () => {
    const ctrl = new AbortController();
    const result = waitForBrowser(pending, { signal: ctrl.signal }).catch((e) => e);
    ctrl.abort();
    expect(isCancelled(await result)).toBe(true);
    await vi.waitFor(() => expect(native.unlisten).toHaveBeenCalled());
    expect(native.opened).toEqual([]);
  });

  it('gives up after a while', async () => {
    vi.useFakeTimers();
    const result = waitForBrowser(pending).catch((e) => e);
    await vi.advanceTimersByTimeAsync(SSO_TIMEOUT_MS + 10);
    const err = await result;
    expect(isCancelled(err)).toBe(false);
    expect(err.message).toMatch(/stopped waiting for your browser/);
  });
});
