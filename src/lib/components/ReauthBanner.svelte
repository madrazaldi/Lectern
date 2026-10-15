<script lang="ts">
  import { KeyRound, LoaderCircle } from '@lucide/svelte';
  import { getCredentials } from '$lib/api/client';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage } from '$lib/stores/toast.svelte';

  // The server stopped accepting this account. Nothing is lost meanwhile: downloads play and progress waits in the outbox.
  const account = $derived(session.needsReauth ? getCredentials() : null);
  const isKey = $derived(account?.method === 'apikey');
  let open = $state(false);
  let secret = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

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
</script>

{#if account}
  <div class="reauth" role="status">
    <div class="line">
      <KeyRound size={16} />
      <span>
        {host(account.serverUrl)} signed {account.username ?? 'you'} out. Your downloads still play, and progress syncs once you sign in again.
      </span>
      {#if !open}
        <button class="btn btn-primary" onclick={() => (open = true)}>Sign in again</button>
      {/if}
    </div>
    {#if open}
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
