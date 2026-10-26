<script lang="ts">
  import { RotateCw } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import { inApp } from '$lib/native';
  import { session } from '$lib/stores/session.svelte';
  import { isUnreachable } from '$lib/util/errors';
  import EmptyState from './EmptyState.svelte';

  /**
   * The one way a page says it couldn't load. Retry re-runs the request (never a page reload, which would
   * stop playback). When the server can't be reached it says so and points at Downloads.
   */
  interface Props {
    title: string;
    message?: string | null;
    /** The failure itself, to recognise "offline". */
    cause?: unknown;
    onretry?: () => unknown;
    children?: Snippet;
  }
  let { title, message, cause, onretry, children }: Props = $props();

  let retrying = $state(false);
  const offline = $derived(!session.online || (cause !== undefined && cause !== null && isUnreachable(cause)));

  async function retry() {
    if (!onretry) return;
    retrying = true;
    try {
      await onretry();
    } finally {
      retrying = false;
    }
  }
</script>

<div role="alert">
  <EmptyState title={offline ? "You're offline" : title}>
    {#if offline}
      <p>
        This needs your server, which can't be reached right now.{#if inApp}
          Downloaded titles still play.{/if}
      </p>
    {:else if message}
      <p class="msg selectable">{message}</p>
    {/if}
    {@render children?.()}
    <div class="row">
      {#if onretry}
        <button class="btn btn-primary" onclick={retry} disabled={retrying}><RotateCw size={15} class={retrying ? 'spin' : ''} /> Try again</button>
      {/if}
      {#if offline && inApp}<a class="btn btn-quiet" href="/downloads">Go to Downloads</a>{/if}
    </div>
  </EmptyState>
</div>

<style>
  .row {
    display: flex;
    gap: 8px;
  }
  .msg {
    overflow-wrap: anywhere;
  }
</style>
