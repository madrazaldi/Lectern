<script lang="ts">
  import { KeyRound, LoaderCircle } from '@lucide/svelte';
  import { getCredentials } from '$lib/api/client';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage } from '$lib/stores/toast.svelte';
  import { isCancelled, reauthenticateWithSso, ssoAvailable } from '$lib/util/sso';

  // The server stopped accepting this account. Nothing is lost meanwhile: downloads play and progress waits in the outbox.
  const account = $derived(session.needsReauth ? getCredentials() : null);
  const isKey = $derived(account?.method === 'apikey');
  const isSso = $derived(account?.method === 'openid');
  let open = $state(false);
  let secret = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** Set while the browser is out signing in again; abort to stop waiting. */
  let waiting = $state<AbortController | null>(null);
  // Stop listening for the browser if this goes away mid-sign-in.
  $effect(() => () => waiting?.abort());

  function host(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!secret.trim()) return;
    busy = true;
    error = null;
    try {
      await session.reauthenticate(secret);
      secret = '';
      open = false;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function sso() {
    if (!account || waiting) return;
    const { serverUrl } = account;
    error = null;
    const ctrl = new AbortController();
    waiting = ctrl;
    try {
      await session.reauthenticateWith((id) => reauthenticateWithSso(id, serverUrl, { signal: ctrl.signal }));
    } catch (err) {
      if (!isCancelled(err)) error = errorMessage(err);
    } finally {
      if (waiting === ctrl) waiting = null;
    }
  }
</script>

{#if account}
  <div class="reauth" role="status">
    <div class="line">
      <KeyRound size={16} />
      <span>
        {host(account.serverUrl)} signed {account.username ?? 'you'} out. Your downloads still play, and progress syncs once you sign in again.
      </span>
      {#if isSso}
        {#if waiting}
          <LoaderCircle size={16} class="spin" />
          <button class="btn btn-quiet" onclick={() => waiting?.abort()}>Cancel</button>
        {:else if ssoAvailable}
          <button class="btn btn-primary" onclick={sso}>Sign in again</button>
        {/if}
      {:else if !open}
        <button class="btn btn-primary" onclick={() => (open = true)}>Sign in again</button>
      {/if}
    </div>
    {#if waiting}
      <p>Waiting for your browser. Finish signing in there and Lectern will pick it up.</p>
    {:else if isSso && !ssoAvailable}
      <p>This account signs in with single sign-on, which works in the Lectern desktop app but not in a browser tab.</p>
    {/if}
    {#if isSso}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    {:else if open}
      <form onsubmit={submit} novalidate>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="field"
          type="password"
          bind:value={secret}
          placeholder={isKey ? 'New API key' : `Password for ${account.username ?? 'this account'}`}
          autocomplete={isKey ? 'off' : 'current-password'}
          aria-label={isKey ? 'API key' : 'Password'}
          autofocus
        />
        <button class="btn btn-primary" disabled={busy || !secret.trim()}>
          {#if busy}<LoaderCircle size={16} class="spin" />{/if} Sign in
        </button>
        <button type="button" class="btn btn-quiet" onclick={() => ((open = false), (error = null))} disabled={busy}>Cancel</button>
      </form>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    {/if}
  </div>
{/if}

<style>
  .reauth {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(640px, calc(100vw - 48px));
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--raised-2);
    border: 1px solid var(--rule);
    box-shadow: 0 14px 34px -10px rgb(0 0 0 / 0.55);
    font-size: var(--t-sm);
    color: var(--text-2);
  }
  .line,
  form {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .line span {
    flex: 1;
  }
  form .field {
    flex: 1;
    min-width: 0;
  }
  .error {
    color: var(--danger);
  }
</style>
