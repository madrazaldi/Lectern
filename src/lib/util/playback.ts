import type { Chapter, LibraryItem, PodcastEpisode } from '$lib/api/types';

/** Index of the chapter playing at `time` (binary search; clamps to the first/last chapter). */
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

/** Index of the audio track that holds `time`, for tracks laid end to end. */
export function findTrack(tracks: { startOffset: number; duration: number }[], time: number) {
  const i = tracks.findIndex((t) => time >= t.startOffset && time < t.startOffset + t.duration);
  if (i >= 0) return i;
  return time <= 0 ? 0 : tracks.length - 1;
}

export interface QueueEntry {
  itemId: string;
  episodeId: string | null;
  title: string;
  subtitle: string;
  updatedAt?: number;
}

function sequenceNumber(s: string | null | undefined) {
  const n = parseFloat(s ?? '');
  return Number.isFinite(n) ? n : Infinity;
}

/** The first unfinished book after `currentId` in series order. */
export function nextInSeries(books: (LibraryItem & { sequence?: string })[], currentId: string, isFinished: (id: string) => boolean) {
  const sorted = [...books].sort((a, b) => sequenceNumber(a.sequence) - sequenceNumber(b.sequence));
  const at = sorted.findIndex((b) => b.id === currentId);
  if (at < 0) return null;
  return sorted.slice(at + 1).find((b) => !isFinished(b.id) && !b.isMissing) ?? null;
}

/** The first unfinished episode published after `currentId`. */
export function nextEpisode(episodes: PodcastEpisode[], currentId: string, isFinished: (id: string) => boolean) {
  const sorted = [...episodes].sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0));
  const at = sorted.findIndex((e) => e.id === currentId);
  if (at < 0) return null;
  return sorted.slice(at + 1).find((e) => !isFinished(e.id)) ?? null;
}

/** "YYYY-MM-DD" and weekday name in local time, as the server files listening sessions. */
export function sessionDate(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    dayOfWeek: d.toLocaleDateString('en-US', { weekday: 'long' })
  };
}
