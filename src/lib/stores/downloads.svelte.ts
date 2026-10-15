import * as abs from '$lib/api/abs';
import { authHeaders, coverUrl, ensureFreshToken, getCredentials, serverUrl } from '$lib/api/client';
import type { AudioFile, Chapter, LibraryItem, PodcastMetadata } from '$lib/api/types';
import { isBook, isPodcast } from '$lib/api/types';
import { call, inTauri, on } from '$lib/native';
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

export interface DownloadRecord {
  key: string;
  accountId: string;
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
  status: 'downloading' | 'ready' | 'failed';
  error?: string;
  bytesTotal: number;
  bytesDone: number;
  addedAt: number;
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

function extOf(f: AudioFile) {
  const ext = f.metadata.ext || f.metadata.filename.match(/\.[^.]+$/)?.[0] || '';
  return /^\.[A-Za-z0-9]{1,6}$/.test(ext) ? ext.toLowerCase() : '';
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

class Downloads {
  records = $state<Record<string, DownloadRecord>>({});
  usage = $state(0);
  /** Records for the signed-in account, newest first. */
  list = $derived(Object.values(this.records).sort((a, b) => b.addedAt - a.addedAt));

  private files = new Map<string, { record: string; done: number }>();
  private loaded = false;

  async load() {
    if (this.loaded || !inTauri) return;
    this.loaded = true;
    void on<Progress>('download-progress', (p) => this.onProgress(p));
    const account = getCredentials()?.id;
    const metas = await call<string[]>('list_download_meta', {}, []).catch(() => []);
    for (const raw of metas) {
      try {
        const r = JSON.parse(raw) as DownloadRecord;
        if (r.accountId !== account) continue;
        // A download interrupted by quitting is left half-done; show it as failed so it can be retried.
        if (r.status === 'downloading') r.status = 'failed';
        this.records[r.key] = r;
      } catch {
        // Corrupt meta: ignore.
      }
    }
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

  async start(itemId: string, episodeId: string | null = null) {
    const account = getCredentials();
    if (!inTauri || !account) return;
    const key = downloadKey(itemId, episodeId);
    if (this.records[key]?.status === 'downloading') return;

    let record: DownloadRecord;
    try {
      const item = await abs.getItem(itemId);
      record = this.plan(item, episodeId, account.id);
      // Retrying: files that already finished are still on disk.
      const prev = this.records[key];
      if (prev) record.tracks = record.tracks.map((t) => ({ ...t, path: prev.tracks.find((p) => p.fileName === t.fileName)?.path ?? null }));
    } catch (err) {
      toast(`Couldn't start the download. ${errorMessage(err)}`, { tone: 'error' });
      return;
    }
    this.records[key] = record;
    await this.saveMeta(record);

    try {
      await call('download_file', {
        id: `${key}#cover`,
        url: coverUrl(itemId, 800, record.item.updatedAt),
        headers: {},
        dir: record.dir,
        fileName: 'cover.jpg'
      })
        .then((p) => (this.records[key].coverPath = p as string))
        .catch(() => {});

      for (const t of record.tracks) {
        if (t.path) continue;
        await ensureFreshToken();
        if (!this.records[key]) return; // Cancelled between files.
        const sourceIno = record.trackSources[t.index];
        const id = `${key}#${t.index}`;
        this.files.set(id, { record: key, done: 0 });
        const path = await call<string>('download_file', {
          id,
          url: `${serverUrl()}/api/items/${itemId}/file/${sourceIno}`,
          headers: authHeaders(),
          dir: record.dir,
          fileName: t.fileName
        });
        this.files.delete(id);
        const r = this.records[key];
        if (!r) return; // Removed while downloading.
        r.tracks = r.tracks.map((x) => (x.index === t.index ? { ...x, path } : x));
        r.bytesDone = r.tracks.reduce((sum, x) => sum + (x.path ? x.size : 0), 0);
        await this.saveMeta(r);
      }
      const r = this.records[key];
      r.status = 'ready';
      r.bytesDone = r.bytesTotal;
      await this.saveMeta(r);
      toast(`${r.title} is ready to play offline.`);
    } catch (err) {
      const r = this.records[key];
      if (!r) return;
      if (String(err) === 'cancelled') return;
      r.status = 'failed';
      r.error = errorMessage(err);
      await this.saveMeta(r);
      toast(`Download of ${r.title} failed. ${r.error}`, { tone: 'error' });
    } finally {
      void this.refreshUsage();
    }
  }

  private plan(item: LibraryItem, episodeId: string | null, accountId: string): DownloadRecord {
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
      accountId,
      itemId: item.id,
      episodeId,
      dir: safeSegment(`${accountId.slice(0, 8)}-${key}`),
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
    const f = this.files.get(p.id);
    if (!f) return;
    const r = this.records[f.record];
    if (!r) return;
    const finished = r.tracks.reduce((sum, t) => sum + (t.path ? t.size : 0), 0);
    r.bytesDone = Math.min(r.bytesTotal, finished + p.received);
  }

  private async saveMeta(r: DownloadRecord) {
    await call('write_download_meta', { dir: r.dir, json: JSON.stringify($state.snapshot(r)) }).catch((err) =>
      console.error('Could not save download info', err)
    );
  }

  async cancel(key: string) {
    for (const [id, f] of this.files) if (f.record === key) await call('cancel_download', { id });
    await this.remove(key);
  }

  async remove(key: string) {
    const r = this.records[key];
    if (!r) return;
    delete this.records[key];
    for (const [id, f] of this.files) if (f.record === key) await call('cancel_download', { id }).catch(() => {});
    await call('remove_download', { dir: r.dir }).catch((err) => toast(`Couldn't delete the download. ${errorMessage(err)}`, { tone: 'error' }));
    void this.refreshUsage();
  }

  async removeAll() {
    for (const key of Object.keys(this.records)) await this.remove(key);
  }
}

export const downloads = new Downloads();
