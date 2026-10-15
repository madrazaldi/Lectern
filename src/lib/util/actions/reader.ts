/** "Read" for titles with an ebook the reader can open. Also starts sending reading positions saved offline. */
import { BookOpenText } from '@lucide/svelte';
import { goto } from '$app/navigation';
import { canRead, hasAudio, primaryEbook, readHref } from '$lib/components/reader/ebook';
import { openable } from '$lib/components/reader/kept';
import '$lib/components/reader/positions.svelte';
import { session } from '$lib/stores/session.svelte';
import { registerItemAction } from '../itemActions';

registerItemAction({
  id: 'read',
  section: 'play',
  // Right after Play; first of all for ebook-only titles, which have nothing to play.
  order: 0.5,
  build: ({ item, episode }) => {
    if (episode || item.collapsedSeries || !canRead(item)) return null;
    // Offline, only the book just read is still here (in memory) to open.
    const offline = !openable(session.online, item.id, primaryEbook(item)?.ino);
    return {
      label: (hasAudio(item) ? 'Read the ebook' : 'Read') + (offline ? ' (needs the server)' : ''),
      icon: BookOpenText,
      disabled: item.isMissing || offline,
      run: () => goto(readHref(item.id))
    };
  }
});
