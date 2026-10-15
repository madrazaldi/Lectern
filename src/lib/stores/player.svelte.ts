import * as abs from '$lib/api/abs';
import { coverUrl, ensureFreshToken, mediaUrl } from '$lib/api/client';
import type { AudioTrack, Chapter, LibraryItem, PlaybackSession, PodcastEpisode } from '$lib/api/types';
import { isBook, isPodcast, type PodcastMetadata } from '$lib/api/types';
import { tintFor, type Tint } from '$lib/util/color';
import { prefs } from './prefs.svelte';
import { session } from './session.svelte';
import { errorMessage, toast } from './toast.svelte';

const SYNC_EVERY_MS = 15_000;
const LAST_KEY = 'lectern.lastPlayed';

export type SleepMode = { kind: 'off' } | { kind: 'timer'; endsAt: number; minutes: number } | { kind: 'chapter'; chapterIndex: number };

interface LastPlayed {
  itemId: string;
  episodeId: string | null;
}

class Player {
  item = $state<LibraryItem | null>(null);
  episode = $state<PodcastEpisode | null>(null);
  session = $state<PlaybackSession | null>(null);
  status = $state<'idle' | 'loading' | 'playing' | 'paused'>('idle');
  buffering = $state(false);
  currentTime = $state(0);
  duration = $state(0);
  expanded = $state(false);
  sleep = $state<SleepMode>({ kind: 'off' });
  now = $state(Date.now());
  tint = $state<Tint | null>(null);

  title = $derived(this.episode?.title ?? this.item?.media.metadata.title ?? '');
  author = $derived.by(() => {
    const item = this.item;
    if (!item) return '';
    if (this.episode) return item.media.metadata.title;
    return isBook(item) ? (item.media.metadata.authorName ?? '') : ((item.media.metadata as PodcastMetadata).author ?? '');
  });
  chapters = $derived.by<Chapter[]>(() => {
    // Before a session opens (e.g. the dock restored on launch) fall back to the item's own chapters.
    const known = this.session?.chapters ?? this.episode?.chapters ?? (this.item && isBook(this.item) ? this.item.media.chapters : undefined);
    if (known?.length) return known;
    return this.duration ? [{ id: 0, start: 0, end: this.duration, title: this.title }] : [];
  });
  chapterIndex = $derived(findChapter(this.chapters, this.currentTime));
  chapter = $derived<Chapter | null>(this.chapters[this.chapterIndex] ?? null);
  isPlaying = $derived(this.status === 'playing');
  sleepRemaining = $derived(
    this.sleep.kind === 'timer'
      ? Math.max(0, (this.sleep.endsAt - this.now) / 1000)
      : this.sleep.kind === 'chapter' && this.chapter
        ? Math.max(0, this.chapter.end - this.currentTime) / (prefs.playbackRate || 1)
        : 0
  );

  private audio: HTMLAudioElement | null = null;
  private tracks: AudioTrack[] = [];
  private trackIndex = -1;
  private listened = 0;
  private lastTick = 0;
  private lastSync = 0;
  private syncing: Promise<void> | null = null;
  private pausedAt = 0;
  private recoveringFrom = -1;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private pendingSeek: number | null = null;

  init() {
    if (this.audio) return;
    const a = new Audio();
    a.preload = 'auto';
    a.preservesPitch = true;
    a.volume = prefs.volume;
    this.audio = a;

    a.addEventListener('timeupdate', () => {
      const t = this.tracks[this.trackIndex];
      if (t && this.pendingSeek === null) this.currentTime = t.startOffset + a.currentTime;
    });
    a.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek !== null) {
        a.currentTime = this.pendingSeek;
        this.pendingSeek = null;
      }
      a.playbackRate = prefs.playbackRate;
    });
    a.addEventListener('waiting', () => (this.buffering = true));
    a.addEventListener('playing', () => {
      this.buffering = false;
      this.status = 'playing';
      this.recoveringFrom = -1;
    });
    a.addEventListener('canplay', () => (this.buffering = false));
    a.addEventListener('pause', () => {
      if (this.status === 'playing') this.status = 'paused';
    });
    a.addEventListener('ended', () => this.onTrackEnded());
    a.addEventListener('error', () => this.onAudioError());

    this.ticker = setInterval(() => this.tick(), 1000);
    window.addEventListener('beforeunload', () => {
      if (this.session) void abs.closeSession(this.session.id, this.syncPayload());
    });
    this.setupMediaSession();
    void this.restoreLast();
  }

  /** Show the last thing listened to in the dock, ready to resume, without opening a session. */
  private async restoreLast() {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw || this.item) return;
    try {
      const last = JSON.parse(raw) as LastPlayed;
      const item = await abs.getItem(last.itemId);
      if (this.item) return;
      this.item = item;
      this.episode = last.episodeId && isPodcast(item) ? (item.media.episodes?.find((e) => e.id === last.episodeId) ?? null) : null;
      const progress = session.progressFor(item.id, last.episodeId);
      this.duration = this.episode?.duration ?? (isBook(item) ? item.media.duration : 0);
      this.currentTime = progress?.currentTime ?? 0;
      this.status = 'idle';
      void this.applyTint();
    } catch {
      localStorage.removeItem(LAST_KEY);
    }
  }

  isCurrent(itemId: string, episodeId?: string | null) {
    return this.item?.id === itemId && (this.episode?.id ?? null) === (episodeId ?? null);
  }

  /** Start (or resume) an item. `startAt` overrides the saved position. */
  async play(itemId: string, episodeId: string | null = null, startAt?: number): Promise<void> {
    this.init();
    if (this.isCurrent(itemId, episodeId) && this.session) {
      if (startAt !== undefined) await this.seek(startAt);
      return this.resume();
    }
    await this.stop();
    this.status = 'loading';
    try {
      await ensureFreshToken();
      const s = await abs.startPlayback(itemId, episodeId);
      this.session = s;
      this.item = s.libraryItem ?? (await abs.getItem(itemId));
      this.episode =
        episodeId && this.item && isPodcast(this.item) ? (this.item.media.episodes?.find((e) => e.id === episodeId) ?? null) : null;
      this.tracks = [...s.audioTracks].sort((a, b) => a.startOffset - b.startOffset);
      this.duration = s.duration;
      this.listened = 0;
      this.lastSync = Date.now();
      localStorage.setItem(LAST_KEY, JSON.stringify({ itemId, episodeId } satisfies LastPlayed));
      void this.applyTint();
      this.updateMediaMetadata();

      let start = startAt ?? s.currentTime ?? 0;
      if (start >= s.duration - 2) start = 0;
      await this.loadAt(start);
      await this.audio!.play();
    } catch (err) {
      this.status = this.item ? 'paused' : 'idle';
      toast(`Couldn't start playback. ${errorMessage(err)}`, { tone: 'error' });
    }
  }

  private async applyTint() {
    const item = this.item;
    if (!item) return;
    const t = await tintFor(coverUrl(item.id, 96, item.updatedAt));
    if (this.item?.id === item.id) this.tint = t;
  }

  private trackFor(time: number) {
    let i = this.tracks.findIndex((t) => time >= t.startOffset && time < t.startOffset + t.duration);
    if (i < 0) i = time <= 0 ? 0 : this.tracks.length - 1;
    return i;
  }

  private async loadAt(time: number) {
    const a = this.audio!;
    const i = this.trackFor(time);
    const track = this.tracks[i];
    if (!track) throw new Error('This item has no playable audio.');
    const local = Math.max(0, time - track.startOffset);
    this.currentTime = time;
    if (i !== this.trackIndex || !a.src) {
      this.trackIndex = i;
      this.pendingSeek = local;
      a.src = mediaUrl(track.contentUrl);
      a.load();
    } else {
      a.currentTime = local;
    }
  }

  async resume(): Promise<void> {
    if (!this.item) return;
    if (!this.session) return this.play(this.item.id, this.episode?.id ?? null);
    const a = this.audio!;
    if (this.pausedAt && Date.now() - this.pausedAt > 60_000 && prefs.smartRewind > 0) {
      await this.seek(Math.max(this.chapter?.start ?? 0, this.currentTime - prefs.smartRewind));
    }
    this.pausedAt = 0;
    this.lastTick = Date.now();
    try {
      await a.play();
    } catch (err) {
      toast(`Playback was blocked. ${errorMessage(err)}`, { tone: 'error' });
    }
  }

  pause() {
    if (!this.audio || this.status !== 'playing') return;
    this.audio.pause();
    this.status = 'paused';
    this.pausedAt = Date.now();
    void this.sync(true);
  }

  toggle() {
    if (this.status === 'playing') this.pause();
    else if (this.status !== 'loading') void this.resume();
  }

  async seek(time: number) {
    if (!this.item) return;
    time = Math.max(0, Math.min(time, (this.duration || Infinity) - 0.5));
    if (!this.session) {
      this.currentTime = time;
      return;
    }
    const wasPlaying = this.status === 'playing';
    await this.loadAt(time);
    if (wasPlaying && this.audio!.paused) await this.audio!.play().catch(() => {});
    this.updatePositionState();
  }

  skip(seconds: number) {
    return this.seek(this.currentTime + seconds);
  }

  /** Previous chapter, or the start of the current one if we're more than a few seconds in. */
  prevChapter() {
    const c = this.chapter;
    if (!c) return;
    const i = this.chapterIndex;
    if (this.currentTime - c.start > 4 || i === 0) return this.seek(c.start);
    return this.seek(this.chapters[i - 1].start);
  }

  nextChapter() {
    const next = this.chapters[this.chapterIndex + 1];
    if (next) return this.seek(next.start);
  }

  setRate(rate: number) {
    rate = Math.round(Math.min(Math.max(rate, 0.5), 3.5) * 100) / 100;
    prefs.playbackRate = rate;
    if (this.audio) this.audio.playbackRate = rate;
    this.updatePositionState();
  }

  setVolume(v: number) {
    prefs.volume = Math.min(Math.max(v, 0), 1);
    if (this.audio) this.audio.volume = prefs.volume;
  }

  setSleep(mode: SleepMode) {
    this.sleep = mode;
    if (this.audio) this.audio.volume = prefs.volume;
  }

  sleepInMinutes(minutes: number) {
    this.setSleep({ kind: 'timer', minutes, endsAt: Date.now() + minutes * 60_000 });
  }

  sleepAtChapterEnd() {
    this.setSleep({ kind: 'chapter', chapterIndex: this.chapterIndex });
  }

  /** Close the server session and clear the dock. */
  async stop() {
    const s = this.session;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    if (s) {
      const payload = this.syncPayload();
      this.session = null;
      await abs.closeSession(s.id, payload).catch(() => {});
      session.patchProgress(s.libraryItemId, s.episodeId, { currentTime: payload.currentTime, progress: payload.currentTime / (payload.duration || 1) });
    }
    this.tracks = [];
    this.trackIndex = -1;
    this.status = 'idle';
    this.setSleep({ kind: 'off' });
  }

  private syncPayload(): abs.SyncPayload {
    return { currentTime: this.currentTime, timeListened: Math.round(this.listened), duration: this.duration };
  }

  private async sync(force = false) {
    const s = this.session;
    if (!s || this.syncing) return;
    if (!force && Date.now() - this.lastSync < SYNC_EVERY_MS) return;
    const payload = this.syncPayload();
    const listened = this.listened;
    this.lastSync = Date.now();
    this.syncing = abs
      .syncSession(s.id, payload)
      .then(() => {
        this.listened = Math.max(0, this.listened - listened);
      })
      .catch(async (err) => {
        // The server drops idle sessions; open a fresh one at the same spot.
        if ((err as { status?: number }).status === 404 && this.item) {
          const fresh = await abs.startPlayback(this.item.id, this.episode?.id ?? null).catch(() => null);
          if (fresh && this.session?.id === s.id) this.session = { ...fresh, currentTime: this.currentTime };
        }
      })
      .finally(() => (this.syncing = null));
    await this.syncing;
  }

  private tick() {
    this.now = Date.now();
    if (this.status !== 'playing') return;
    if (this.lastTick) this.listened += Math.min((this.now - this.lastTick) / 1000, 2);
    this.lastTick = this.now;

    if (this.item) {
      session.patchProgress(this.item.id, this.episode?.id ?? null, {
        currentTime: this.currentTime,
        duration: this.duration,
        progress: this.duration ? this.currentTime / this.duration : 0
      });
    }
    void this.sync();
    this.runSleepTimer();
    this.updatePositionState();
  }

  private runSleepTimer() {
    const a = this.audio!;
    const sl = this.sleep;
    if (sl.kind === 'timer') {
      const left = (sl.endsAt - this.now) / 1000;
      if (left <= 0) {
        this.pause();
        this.setSleep({ kind: 'off' });
        toast('Sleep timer ended. Playback paused.');
      } else if (left < 10) {
        a.volume = prefs.volume * (left / 10);
      }
    } else if (sl.kind === 'chapter' && this.chapterIndex !== sl.chapterIndex) {
      this.pause();
      void this.seek(this.chapters[sl.chapterIndex + 1]?.start ?? this.currentTime);
      this.setSleep({ kind: 'off' });
      toast('Paused at the end of the chapter.');
    }
  }

  private async onTrackEnded() {
    if (this.trackIndex < this.tracks.length - 1) {
      const next = this.tracks[this.trackIndex + 1];
      await this.loadAt(next.startOffset);
      await this.audio!.play().catch(() => {});
      return;
    }
    this.currentTime = this.duration;
    this.status = 'paused';
    await this.sync(true);
    if (this.item) session.patchProgress(this.item.id, this.episode?.id ?? null, { isFinished: true, progress: 1 });
    toast(`Finished ${this.title}.`);
  }

  /** Stream URLs carry a short-lived token; on failure refresh it once and pick up where we were. */
  private async onAudioError() {
    if (!this.session || this.recoveringFrom === this.trackIndex) {
      if (this.session) {
        this.status = 'paused';
        toast('The audio stream stopped. Check your connection and press play to retry.', { tone: 'error' });
      }
      return;
    }
    this.recoveringFrom = this.trackIndex;
    const at = this.currentTime;
    const wasPlaying = this.status === 'playing' || this.status === 'loading';
    await ensureFreshToken();
    this.trackIndex = -1;
    await this.loadAt(at);
    if (wasPlaying) await this.audio!.play().catch(() => {});
  }

  private setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const handle = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // Unsupported action in this webview.
      }
    };
    handle('play', () => void this.resume());
    handle('pause', () => this.pause());
    handle('seekbackward', (d) => void this.skip(-(d.seekOffset ?? prefs.skipBack)));
    handle('seekforward', (d) => void this.skip(d.seekOffset ?? prefs.skipForward));
    handle('previoustrack', () => void this.prevChapter());
    handle('nexttrack', () => void this.nextChapter());
    handle('seekto', (d) => d.seekTime !== undefined && void this.seek(d.seekTime));
  }

  private updateMediaMetadata() {
    if (!('mediaSession' in navigator) || !this.item) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.title,
      artist: this.author,
      album: this.episode ? this.item.media.metadata.title : (this.chapter?.title ?? ''),
      artwork: [{ src: coverUrl(this.item.id, 512, this.item.updatedAt), sizes: '512x512' }]
    });
  }

  private updatePositionState() {
    if (!('mediaSession' in navigator) || !this.duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: this.duration,
        position: Math.min(this.currentTime, this.duration),
        playbackRate: prefs.playbackRate
      });
      navigator.mediaSession.playbackState = this.status === 'playing' ? 'playing' : 'paused';
    } catch {
      // Ignore out-of-range updates while seeking.
    }
  }
}

export function findChapter(chapters: Chapter[], time: number) {
  let lo = 0;
  let hi = chapters.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (time < chapters[mid].start) hi = mid - 1;
    else if (time >= chapters[mid].end) lo = mid + 1;
    else return mid;
  }
  return Math.max(0, Math.min(lo, chapters.length - 1));
}

export const player = new Player();
