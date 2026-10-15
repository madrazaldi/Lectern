<script lang="ts" generics="T extends { id: string; name: string }">
  import { Check, LoaderCircle, Plus } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { errorMessage, toast } from '$lib/stores/toast.svelte';

  /** "Add to playlist / collection": tick the lists a title is in, or start a new one with it. */
  interface Props {
    /** "playlist", "collection". */
    noun: string;
    load: () => Promise<T[]>;
    count: (list: T) => number;
    /** Is the title already in this list? */
    has: (list: T) => boolean;
    /** Add the title to `list`, or take it out (`had`). Resolves to the updated list, or null if it no longer exists. */
    toggle: (list: T, had: boolean) => Promise<T | null>;
    create: (name: string) => Promise<unknown>;
    close: () => void;
  }
  let { noun, load, count, has, toggle, create, close }: Props = $props();

  let lists = $state<T[] | null>(null);
  let creating = $state(false);
  let name = $state('');
  let busy = $state<string | null>(null);

  onMount(() => {
    load()
      .then((l) => (lists = l))
      .catch((err) => {
        toast(`Couldn't load ${noun}s. ${errorMessage(err)}`, { tone: 'error' });
        close();
      });
  });

  async function flip(list: T) {
    busy = list.id;
    try {
      const had = has(list);
      const updated = await toggle(list, had);
      lists = updated ? lists!.map((x) => (x.id === list.id ? updated : x)) : lists!.filter((x) => x.id !== list.id);
      toast(had ? `Removed from ${list.name}.` : `Added to ${list.name}.`);
    } catch (err) {
      toast(`Couldn't update ${list.name}. ${errorMessage(err)}`, { tone: 'error' });
    } finally {
      busy = null;
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    busy = 'new';
    try {
      await create(n);
      toast(`Added to the new ${noun} ${n}.`);
      close();
    } catch (err) {
      toast(`Couldn't create the ${noun}. ${errorMessage(err)}`, { tone: 'error' });
    } finally {
      busy = null;
    }
  }
</script>

<div class="picker">
  <p class="head">Add to {noun}</p>
  {#if !lists}
    <div class="loading" role="status"><LoaderCircle size={18} class="spin" aria-hidden="true" /><span class="sr-only">Loading {noun}s…</span></div>
  {:else}
    <ul>
      {#each lists as l (l.id)}
        <li>
          <button class="opt" onclick={() => flip(l)} disabled={busy !== null} aria-pressed={has(l)}>
            <span class="tick"
              >{#if busy === l.id}<LoaderCircle size={14} class="spin" />{:else if has(l)}<Check size={14} />{/if}</span
            >
            <span class="name">{l.name}</span>
            <span class="faint num">{count(l)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if creating}
    <form onsubmit={submit}>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="field" bind:value={name} placeholder="{noun[0].toUpperCase()}{noun.slice(1)} name" aria-label="New {noun} name" autofocus />
      <button class="btn btn-primary" disabled={!name.trim() || busy !== null}>Create</button>
    </form>
  {:else}
    <button class="opt new" onclick={() => (creating = true)}><span class="tick"><Plus size={14} /></span> New {noun}…</button>
  {/if}
</div>

<style>
  .picker {
    width: 260px;
  }
  .head {
    margin: 2px 8px 6px;
    font-size: var(--t-xs);
    font-weight: 650;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 260px;
    overflow-y: auto;
  }
  .opt {
    display: grid;
    grid-template-columns: 18px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 34px;
    padding: 0 8px;
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
    text-align: left;
  }
  .opt:hover:not(:disabled) {
    background: var(--rule-soft);
  }
  .tick {
    display: inline-flex;
    color: var(--accent);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .new {
    margin-top: 4px;
    border-top: 1px solid var(--rule-soft);
    border-radius: 0;
    color: var(--text-2);
  }
  form {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  form input {
    flex: 1;
    min-width: 0;
    height: 34px;
  }
  form .btn {
    height: 34px;
  }
  .loading {
    display: grid;
    place-items: center;
    height: 60px;
    color: var(--text-3);
  }
</style>
