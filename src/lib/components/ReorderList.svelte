<script lang="ts" generics="T">
  import { GripVertical } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import { move } from '$lib/util/reorder';

  /**
   * A list the user puts in order: drag a row by its handle (Escape cancels), or focus the handle and use ↑/↓ (Home/End for the
   * ends). Rows move live while dragging; `onmove` fires once, on drop, and the owner updates `items`.
   */
  interface Props {
    items: T[];
    key: (item: T) => string;
    /** Names a row in the handle's label and in announcements. */
    label: (item: T) => string;
    onmove: (from: number, to: number) => void;
    disabled?: boolean;
    row: Snippet<[T, number]>;
  }
  let { items, key, label, onmove, disabled = false, row }: Props = $props();

  let list: HTMLDivElement;
  /** The order while a drag is under way. */
  let preview = $state<T[] | null>(null);
  let dragKey = $state<string | null>(null);
  let dragFrom = 0;
  let announcement = $state('');
  const hintId = $props.id();

  const shown = $derived(preview ?? items);

  function rows() {
    return Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-key]'));
  }

  function down(e: PointerEvent, item: T, index: number) {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    dragKey = key(item);
    dragFrom = index;
    preview = [...items];
  }

  function drag(e: PointerEvent) {
    if (!dragKey || !preview) return;
    // The dragged row belongs after every other row whose middle the pointer has passed.
    const others = rows().filter((r) => r.dataset.key !== dragKey);
    const to = others.filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2 < e.clientY;
    }).length;
    const at = preview.findIndex((it) => key(it) === dragKey);
    if (at >= 0 && to !== at) preview = move(preview, at, to);
  }

  function drop() {
    if (!dragKey || !preview) return;
    const k = dragKey;
    const to = preview.findIndex((it) => key(it) === k);
    const item = preview[to];
    dragKey = null;
    preview = null;
    if (to >= 0 && to !== dragFrom) commit(dragFrom, to, item);
  }

  function cancel() {
    dragKey = null;
    preview = null;
  }

  // Listen on the window, not via pointer capture: the dragged row's node is moved in the DOM as the order
  // changes, which would release a capture mid-drag.
  $effect(() => {
    if (!dragKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    window.addEventListener('pointermove', drag);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', drag);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKey, true);
    };
  });

  function commit(from: number, to: number, item: T) {
    onmove(from, to);
    announcement = `Moved ${label(item)} to position ${to + 1} of ${items.length}.`;
  }

  async function keydown(e: KeyboardEvent, item: T, index: number) {
    if (disabled || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const last = items.length - 1;
    const to = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    // Ours, not the page's (Now Playing uses ↑/↓ for speed).
    e.preventDefault();
    e.stopPropagation();
    if (to < 0 || to > last || to === index) return;
    commit(index, to, item);
    // Moving a node in the DOM can drop its focus; keep it on the handle that moved.
    await tick();
    list.querySelector<HTMLElement>(`:scope > [data-key="${CSS.escape(key(item))}"] .grip`)?.focus({ preventScroll: false });
  }
</script>

<div class="reorder" role="list" bind:this={list}>
  {#each shown as item, i (key(item))}
    <div class="item" role="listitem" data-key={key(item)} class:dragging={dragKey === key(item)}>
      <button
        class="grip"
        type="button"
        aria-label="Reorder {label(item)}, position {i + 1} of {shown.length}"
        aria-describedby={hintId}
        title="Drag to reorder, or use the arrow keys"
        {disabled}
        onpointerdown={(e) => down(e, item, i)}
        onkeydown={(e) => keydown(e, item, i)}
      >
        <GripVertical size={16} />
      </button>
      <div class="content">{@render row(item, i)}</div>
    </div>
  {/each}
</div>
<p class="sr-only" id={hintId}>Use the up and down arrow keys to move it; Home and End move it to the start or the end.</p>
<p class="sr-only" role="status" aria-live="polite">{announcement}</p>

<style>
  .reorder {
    display: flex;
    flex-direction: column;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--r-sm);
  }
  .content {
    flex: 1;
    min-width: 0;
  }
  .dragging {
    position: relative;
    z-index: 3;
    background: var(--raised-2);
    box-shadow: 0 12px 30px -10px rgb(0 0 0 / 0.55);
  }
  .grip {
    display: grid;
    place-items: center;
    width: 28px;
    height: 44px;
    flex: none;
    border-radius: var(--r-sm);
    color: var(--text-3);
    cursor: grab;
    touch-action: none;
  }
  .grip:hover:not(:disabled),
  .grip:focus-visible {
    color: var(--text);
    background: var(--rule-soft);
  }
  .dragging .grip {
    cursor: grabbing;
    color: var(--accent);
  }
  .grip:disabled {
    cursor: default;
    opacity: 0.4;
  }
</style>
