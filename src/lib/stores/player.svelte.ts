import * as abs from '$lib/api/abs';
import { ApiError, coverUrl, ensureFreshToken, mediaUrl, scopedKey } from '$lib/api/client';
import type { Chapter, LibraryItem, MediaProgress, PlaybackSession, PodcastEpisode } from '$lib/api/types';
import { isBook, isPodcast, type PodcastMetadata, type SeriesRef } from '$lib/api/types';
import { fileSrc, setNowPlaying } from '$lib/native';
import { tintFor, type Tint } from '$lib/util/color';
import { clock } from '$lib/util/format';
import { findChapter, findTrack, nextEpisode, nextInSeries, sessionDate, type QueueEntry } from '$lib/util/playback';
import { downloads, type DownloadRecord } from './downloads.svelte';
import { outbox, progressKey } from './outbox.svelte';
import { prefs } from './prefs.svelte';
import { session } from './session.svelte';
import { errorMessage, toast } from './toast.svelte';

export { findChapter };

const SYNC_EVERY_MS = 15_000;
const WRITE_AHEAD_MS = 5_000;
/** Start buffering the next file this many seconds before the current one ends. */
const PRELOAD_LEAD_S = 30;
const LAST_KEY = 'lectern.lastPlayed';
const QUEUE_KEY = 'lectern.queue';

export type SleepMode = { kind: 'off' } | { kind: 'timer'; endsAt: number; minutes: number } | { kind: 'chapter'; chapterIndex: number };

interface LastPlayed {
  itemId: string;
  episodeId: string | null;
}

interface PlayTrack {
  startOffset: number;
  duration: number;
  /** Built on demand: stream URLs carry a token that may have been refreshed since the session opened. */
  src: () => string;
}

class Player {
  item = $state<LibraryItem | null>(null);
  episode = $state<PodcastEpisode | null>(null);
  /** The server's playback session. Null before playing, or when playing a download without the server. */
  session = $state<PlaybackSession | null>(null);
  /** Set while listening is being recorded locally (offline, or the server stopped answering mid-session). */
  local = $state<abs.LocalSession | null>(null);
  status = $state<'idle' | 'loading' | 'playing' | 'paused'>('idle');
  buffering = $state(false);
  currentTime = $state(0);
  duration = $state(0);
  expanded = $state(false);
  sleep = $state<SleepMode>({ kind: 'off' });
  now = $state(Date.now());
  tint = $state<Tint | null>(null);
  fromDownload = $state(false);
  queue = $state<QueueEntry[]>([]);

  /** Audio is loaded and controllable (as opposed to the dock showing the last thing played, ready to resume). */
  ready = $derived(!!(this.session || this.local));
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
  /** Speed for what's loaded: its own if one was chosen, otherwise the default. */
  rate = $derived(this.item ? this.rateFor(this.item.id) : prefs.playbackRate);
  hasOwnRate = $derived(!!this.item && prefs.perItemSpeed && prefs.itemRates[this.item.id] !== undefined);
  sleepRemaining = $derived(
    this.sleep.kind === 'timer'
      ? Math.max(0, (this.sleep.endsAt - this.now) / 1000)
      : this.sleep.kind === 'chapter' && this.chapter
        ? Math.max(0, this.chapter.end - this.currentTime) / (this.rate || 1)
        : 0
  );

  private elements: HTMLAudioElement[] = [];
  private audio: HTMLAudioElement | null = null;
  private tracks: PlayTrack[] = [];
  private trackIndex = -1;
  /** Track index preloaded into the standby element, or -1. */
  private standbyTrack = -1;
  private listened = 0;
  private lastTick = 0;
  private lastSync = 0;
  private lastWriteAhead = 0;
  /** Position in the last sync the server acknowledged, to tell our own echoes from other devices' progress. */
  private lastSentTime = -1;
  private syncing: Promise<void> | null = null;
  private pausedAt = 0;
  private recoveringFrom = -1;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private pendingSeek: number | null = null;

  rateFor(itemId: string) {
    return (prefs.perItemSpeed ? prefs.itemRates[itemId] : undefined) ?? prefs.playbackRate;
  }

  init() {
    if (this.audio) return;
    this.elements = [this.createElement(), this.createElement()];
    this.audio = this.elements[0];

    this.ticker = setInterval(() => this.tick(), 1000);
    window.addEventListener('beforeunload', () => {
      this.writeAhead(true);
      if (this.session && !this.local) void abs.closeSession(this.session.id, this.syncPayload());
    });
    outbox.busy = (key) => !!this.item && !!this.session && !this.local && key === progressKey(this.item.id, this.episode?.id ?? null);
    session.onRemoteProgress = (p, from) => this.reconcile(p, from);
    try {
      this.queue = JSON.parse(localStorage.getItem(scopedKey(QUEUE_KEY)) ?? '[]');
    } catch {
      this.queue = [];
    }
    this.setupMediaSession();
    $effect.root(() => {
      // Keep the OS (lock screen, Control Center, menu bar) in step with what's playing.
      $effect(() => {
        void [this.title, this.author, this.chapter?.title, this.item?.id];
        this.updateMediaMetadata();
      });
      let sent = '';
      $effect(() => {
        const state = {
          title: this.item ? this.title : null,
          subtitle: this.item ? (this.episode ? this.author : this.chapters.length > 1 ? (this.chapter?.title ?? this.author) : this.author) : null,
          playing: this.isPlaying,
          canControl: !!this.item,
          sleepLabel: this.sleepLabel
        };
        // The sleep label is the only part that ticks; skip the IPC when nothing visible changed.
        const json = JSON.stringify(state);
        if (json === sent) return;
        sent = json;
        void setNowPlaying(state).catch(() => {});
      });
    });
    void this.restoreLast();
  }

  /** Short description of the sleep timer, for menus. */
  get sleepLabel() {
    if (this.sleep.kind === 'chapter') return 'end of chapter';
    if (this.sleep.kind === 'timer') return `${Math.max(1, Math.ceil(this.sleepRemaining / 60))} min left`;
    return null;
  }

  private createElement() {
    const a = new Audio();
    a.preload = 'auto';
    a.preservesPitch = true;
    a.volume = prefs.volume;
    const active = () => a === this.audio;

    a.addEventListener('timeupdate', () => {
      if (!active()) return;
      const t = this.tracks[this.trackIndex];
      if (t && this.pendingSeek === null) this.currentTime = t.startOffset + a.currentTime;
      if (t && t.duration - a.currentTime < PRELOAD_LEAD_S) this.preloadNext();
    });
    a.addEventListener('loadedmetadata', () => {
      if (!active()) return;
      if (this.pendingSeek !== null) {
        a.currentTime = this.pendingSeek;
        this.pendingSeek = null;
      }
      a.playbackRate = this.rate;
    });
    a.addEventListener('waiting', () => active() && (this.buffering = true));
    a.addEventListener('playing', () => {
      if (!active()) return;
      this.buffering = false;
      this.status = 'playing';
      this.recoveringFrom = -1;
    });
    a.addEventListener('canplay', () => active() && (this.buffering = false));
    a.addEventListener('pause', () => {
      // A file reaching its end pauses itself just before `ended`; the next file takes over from there.
      if (active() && !a.ended && this.status === 'playing') this.status = 'paused';
    });
    a.addEventListener('ended', () => active() && void this.onTrackEnded());
    a.addEventListener('error', () => {
      if (active()) void this.onAudioError();
      else if (Number(a.dataset.track) === this.standbyTrack) this.standbyTrack = -1;
    });
    return a;
  }

  private get standby() {
    return this.elements.find((e) => e !== this.audio)!;
  }

  /** Show the last thing listened to in the dock, ready to resume, without opening a session. */
  private async restoreLast() {
    const raw = localStorage.getItem(scopedKey(LAST_KEY));
    if (!raw || this.item) return;
    let last: LastPlayed;
    try {
      last = JSON.parse(raw) as LastPlayed;
    } catch {
      localStorage.removeItem(scopedKey(LAST_KEY));
      return;
    }
    let item: LibraryItem | null = downloads.ready(last.itemId, last.episodeId)?.item ?? null;
    try {
      item = await abs.getItem(last.itemId);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 0)) localStorage.removeItem(scopedKey(LAST_KEY));
    }
    if (!item || this.item) return;
    this.item = item;
    this.episode = last.episodeId && isPodcast(item) ? (item.media.episodes?.find((e) => e.id === last.episodeId) ?? null) : null;
    const progress = session.progressFor(item.id, last.episodeId);
    this.duration = this.episode?.duration ?? (isBook(item) ? item.media.duration : 0);
    this.currentTime = progress?.currentTime ?? 0;
    this.status = 'idle';
    void this.applyTint();
  }

  isCurrent(itemId: string, episodeId?: string | null) {
    return this.item?.id === itemId && (this.episode?.id ?? null) === (episodeId ?? null);
  }

  /** Start (or resume) an item. `startAt` overrides the saved position. */
  async play(itemId: string, episodeId: string | null = null, startAt?: number): Promise<void> {
    this.init();
    if (this.isCurrent(itemId, episodeId) && this.ready) {
      if (startAt !== undefined) await this.seek(startAt);
      return this.resume();
    }
    await this.stop();
    this.status = 'loading';
    const download = downloads.ready(itemId, episodeId);
    try {
      let s: PlaybackSession | null = null;
      try {
        await ensureFreshToken();
        s = await abs.startPlayback(itemId, episodeId);
      } catch (err) {
        // No server, but the files are here: listen anyway and record the session locally.
        if (!download || !(err instanceof ApiError && err.status === 0)) throw err;
      }
      const item = s?.libraryItem ?? download?.item ?? (await abs.getItem(itemId));
      this.item = item;
      this.episode = episodeId && isPodcast(item) ? (item.media.episodes?.find((e) => e.id === episodeId) ?? null) : null;
      this.fromDownload = !!download;
      this.tracks = download ? localTracks(download) : streamTracks(s!);
      this.duration = download?.duration ?? s!.duration;
      this.trackIndex = -1;
      this.standbyTrack = -1;
      this.listened = 0;
      this.lastSync = Date.now();
      this.lastSentTime = s?.currentTime ?? -1;
      localStorage.setItem(scopedKey(LAST_KEY), JSON.stringify({ itemId, episodeId } satisfies LastPlayed));
      void this.applyTint();

      let start = startAt ?? s?.currentTime ?? session.progressFor(itemId, episodeId)?.currentTime ?? 0;
      if (start >= this.duration - 2) start = 0;
      this.currentTime = start;
      this.session = s;
      if (!s) this.local = this.newLocalSession();
      await this.loadAt(start);
      await this.audio!.play();
    } catch (err) {
      this.status = this.item ? 'paused' : 'idle';
      toast(`Couldn't start playback. ${errorMessage(err)}`, { tone: 'error' });
    }
  }

  private newLocalSession(): abs.LocalSession {
    const item = this.item!;
    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      userId: session.user?.id,
      libraryId: item.libraryId,
      libraryItemId: item.id,
      episodeId: this.episode?.id ?? null,
      mediaType: item.mediaType,
      mediaMetadata: item.media.metadata,
      chapters: this.chapters,
      displayTitle: this.title,
      displayAuthor: this.author,
      coverPath: item.media.coverPath,
      duration: this.duration,
      playMethod: 3, // PlayMethod.LOCAL
      mediaPlayer: 'html5',
      deviceInfo: abs.deviceInfo(),
      ...sessionDate(now),
      timeListening: 0,
      startTime: this.currentTime,
      currentTime: this.currentTime,
      startedAt: now,
      updatedAt: now
    };
  }

  private async applyTint() {
    const item = this.item;
    if (!item) return;
    const t = await tintFor(coverUrl(item.id, 96, item.updatedAt));
    if (this.item?.id === item.id) this.tint = t;
  }

  private async loadAt(time: number) {
    const a = this.audio!;
    const i = findTrack(this.tracks, time);
    const track = this.tracks[i];
    if (!track) throw new Error('This item has no playable audio.');
    const local = Math.max(0, time - track.startOffset);
    this.currentTime = time;
    if (i !== this.trackIndex || !a.src) {
      this.trackIndex = i;
      this.pendingSeek = local;
      a.src = track.src();
      a.dataset.track = String(i);
      a.load();
    } else {
      a.currentTime = local;
    }
  }

  /** Buffer the next file in the standby element so the hand-over at the end of this one is seamless. */
  private preloadNext() {
    const next = this.trackIndex + 1;
    if (next >= this.tracks.length || this.standbyTrack === next) return;
    const b = this.standby;
    this.standbyTrack = next;
    b.src = this.tracks[next].src();
    b.dataset.track = String(next);
    b.load();
  }

  async resume(): Promise<void> {
    if (!this.item) return;
    if (!this.ready) return this.play(this.item.id, this.episode?.id ?? null);
    const a = this.audio!;
    if (this.pausedAt && Date.now() - this.pausedAt > 30_000) await this.checkElsewhere();
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

  /** Before resuming after a while, ask whether another device has moved this item on in the meantime. */
  private async checkElsewhere() {
    if (!this.item || !session.online) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    try {
      const p = await abs.getProgress(this.item.id, this.episode?.id ?? null, ctrl.signal);
      if (p) this.reconcile(p);
    } catch {
      // Slow or offline: resume where we are.
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Adopt progress made on another device. Only while not actively playing here: if we're playing, we're the
   * device being listened to, and our next sync is the newer truth.
   */
  reconcile(p: MediaProgress, from?: string) {
    if (!this.isCurrent(p.libraryItemId, p.episodeId)) return;
    if (this.status === 'playing' || this.status === 'loading') return;
    // Our own last sync echoing back.
    if (this.lastSentTime >= 0 && Math.abs(p.currentTime - this.lastSentTime) < 2) return;
    if (Math.abs(p.currentTime - this.currentTime) < 5) return;
    const was = this.currentTime;
    if (!this.ready) {
      this.currentTime = p.currentTime;
      return;
    }
    this.lastSentTime = p.currentTime;
    void this.seek(p.currentTime);
    toast(`Moved to ${clock(p.currentTime)}, where you left off${from ? ` on ${from}` : ' on another device'}.`, {
      action: { label: `Back to ${clock(was)}`, run: () => void this.seek(was) },
      ms: 8000
    });
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
    if (!this.ready) {
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
    if (prefs.perItemSpeed && this.item) prefs.itemRates = { ...prefs.itemRates, [this.item.id]: rate };
    else prefs.playbackRate = rate;
    if (this.audio) this.audio.playbackRate = rate;
    this.updatePositionState();
  }

  /** Forget this item's own speed and go back to the default. */
  resetRate() {
    if (!this.item) return;
    const { [this.item.id]: _, ...rest } = prefs.itemRates;
    prefs.itemRates = rest;
    if (this.audio) this.audio.playbackRate = this.rate;
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
    const item = this.item;
    const episodeId = this.episode?.id ?? null;
    for (const a of this.elements) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    if (item && this.ready) {
      const payload = this.syncPayload();
      if (this.local) {
        this.recordLocal();
      } else if (s) {
        this.writeAhead(true);
        this.session = null;
        try {
          await abs.closeSession(s.id, payload);
          outbox.confirm(progressKey(item.id, episodeId));
        } catch {
          // Stays in the outbox and goes out when the server is back.
        }
      }
      session.patchProgress(item.id, episodeId, { currentTime: payload.currentTime, progress: payload.currentTime / (payload.duration || 1) });
    }
    this.session = null;
    this.local = null;
    this.tracks = [];
    this.trackIndex = -1;
    this.standbyTrack = -1;
    this.status = 'idle';
    this.setSleep({ kind: 'off' });
  }

  /** Save where we are before the app quits. Resolves within `timeoutMs` whatever the network does. */
  async shutdown(timeoutMs = 2500) {
    this.writeAhead(true);
    if (this.local) this.recordLocal();
    const s = this.session;
    if (!s || this.local) return;
    const close = abs.closeSession(s.id, this.syncPayload()).then(() => this.item && outbox.confirm(progressKey(this.item.id, this.episode?.id ?? null)));
    await Promise.race([close.catch(() => {}), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  private syncPayload(): abs.SyncPayload {
    return { currentTime: this.currentTime, timeListened: Math.round(this.listened), duration: this.duration };
  }

  /** Persist the position locally between syncs, so a crash or force-quit can't lose it. */
  private writeAhead(force = false) {
    if (!this.item || !this.session || this.local) return;
    if (!force && Date.now() - this.lastWriteAhead < WRITE_AHEAD_MS) return;
    this.lastWriteAhead = Date.now();
    outbox.putProgress({
      itemId: this.item.id,
      episodeId: this.episode?.id ?? null,
      currentTime: this.currentTime,
      duration: this.duration,
      updatedAt: Date.now()
    });
  }

  /** Fold listening since the last call into the local session and queue it for the server. */
  private recordLocal() {
    const l = this.local;
    if (!l) return;
    l.timeListening += this.listened;
    l.currentTime = this.currentTime;
    l.updatedAt = Date.now();
    this.listened = 0;
    outbox.putSession($state.snapshot(l) as abs.LocalSession);
  }

  private async sync(force = false) {
    if (this.local) {
      if (force || Date.now() - this.lastSync >= SYNC_EVERY_MS) {
        this.lastSync = Date.now();
        this.recordLocal();
      }
      return;
    }
    const s = this.session;
    if (!s || this.syncing) return;
    if (!force && Date.now() - this.lastSync < SYNC_EVERY_MS) return;
    const payload = this.syncPayload();
    const listened = this.listened;
    const sentAt = Date.now();
    this.lastSync = sentAt;
    this.syncing = abs
      .syncSession(s.id, payload)
      .then(() => {
        this.listened = Math.max(0, this.listened - listened);
        this.lastSentTime = payload.currentTime;
        outbox.confirm(progressKey(s.libraryItemId, s.episodeId), sentAt);
      })
      .catch(async (err) => {
        if (this.session?.id !== s.id) return;
        if (err instanceof ApiError && err.status === 0) {
          // Lost the server mid-listen: carry on and record locally from here.
          outbox.confirm(progressKey(s.libraryItemId, s.episodeId));
          this.local = this.newLocalSession();
          this.local.timeListening = 0;
          this.recordLocal();
          return;
        }
        // The server drops idle sessions; open a fresh one at the same spot.
        if (err instanceof ApiError && err.status === 404 && this.item) {
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
    this.writeAhead();
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
    const next = this.trackIndex + 1;
    if (next < this.tracks.length) {
      const b = this.standby;
      if (this.standbyTrack === next && b.readyState >= HTMLMediaElement.HAVE_METADATA) {
        // Seamless: the next file is already buffered.
        this.audio = b;
        this.trackIndex = next;
        this.standbyTrack = -1;
        b.currentTime = 0;
        b.playbackRate = this.rate;
        b.volume = this.elements.find((e) => e !== b)!.volume;
        this.currentTime = this.tracks[next].startOffset;
        await b.play().catch(() => {});
      } else {
        await this.loadAt(this.tracks[next].startOffset);
        await this.audio!.play().catch(() => {});
      }
      return;
    }
    this.currentTime = this.duration;
    this.status = 'paused';
    await this.sync(true);
    const finished = this.item;
    if (finished) session.patchProgress(finished.id, this.episode?.id ?? null, { isFinished: true, progress: 1, finishedAt: Date.now() });
    toast(`Finished ${this.title}.`);
    await this.advance();
  }

  /** After finishing: play the head of Up Next, or carry on with the series or podcast if allowed. */
  private async advance() {
    const head = this.queue[0];
    if (head) {
      this.removeFromQueue(0);
      return this.play(head.itemId, head.episodeId);
    }
    if (!prefs.autoContinue || this.sleep.kind !== 'off') return;
    const next = await this.findNext().catch(() => null);
    if (next) {
      toast(`Up next: ${next.title}.`);
      return this.play(next.itemId, next.episodeId);
    }
  }

  private async findNext(): Promise<QueueEntry | null> {
    const item = this.item;
    if (!item) return null;
    const finished = (itemId: string, episodeId?: string | null) => !!session.progressFor(itemId, episodeId)?.isFinished;
    if (this.episode && isPodcast(item)) {
      let episodes = item.media.episodes ?? [];
      if (!episodes.length) {
        const full = await abs.getItem(item.id);
        episodes = isPodcast(full) ? (full.media.episodes ?? []) : [];
      }
      const ep = nextEpisode(episodes, this.episode.id, (id) => finished(item.id, id));
      return ep ? { itemId: item.id, episodeId: ep.id, title: ep.title, subtitle: item.media.metadata.title } : null;
    }
    if (!isBook(item)) return null;
    const s = item.media.metadata.series;
    const series = (Array.isArray(s) ? s[0] : s) as SeriesRef | undefined;
    if (!series) return null;
    const res = await abs.getLibraryItems(item.libraryId, {
      filter: abs.encodeFilter('series', series.id),
      sort: 'media.metadata.series.sequence',
      limit: 200
    });
    const books = res.results.map((b) => {
      const meta = isBook(b) ? b.media.metadata.series : undefined;
      const ref = (Array.isArray(meta) ? meta.find((x) => x.id === series.id) : meta) as SeriesRef | undefined;
      return { ...b, sequence: b.sequence ?? ref?.sequence ?? undefined };
    });
    const book = nextInSeries(books, item.id, (id) => finished(id));
    return book ? { itemId: book.id, episodeId: null, title: book.media.metadata.title, subtitle: series.name, updatedAt: book.updatedAt } : null;
  }

  // Up Next

  enqueue(entry: QueueEntry, opts: { next?: boolean } = {}) {
    const rest = this.queue.filter((q) => !(q.itemId === entry.itemId && q.episodeId === entry.episodeId));
    this.queue = opts.next ? [entry, ...rest] : [...rest, entry];
    this.saveQueue();
  }

  inQueue(itemId: string, episodeId: string | null = null) {
    return this.queue.some((q) => q.itemId === itemId && q.episodeId === episodeId);
  }

  removeFromQueue(index: number) {
    this.queue = this.queue.filter((_, i) => i !== index);
    this.saveQueue();
  }

  moveInQueue(index: number, by: number) {
    const to = index + by;
    if (to < 0 || to >= this.queue.length) return;
    const q = [...this.queue];
    [q[index], q[to]] = [q[to], q[index]];
    this.queue = q;
    this.saveQueue();
  }

  /** Replace Up Next with these entries and start the first. */
  playAll(entries: QueueEntry[]) {
    const [first, ...rest] = entries;
    if (!first) return;
    this.queue = rest;
    this.saveQueue();
    return this.play(first.itemId, first.episodeId);
  }

  clearQueue() {
    this.queue = [];
    this.saveQueue();
  }

  private saveQueue() {
    localStorage.setItem(scopedKey(QUEUE_KEY), JSON.stringify(this.queue));
  }

  /** Stream URLs carry a short-lived token; on failure refresh it once and pick up where we were. */
  private async onAudioError() {
    if (!this.ready || this.recoveringFrom === this.trackIndex) {
      if (this.ready) {
        this.status = 'paused';
        toast(
          this.fromDownload
            ? 'The downloaded file couldn’t be played. Try deleting and downloading it again.'
            : 'The audio stream stopped. Check your connection and press play to retry.',
          { tone: 'error' }
        );
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
    if (!('mediaSession' in navigator)) return;
    if (!this.item) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.title,
      artist: this.author,
      album: this.episode ? this.item.media.metadata.title : this.chapters.length > 1 ? (this.chapter?.title ?? '') : '',
      artwork: [{ src: coverUrl(this.item.id, 512, this.item.updatedAt), sizes: '512x512' }]
    });
  }

  private updatePositionState() {
    if (!('mediaSession' in navigator) || !this.duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: this.duration,
        position: Math.min(this.currentTime, this.duration),
        playbackRate: this.rate
      });
      navigator.mediaSession.playbackState = this.status === 'playing' ? 'playing' : 'paused';
    } catch {
      // Ignore out-of-range updates while seeking.
    }
  }
}

function streamTracks(s: PlaybackSession): PlayTrack[] {
  return [...s.audioTracks]
    .sort((a, b) => a.startOffset - b.startOffset)
    .map((t) => ({ startOffset: t.startOffset, duration: t.duration, src: () => mediaUrl(t.contentUrl) }));
}

function localTracks(d: DownloadRecord): PlayTrack[] {
  return d.tracks.map((t) => ({ startOffset: t.startOffset, duration: t.duration, src: () => fileSrc(t.path!) }));
}

export const player = new Player();
