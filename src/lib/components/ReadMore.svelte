<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Clamps its content to `lines` and offers "Read more" only if the content actually overflows,
   * measured on the rendered text (so a short bio with long words, or a long one in a wide window, is judged right).
   * Font and line height come from the surrounding element.
   */
  let { lines, children }: { lines: number; children: Snippet } = $props();

  let box = $state<HTMLDivElement>();
  let expanded = $state(false);
  let overflows = $state(false);
  const id = $props.id();

  $effect(() => {
    const el = box;
    if (!el) return;
    const measure = () => {
      // Measured while clamped; once expanded the button stays so it can collapse again.
      if (!expanded) overflows = el.scrollHeight - el.clientHeight > 2;
    };
    measure();
    // Literata arriving changes how much the text needs without resizing the clamped box.
    void document.fonts?.ready.then(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
</script>

<div class:clamped={!expanded} class:fade={!expanded && overflows} style:--lines={lines} bind:this={box} {id}>
  {@render children()}
</div>
{#if overflows || expanded}
  <button class="more" aria-expanded={expanded} aria-controls={id} onclick={() => (expanded = !expanded)}>{expanded ? 'Show less' : 'Read more'}</button>
{/if}

<style>
  .clamped {
    max-height: calc(var(--lines) * 1lh);
    overflow: hidden;
  }
  .fade {
    mask-image: linear-gradient(180deg, #000 55%, transparent);
  }
  .more {
    margin-top: 8px;
    font-weight: 650;
    font-size: var(--t-sm);
    color: var(--accent);
  }
  .more:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
