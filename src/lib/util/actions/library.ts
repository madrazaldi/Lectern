/** Library workstream: the "Add to collection…" title action, and who may edit collections and history. */
import { FolderPlus } from '@lucide/svelte';
import { mount, unmount } from 'svelte';
import { isBook } from '$lib/api/types';
import CollectionDialog from '$lib/components/CollectionDialog.svelte';
import { session } from '$lib/stores/session.svelte';
import { registerItemAction } from '../itemActions';

// The server checks these permissions, not the account type: an admin without "update" can't edit collections either.
export const canEditCollections = () => session.user?.permissions?.update === true;
export const canDeleteCollections = () => session.user?.permissions?.delete === true;
/** Deleting a listening session needs the delete permission. */
export const canDeleteSessions = () => session.user?.permissions?.delete === true;

let open: ReturnType<typeof mount> | null = null;

/** Show the collection picker for some books, outside any page (it's opened from context menus). */
export function openCollectionPicker(target: { libraryId: string; itemIds: string[]; title: string }) {
  if (open) void unmount(open);
  const dialog = mount(CollectionDialog, {
    target: document.body,
    props: {
      ...target,
      onclose: () => {
        if (open === dialog) open = null;
        void unmount(dialog);
      }
    }
  });
  open = dialog;
}

registerItemAction({
  id: 'collection',
  section: 'organize',
  order: 1,
  build: ({ item, episode }) => {
    if (episode || !canEditCollections()) return null;
    // A collapsed series card stands for all of its books.
    const series = item.collapsedSeries;
    const itemIds = series ? series.libraryItemIds : isBook(item) ? [item.id] : [];
    if (!itemIds.length) return null;
    const title = series?.name ?? item.media.metadata.title;
    return { label: 'Add to collection…', icon: FolderPlus, run: () => openCollectionPicker({ libraryId: item.libraryId, itemIds, title }) };
  }
});
