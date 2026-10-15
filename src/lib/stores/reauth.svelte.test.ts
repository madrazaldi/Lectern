import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ accountChanged: [] as (() => void)[] }));
const sso = vi.hoisted(() => ({ reauthenticateWithSso: vi.fn() }));
const reauthenticateWith = vi.hoisted(() => vi.fn(async (signIn: (id: string) => Promise<unknown>) => signIn('acc')));

vi.mock('$lib/api/client', () => ({
  getCredentials: () => ({ id: 'acc', serverUrl: 'http://abs', method: 'openid' }),
  onAccountChanged: (fn: () => void) => void hooks.accountChanged.push(fn)
}));
vi.mock('$lib/util/sso', () => ({ ...sso, isCancelled: (e: unknown) => (e as Error)?.name === 'AbortError' }));
vi.mock('./session.svelte', () => ({ session: { reauthenticateWith } }));
vi.mock('./toast.svelte', () => ({ errorMessage: (e: unknown) => (e as Error).message }));

const { ssoReauth } = await import('./reauth.svelte');

/** A browser leg that waits until aborted. */
function waitUntilAborted() {
  sso.reauthenticateWithSso.mockImplementation(
    (_id: string, _url: string, { signal }: { signal: AbortSignal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))))
  );
}

beforeEach(() => {
  sso.reauthenticateWithSso.mockReset();
  ssoReauth.error = null;
});

describe('ssoReauth', () => {
  it('keeps waiting for the browser on its own, until cancelled', async () => {
    waitUntilAborted();
    const signingIn = ssoReauth.start();
    expect(ssoReauth.waiting).not.toBeNull();
    // A second press while waiting doesn't open the browser again.
    await ssoReauth.start();
    expect(sso.reauthenticateWithSso).toHaveBeenCalledTimes(1);
    ssoReauth.cancel();
    await signingIn;
    expect(ssoReauth.waiting).toBeNull();
    expect(ssoReauth.error).toBeNull();
  });

  it('stops waiting when the account changes', async () => {
    waitUntilAborted();
    const signingIn = ssoReauth.start();
    hooks.accountChanged.forEach((fn) => fn());
    await signingIn;
    expect(ssoReauth.waiting).toBeNull();
  });

  it('reports a sign-in that failed', async () => {
    sso.reauthenticateWithSso.mockRejectedValue(new Error('Provider said no'));
    await ssoReauth.start();
    expect(ssoReauth.error).toBe('Provider said no');
    expect(ssoReauth.waiting).toBeNull();
  });
});
