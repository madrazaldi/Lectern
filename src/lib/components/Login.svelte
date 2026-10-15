<script lang="ts">
  import { ExternalLink, KeyRound, LoaderCircle, UserRound } from '@lucide/svelte';
  import { loginWithApiKey, loginWithPassword, normalizeServerUrl, resolveServer, type ServerStatus } from '$lib/api/client';
  import { session } from '$lib/stores/session.svelte';
  import { friendlyLoginError } from '$lib/util/errors';
  import { roving } from '$lib/util/roving';
  import { isCancelled, signInWithSso, ssoAvailable } from '$lib/util/sso';
  import { pageTitle } from '$lib/util/title';

  const LAST_SERVER = 'lectern.lastServer';
  /** Pause in typing before looking up the server, so its sign-in options show before submitting. */
  const PROBE_DELAY_MS = 600;

  let server = $state(localStorage.getItem(LAST_SERVER) ?? '');
  let method = $state<'password' | 'apikey'>('password');
  let username = $state('');
  let password = $state('');
  let apiKey = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** The server last found behind the address field, with what it allows. */
  let probe = $state<{ input: string; url: string; status: ServerStatus } | null>(null);
  /** Set while the browser is out signing in; abort to stop waiting. */
  let waiting = $state<AbortController | null>(null);
  // Stop listening for the browser if this goes away mid-sign-in.
  $effect(() => () => waiting?.abort());

  const known = $derived(probe && probe.input === server.trim() ? probe : null);
  const methods = $derived(known?.status.authMethods ?? ['local']);
  const openId = $derived(methods.includes('openid'));
  // Unknown or older servers report nothing useful: offer the usual sign-in.
  const localAllowed = $derived(methods.includes('local') || !openId);
  // The single sign-on button takes the lead when there is one.
  const ssoOffered = $derived(openId && ssoAvailable);
  const ssoLabel = $derived(known?.status.authFormData?.authOpenIDButtonText?.trim() || 'Sign in with single sign-on');

  // A short shelf for the welcome panel: varied heights, a few already "read".
  const spines = Array.from({ length: 22 }, (_, i) => {
    const x = Math.sin(i * 7.13 + 1.3) * 10000;
    return { h: 46 + (x - Math.floor(x)) * 54, w: 10 + ((i * 7) % 5) * 4, read: i < 9 };
  });

  async function lookup(input: string) {
    const { url, status } = await resolveServer(input);
    probe = { input: input.trim(), url, status };
    return probe;
  }

  let probing: string | null = null;

  /** Look the server up quietly; failures wait until the user submits. */
  function check(input: string) {
    const key = input.trim();
    if (!key || probe?.input === key || probing === key) return;
    probing = key;
    lookup(input)
      .catch(() => {})
      .finally(() => {
        if (probing === key) probing = null;
      });
  }

  $effect(() => {
    const input = server;
    const timer = setTimeout(() => check(input), PROBE_DELAY_MS);
    return () => clearTimeout(timer);
  });

  async function finish(url: string) {
    localStorage.setItem(LAST_SERVER, url);
    // Signing in to another account on top of one already open: restart into it with clean state.
    if (session.addingAccount) return location.reload();
    await session.load();
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (!server.trim()) return (error = 'Enter your server address.');
    if (known && !localAllowed) return sso();
    if (method === 'password' && !username.trim()) return (error = 'Enter your username.');
    if (method === 'apikey' && !apiKey.trim()) return (error = 'Paste an API key from your server settings.');
    busy = true;
    let url: string | undefined;
    try {
      url = normalizeServerUrl(server);
      const found = known ?? (await lookup(server));
      url = found.url;
      // The server turned out to take single sign-on only: the form now offers just that.
      if (!found.status.authMethods.includes('local') && found.status.authMethods.includes('openid')) return;
      if (method === 'password') await loginWithPassword(url, username.trim(), password);
      else await loginWithApiKey(url, apiKey);
      await finish(url);
    } catch (err) {
      error = friendlyLoginError(err, server, url);
    } finally {
      busy = false;
    }
  }

  function cancelAdding() {
    waiting?.abort();
    session.addingAccount = false;
  }

  async function sso() {
    if (!known || waiting || !ssoAvailable) return;
    const { url } = known;
    error = null;
    const ctrl = new AbortController();
    waiting = ctrl;
    try {
      await signInWithSso(url, { signal: ctrl.signal });
      await finish(url);
    } catch (err) {
      if (!isCancelled(err)) error = friendlyLoginError(err, server, url);
    } finally {
      if (waiting === ctrl) waiting = null;
    }
  }
</script>

<svelte:head><title>{pageTitle(session.addingAccount ? 'Add an account' : 'Sign in')}</title></svelte:head>

<div class="login">
  <div class="drag" data-tauri-drag-region></div>
  <section class="welcome" aria-hidden="true">
    <div class="shelf">
      {#each spines as s, i (i)}
        <span class="spine" class:read={s.read} style:height="{s.h}%" style:width="{s.w}px" style:animation-delay="{i * 35}ms"></span>
      {/each}
    </div>
    <h1 class="serif">Lectern</h1>
    <p>Your Audiobookshelf library, on the desktop.</p>
  </section>

  <section class="panel">
    <form onsubmit={submit} novalidate>
      <h2>{session.addingAccount ? 'Add an account' : 'Connect to your server'}</h2>

      <label class="lbl">
        Server address
        <input
          class="field"
          bind:value={server}
          onblur={() => check(server)}
          placeholder="abs.example.com or 192.168.1.20:13378"
          autocomplete="url"
          spellcheck="false"
        />
      </label>

      {#if openId}
        {#if !ssoAvailable}
          <p class="note">This server signs in with single sign-on, which works in the Lectern desktop app but not in a browser tab.</p>
        {:else if waiting}
          <div class="waiting" role="status">
            <LoaderCircle size={18} class="spin" />
            <span>Waiting for your browser. Finish signing in there and Lectern will pick it up.</span>
            <button type="button" class="btn btn-quiet" onclick={() => waiting?.abort()}>Cancel</button>
          </div>
        {:else}
          <button type="button" class="btn btn-primary btn-lg submit" onclick={sso} disabled={busy}>
            <ExternalLink size={17} />
            {ssoLabel}
          </button>
        {/if}
        {#if localAllowed}<p class="or" aria-hidden="true"><span>or</span></p>{/if}
      {/if}

      {#if localAllowed}
        <div class="seg" role="radiogroup" aria-label="Sign-in method" {@attach roving()}>
          <button type="button" role="radio" aria-checked={method === 'password'} onclick={() => (method = 'password')}>
            <UserRound size={15} /> Username
          </button>
          <button type="button" role="radio" aria-checked={method === 'apikey'} onclick={() => (method = 'apikey')}>
            <KeyRound size={15} /> API key
          </button>
        </div>

        {#if method === 'password'}
          <label class="lbl">
            Username
            <input class="field" bind:value={username} autocomplete="username" spellcheck="false" />
          </label>
          <label class="lbl">
            Password
            <input class="field" type="password" bind:value={password} autocomplete="current-password" />
          </label>
        {:else}
          <label class="lbl">
            API key
            <textarea class="field key" bind:value={apiKey} rows="3" spellcheck="false" placeholder="Create one under Settings → API Keys on your server"
            ></textarea>
          </label>
        {/if}
      {/if}

      {#if error}<p class="error" role="alert">{error}</p>{/if}

      {#if localAllowed}
        <button class="btn btn-lg submit" class:btn-primary={!ssoOffered} class:btn-quiet={ssoOffered} disabled={busy || !!waiting}>
          {#if busy}<LoaderCircle size={18} class="spin" /> Connecting{:else}Sign in{/if}
        </button>
      {/if}
      {#if session.addingAccount}
        <button type="button" class="btn btn-quiet btn-lg submit" onclick={cancelAdding} disabled={busy}>Cancel</button>
      {/if}
    </form>
  </section>
</div>

<style>
  .login {
    position: relative;
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    height: 100vh;
  }
  .drag {
    position: absolute;
    inset: 0 0 auto;
    height: 44px;
    z-index: 2;
  }
  .welcome {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 64px;
    background: radial-gradient(ellipse at 20% 100%, var(--wash), transparent 70%), var(--sidebar);
    border-right: 1px solid var(--rule-soft);
    overflow: hidden;
  }
  .shelf {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 160px;
    padding-bottom: 6px;
    border-bottom: 2px solid var(--rule);
    margin-bottom: 40px;
    width: fit-content;
  }
  .spine {
    flex: none;
    border-radius: 3px 3px 1px 1px;
    background: var(--spine-empty);
    animation: rise 700ms var(--ease) both;
  }
  .spine.read {
    background: var(--accent);
    filter: saturate(0.8) brightness(0.9);
  }
  .spine:nth-child(10) {
    background: linear-gradient(0deg, var(--accent) 45%, var(--spine-empty) 45%);
    transform: translateY(-10px);
    animation-name: rise-current;
  }
  @keyframes rise {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
  }
  @keyframes rise-current {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
    to {
      transform: translateY(-10px);
    }
  }
  h1 {
    font-size: 4.25rem;
    line-height: 1;
    font-weight: 640;
    letter-spacing: -0.035em;
    font-variation-settings: 'opsz' 72;
  }
  .welcome p {
    margin-top: 14px;
    font-size: var(--t-lg);
    color: var(--text-2);
    max-width: 30ch;
  }
  .panel {
    display: grid;
    place-items: center;
    padding: 48px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: min(380px, 100%);
  }
  h2 {
    font-family: var(--font-serif);
    font-size: var(--t-xl);
    font-weight: 600;
    margin-bottom: 6px;
  }
  .lbl {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--text-2);
  }
  .lbl .field {
    font-weight: 400;
    color: var(--text);
  }
  .key {
    height: auto;
    padding: 10px 14px;
    resize: none;
    font-size: var(--t-sm);
    word-break: break-all;
  }
  .seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 3px;
    border-radius: var(--r-md);
    background: var(--raised);
    border: 1px solid var(--rule-soft);
  }
  .seg button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 32px;
    border-radius: 7px;
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--text-3);
  }
  .seg button[aria-checked='true'] {
    background: var(--raised-2);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
  }
  .error {
    padding: 10px 12px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--danger);
    font-size: var(--t-sm);
  }
  .submit {
    justify-content: center;
    margin-top: 4px;
  }
  .note {
    font-size: var(--t-sm);
    color: var(--text-2);
  }
  .waiting {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: var(--raised);
    border: 1px solid var(--rule-soft);
    font-size: var(--t-sm);
    color: var(--text-2);
  }
  .waiting span {
    flex: 1;
  }
  .or {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: var(--t-xs);
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--rule-soft);
  }
  @media (max-width: 1000px) {
    .login {
      grid-template-columns: 1fr;
    }
    .welcome {
      display: none;
    }
  }
</style>
