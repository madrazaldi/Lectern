<script lang="ts">
  import { coverUrl } from '$lib/api/client';
  import { fileSrc } from '$lib/native';
  import { downloads } from '$lib/stores/downloads.svelte';
  import { session } from '$lib/stores/session.svelte';

  interface Props {
    itemId: string;
    title?: string;
    author?: string;
    updatedAt?: number;
    width?: number;
    /** Height ÷ width. Defaults to the current library's setting (square or 1.6). */
    aspect?: number;
    hasCover?: boolean;
    radius?: string;
    eager?: boolean;
  }

  let { itemId, title = '', author = '', updatedAt, width = 400, aspect, hasCover = true, radius = 'var(--r-sm)', eager = false }: Props = $props();

  let failed = $state(false);
  let loaded = $state(false);
  const ratio = $derived(aspect ?? (session.library?.settings.coverAspectRatio === 0 ? 1.6 : 1));
  // A downloaded copy loads instantly and works offline.
  const local = $derived(downloads.coverFor(itemId));
  const src = $derived(local ? fileSrc(local) : coverUrl(itemId, width, updatedAt));

  // A stable, muted cloth colour per title for books without art.
  const cloth = $derived.by(() => {
    let hash = 0;
    for (const c of title || itemId) hash = (hash * 31 + c.charCodeAt(0)) | 0;
    return `hsl(${Math.abs(hash) % 360} 28% 30%)`;
  });

  $effect(() => {
    void src;
    failed = false;
    loaded = false;
  });
</script>

<div class="cover" style:aspect-ratio="1 / {ratio}" style:border-radius={radius} style:--cloth={cloth}>
  {#if hasCover && !failed}
    <img
      {src}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable="false"
      class:loaded
      onload={() => (loaded = true)}
      onerror={() => (failed = true)}
    />
  {/if}
  {#if !hasCover || failed}
    <div class="plate">
      <span class="t">{title}</span>
      {#if author}<span class="a">{author}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .cover {
    position: relative;
    width: 100%;
    overflow: hidden;
    background: var(--raised-2);
    box-shadow: var(--shadow-cover);
    container-type: inline-size;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 260ms var(--ease);
  }
  img.loaded {
    opacity: 1;
  }
  .plate {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 9% 10%;
    background: linear-gradient(90deg, rgb(0 0 0 / 0.25) 0 4%, rgb(255 255 255 / 0.06) 4% 5%, transparent 5%), var(--cloth);
    color: #f1eadf;
  }
  .t {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: clamp(11px, 11cqi, 28px);
    line-height: 1.12;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .a {
    font-size: clamp(9px, 7cqi, 15px);
    opacity: 0.75;
  }
</style>
