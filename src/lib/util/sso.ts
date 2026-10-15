import { ApiError, beginOpenIdLogin, completeOpenIdLogin, isOpenIdCallback, reauthenticateWithOpenId, type OpenIdPending } from '$lib/api/client';
import { inTauri, onDeepLink, openExternal, showMainWindow } from '$lib/native';

/** Single sign-on needs the desktop app: only it can receive the deep link the browser comes back with. */
export const ssoAvailable = inTauri;

/** How long to wait for the browser. Generous, since signing in at the provider can involve a second factor. */
export const SSO_TIMEOUT_MS = 5 * 60_000;

export interface SsoOptions {
  /** Abort to stop waiting (the user pressed Cancel). */
  signal?: AbortSignal;
  timeout?: number;
}

function abortError() {
  return new DOMException('Sign-in cancelled.', 'AbortError');
}

/**
 * Open the identity provider's sign-in page in the browser and wait for the deep link that brings this sign-on back.
 * Rejects with an AbortError when `signal` aborts, and with an ApiError after `timeout`.
 */
export async function waitForBrowser(pending: OpenIdPending, { signal, timeout = SSO_TIMEOUT_MS }: SsoOptions = {}): Promise<string> {
  if (signal?.aborted) throw abortError();
  let done = false;
  let unlisten = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<string>((succeed, fail) => {
      // Settle synchronously, so a listener that registers afterwards knows not to open the browser.
      const resolve = (link: string) => {
        done = true;
        succeed(link);
      };
      const reject = (err: unknown) => {
        done = true;
        fail(err);
      };
      onAbort = () => reject(abortError());
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => reject(new ApiError(0, 'Lectern stopped waiting for your browser. Start the sign-in again when you’re ready.')), timeout);
      // Listen before opening the browser, so a quick sign-in can't come back unheard.
      onDeepLink((urls) => {
        const link = urls.find((url) => isOpenIdCallback(pending, url));
        if (link) resolve(link);
      })
        .then(async (fn) => {
          if (done) return fn();
          unlisten = fn;
          await openExternal(pending.authorizeUrl);
        })
        .catch((err) => reject(new ApiError(0, `Couldn't open your browser to sign in. ${String(err)}`)));
    });
  } finally {
    done = true;
    unlisten();
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

async function browserLeg(serverUrl: string, opts: SsoOptions) {
  const pending = await beginOpenIdLogin(serverUrl);
  if (opts.signal?.aborted) throw abortError();
  const link = await waitForBrowser(pending, opts);
  // The browser has the focus now; bring the app back in front.
  void showMainWindow().catch(() => {});
  return { pending, link };
}

/** Sign in to `serverUrl` through the browser and make it the active account. */
export async function signInWithSso(serverUrl: string, opts: SsoOptions = {}) {
  const { pending, link } = await browserLeg(serverUrl, opts);
  return completeOpenIdLogin(pending, link);
}

/** Sign a saved single sign-on account in again, in place. */
export async function reauthenticateWithSso(accountId: string, serverUrl: string, opts: SsoOptions = {}) {
  const { pending, link } = await browserLeg(serverUrl, opts);
  return reauthenticateWithOpenId(accountId, pending, link);
}

export function isCancelled(err: unknown) {
  return (err as Error | null)?.name === 'AbortError';
}
