<script lang="ts">
  import { untrack } from 'svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as abs from '$lib/api/abs';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import { formatOf, primaryEbook, READABLE } from '$lib/components/reader/ebook';
  import { bookKey, keepBook, keptBook } from '$lib/components/reader/kept';
  import { localPositions, openingPosition, positions, savePosition } from '$lib/components/reader/positions.svelte';
  import Reader from '$lib/components/reader/Reader.svelte';
  import type { Position } from '$lib/components/reader/sync';
  import { session } from '$lib/stores/session.svelte';
  import { errorMessage } from '$lib/stores/toast.svelte';
  import { isUnreachable } from '$lib/util/errors';
  import { resource } from '$lib/util/resource.svelte';
  import { pageTitle } from '$lib/util/title';

  const id = $derived(page.params.id!);
  const fileParam = $derived(page.url.searchParams.get('file'));

  const res = resource(() => id, { id: (k) => `item:${k}`, load: (k) => abs.getItem(k) });
  const item = $derived(res.data);
  const primary = $derived(item ? primaryEbook(item) : null);
  const file = $derived(item ? (fileParam ? (item.libraryFiles?.find((f) => f.ino === fileParam && f.fileType === 'ebook') ?? null) : primary) : null);
  const format = $derived(file ? formatOf(file) : null);
  /** The primary ebook's position lives on the server; another file's only on this device. */
  const synced = $derived(!!file && file.ino === primary?.ino);
  // A string, so refreshing the item (a new object, same file) doesn't download the book again.
  const fileKey = $derived(item && file && format && READABLE.has(format) ? bookKey(item.id, file.ino) : null);

  let opened = $state<{ key: string; data: ArrayBuffer; start: string | null } | null>(null);
  let failure = $state<{ message: string; cause: unknown } | null>(null);
  let attempt = $state(0);
  let last: Position | null = null;

  $effect(() => {
    const key = fileKey;
    void attempt;
    if (!key) return;
    const { itemId, ino, sync } = untrack(() => ({ itemId: id, ino: file!.ino, sync: synced }));
    const ctrl = new AbortController();
    opened = null;
    failure = null;
    last = null;
    // The server's progress fresh rather than from the cached user, so a position from another device is picked up.
    const progress = sync
      ? abs.getProgress(itemId, null, ctrl.signal).catch((err) => {
          if (err?.name === 'AbortError') throw err;
          return session.progressFor(itemId);
        })
      : null;
    // The book just read (before a trip to the mini player, say) is still in memory: no second download.
    const kept = keptBook(key);
    Promise.all([kept ?? abs.getEbook(itemId, sync ? null : ino, ctrl.signal), progress])
      .then(([data, server]) => {
        keepBook(key, data);
        const start = sync ? openingPosition(itemId, server) : localPositions.get(key);
        opened = { key, data, start: start?.location ?? null };
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') failure = { message: errorMessage(err), cause: err };
      });
    return () => {
      ctrl.abort();
      if (sync) void positions.flush(itemId);
    };
  });

  function onposition(pos: Position) {
    if (!opened) return;
    if (last && last.location === pos.location && Math.abs(last.progress - pos.progress) < 0.001) return;
    last = pos;
    if (synced) savePosition(id, pos);
    else localPositions.set(opened.key, pos);
  }

  // Hiding or closing the window: don't leave the last page turn waiting on a timer.
  $effect(() => {
    const itemId = id;
    const hidden = () => {
      if (document.visibilityState === 'hidden') void positions.flush(itemId);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  });

  let cameFromItem = false;
  afterNavigate(({ from }) => {
    cameFromItem = from?.url.pathname === `/item/${id}`;
  });

  const offline = (cause: unknown) => !session.online || isUnreachable(cause);

  /** Back to the title's page: the way we came if that's where we came from, else in place of the reader. */
  function close() {
    if (cameFromItem) history.back();
    else void goto(`/item/${id}`, { replaceState: true });
  }
</script>

<svelte:head><title>{pageTitle(item?.media.metadata.title)}</title></svelte:head>

<!-- Ebooks aren't downloaded for offline use, so unlike elsewhere there's no pointing at Downloads. -->
{#snippet offlineState(retry: () => unknown)}
  <div class="page" role="alert">
    <EmptyState title="You're offline">
      <p class="muted">Books open from your server, which can't be reached right now. Lectern doesn't keep ebooks for reading offline.</p>
      <div class="row">
        <button class="btn btn-primary" onclick={retry}>Try again</button>
        <a class="btn btn-quiet" href="/item/{id}">Back to the title</a>
      </div>
    </EmptyState>
  </div>
{/snippet}

{#if res.error}
  {#if offline(res.cause)}
    {@render offlineState(() => res.refresh())}
  {:else}
    <div class="page"><ErrorState title="Couldn't open this title" message={res.error} cause={res.cause} onretry={() => res.refresh()} /></div>
  {/if}
{:else if !item}
  <Loading label="Loading title" />
{:else if !file || !format}
  <div class="page">
    <EmptyState title="No ebook here">
      <p class="muted">{fileParam ? 'That file isn’t in this title any more.' : 'This title doesn’t have an ebook.'}</p>
      <a class="btn btn-quiet" href="/item/{id}">Back to {item.media.metadata.title}</a>
    </EmptyState>
  </div>
{:else if !READABLE.has(format)}
  <div class="page">
    <EmptyState title="Can't open {format.toUpperCase()} files yet">
      <p class="muted">Lectern reads EPUB and PDF ebooks.</p>
      <a class="btn btn-quiet" href="/item/{id}">Back to {item.media.metadata.title}</a>
    </EmptyState>
  </div>
{:else if failure && offline(failure.cause)}
  {@render offlineState(() => attempt++)}
{:else if failure}
  <div class="page">
    <ErrorState title="Couldn't download the book" message={failure.message} cause={failure.cause} onretry={() => attempt++} />
  </div>
{:else if !opened}
  <Loading label="Opening the book" />
{:else}
  {#key opened.key}
    <Reader
      title={item.media.metadata.title}
      format={format === 'pdf' ? 'pdf' : 'epub'}
      data={opened.data}
      start={opened.start}
      cacheId={opened.key}
      {onposition}
      onclose={close}
    />
  {/key}
{/if}

<style>
  .row {
    display: flex;
    justify-content: center;
    gap: 8px;
  }
</style>
