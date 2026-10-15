<script lang="ts">
  import { Bookmark, Pencil, Trash2 } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';
  import { clock } from '$lib/util/format';
  import { removeBookmark } from '$lib/util/play';

  /** A title's bookmarks: jump to one, rename it, or delete it (with Undo). */
  interface Props {
    itemId: string;
    marks: { time: number; title: string }[];
    onseek: (time: number) => void;
    variant?: 'panel' | 'plain';
    /** Shown in place of the list when there are no bookmarks. */
    empty?: Snippet;
  }
  let { itemId, marks, onseek, variant = 'plain', empty }: Props = $props();

  let editing = $state<number | null>(null);
  let draft = $state('');

  async function save(time: number) {
    const title = draft.trim();
    if (editing !== time) return;
    editing = null;
    const before = marks.find((m) => m.time === time)?.title;
    if (!title || title === before) return;
    try {
      await session.renameBookmark(itemId, time, title);
    } catch (err) {
      toast(`Couldn't rename the bookmark. ${errorMessage(err)}`, { tone: 'error' });
    }
  }
</script>

<ol class="list {variant}" aria-label="Bookmarks">
  {#each marks as b (b.time)}
    <li class="mark-row">
      {#if editing === b.time}
        <form
          class="edit"
          onsubmit={(e) => {
            e.preventDefault();
            void save(b.time);
          }}
        >
          <input
            class="field"
            bind:value={draft}
            {@attach (el) => el.select()}
            onblur={() => save(b.time)}
            onkeydown={(e) => {
              if (e.key === 'Escape') {
                // Cancel the rename only; don't let Escape close Now Playing too.
                e.stopPropagation();
                editing = null;
              }
            }}
            aria-label="Bookmark name"
          />
        </form>
      {:else}
        <button class="row" onclick={() => onseek(b.time)}>
          <span class="idx"><Bookmark size={14} /></span>
          <span class="name">{b.title}</span>
          <span class="meta num">{clock(b.time)}</span>
        </button>
        <div class="mark-actions">
          <button
            class="icon-btn"
            aria-label="Rename bookmark {b.title}"
            title="Rename"
            onclick={() => {
              draft = b.title;
              editing = b.time;
            }}><Pencil size={14} /></button
          >
          <button class="icon-btn" aria-label="Delete bookmark {b.title}" title="Delete" onclick={() => removeBookmark(itemId, b)}><Trash2 size={14} /></button>
        </div>
      {/if}
    </li>
  {:else}
    {#if empty}<li class="empty">{@render empty()}</li>{/if}
  {/each}
</ol>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
  }
  .panel {
    padding: 8px;
    flex: 1;
    min-height: 0;
  }
  .plain {
    max-height: 520px;
    border-top: 1px solid var(--rule-soft);
  }
  .mark-row {
    position: relative;
    display: flex;
    align-items: center;
  }
  .row {
    display: grid;
    grid-template-columns: 30px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    font-size: var(--t-sm);
    text-align: left;
  }
  .panel .row {
    grid-template-columns: 34px 1fr auto;
    padding: 9px 10px;
    border-radius: var(--r-sm);
  }
  .plain .row {
    padding: 8px 6px;
  }
  .plain .mark-row {
    border-bottom: 1px solid var(--rule-soft);
  }
  .row:hover {
    background: color-mix(in srgb, var(--text) 5%, transparent);
  }
  .idx,
  .meta {
    color: var(--text-3);
    font-size: var(--t-xs);
    display: inline-flex;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mark-actions {
    position: absolute;
    right: 4px;
    display: none;
    padding-left: 12px;
    background: linear-gradient(90deg, transparent, var(--raised) 12px);
  }
  .plain .mark-actions {
    background: linear-gradient(90deg, transparent, var(--ground) 12px);
  }
  .mark-row:hover .mark-actions,
  .mark-row:focus-within .mark-actions {
    display: flex;
  }
  .edit {
    width: 100%;
    padding: 2px;
  }
  .edit input {
    width: 100%;
    height: 34px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 16px 12px;
    color: var(--text-2);
    font-size: var(--t-sm);
  }
</style>
