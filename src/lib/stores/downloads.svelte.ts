import { SvelteMap } from 'svelte/reactivity';
import * as abs from '$lib/api/abs';
import { authHeaders, coverUrl, ensureFreshToken, getCredentials, listAccounts, onAccountChanged, serverUrl, type Account } from '$lib/api/client';
import type { AudioFile, Chapter, LibraryItem, PodcastMetadata } from '$lib/api/types';
import { isBook, isPodcast } from '$lib/api/types';
import { call, inTauri, on } from '$lib/native';
import { bytes } from '$lib/util/format';
import { errorMessage, toast } from './toast.svelte';

export interface DownloadedTrack {
  index: number;
  startOffset: number;
  duration: number;
  title: string;
  mimeType: string;
  fileName: string;
  size: number;
  /** Absolute path once the file is on disk. */
  path: string | null;
}

/** `paused` downloads keep their partial files and pick up where they stopped. */
export type DownloadStatus = 'downloading' | 'paused' | 'ready' | 'failed';

export interface DownloadRecord {
  key: string;
  accountId: string;
  /** "user on host", so downloads from another account can still be told apart. */
  accountLabel?: string;
  itemId: string;
  episodeId: string | null;
  /** Folder under the app's downloads directory. */
  dir: string;
  title: string;
  author: string;
  /** The item as it was when downloaded, so it can be shown and played without the server. */
  item: LibraryItem;
  chapters: Chapter[];
  duration: number;
  tracks: DownloadedTrack[];
  /** Server file (inode) behind each track index. */
  trackSources: Record<number, string>;
  coverPath: string | null;
  status: DownloadStatus;
  error?: string;
  bytesTotal: number;
  bytesDone: number;
  addedAt: number;
}

/** What the Rust side rejects `download_file` with. */
interface DownloadError {
  kind: 'cancelled' | 'network' | 'http' | 'invalid' | 'io';
  message: string;
  status?: number;
}

interface Progress {
  id: string;
  received: number;
  total: number | null;
}

export function downloadKey(itemId: string, episodeId: string | null) {
  return episodeId ? `${itemId}:${episodeId}` : itemId;
}

function safeSegment(s: string) {
  return s.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function downloadDir(accountId: string, key: string) {
  return safeSegment(`${accountId.slice(0, 8)}-${key}`);
}

function extOf(f: AudioFile) {
  const ext = f.metadata.ext || f.metadata.filename.match(/\.[^.]+$/)?.[0] || '';
  return /^\.[A-Za-z0-9]{1,6}$/.test(ext) ? ext.toLowerCase() : '';
}

function accountLabel(a: Pick<Account, 'serverUrl' | 'username'>) {
  let host = a.serverUrl;
  try {
    host = new URL(a.serverUrl).host;
  } catch {
    // Keep the raw address.
  }
  return a.username ? `${a.username} on ${host}` : host;
}

function asDownloadError(err: unknown): DownloadError {
  if (err && typeof err === 'object' && 'kind' in err && 'message' in err) return err as DownloadError;
  if (err === 'cancelled') return { kind: 'cancelled', message: 'cancelled' };
  return { kind: 'io', message: errorMessage(err) };
}

function isTransient(e: DownloadError, attempt: number) {
  if (e.kind === 'network') return true;
  if (e.kind !== 'http' || e.status === undefined) return false;
  // One 401 is worth a retry with a refreshed token.
  return (e.status === 401 && attempt === 0) || e.status === 408 || e.status === 429 || e.status >= 500;
}

/** Lay an item's audio files end to end, the same way the server builds a session's tracks. */
export function planTracks(files: AudioFile[]): DownloadedTrack[] {
  let offset = 0;
  return files
    .filter((f) => !f.exclude)
    .sort((a, b) => a.index - b.index)
    .map((f, i) => {
      const t: DownloadedTrack = {
        index: i + 1,
        startOffset: offset,
        duration: f.duration,
        title: f.metadata.filename,
        mimeType: f.mimeType,
        fileName: `${String(i + 1).padStart(3, '0')}-${safeSegment(f.ino)}${extOf(f)}`,
        size: f.metadata.size ?? 0,
        path: null
      };
      offset += f.duration;
      return t;
    });
}

function byKey(records: DownloadRecord[]) {
  const out: Record<string, DownloadRecord> = {};
  for (const r of records) out[r.key] = r;
  return out;
}

const finishedBytes = (r: DownloadRecord, except?: number) => r.tracks.reduce((sum, t) => sum + (t.path && t.index !== except ? t.size : 0), 0);

/** One run of a download. A newer run for the same folder gets a new generation; anything the old one does after that is ignored. */
export class DownloadJob {
  /** Rust attempt ids in flight, so stopping reaches them (cover included). */
  readonly ids = new Set<string>();
  cancelled = false;
  done: Promise<void> = Promise.resolve();
  wake: (() => void) | null = null;

  phase = $state<'starting' | 'downloading' | 'retrying'>('starting');
  /** Track being fetched and how far along it is. */
  track = $state(0);
  trackReceived = $state(0);
  trackTotal = $state(0);
  /** Bytes per second, smoothed. */
  speed = $state(0);

  sample = { at: 0, bytes: 0 };

  constructor(
    readonly gen: number,
    readonly key: string,
    readonly dir: string,
    readonly accountId: string
  ) {}
}

type Target = string | DownloadRecord;

class Downloads {
  /** Every download on disk, from any account, by folder. */
  byDir = $state<Record<string, DownloadRecord>>({});
  usage = $state(0);
  accountId = $state<string | null>(null);
  /** Records for the signed-in account, by key. */
  records = $derived(byKey(Object.values(this.byDir).filter((r) => r.accountId === this.accountId)));
  /** Records for the signed-in account, newest first. */
  list = $derived(Object.values(this.records).sort((a, b) => b.addedAt - a.addedAt));
  /** Downloads made while signed in to some other account; still on disk, so they can be deleted from here. */
  others = $derived(
    Object.values(this.byDir)
      .filter((r) => r.accountId !== this.accountId)
      .sort((a, b) => b.addedAt - a.addedAt)
  );

  /** Waits between attempts at a file after a transient failure. */
  retryDelays = [2_000, 5_000, 15_000];

  private jobs = new SvelteMap<string, DownloadJob>();
  private attempts = new Map<string, { job: DownloadJob; index: number }>();
  private writes = new Map<string, Promise<boolean>>();
  private removals = new Map<string, Promise<void>>();
  private loading: Promise<void> | null = null;
  private listening = false;
  private gen = 0;

  /** Downloads running now (for the quit handshake). */
  get active() {
    return this.jobs.size;
  }

  /**
   * Reads downloads from disk. Memoized: every call returns the same promise, so the player can await it on
   * startup. Use `reload()` to read again, e.g. after switching accounts.
   */
  load(): Promise<void> {
    this.loading ??= this.read(true);
    return this.loading;
  }

  /** Re-reads downloads for the account that is signed in now. Running downloads carry on. */
  reload(): Promise<void> {
    if (!this.loading) return this.load();
    this.loading = (this.loading ?? Promise.resolve()).then(() => this.read(false));
    return this.loading;
  }

  private async read(first: boolean) {
    this.accountId = getCredentials()?.id ?? null;
    if (!inTauri) return;
    if (!this.listening) {
      this.listening = true;
      void on<Progress>('download-progress', (p) => this.onProgress(p));
    }
    // Folders a quit or crash left without any record of what they hold.
    if (first) await call<number>('prune_downloads').catch(() => 0);
    const metas = await call<string[]>('list_download_meta', {}, []).catch(() => [] as string[]);
    const next: Record<string, DownloadRecord> = {};
    for (const raw of metas) {
      try {
        const r = JSON.parse(raw) as DownloadRecord;
        if (!r.dir || !r.key || !r.accountId) continue;
        const live = this.byDir[r.dir];
        if (live && this.jobs.has(r.dir)) {
          next[r.dir] = live;
          continue;
        }
        // Interrupted by quitting: the partial files are still there, so it can resume.
        if (r.status === 'downloading') {
          r.status = 'paused';
          r.bytesDone = finishedBytes(r);
        }
        next[r.dir] = r;
      } catch {
        // Corrupt meta: ignore.
      }
    }
    for (const dir of this.jobs.keys()) if (this.byDir[dir] && !next[dir]) next[dir] = this.byDir[dir];
    this.byDir = next;
    this.accountId = getCredentials()?.id ?? null;
    void this.refreshUsage();
  }

  async refreshUsage() {
    this.usage = await call<number>('downloads_usage', {}, 0).catch(() => 0);
  }

  get(itemId: string, episodeId: string | null = null): DownloadRecord | undefined {
    return this.records[downloadKey(itemId, episodeId)];
  }

  /** Path of a downloaded cover for this item (any of its downloads), if one is on disk. */
  coverFor(itemId: string) {
    for (const r of this.list) if (r.itemId === itemId && r.coverPath) return r.coverPath;
    return null;
  }

  /** The finished download for this item, if there is one. */
  ready(itemId: string, episodeId: string | null = null) {
    const r = this.get(itemId, episodeId);
    return r?.status === 'ready' ? r : undefined;
  }

  /** The running download for a record or key, with live per-file progress. */
  job(target: Target): DownloadJob | undefined {
    const dir = this.dirOf(target);
    return dir ? this.jobs.get(dir) : undefined;
  }

  jobFor(itemId: string, episodeId: string | null = null) {
    return this.job(downloadKey(itemId, episodeId));
  }

  /** Who a record belongs to, for listing downloads from other accounts. */
  accountLabel(r: DownloadRecord) {
    const account = listAccounts().find((a) => a.id === r.accountId);
    return r.accountLabel ?? (account ? accountLabel(account) : 'A signed-out account');
  }

  private dirOf(target: Target) {
    if (typeof target !== 'string') return target.dir;
    return this.accountId ? downloadDir(this.accountId, target) : null;
  }

  private live(job: DownloadJob) {
    return !job.cancelled && this.jobs.get(job.dir) === job;
  }

  /** Starts or resumes a download. Calling it again while it runs does nothing. */
  start(itemId: string, episodeId: string | null = null): Promise<void> {
    const account = getCredentials();
    if (!inTauri || !account) return Promise.resolve();
    this.accountId = account.id;
    const key = downloadKey(itemId, episodeId);
    const dir = downloadDir(account.id, key);
    // Claimed before anything is awaited, so a double click can't start two runs on the same files.
    const prev = this.jobs.get(dir);
    if (prev && !prev.cancelled) return prev.done;
    const job = new DownloadJob(++this.gen, key, dir, account.id);
    this.jobs.set(dir, job);
    const existing = this.byDir[dir];
    if (existing) {
      existing.status = 'downloading';
      existing.error = undefined;
    }
    // A stopped run or a deletion in this folder must be finished with its files before this run touches them.
    const after = Promise.all([prev?.done, this.removals.get(dir)]);
    job.done = this.run(job, account, itemId, episodeId, after).finally(() => {
      for (const [id, a] of this.attempts) if (a.job === job) this.attempts.delete(id);
      if (this.jobs.get(dir) === job) this.jobs.delete(dir);
      void this.refreshUsage();
    });
    return job.done;
  }

  private async run(job: DownloadJob, account: Account, itemId: string, episodeId: string | null, after: Promise<unknown>) {
    await after;
    if (!this.live(job)) return;

    let record: DownloadRecord;
    try {
      const item = await abs.getItem(itemId);
      if (!this.live(job)) return;
      record = this.plan(item, episodeId, account);
      const prev = this.byDir[job.dir];
      if (prev) {
        // Resuming: files that already finished are still on disk.
        record.tracks = record.tracks.map((t) => ({ ...t, path: prev.tracks.find((p) => p.fileName === t.fileName)?.path ?? null }));
        record.coverPath = prev.coverPath;
        record.addedAt = prev.addedAt;
      }
      record.bytesDone = finishedBytes(record);
      const needed = record.tracks.reduce((sum, t) => sum + (t.path ? 0 : t.size), 0);
      const free = await call<number>('downloads_free_space').catch(() => Infinity);
      if (!this.live(job)) return;
      if (needed > free) throw new Error(`Not enough disk space: needs ${bytes(needed)}, ${bytes(free)} free.`);
    } catch (err) {
      if (!this.live(job)) return;
      const message = errorMessage(err);
      const prev = this.byDir[job.dir];
      if (prev) {
        prev.status = 'failed';
        prev.error = message;
        await this.saveMeta(prev);
      }
      toast(`Couldn't start the download. ${message}`, { tone: 'error' });
      return;
    }
    this.byDir[job.dir] = record;
    if (!(await this.saveMeta(record, true))) {
      if (!this.live(job)) return;
      return this.fail(job, "Couldn't write to the downloads folder.");
    }

    if (!record.coverPath && record.item.media.coverPath) {
      try {
        const path = await this.fetch(job, `${job.key}#cover@${job.gen}`, null, {
          url: coverUrl(itemId, 800, record.item.updatedAt),
          headers: {},
          fileName: 'cover.jpg',
          kind: 'image'
        });
        const r = this.byDir[job.dir];
        if (r) r.coverPath = path;
      } catch (err) {
        if (asDownloadError(err).kind === 'cancelled') return;
        // No cover is fine; the server's is used while online.
      }
    }

    for (const t of record.tracks) {
      if (t.path) continue;
      let path: string | null;
      try {
        path = await this.fetchTrack(job, record, t);
      } catch (err) {
        if (!this.live(job)) return;
        return this.fail(job, asDownloadError(err).message);
      }
      if (path === null) return;
      // Keep a finished file even if this run was stopped meanwhile (paused): it's complete on disk.
      const r = this.byDir[job.dir];
      if (!r) return;
      r.tracks = r.tracks.map((x) => (x.index === t.index ? { ...x, path } : x));
      r.bytesDone = finishedBytes(r);
      await this.saveMeta(r);
      if (!this.live(job)) return;
    }
    const r = this.byDir[job.dir];
    if (!r || !this.live(job)) return;
    r.status = 'ready';
    r.error = undefined;
    r.bytesDone = r.bytesTotal;
    await this.saveMeta(r);
    toast(`${r.title} is ready to play offline.`);
  }

  /** One track, retrying transient failures; resumes from the partial file each time. Null when stopped. */
  private async fetchTrack(job: DownloadJob, record: DownloadRecord, t: DownloadedTrack): Promise<string | null> {
    for (let attempt = 0; ; attempt++) {
      await ensureFreshToken();
      if (!this.live(job)) return null;
      job.phase = 'downloading';
      job.track = t.index;
      job.trackReceived = 0;
      job.trackTotal = t.size;
      try {
        return await this.fetch(job, `${job.key}#${t.index}@${job.gen}.${attempt}`, t.index, {
          url: `${serverUrl()}/api/items/${record.itemId}/file/${record.trackSources[t.index]}`,
          headers: authHeaders(),
          fileName: t.fileName,
          expectedSize: t.size || null,
          kind: 'audio'
        });
      } catch (err) {
        const e = asDownloadError(err);
        if (e.kind === 'cancelled' || !this.live(job)) return null;
        if (!isTransient(e, attempt) || attempt >= this.retryDelays.length) throw e;
        // The token was turned away; any API request refreshes it before the next attempt.
        if (e.status === 401) await abs.getItem(record.itemId).catch(() => {});
        const delay = this.retryDelays[attempt];
        job.phase = 'retrying';
        await this.sleep(job, delay);
      }
    }
  }

  private async fetch(
    job: DownloadJob,
    id: string,
    index: number | null,
    args: { url: string; headers: Record<string, string>; fileName: string; expectedSize?: number | null; kind: 'audio' | 'image' }
  ) {
    job.ids.add(id);
    if (index !== null) this.attempts.set(id, { job, index });
    job.sample = { at: 0, bytes: 0 };
    try {
      return await call<string>('download_file', { id, dir: job.dir, ...args });
    } finally {
      job.ids.delete(id);
      this.attempts.delete(id);
    }
  }

  private sleep(job: DownloadJob, ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        job.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      job.wake = done;
    });
  }

  private async fail(job: DownloadJob, message: string) {
    const r = this.byDir[job.dir];
    if (!r) return;
    r.status = 'failed';
    r.error = message;
    r.bytesDone = finishedBytes(r);
    await this.saveMeta(r);
    toast(`Download of ${r.title} stopped. ${message}`, { tone: 'error' });
  }

  private plan(item: LibraryItem, episodeId: string | null, account: Account): DownloadRecord {
    let files: AudioFile[] = [];
    let chapters: Chapter[] = [];
    let title = item.media.metadata.title;
    let author = isBook(item) ? (item.media.metadata.authorName ?? '') : ((item.media.metadata as PodcastMetadata).author ?? '');
    let stored = item;
    if (episodeId) {
      const ep = isPodcast(item) ? item.media.episodes?.find((e) => e.id === episodeId) : undefined;
      if (!ep?.audioFile) throw new Error('This episode has no audio file on the server.');
      files = [ep.audioFile];
      chapters = ep.chapters ?? [];
      author = title;
      title = ep.title;
      // Keep just this episode: whole podcast feeds can be enormous.
      stored = { ...item, media: { ...item.media, episodes: [ep] } } as LibraryItem;
    } else if (isBook(item)) {
      files = item.media.audioFiles ?? [];
      chapters = item.media.chapters ?? [];
    }
    const sorted = files.filter((f) => !f.exclude).sort((a, b) => a.index - b.index);
    const tracks = planTracks(files);
    if (!tracks.length) throw new Error('This title has no audio files.');
    const duration = tracks.reduce((sum, t) => sum + t.duration, 0);
    const key = downloadKey(item.id, episodeId);
    return {
      key,
      accountId: account.id,
      accountLabel: accountLabel(account),
      itemId: item.id,
      episodeId,
      dir: downloadDir(account.id, key),
      title,
      author,
      item: stored,
      chapters,
      duration,
      tracks,
      coverPath: null,
      status: 'downloading',
      bytesTotal: tracks.reduce((sum, t) => sum + t.size, 0),
      bytesDone: 0,
      addedAt: Date.now(),
      trackSources: Object.fromEntries(tracks.map((t, i) => [t.index, sorted[i].ino]))
    };
  }

  private onProgress(p: Progress) {
    const a = this.attempts.get(p.id);
    if (!a) return;
    const { job, index } = a;
    const r = this.byDir[job.dir];
    if (!r) return;
    job.track = index;
    job.trackReceived = p.received;
    if (p.total) job.trackTotal = p.total;
    const now = Date.now();
    if (!job.sample.at) job.sample = { at: now, bytes: p.received };
    else if (now - job.sample.at >= 500) {
      const rate = ((p.received - job.sample.bytes) * 1000) / (now - job.sample.at);
      job.speed = job.speed ? job.speed * 0.7 + rate * 0.3 : rate;
      job.sample = { at: now, bytes: p.received };
    }
    r.bytesDone = Math.min(r.bytesTotal, finishedBytes(r, index) + p.received);
  }

  /** Writes a record's meta.json. Only `create` may make the folder, so a late write can't bring back a deleted download. */
  private saveMeta(r: DownloadRecord, create = false): Promise<boolean> {
    const json = JSON.stringify($state.snapshot(r));
    const prev = this.writes.get(r.dir) ?? Promise.resolve(true);
    const next = prev.then(() =>
      call<boolean>('write_download_meta', { dir: r.dir, json, create }).then(
        (ok) => ok !== false,
        (err) => {
          console.error('Could not save download info', err);
          return false;
        }
      )
    );
    this.writes.set(r.dir, next);
    void next.then(() => {
      if (this.writes.get(r.dir) === next) this.writes.delete(r.dir);
    });
    return next;
  }

  /** Stops a run and resolves once Rust has closed its files. */
  private stop(job: DownloadJob) {
    job.cancelled = true;
    job.wake?.();
    const cancels = [...job.ids].map((id) => call('cancel_download', { id }).catch(() => {}));
    return Promise.all(cancels).then(() => job.done);
  }

  /** Stops a download but keeps what it has so far. */
  async pause(target: Target) {
    const dir = this.dirOf(target);
    const job = dir ? this.jobs.get(dir) : undefined;
    if (!dir || !job) return;
    await this.stop(job);
    const r = this.byDir[dir];
    if (!r || this.jobs.has(dir)) return;
    r.status = 'paused';
    r.error = undefined;
    r.bytesDone = finishedBytes(r);
    await this.saveMeta(r);
  }

  /** Stops a download and deletes whatever it fetched. */
  cancel(target: Target) {
    return this.remove(target);
  }

  remove(target: Target): Promise<void> {
    const dir = this.dirOf(target);
    if (!dir) return Promise.resolve();
    const job = this.jobs.get(dir);
    const stopping = job ? this.stop(job) : null;
    const had = !!this.byDir[dir];
    delete this.byDir[dir];
    if (!had && !job) return this.removals.get(dir) ?? Promise.resolve();
    const removal = (async () => {
      await stopping;
      await this.writes.get(dir);
      // Rust also waits for any attempt still writing in the folder before deleting it.
      await call('remove_download', { dir }).catch((err) => toast(`Couldn't delete the download. ${errorMessage(err)}`, { tone: 'error' }));
      void this.refreshUsage();
    })();
    this.removals.set(dir, removal);
    void removal.then(() => {
      if (this.removals.get(dir) === removal) this.removals.delete(dir);
    });
    return removal;
  }

  async removeAll(records: DownloadRecord[] = this.list) {
    for (const r of [...records]) await this.remove(r);
  }
}

export const downloads = new Downloads();

// Records are kept per account: show the ones belonging to whoever is signed in now.
onAccountChanged(() => void downloads.reload());
