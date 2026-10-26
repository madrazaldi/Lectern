<script lang="ts">
  import { LogOut, Plus } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { getCredentials, listAccounts, probeServer, scopedKey, switchAccount, type ServerStatus } from '$lib/api/client';
  import { APP_VERSION, inApp } from '$lib/native';
  import { downloads } from '$lib/stores/downloads.svelte';
  import { player } from '$lib/stores/player.svelte';
  import { prefs, type Theme } from '$lib/stores/prefs.svelte';
  import { session } from '$lib/stores/session.svelte';
  import ShortcutList from '$lib/components/ShortcutList.svelte';
  import { dialogs } from '$lib/util/dialogs.svelte';
  import { bytes } from '$lib/util/format';
  import { roving } from '$lib/util/roving';
  import { isMacPlatform, modLabel } from '$lib/util/shortcuts';
  import { pageTitle } from '$lib/util/title';

  const creds = getCredentials();
  const accounts = listAccounts();
  let status = $state<ServerStatus | null>(null);

  onMount(() => {
    if (creds)
      probeServer(creds.serverUrl)
        .then((s) => (status = s))
        .catch(() => {});
    void downloads.refreshUsage();
  });

  const skipOptions = [5, 10, 15, 30, 45, 60];
  const speedOptions = [0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.6, 1.75, 2, 2.25, 2.5, 3];
  const customRates = $derived(Object.keys(prefs.itemRates).length);
  const themes: { value: Theme; label: string }[] = [
    { value: 'system', label: 'Match system' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' }
  ];

  function host(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  async function signOut() {
    await player.stop();
    localStorage.removeItem(scopedKey('lectern.lastPlayed'));
    player.item = null;
    await session.signOut();
  }

  async function useAccount(id: string) {
    await player.shutdown();
    await switchAccount(id);
    location.reload();
  }
</script>

<svelte:head><title>{pageTitle('Settings')}</title></svelte:head>

<div class="page narrow">
  <h1 class="page-title">Settings</h1>

  <section>
    <h2 class="serif">Account</h2>
    <dl>
      <div>
        <dt>Server</dt>
        <dd class="selectable">{creds?.serverUrl}</dd>
      </div>
      {#if status}<div>
          <dt>Server version</dt>
          <dd>Audiobookshelf {status.serverVersion}</dd>
        </div>{/if}
      <div>
        <dt>Signed in as</dt>
        <dd>{session.user?.username} <span class="faint">({creds?.method === 'apikey' ? 'API key' : session.user?.type})</span></dd>
      </div>
      <div>
        <dt>Sync</dt>
        <dd>{session.online ? 'Connected' : 'Offline, retrying in the background'}</dd>
      </div>
    </dl>
    <div class="buttons">
      <button class="btn btn-quiet" onclick={signOut}><LogOut size={16} /> Sign out</button>
      <button class="btn btn-quiet" onclick={() => (session.addingAccount = true)}><Plus size={16} /> Add account</button>
    </div>
    {#if accounts.length > 1}
      <ul class="accounts" aria-label="Saved accounts">
        {#each accounts as a (a.id)}
          <li>
            <span class="avatar" aria-hidden="true">{(a.username ?? '?').slice(0, 1).toUpperCase()}</span>
            <span class="who"><strong>{a.username}</strong> <span class="faint">on {host(a.serverUrl)}</span></span>
            {#if a.id === creds?.id}
              <span class="current">Current</span>
            {:else}
              <button class="btn btn-quiet" onclick={() => useAccount(a.id)}>Switch</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h2 class="serif">Appearance</h2>
    <div class="row">
      <div class="label">
        <span>Theme</span>
      </div>
      <div class="seg" role="radiogroup" aria-label="Theme" {@attach roving()}>
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
    <label class="row">
      <div class="label"><span>Default speed</span><small>Used for anything you haven't set a speed for.</small></div>
      <select class="select" bind:value={prefs.playbackRate}>
        {#if !speedOptions.includes(prefs.playbackRate)}<option value={prefs.playbackRate}>{prefs.playbackRate}×</option>{/if}
        {#each speedOptions as r (r)}<option value={r}>{r}×</option>{/each}
      </select>
    </label>
    <label class="row">
      <div class="label">
        <span>Remember speed for each title</span>
        <small>
          Changing speed in the player applies to that title only.{#if customRates}
            {customRates === 1 ? 'One title has' : `${customRates} titles have`} their own speed.
            <button
              class="link"
              onclick={(e) => {
                e.preventDefault();
                prefs.itemRates = {};
              }}>Reset all</button
            >{/if}
        </small>
      </div>
      <input type="checkbox" class="switch" bind:checked={prefs.perItemSpeed} />
    </label>
    <label class="row">
      <div class="label">
        <span>Keep going when a title ends</span>
        <small>If Up Next is empty, play the next book in the series or the next podcast episode.</small>
      </div>
      <input type="checkbox" class="switch" bind:checked={prefs.autoContinue} />
    </label>
    <label class="row">
      <div class="label">
        <span>Scrub within the current chapter</span>
        <small>The player's progress bar and times cover the chapter you're in instead of the whole book.</small>
      </div>
      <input type="checkbox" class="switch" bind:checked={prefs.chapterTrack} />
    </label>
    {#if inApp}
      <label class="row">
        <div class="label">
          <span>Keep playing when the window is closed</span>
          <small>Closing the window hides it; playback carries on and the menu bar icon controls it. Quit with {modLabel(isMacPlatform())}Q.</small>
        </div>
        <input type="checkbox" class="switch" bind:checked={prefs.keepPlayingWhenClosed} />
      </label>
    {/if}
  </section>

  {#if inApp}
    <section>
      <h2 class="serif">Downloads</h2>
      <div class="row">
        <div class="label">
          <span>Space used</span>
          <small
            >{downloads.list.length ? `${downloads.list.length} downloaded ${downloads.list.length === 1 ? 'title' : 'titles'}.` : 'Nothing downloaded.'}</small
          >
        </div>
        <span class="num">{bytes(downloads.usage)}</span>
      </div>
      <div class="row">
        <div class="label"><span>Manage downloads</span></div>
        <a class="btn btn-quiet" href="/downloads">Open Downloads</a>
      </div>
    </section>
  {/if}

  <section>
    <div class="sec-head">
      <h2 class="serif">Keyboard shortcuts</h2>
      <button class="link" onclick={() => (dialogs.shortcuts = true)}>Show anywhere with <kbd>?</kbd></button>
    </div>
    <ShortcutList />
  </section>

  <p class="version faint">Lectern {APP_VERSION}</p>
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
  .buttons {
    display: flex;
    gap: 8px;
  }
  .accounts {
    list-style: none;
    margin: 16px 0 0;
    padding: 0;
  }
  .accounts li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--rule-soft);
    font-size: var(--t-sm);
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 700;
  }
  .who {
    flex: 1;
  }
  .current {
    font-size: var(--t-xs);
    font-weight: 650;
    color: var(--accent);
  }
  .link {
    color: var(--accent);
    font-weight: 600;
  }
  .version {
    margin: 40px 0 0;
    font-size: var(--t-xs);
  }
  .sec-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }
  .sec-head .link {
    font-size: var(--t-sm);
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
