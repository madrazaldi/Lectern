<script lang="ts">
  import { X } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import * as abs from '$lib/api/abs';
  import type { LibraryItem, PodcastAutoDownload, PodcastMedia } from '$lib/api/types';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { containKeys } from '$lib/util/confirm';
  import { relative } from '$lib/util/format';
  import Modal from './Modal.svelte';

  /** A podcast's auto-download settings: whether the server fetches new episodes, how often, and how many it keeps. */
  interface Props {
    podcast: LibraryItem & { media: PodcastMedia & Partial<PodcastAutoDownload> };
    onclose: () => void;
    onsaved?: (item: LibraryItem) => void;
  }
  let { podcast, onclose, onsaved }: Props = $props();

  const SCHEDULES = [
    { cron: '0 * * * *', label: 'Every hour' },
    { cron: '0 */6 * * *', label: 'Every 6 hours' },
    { cron: '0 */12 * * *', label: 'Every 12 hours' },
    { cron: '0 0 * * *', label: 'Every day' },
    { cron: '0 0 * * 0', label: 'Every week' }
  ];

  // A form: starts from the podcast as it was when opened.
  const media = untrack(() => podcast.media);
  let enabled = $state(!!media.autoDownloadEpisodes);
  const initial = media.autoDownloadSchedule || '0 * * * *';
  let schedule = $state(initial);
  let preset = $state(SCHEDULES.some((s) => s.cron === initial) ? initial : 'custom');
  let maxNew = $state(media.maxNewEpisodesToDownload ?? 3);
  let maxKeep = $state(media.maxEpisodesToKeep ?? 0);
  let saving = $state(false);

  const cronOk = $derived(/^\S+( \S+){4,5}$/.test(schedule.trim()));

  async function save(e: SubmitEvent, close: () => void) {
    e.preventDefault();
    if (!cronOk || saving) return;
    saving = true;
    try {
      const res = await abs.updatePodcastMedia(podcast.id, {
        autoDownloadEpisodes: enabled,
        autoDownloadSchedule: schedule.trim(),
        maxNewEpisodesToDownload: Math.max(0, Math.floor(maxNew || 0)),
        maxEpisodesToKeep: Math.max(0, Math.floor(maxKeep || 0))
      });
      onsaved?.(res.libraryItem);
      toast('Saved the podcast’s download settings.');
      close();
    } catch (err) {
      toast(`Couldn't save the settings. ${errorMessage(err)}`, { tone: 'error' });
    } finally {
      saving = false;
    }
  }
</script>

<Modal label="Download settings for {podcast.media.metadata.title}" width={460} {onclose}>
  {#snippet children({ close })}
    <form class="settings" onsubmit={(e) => save(e, close)} {@attach containKeys}>
      <header>
        <h2 class="serif">Download settings</h2>
        <button type="button" class="icon-btn" onclick={close} aria-label="Close"><X size={18} /></button>
      </header>

      <label class="check">
        <input type="checkbox" bind:checked={enabled} />
        <span>Download new episodes automatically</span>
      </label>

      <fieldset disabled={!enabled}>
        <label class="row">
          <span>Check</span>
          <select
            class="select"
            bind:value={preset}
            onchange={() => {
              if (preset !== 'custom') schedule = preset;
            }}
          >
            {#each SCHEDULES as s (s.cron)}<option value={s.cron}>{s.label}</option>{/each}
            <option value="custom">Custom (cron)</option>
          </select>
        </label>
        {#if preset === 'custom'}
          <label class="row">
            <span>Cron</span>
            <input class="field num" bind:value={schedule} aria-invalid={!cronOk} spellcheck="false" placeholder="0 * * * *" />
          </label>
        {/if}
        <label class="row">
          <span>New per check</span>
          <input class="field num" type="number" min="0" bind:value={maxNew} />
        </label>
        <p class="hint faint">The most episodes one check downloads. 0 downloads all of them.</p>
        <label class="row">
          <span>Keep at most</span>
          <input class="field num" type="number" min="0" bind:value={maxKeep} />
        </label>
        <p class="hint faint">When an automatic download goes over this, the oldest episode is deleted. 0 keeps everything.</p>
      </fieldset>

      {#if media.lastEpisodeCheck}<p class="faint last">Last checked {relative(media.lastEpisodeCheck)}.</p>{/if}

      <footer>
        <button type="button" class="btn btn-quiet" onclick={close}>Cancel</button>
        <button class="btn btn-primary" disabled={saving || !cronOk}>{saving ? 'Saving…' : 'Save'}</button>
      </footer>
    </form>
  {/snippet}
</Modal>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    font-size: var(--t-xl);
    font-weight: 600;
  }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  fieldset:disabled {
    opacity: 0.5;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--t-sm);
    font-weight: 600;
  }
  .row {
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    font-size: var(--t-sm);
  }
  .row > span {
    color: var(--text-2);
  }
  .row .select {
    justify-self: start;
  }
  .row .field {
    height: 34px;
    max-width: 180px;
  }
  .field[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .hint {
    margin: -4px 0 0 132px;
    font-size: var(--t-xs);
  }
  .last {
    font-size: var(--t-xs);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
