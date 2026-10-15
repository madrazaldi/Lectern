/** "Read" for titles with an ebook the reader can open. Also starts sending reading positions saved offline. */
import { BookOpenText } from '@lucide/svelte';
import { goto } from '$app/navigation';
import { canRead, hasAudio, readHref } from '$lib/components/reader/ebook';
import '$lib/components/reader/positions.svelte';
import { registerItemAction } from '../itemActions';

registerItemAction({
  id: 'read',
  section: 'play',
  // Right after Play; first of all for ebook-only titles, which have nothing to play.
  order: 0.5,
  build: ({ item, episode }) => {
    if (episode || item.collapsedSeries || !canRead(item)) return null;
    return { label: hasAudio(item) ? 'Read the ebook' : 'Read', icon: BookOpenText, disabled: item.isMissing, run: () => goto(readHref(item.id)) };
  }
});
