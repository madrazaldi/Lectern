<script lang="ts">
  import * as abs from '$lib/api/abs';
  import type { Collection } from '$lib/api/types';
  import { invalidate } from '$lib/util/resource.svelte';
  import ListPicker from './ListPicker.svelte';

  interface Props {
    libraryId: string;
    /** One book, or every book of a series. */
    itemIds: string[];
    close: () => void;
  }
  let { libraryId, itemIds, close }: Props = $props();

  // A series counts as in a collection only once all of its books are.
  const contains = (c: Collection) => itemIds.every((id) => c.books.some((b) => b.id === id));

  function changed<T extends { id: string }>(c: T) {
    invalidate('collections:');
    invalidate(`collection:${c.id}`);
    return c;
  }

  async function toggle(c: Collection, had: boolean) {
    // Only what's missing: adding a book that's already there is an error for the single-book endpoint.
    const ids = had ? itemIds : itemIds.filter((id) => !c.books.some((b) => b.id === id));
    return changed(had ? await abs.removeFromCollection(c.id, ids) : await abs.addToCollection(c.id, ids));
  }
</script>

<ListPicker
  noun="collection"
  load={() => abs.getCollections(libraryId)}
  count={(c) => c.books.length}
  has={contains}
  {toggle}
  create={async (name) => changed(await abs.createCollection(libraryId, name, itemIds))}
  {close}
/>
