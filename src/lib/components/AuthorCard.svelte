<script lang="ts">
  import { authorImageUrl } from '$lib/api/client';
  import type { Author } from '$lib/api/types';

  let { author }: { author: Author & { updatedAt?: number } } = $props();
  let failed = $state(false);
  const initials = $derived(
    author.name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase()
  );
</script>

<a class="card" href="/authors/{author.id}">
  <div class="portrait">
    {#if author.imagePath && !failed}
      <img src={authorImageUrl(author.id, 300, author.updatedAt)} alt="" loading="lazy" onerror={() => (failed = true)} draggable="false" />
    {:else}
      <span class="initials serif">{initials}</span>
    {/if}
  </div>
  <span class="name">{author.name}</span>
  {#if author.numBooks}<span class="by">{author.numBooks} {author.numBooks === 1 ? 'book' : 'books'}</span>{/if}
</a>

<style>
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    min-width: 0;
  }
  .portrait {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 50%;
    overflow: hidden;
    background: var(--raised-2);
    display: grid;
    place-items: center;
    box-shadow: var(--shadow-cover);
    transition: transform 200ms var(--ease);
  }
  .card:hover .portrait {
    transform: scale(1.03);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: grayscale(0.25);
  }
  .initials {
    font-size: 2rem;
    font-weight: 600;
    color: var(--text-3);
  }
  .name {
    margin-top: 12px;
    font-weight: 600;
    font-size: var(--t-md);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .by {
    font-size: var(--t-sm);
    color: var(--text-2);
  }
</style>
