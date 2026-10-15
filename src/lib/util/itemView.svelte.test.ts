import { describe, expect, it, vi } from 'vitest';
import type { LibraryItem } from '$lib/api/types';

const playOrToggle = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/player.svelte', () => ({ player: { isCurrent: () => false, isPlaying: false } }));
vi.mock('$lib/stores/session.svelte', () => ({ session: { progressFor: () => undefined } }));
vi.mock('./play', () => ({ playOrToggle }));

const { ItemView } = await import('./itemView.svelte');

function book(media: Record<string, unknown>): LibraryItem {
  return { id: 'b', mediaType: 'book', isMissing: false, media: { metadata: { title: 'Book' }, ...media } } as unknown as LibraryItem;
}

describe('ItemView', () => {
  it('offers Play for a book with audio', () => {
    const view = new ItemView(() => book({ duration: 3600, numTracks: 2 }));
    expect(view.canPlay).toBe(true);
    view.play();
    expect(playOrToggle).toHaveBeenCalledWith('b', null);
  });

  it('has nothing to play for an ebook-only book', () => {
    playOrToggle.mockClear();
    const view = new ItemView(() => book({ duration: 0, numTracks: 0, numAudioFiles: 0, ebookFormat: 'epub' }));
    expect(view.canPlay).toBe(false);
    view.play();
    expect(playOrToggle).not.toHaveBeenCalled();
  });
});
