<script lang="ts">
  import { KeyRound, LoaderCircle, UserRound } from '@lucide/svelte';
  import { loginWithApiKey, loginWithPassword, normalizeServerUrl, probeServer } from '$lib/api/client';
  import { session } from '$lib/stores/session.svelte';

  const LAST_SERVER = 'lectern.lastServer';

  let server = $state(localStorage.getItem(LAST_SERVER) ?? '');
  let method = $state<'password' | 'apikey'>('password');
  let username = $state('');
  let password = $state('');
  let apiKey = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  // A short shelf for the welcome panel: varied heights, a few already "read".
  const spines = Array.from({ length: 22 }, (_, i) => {
    const x = Math.sin(i * 7.13 + 1.3) * 10000;
    return { h: 46 + (x - Math.floor(x)) * 54, w: 10 + ((i * 7) % 5) * 4, read: i < 9 };
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (!server.trim()) return (error = 'Enter your server address.');
    if (method === 'password' && !username.trim()) return (error = 'Enter your username.');
    if (method === 'apikey' && !apiKey.trim()) return (error = 'Paste an API key from your server settings.');
    busy = true;
    try {
      const url = normalizeServerUrl(server);
      await probeServer(url);
      if (method === 'password') await loginWithPassword(url, username.trim(), password);
      else await loginWithApiKey(url, apiKey);
      localStorage.setItem(LAST_SERVER, url);
      await session.load();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

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
      <h2>Connect to your server</h2>

      <label class="lbl">
        Server address
        <input class="field" bind:value={server} placeholder="abs.example.com or 192.168.1.20:13378" autocomplete="url" spellcheck="false" />
      </label>

      <div class="seg" role="radiogroup" aria-label="Sign-in method">
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
          <textarea class="field key" bind:value={apiKey} rows="3" spellcheck="false" placeholder="Create one under Settings → API Keys on your server"></textarea>
        </label>
      {/if}

      {#if error}<p class="error" role="alert">{error}</p>{/if}

      <button class="btn btn-primary btn-lg submit" disabled={busy}>
        {#if busy}<LoaderCircle size={18} class="spin" /> Connecting{:else}Sign in{/if}
      </button>
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
  @media (max-width: 1000px) {
    .login {
      grid-template-columns: 1fr;
    }
    .welcome {
      display: none;
    }
  }
</style>
