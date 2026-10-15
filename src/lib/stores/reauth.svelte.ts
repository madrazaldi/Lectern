import { getCredentials, onAccountChanged } from '$lib/api/client';
import { isCancelled, reauthenticateWithSso } from '$lib/util/sso';
import { session } from './session.svelte';
import { errorMessage } from './toast.svelte';

/**
 * Signing the current account in again through the browser (single sign-on). Kept here rather than in the banner
 * that starts it, so going to the mini player (which takes the banner down) doesn't stop waiting for the browser.
 */
class SsoReauth {
  /** Set while the browser is out signing in again; abort to stop waiting. */
  waiting = $state<AbortController | null>(null);
  error = $state<string | null>(null);

  constructor() {
    // A sign-in for the previous account is no use to the next one.
    onAccountChanged(() => {
      this.cancel();
      this.error = null;
    });
  }

  async start() {
    const account = getCredentials();
    if (!account || this.waiting) return;
    const { serverUrl } = account;
    this.error = null;
    const ctrl = new AbortController();
    this.waiting = ctrl;
    try {
      await session.reauthenticateWith((id) => reauthenticateWithSso(id, serverUrl, { signal: ctrl.signal }));
    } catch (err) {
      if (!isCancelled(err)) this.error = errorMessage(err);
    } finally {
      if (this.waiting === ctrl) this.waiting = null;
    }
  }

  cancel() {
    this.waiting?.abort();
  }
}

export const ssoReauth = new SsoReauth();
