// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter, LibraryItem, MediaProgress, PlaybackSession } from '$lib/api/types';

/** Enough of HTMLAudioElement for the player: events, src as an attribute, and play()/pause(). */
class FakeAudio extends EventTarget {
  static all: FakeAudio[] = [];
  preload = '';
  preservesPitch = true;
  volume = 1;
  playbackRate = 1;
  currentTime = 0;
  paused = true;
  ended = false;
  readyState = 0;
  error: { code: number } | null = null;
  dataset: Record<string, string> = {};
  srcSets: string[] = [];
  /** Replace to make play() fail. */
  onPlay: (a: FakeAudio) => Promise<void> = async () => {};
  private attrs = new Map<string, string>();

  constructor() {
    super();
    FakeAudio.all.push(this);
  }
  get src() {
    return this.attrs.get('src') ?? '';
  }
  set src(v: string) {
    this.attrs.set('src', v);
    this.srcSets.push(v);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  load() {
    this.readyState = 0;
    this.error = null;
  }
  async play() {
    await this.onPlay(this);
    this.paused = false;
    this.dispatchEvent(new Event('playing'));
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  // Test helpers.
  metadata() {
    this.readyState = 1;
    this.dispatchEvent(new Event('loadedmetadata'));
  }
  at(t: number) {
    this.currentTime = t;
    this.dispatchEvent(new Event('timeupdate'));
  }
  fail() {
    this.error = { code: 4 };
    this.dispatchEvent(new Event('error'));
  }
}

const m = vi.hoisted(() => ({
  online: true,
  progress: {} as Record<string, unknown>,
  reconnect: [] as (() => unknown)[],
  downloadsLoaded: false,
  download: null as unknown,
  toast: null as unknown as ReturnType<typeof vi.fn>
}));

const api = vi.hoisted(() => ({
  startPlayback: vi.fn(),
  closeSession: vi.fn(),
  syncSession: vi.fn(),
  getItem: vi.fn(),
  getProgress: vi.fn(),
  getLibraryItems: vi.fn(),
  encodeFilter: vi.fn(),
  deviceInfo: () => ({ deviceId: 'test' })
}));

const out = vi.hoisted(() => ({
  entries: {} as Record<string, unknown>,
  busy: () => false,
  prepare: () => {},
  putProgress: vi.fn(),
  putSession: vi.fn(),
  confirm: vi.fn(),
  flush: vi.fn(async () => {})
}));

vi.mock('$lib/api/client', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message = '',
      public unreachable = status === 0
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    isUnreachable: (e: unknown) => e instanceof ApiError && e.unreachable,
    isAuthLost: (e: unknown) => e instanceof ApiError && e.status === 401,
    beforeAccountChange: () => () => {},
    onAccountChanged: () => () => {},
    getCredentials: () => ({ id: 'acc' }),
    scopedKey: (k: string) => `${k}.acc`,
    coverUrl: (id: string) => `http://abs/cover/${id}`,
    mediaUrl: (path: string) => `http://abs${path}?token=t`,
    ensureFreshToken: vi.fn(async () => {})
  };
});
vi.mock('$lib/api/abs', () => api);
vi.mock('$lib/native', () => ({ fileSrc: (p: string) => `asset://${p}`, setNowPlaying: async () => {} }));
vi.mock('$lib/util/color', () => ({ tintFor: async () => null }));
vi.mock('./downloads.svelte', () => ({
  downloads: {
    load: vi.fn(async () => {
      await Promise.resolve();
      m.downloadsLoaded = true;
    }),
    ready: () => (m.downloadsLoaded ? m.download : undefined)
  }
}));
vi.mock('./session.svelte', () => ({
  session: {
    get online() {
      return m.online;
    },
    user: null,
    onRemoteProgress: null,
    onReconnect: (fn: () => unknown) => void m.reconnect.push(fn),
    progressFor: (id: string) => m.progress[id],
    patchProgress: vi.fn()
  }
}));
vi.mock('./outbox.svelte', () => ({ outbox: out, progressKey: (id: string, ep: string | null) => `progress:${ep ? `${id}:${ep}` : id}` }));
vi.mock('./prefs.svelte', () => ({
  prefs: { playbackRate: 1, perItemSpeed: false, itemRates: {}, volume: 1, smartRewind: 0, autoContinue: false, skipBack: 15, skipForward: 30 }
}));
vi.mock('./toast.svelte', () => {
  m.toast = vi.fn();
  return { toast: m.toast, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) };
});

const { ApiError } = await import('$lib/api/client');
type Player = (typeof import('./player.svelte'))['player'];
let player: Player;

const chapters: Chapter[] = [
  { id: 0, start: 0, end: 100, title: 'One' },
  { id: 1, start: 100, end: 200, title: 'Two' },
  { id: 2, start: 200, end: 1000, title: 'Three' }
];

function item(id: string): LibraryItem {
  return {
    id,
    libraryId: 'lib',
    mediaType: 'book',
    updatedAt: 1,
    media: { metadata: { title: `Book ${id}`, authorName: 'Author' }, chapters, duration: 1000, coverPath: null }
  } as unknown as LibraryItem;
}

let sessions = 0;
function playback(itemId: string, currentTime = 0, files = 1): PlaybackSession {
  const per = 1000 / files;
  return {
    id: `s${++sessions}-${itemId}`,
    libraryItemId: itemId,
    episodeId: null,
    duration: 1000,
    currentTime,
    chapters,
    audioTracks: Array.from({ length: files }, (_, i) => ({ index: i + 1, startOffset: i * per, duration: per, contentUrl: `/api/items/${itemId}/file/${i}` })),
    libraryItem: item(itemId)
  } as unknown as PlaybackSession;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

/** The element currently playing. */
const active = () => FakeAudio.all.find((a) => !a.paused) ?? FakeAudio.all.find((a) => a.getAttribute('src'))!;
const tick = (ms = 1000) => vi.advanceTimersByTimeAsync(ms);
const errorToasts = () => m.toast.mock.calls.filter(([, o]) => (o as { tone?: string } | undefined)?.tone === 'error');

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('HTMLMediaElement', { HAVE_METADATA: 1 });
  FakeAudio.all = [];
  sessions = 0;
  m.online = true;
  m.progress = {};
  m.reconnect = [];
  m.downloadsLoaded = false;
  m.download = null;
  localStorage.clear();
  for (const fn of Object.values(api)) if (vi.isMockFunction(fn)) fn.mockReset();
  for (const fn of [out.putProgress, out.putSession, out.confirm]) fn.mockReset();
  out.entries = {};
  api.startPlayback.mockImplementation(async (id: string) => playback(id));
  api.closeSession.mockResolvedValue(undefined);
  api.syncSession.mockResolvedValue(undefined);
  api.getProgress.mockResolvedValue(null);
  vi.resetModules();
  ({ player } = await import('./player.svelte'));
  m.toast.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Play an item and let its audio load and start. */
async function playLoaded(id = 'a', startAt?: number) {
  await player.play(id, null, startAt);
  active().metadata();
  expect(player.status).toBe('playing');
}

describe('play()', () => {
  it('lets the latest call win and closes the sessions opened for the others', async () => {
    const first = deferred<PlaybackSession>();
    api.startPlayback.mockImplementationOnce(() => first.promise);
    const a = player.play('a');
    await vi.waitFor(() => expect(api.startPlayback).toHaveBeenCalledTimes(1));
    const b = player.play('b');
    await tick(0);
    // The second request waits for the first, so the server sees them in order.
    expect(api.startPlayback).toHaveBeenCalledTimes(1);
    const sa = playback('a');
    first.resolve(sa);
    await Promise.all([a, b]);
    expect(api.closeSession).toHaveBeenCalledWith(sa.id);
    expect(api.startPlayback).toHaveBeenCalledTimes(2);
    expect(player.item?.id).toBe('b');
    expect(player.session?.libraryItemId).toBe('b');
    expect(player.status).toBe('playing');
  });

  it('does not let a superseded call start audio', async () => {
    const first = deferred<PlaybackSession>();
    api.startPlayback.mockImplementationOnce(() => first.promise);
    const plays = vi.fn(async () => {});
    const a = player.play('a');
    await tick(0);
    for (const el of FakeAudio.all) el.onPlay = plays;
    const b = player.play('b');
    first.resolve(playback('a'));
    await Promise.all([a, b]);
    expect(plays).toHaveBeenCalledTimes(1);
    expect(player.item?.id).toBe('b');
  });

  it('honours a seek made while the audio was still loading', async () => {
    await player.play('a', null, 50);
    await player.seek(400);
    active().metadata();
    expect(active().currentTime).toBe(400);
    expect(player.currentTime).toBe(400);
  });

  it('reports a file that will not play once, after one retry', async () => {
    const fail = async (a: FakeAudio) => {
      a.fail();
      throw new DOMException('unsupported', 'NotSupportedError');
    };
    await player.play('a');
    for (const el of FakeAudio.all) el.onPlay = fail;
    await player.stop();
    await player.play('b');
    await tick(0);
    expect(errorToasts()).toHaveLength(1);
    expect(player.status).toBe('paused');
  });
});

describe('the restored dock', () => {
  beforeEach(() => {
    localStorage.setItem('lectern.lastPlayed.acc', JSON.stringify({ itemId: 'a', episodeId: null }));
    m.progress.a = { currentTime: 100 } as MediaProgress;
    api.getItem.mockResolvedValue(item('a'));
  });

  it('starts from a position picked before pressing play', async () => {
    player.init();
    await vi.waitFor(() => expect(player.item?.id).toBe('a'));
    expect(player.ready).toBe(false);
    await player.seek(300);
    api.startPlayback.mockResolvedValueOnce(playback('a', 100));
    await player.resume();
    active().metadata();
    expect(active().currentTime).toBe(300);
    expect(player.currentTime).toBe(300);
  });

  it('uses the server’s position when nothing was picked', async () => {
    player.init();
    await vi.waitFor(() => expect(player.item?.id).toBe('a'));
    api.startPlayback.mockResolvedValueOnce(playback('a', 250));
    await player.resume();
    active().metadata();
    expect(active().currentTime).toBe(250);
  });

  it('restores a downloaded item offline, once downloads have loaded', async () => {
    m.online = false;
    api.getItem.mockRejectedValue(new ApiError(0, 'offline'));
    m.download = { item: item('a'), duration: 1000, tracks: [] };
    player.init();
    await vi.waitFor(() => expect(player.item?.id).toBe('a'));
    expect(api.getItem).not.toHaveBeenCalled();
    expect(player.currentTime).toBe(100);
  });
});

describe('sleep timer', () => {
  it('only counts down while playing', async () => {
    await playLoaded();
    player.sleepInMinutes(10);
    await tick(60_000);
    expect(player.sleepRemaining).toBeCloseTo(540, -1);
    player.pause();
    await tick(5 * 60_000);
    expect(player.sleepRemaining).toBeCloseTo(540, -1);
    await player.resume();
    await tick(60_000);
    expect(player.sleepRemaining).toBeCloseTo(480, -1);
  });

  it('keeps running into the next item from Up Next', async () => {
    await playLoaded();
    player.sleepInMinutes(30);
    const { endsAt } = player.sleep as { endsAt: number };
    player.enqueue({ itemId: 'b', episodeId: null, title: 'B', subtitle: '' });
    active().dispatchEvent(new Event('ended'));
    await vi.waitFor(() => expect(player.item?.id).toBe('b'));
    expect(player.sleep).toMatchObject({ kind: 'timer', endsAt });
  });

  it('stops at the end of the book instead of starting Up Next when set for the last chapter', async () => {
    await playLoaded('a', 500);
    player.sleepAtChapterEnd();
    expect(player.sleep).toEqual({ kind: 'chapter', chapterIndex: 2 });
    player.enqueue({ itemId: 'b', episodeId: null, title: 'B', subtitle: '' });
    active().dispatchEvent(new Event('ended'));
    await tick(0);
    await vi.waitFor(() => expect(player.sleep.kind).toBe('off'));
    expect(api.startPlayback).toHaveBeenCalledTimes(1);
    expect(player.item?.id).toBe('a');
    expect(player.queue).toHaveLength(1);
  });

  it('stops at the end of the book when set to', async () => {
    await playLoaded();
    player.sleepAtBookEnd();
    player.enqueue({ itemId: 'b', episodeId: null, title: 'B', subtitle: '' });
    active().dispatchEvent(new Event('ended'));
    await vi.waitFor(() => expect(player.sleep.kind).toBe('off'));
    expect(api.startPlayback).toHaveBeenCalledTimes(1);
  });

  it('follows seeks back instead of pausing, and pauses where the chapter ends', async () => {
    await playLoaded('a', 150);
    player.sleepAtChapterEnd();
    expect(player.sleep).toEqual({ kind: 'chapter', chapterIndex: 1 });
    await player.seek(50);
    active().at(50);
    await tick();
    expect(player.status).toBe('playing');
    expect(player.sleep).toEqual({ kind: 'chapter', chapterIndex: 0 });
    active().at(99);
    expect(player.status).toBe('playing');
    active().at(100.2);
    expect(player.status).toBe('paused');
    expect(player.sleep.kind).toBe('off');
    // Paused where it was, not moved on to the next chapter's start.
    expect(player.currentTime).toBeCloseTo(100.2);
  });

  it('re-targets on a chapter jump rather than firing', async () => {
    await playLoaded('a', 150);
    player.sleepAtChapterEnd();
    await player.prevChapter();
    active().at(player.currentTime);
    await tick();
    expect(player.status).toBe('playing');
    expect(player.sleep).toMatchObject({ kind: 'chapter' });
  });
});

describe('Up Next', () => {
  it('passes over an Up Next entry that will not start for the one after it', async () => {
    await playLoaded();
    api.startPlayback.mockImplementation(async (id: string) => {
      if (id === 'b') throw new ApiError(500, 'No audio');
      return playback(id);
    });
    player.enqueue({ itemId: 'b', episodeId: null, title: 'B', subtitle: '' });
    player.enqueue({ itemId: 'c', episodeId: null, title: 'C', subtitle: '' });
    active().dispatchEvent(new Event('ended'));
    await vi.waitFor(() => expect(player.item?.id).toBe('c'));
    expect(player.queue).toHaveLength(0);
    expect(errorToasts()).toHaveLength(1);
  });
});

describe('syncing', () => {
  it('sends the paused position even when a periodic sync is in flight', async () => {
    await playLoaded('a', 10);
    const inFlight = deferred<void>();
    api.syncSession.mockImplementationOnce(() => inFlight.promise);
    active().at(20);
    await tick(15_000);
    expect(api.syncSession).toHaveBeenCalledTimes(1);
    active().at(42);
    player.pause();
    expect(out.putProgress).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: 42, sessionId: player.session!.id }));
    inFlight.resolve();
    await vi.waitFor(() => expect(api.syncSession).toHaveBeenCalledTimes(2));
    expect(api.syncSession.mock.calls[1][1]).toMatchObject({ currentTime: 42 });
  });

  it('does not count time spent buffering as listening', async () => {
    await playLoaded();
    active().dispatchEvent(new Event('waiting'));
    await tick(10_000);
    active().dispatchEvent(new Event('playing'));
    await tick(5_000);
    player.pause();
    await tick(0);
    const listened = api.syncSession.mock.calls.reduce((sum, [, p]) => sum + (p as { timeListened: number }).timeListened, 0);
    expect(listened).toBeLessThanOrEqual(6);
  });

  it('falls back to a local session when the server goes away, and rejoins when it is back', async () => {
    await playLoaded();
    const lost = player.session!.id;
    api.syncSession.mockRejectedValueOnce(new ApiError(0, 'offline'));
    await tick(15_000);
    await vi.waitFor(() => expect(player.local).not.toBeNull());
    expect(player.session).toBeNull();
    expect(player.ready).toBe(true);

    await Promise.all(m.reconnect.map((fn) => fn()));
    expect(api.closeSession).toHaveBeenCalledWith(lost);
    expect(api.startPlayback).toHaveBeenCalledTimes(2);
    expect(player.local).toBeNull();
    expect(player.session?.id).not.toBe(lost);
    expect(out.putSession).toHaveBeenCalled();
  });

  it('closes the replacement for an expired session if the item changed meanwhile', async () => {
    await playLoaded('a');
    const fresh = deferred<PlaybackSession>();
    api.syncSession.mockRejectedValueOnce(new ApiError(404, 'Not Found'));
    api.startPlayback.mockImplementationOnce(() => fresh.promise);
    await tick(15_000);
    await player.play('b');
    const replacement = playback('a');
    fresh.resolve(replacement);
    await tick(0);
    expect(api.closeSession).toHaveBeenCalledWith(replacement.id);
    expect(player.session?.libraryItemId).toBe('b');
  });
});

describe('multi-file items', () => {
  it('backs off after a failed preload and loads the next file at the hand-over instead', async () => {
    await playLoaded('a', 0);
    await player.stop();
    api.startPlayback.mockImplementation(async (id: string) => playback(id, 0, 2));
    await player.play('a');
    const main = active();
    main.metadata();
    main.at(480);
    await tick(0);
    const standby = FakeAudio.all.find((x) => x !== main)!;
    expect(standby.srcSets).toHaveLength(1);
    standby.fail();
    for (let t = 481; t < 500; t++) main.at(t);
    await tick(0);
    expect(standby.srcSets).toHaveLength(1);
    const before = main.srcSets.length;
    main.dispatchEvent(new Event('ended'));
    await tick(0);
    expect(main.srcSets.length).toBe(before + 1);
  });

  it('hands over to a standby still loading rather than fetching the file twice', async () => {
    api.startPlayback.mockImplementation(async (id: string) => playback(id, 0, 2));
    await player.play('a');
    const main = active();
    main.metadata();
    main.at(480);
    await tick(0);
    const standby = FakeAudio.all.find((x) => x !== main)!;
    expect(standby.readyState).toBe(0);
    const mainSets = main.srcSets.length;
    main.dispatchEvent(new Event('ended'));
    await tick(0);
    expect(main.srcSets.length).toBe(mainSets);
    expect(standby.srcSets).toHaveLength(1);
    expect(standby.paused).toBe(false);
    standby.metadata();
    expect(standby.currentTime).toBe(0);
    expect(player.currentTime).toBe(500);
  });
});
