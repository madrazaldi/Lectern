<script lang="ts">
  import { LogOut } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { getCredentials, probeServer, type ServerStatus } from '$lib/api/client';
  import { player } from '$lib/stores/player.svelte';
  import { prefs, type Theme } from '$lib/stores/prefs.svelte';
  import { session } from '$lib/stores/session.svelte';

  const creds = getCredentials();
  let status = $state<ServerStatus | null>(null);

  onMount(() => {
    if (creds) probeServer(creds.serverUrl).then((s) => (status = s)).catch(() => {});
  });

  const skipOptions = [5, 10, 15, 30, 45, 60];
  const themes: { value: Theme; label: string }[] = [
    { value: 'system', label: 'Match system' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' }
  ];

  const shortcuts = [
    ['Space', 'Play or pause'],
    ['← / →', 'Skip back / forward'],
    ['⇧← / ⇧→', 'Previous / next chapter'],
    ['F', 'Open or close Now Playing'],
    ['B', 'Add a bookmark'],
    ['↑ / ↓', 'Change speed (in Now Playing)'],
    ['⌘K or /', 'Search'],
    ['⌘,', 'Settings']
  ];

  async function signOut() {
    await player.stop();
    localStorage.removeItem('lectern.lastPlayed');
    player.item = null;
    await session.signOut();
  }
</script>

<div class="page narrow">
  <h1 class="page-title">Settings</h1>

  <section>
    <h2 class="serif">Account</h2>
    <dl>
      <div><dt>Server</dt><dd class="selectable">{creds?.serverUrl}</dd></div>
      {#if status}<div><dt>Server version</dt><dd>Audiobookshelf {status.serverVersion}</dd></div>{/if}
      <div><dt>Signed in as</dt><dd>{session.user?.username} <span class="faint">({creds?.method === 'apikey' ? 'API key' : session.user?.type})</span></dd></div>
    </dl>
    <button class="btn btn-quiet" onclick={signOut}><LogOut size={16} /> Sign out</button>
  </section>

  <section>
    <h2 class="serif">Appearance</h2>
    <div class="row">
      <div class="label">
        <span>Theme</span>
      </div>
      <div class="seg" role="radiogroup" aria-label="Theme">
        {#each themes as t (t.value)}
          <button role="radio" aria-checked={prefs.theme === t.value} onclick={() => (prefs.theme = t.value)}>{t.label}</button>
        {/each}
      </div>
    </div>
    <label class="row">
      <div class="label">
        <span>Tint the app with the cover</span>
        <small>Accent colours follow the artwork of whatever is playing.</small>
      </div>
      <input type="checkbox" class="switch" bind:checked={prefs.coverTint} />
    </label>
  </section>

  <section>
    <h2 class="serif">Playback</h2>
    <label class="row">
      <div class="label"><span>Skip back</span></div>
      <select class="select" bind:value={prefs.skipBack}>
        {#each skipOptions as s (s)}<option value={s}>{s} seconds</option>{/each}
      </select>
    </label>
    <label class="row">
      <div class="label"><span>Skip forward</span></div>
      <select class="select" bind:value={prefs.skipForward}>
        {#each skipOptions as s (s)}<option value={s}>{s} seconds</option>{/each}
      </select>
    </label>
    <label class="row">
      <div class="label">
        <span>Rewind after a break</span>
        <small>When you resume after more than a minute, step back a little to catch the thread.</small>
      </div>
      <select class="select" bind:value={prefs.smartRewind}>
        <option value={0}>Off</option>
        {#each [3, 5, 10, 15, 30] as s (s)}<option value={s}>{s} seconds</option>{/each}
      </select>
    </label>
    <div class="row">
      <div class="label"><span>Speed</span><small>Used for every book. Change it any time from the player.</small></div>
      <span class="num">{prefs.playbackRate}×</span>
    </div>
  </section>

  <section>
    <h2 class="serif">Keyboard shortcuts</h2>
    <dl class="keys">
      {#each shortcuts as [k, v] (k)}
        <div><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
      {/each}
    </dl>
  </section>
</div>

<style>
  .narrow {
    max-width: 760px;
  }
  section {
    margin-top: 40px;
  }
  h2 {
    font-size: var(--t-lg);
    font-weight: 620;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule-soft);
    margin-bottom: 6px;
  }
  dl {
    margin: 0 0 16px;
  }
  dl > div {
    display: grid;
    grid-template-columns: 180px 1fr;
    padding: 10px 0;
    font-size: var(--t-sm);
  }
  dt {
    color: var(--text-2);
  }
  dd {
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 14px 0;
    border-bottom: 1px solid var(--rule-soft);
  }
  .label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--t-md);
  }
  small {
    font-size: var(--t-sm);
    color: var(--text-3);
    max-width: 52ch;
  }
  .seg {
    display: flex;
    padding: 3px;
    border-radius: 999px;
    background: var(--raised);
    border: 1px solid var(--rule-soft);
  }
  .seg button {
    height: 28px;
    padding: 0 14px;
    border-radius: 999px;
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--text-3);
  }
  .seg button[aria-checked='true'] {
    background: var(--raised-2);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
  }
  .switch {
    appearance: none;
    flex: none;
    width: 40px;
    height: 24px;
    border-radius: 999px;
    background: var(--rule);
    position: relative;
    cursor: pointer;
    transition: background 160ms;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    transition: transform 160ms var(--ease);
  }
  .switch:checked {
    background: var(--accent);
  }
  .switch:checked::after {
    transform: translateX(16px);
  }
  .keys > div {
    grid-template-columns: 140px 1fr;
    border-bottom: 1px solid var(--rule-soft);
  }
  kbd {
    font-family: var(--font-sans);
    font-size: var(--t-xs);
    padding: 2px 7px;
    border-radius: 5px;
    border: 1px solid var(--rule);
    background: var(--raised);
    color: var(--text);
  }
</style>
