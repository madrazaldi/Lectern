import { describe, expect, it } from 'vitest';
import type { EpisodeDownload, FeedEpisode, ServerEpisode, User } from '$lib/api/types';
import { cleanEpisodeUrl, emptyQueue, feedEntries, podcastPath, podcastPermissions, queueFor, reduceQueue, sanitizeFilename, seedQueue } from './podcastFeed';

const feedEp = (n: number, over: Partial<FeedEpisode> = {}) =>
  ({ title: `Episode ${n}`, guid: `g-${n}`, publishedAt: n * 1000, enclosure: { url: `https://cdn.test/ep${n}.mp3` }, ...over }) as FeedEpisode;
const serverEp = (over: Partial<ServerEpisode>) => ({ id: `s-${Math.random()}`, title: 'x', ...over }) as ServerEpisode;
const dl = (id: string, over: Partial<EpisodeDownload> = {}) =>
  ({ id, libraryItemId: 'pod', libraryId: 'lib', url: `https://cdn.test/${id}.mp3`, guid: null, isFinished: false, failed: false, ...over }) as EpisodeDownload;

describe('cleanEpisodeUrl', () => {
  it('drops per-request query parameters but keeps id', () => {
    expect(cleanEpisodeUrl('https://a.test/e.mp3?token=1&expires=2')).toBe('https://a.test/e.mp3');
    expect(cleanEpisodeUrl('https://a.test/e.mp3?id=7&token=1')).toBe('https://a.test/e.mp3?id=7');
    expect(cleanEpisodeUrl('https://a.test/e.mp3')).toBe('https://a.test/e.mp3');
  });

  it('matches the percent-encoded URL the server queues', () => {
    const raw = 'https://a.test/my episode.mp3';
    expect(cleanEpisodeUrl(encodeURI(raw))).toBe(cleanEpisodeUrl(raw));
  });
});

describe('feedEntries', () => {
  it('marks episodes the server has by guid or by URL, and sorts newest first', () => {
    const feed = [feedEp(1), feedEp(3), feedEp(2)];
    const have = [serverEp({ guid: 'g-1' }), serverEp({ guid: 'other', enclosure: { url: 'https://cdn.test/ep2.mp3?sig=abc' } })];
    const out = feedEntries(feed, have, []);
    expect(out.map((e) => [e.episode.title, e.state])).toEqual([
      ['Episode 3', 'new'],
      ['Episode 2', 'downloaded'],
      ['Episode 1', 'downloaded']
    ]);
  });

  it('marks queued episodes by guid, else by URL', () => {
    const feed = [feedEp(1), feedEp(2, { guid: '' }), feedEp(3)];
    const pending = [dl('a', { guid: 'g-1' }), dl('b', { url: 'https://cdn.test/ep2.mp3' })];
    expect(feedEntries(feed, [], pending).map((e) => e.state)).toEqual(['new', 'queued', 'queued']);
  });

  it('prefers "downloaded" over "queued", and skips episodes without audio or listed twice', () => {
    const feed = [feedEp(1), feedEp(2, { enclosure: undefined as never }), feedEp(1, { guid: 'dupe' })];
    const out = feedEntries(feed, [serverEp({ guid: 'g-1' })], [dl('a', { guid: 'g-1' })]);
    expect(out).toHaveLength(1);
    expect(out[0].state).toBe('downloaded');
  });
});

describe('download queue reducer', () => {
  it('follows a download from queued to started to finished', () => {
    let s = emptyQueue();
    s = reduceQueue(s, { type: 'started', download: dl('a') });
    s = reduceQueue(s, { type: 'queued', download: dl('b') });
    s = reduceQueue(s, { type: 'queued', download: dl('c') });
    expect(s.current?.id).toBe('a');
    expect(s.queued.map((d) => d.id)).toEqual(['b', 'c']);

    s = reduceQueue(s, { type: 'finished', download: dl('a', { isFinished: true }) });
    s = reduceQueue(s, { type: 'started', download: dl('b') });
    expect(s.current?.id).toBe('b');
    expect(s.queued.map((d) => d.id)).toEqual(['c']);
    expect(s.done.map((d) => d.id)).toEqual(['a']);

    s = reduceQueue(s, { type: 'finished', download: dl('b', { isFinished: true, failed: true }) });
    expect(s.current).toBeNull();
    expect(s.done.map((d) => [d.id, d.failed])).toEqual([
      ['b', true],
      ['a', false]
    ]);
  });

  it('ignores repeated events', () => {
    let s = reduceQueue(emptyQueue(), { type: 'queued', download: dl('a') });
    const again = reduceQueue(s, { type: 'queued', download: dl('a') });
    expect(again).toBe(s);
    s = reduceQueue(s, { type: 'finished', download: dl('a') });
    s = reduceQueue(s, { type: 'finished', download: dl('a') });
    expect(s.done).toHaveLength(1);
  });

  it('clears one podcast’s queue and leaves the rest', () => {
    let s = reduceQueue(emptyQueue(), { type: 'queued', download: dl('a') });
    s = reduceQueue(s, { type: 'queued', download: dl('b', { libraryItemId: 'other' }) });
    s = reduceQueue(s, { type: 'cleared', libraryItemId: 'pod' });
    expect(s.queued.map((d) => d.id)).toEqual(['b']);
  });

  it('seeds from the server for one library without losing another library’s downloads or the history', () => {
    let s = reduceQueue(emptyQueue(), { type: 'started', download: dl('x', { libraryId: 'lib' }) });
    s = reduceQueue(s, { type: 'queued', download: dl('o', { libraryId: 'lib2', libraryItemId: 'p2' }) });
    s = reduceQueue(s, { type: 'finished', download: dl('old') });
    s = seedQueue(s, 'lib', { currentDownload: null, queue: [dl('y')] });
    expect(s.current).toBeNull();
    expect(s.queued.map((d) => d.id)).toEqual(['o', 'y']);
    expect(s.done.map((d) => d.id)).toEqual(['old']);
    expect(queueFor(s, 'pod').queued.map((d) => d.id)).toEqual(['y']);
  });
});

describe('podcast folders', () => {
  it('sanitises a title the way the server does', () => {
    expect(sanitizeFilename('Tech: News / Views?')).toBe('Tech - News Views');
    expect(sanitizeFilename('Ends with dots...')).toBe('Ends with dots');
    expect(sanitizeFilename('  lots   of   space ')).toBe('lots of space');
  });

  it('joins with the folder’s own separator', () => {
    expect(podcastPath('/podcasts', 'My Show')).toBe('/podcasts/My Show');
    expect(podcastPath('/podcasts/', 'My Show')).toBe('/podcasts/My Show');
    expect(podcastPath('D:\\Podcasts', 'My Show')).toBe('D:\\Podcasts\\My Show');
    expect(podcastPath('/podcasts', '???')).toBe('');
  });
});

describe('podcastPermissions', () => {
  const user = (type: string, permissions: Record<string, boolean>) => ({ type, permissions }) as unknown as User;

  it('lets admins manage, and gates update/delete on the permissions themselves', () => {
    expect(podcastPermissions(user('root', { update: true, delete: true }))).toEqual({ manage: true, download: true, update: true, delete: true });
    expect(podcastPermissions(user('admin', { update: false, delete: true }))).toEqual({ manage: true, download: false, update: false, delete: true });
  });

  it('gives a listener nothing', () => {
    expect(podcastPermissions(user('user', { download: true }))).toEqual({ manage: false, download: false, update: false, delete: false });
    expect(podcastPermissions(null).manage).toBe(false);
  });
});
