// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EpisodeDownload } from '$lib/api/types';

const hooks = vi.hoisted(() => ({ accountChanged: [] as (() => void)[], reconnect: [] as (() => unknown)[] }));
const api = vi.hoisted(() => ({ getEpisodeDownloadQueue: vi.fn() }));

vi.mock('$lib/api/abs', () => api);
vi.mock('$lib/api/client', () => ({ onAccountChanged: (fn: () => void) => void hooks.accountChanged.push(fn) }));
vi.mock('./live.svelte', () => ({ live: { onEpisodeEvent: () => () => {} } }));
vi.mock('./session.svelte', () => ({ session: { onReconnect: (fn: () => unknown) => void hooks.reconnect.push(fn) } }));

const { episodeDownloads } = await import('./episodeDownloads.svelte');

const download = (id: string, libraryId = 'pods'): EpisodeDownload => ({ id, libraryId, libraryItemId: 'p1' }) as unknown as EpisodeDownload;
const changeAccount = () => hooks.accountChanged.forEach((fn) => fn());

beforeEach(() => {
  api.getEpisodeDownloadQueue.mockReset();
  changeAccount();
});

describe('episodeDownloads', () => {
  it('forgets the previous account’s queue and libraries', async () => {
    api.getEpisodeDownloadQueue.mockResolvedValue({ currentDownload: download('d1'), queue: [download('d2')] });
    await episodeDownloads.load('pods');
    expect(episodeDownloads.forItem('p1').queued).toHaveLength(1);

    changeAccount();
    expect(episodeDownloads.forItem('p1')).toEqual({ current: null, queued: [], done: [] });
    // The old account's library isn't read again for the new one.
    await Promise.all(hooks.reconnect.map((fn) => fn()));
    expect(api.getEpisodeDownloadQueue).toHaveBeenCalledTimes(1);
  });

  it('ignores a queue read for the previous account that lands after the change', async () => {
    let answer!: (v: unknown) => void;
    api.getEpisodeDownloadQueue.mockReturnValue(new Promise((r) => (answer = r)));
    const loading = episodeDownloads.load('pods');
    changeAccount();
    answer({ currentDownload: download('d1'), queue: [] });
    await loading;
    expect(episodeDownloads.forItem('p1').current).toBeNull();
  });
});
