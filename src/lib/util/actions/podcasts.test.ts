// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryItem, MediaProgress } from '$lib/api/types';

const m = vi.hoisted(() => ({ progress: {} as Record<string, MediaProgress> }));
const api = vi.hoisted(() => ({ getProgress: vi.fn(), deleteProgress: vi.fn(), updateProgress: vi.fn() }));
const discard = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock('$lib/api/abs', () => api);
vi.mock('$lib/api/client', () => ({ isAuthLost: () => false, isUnreachable: () => false, serverNow: () => 1 }));
vi.mock('$lib/components/reader/positions.svelte', () => ({ positions: { discard } }));
vi.mock('$lib/stores/player.svelte', () => ({ player: { isCurrent: () => false } }));
vi.mock('$lib/stores/toast.svelte', () => ({ toast, errorMessage: String }));
vi.mock('$lib/util/confirm', () => ({ confirmDialog: vi.fn() }));
vi.mock('$lib/stores/session.svelte', () => ({
  session: {
    online: true,
    user: null,
    progressFor: (id: string) => m.progress[id],
    forgetProgress: (id: string) => delete m.progress[id],
    patchProgress: vi.fn((id: string, _ep: string | null, patch: Partial<MediaProgress>) => (m.progress[id] = { ...m.progress[id], ...patch }))
  }
}));

const { resetProgress } = await import('./podcasts');
const { itemActions } = await import('$lib/util/itemActions');

const book = { id: 'b1', mediaType: 'book', media: { metadata: { title: 'Ebook' } } } as unknown as LibraryItem;
const read: MediaProgress = {
  id: 'p1',
  libraryItemId: 'b1',
  episodeId: null,
  duration: 0,
  progress: 0,
  currentTime: 0,
  isFinished: false,
  hideFromContinueListening: false,
  startedAt: 0,
  finishedAt: null,
  lastUpdate: 1,
  ebookLocation: 'epubcfi(/6/8)',
  ebookProgress: 0.42
};
const offersReset = () => itemActions({ item: book }).some((a) => a.id === 'reset-progress');

beforeEach(() => {
  vi.clearAllMocks();
  m.progress = {};
  api.deleteProgress.mockResolvedValue(undefined);
  api.updateProgress.mockResolvedValue(undefined);
});

describe('Reset progress', () => {
  it('is offered for a title that has only been read', () => {
    expect(offersReset()).toBe(false);
    m.progress.b1 = { ...read };
    expect(offersReset()).toBe(true);
  });

  it('drops a reading position still waiting to go out, and Undo puts the reading position back', async () => {
    m.progress.b1 = { ...read };
    await resetProgress('b1', null, 'Ebook');
    expect(api.deleteProgress).toHaveBeenCalledWith('p1');
    expect(discard).toHaveBeenCalledWith('b1');
    expect(m.progress.b1).toBeUndefined();

    const undo = toast.mock.calls[0][1].action.run as () => void;
    undo();
    await vi.waitFor(() => expect(api.updateProgress).toHaveBeenCalled());
    expect(api.updateProgress).toHaveBeenCalledWith('b1', expect.objectContaining({ ebookLocation: 'epubcfi(/6/8)', ebookProgress: 0.42 }), null);
    expect(m.progress.b1).toMatchObject({ ebookLocation: 'epubcfi(/6/8)', ebookProgress: 0.42 });
  });
});
